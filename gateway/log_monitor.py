#!/usr/bin/env python3
"""Shopfloor Sentinel – passive log monitor.

Watches log files on the gateway and receives syslog forwarded from HMIs /
engineering PCs (Windows via NXLog, Snare or Windows Event Forwarding → syslog;
Linux via rsyslog), then turns well-understood patterns into Sentinel events:

  Linux
    repeated failed SSH logins                       -> UNK_REMOTE_LOGIN
    successful SSH login from an untrusted IP        -> UNK_REMOTE_LOGIN (loginSucceeded)
    USB mass-storage device attached                 -> USB_INSERT
  Windows (Security / System / Defender event IDs)
    4625 repeated failed logons                      -> UNK_REMOTE_LOGIN
    4624 logon type 10 (RDP) from an untrusted IP    -> UNK_REMOTE_LOGIN (loginSucceeded)
    6416, DriverFrameworks 2003/2100, USBSTOR        -> USB_INSERT
    7045 / 4697 new service installed                -> SUSPICIOUS_SOFTWARE
    1102 / 104 audit log cleared                     -> SUSPICIOUS_SOFTWARE
    Defender 1116 / 1117 malware detected            -> SUSPICIOUS_SOFTWARE

It only READS. It never sends anything to PLCs, HMIs or other plant devices.

Usage:
  sudo python3 log_monitor.py                         # files + syslog from config.json → "logs"
  python3 log_monitor.py --replay hmi.log --host 192.168.10.21 --dry-run
"""
import argparse
import os
import re
import socket
import threading
import time
from collections import defaultdict, deque

from sentinel_client import Cooldown, EventSender, load_config, log, start_heartbeat

# ---------- Linux ----------
SSH_FAILED = re.compile(r"Failed password for (?:invalid user )?(\S+) from (\d+\.\d+\.\d+\.\d+)")
SSH_ACCEPTED = re.compile(r"Accepted \S+ for (\S+) from (\d+\.\d+\.\d+\.\d+)")
LINUX_USB = re.compile(r"usb-storage \d|USB Mass Storage device detected|New USB device found.*idVendor=(\w+)")

# ---------- Windows (key=value, JSON, Snare tab-separated, or rendered text) ----------
WIN_EVENT_ID = re.compile(r'(?:"?EventI[Dd]"?\s*[:=]\s*"?|EventCode=|MSWinEventLog\t\d+\t\w+\t\d+\t[^\t]+\t)(\d{2,5})')
WIN_SRC_IP = re.compile(r'(?:"?IpAddress"?\s*[:=]\s*"?|Source Network Address:\s*)(\d+\.\d+\.\d+\.\d+)')
WIN_LOGON_TYPE = re.compile(r'(?:"?LogonType"?\s*[:=]\s*"?|Logon Type:\s*)(\d+)')
WIN_USER = re.compile(r'(?:"?TargetUserName"?\s*[:=]\s*"?|Account Name:\s*)([^"\s,\t]+)')
WIN_SERVICE = re.compile(r'(?:"?ServiceName"?\s*[:=]\s*"?|Service Name:\s*)([^",\t\r\n]+)')
WIN_THREAT = re.compile(r'(?:"?Threat Name"?\s*[:=]\s*"?|Name:\s*)([A-Za-z]+:[^",\t\r\n]+)')
WIN_HOST = re.compile(r'(?:"?Hostname"?\s*[:=]\s*"?|"?Computer"?\s*[:=]\s*"?)([A-Za-z0-9_.-]+)')
SYSLOG_PRI = re.compile(r"^<\d{1,3}>(?:1 )?")

DEFAULTS = {
    "files": [],  # [{"path": "/var/log/auth.log", "machine": "GATEWAY"}]
    "syslogPort": 5514,
    "syslogBind": "0.0.0.0",
    "failedLoginThreshold": 5,
    "failedLoginWindowSeconds": 300,
    "trustedIps": [],
    "cooldownMinutes": 10,
    "defaultMachine": "OFFICE_LAN",
}


class LogDetector:
    """feed(line, host) for every log line; calls emit(eventTypeKey, machineIdentifier, details)."""

    def __init__(self, lcfg, emit, assets=(), trusted=()):
        self.c = {**DEFAULTS, **(lcfg or {})}
        self.emit = emit
        self.trusted = set(self.c["trustedIps"]) | set(trusted)
        self.by_ip, self.by_host = {}, {}
        for a in assets:
            for ip in a.get("ips", []):
                self.by_ip[ip] = a["identifier"]
            for h in a.get("hostnames", []):
                self.by_host[h.lower()] = a["identifier"]
        self.failures = defaultdict(deque)
        self.cool = Cooldown(self.c["cooldownMinutes"] * 60)
        self.lock = threading.Lock()
        self.stats = {"lines": 0, "events": 0}

    def machine_for(self, host, line, default=None):
        m = WIN_HOST.search(line)
        for key in (host, m.group(1) if m else None):
            if key and key in self.by_ip:
                return self.by_ip[key]
            if key and key.lower() in self.by_host:
                return self.by_host[key.lower()]
            if key and key.lower().split(".")[0] in self.by_host:
                return self.by_host[key.lower().split(".")[0]]
        return default or self.c["defaultMachine"]

    def _emit(self, key, event_type, machine, details, now):
        if not self.cool.ready(key, now):
            return
        self.stats["events"] += 1
        self.emit(event_type, machine, {**details, "source": "log-monitor"})

    def _failed_login(self, machine, ip, user, protocol, now):
        q = self.failures[(machine, ip)]
        q.append(now)
        while q and now - q[0] > self.c["failedLoginWindowSeconds"]:
            q.popleft()
        if len(q) >= self.c["failedLoginThreshold"]:
            self._emit(("fail", machine, ip), "UNK_REMOTE_LOGIN", machine,
                       {"protocol": protocol, "sourceIp": ip, "user": user, "failedAttempts": len(q)}, now)

    def feed(self, line, host=None, default_machine=None, now=None):
        now = time.time() if now is None else now
        line = SYSLOG_PRI.sub("", line.strip())
        if not line:
            return
        with self.lock:
            self.stats["lines"] += 1
            machine = self.machine_for(host, line, default_machine)
            if self._windows(line, machine, now):
                return
            self._linux(line, machine, now)

    def _linux(self, line, machine, now):
        m = SSH_FAILED.search(line)
        if m:
            self._failed_login(machine, m.group(2), m.group(1), "SSH", now)
            return
        m = SSH_ACCEPTED.search(line)
        if m and m.group(2) not in self.trusted:
            self._emit(("ok", machine, m.group(2)), "UNK_REMOTE_LOGIN", machine,
                       {"protocol": "SSH", "sourceIp": m.group(2), "user": m.group(1), "loginSucceeded": True}, now)
            return
        m = LINUX_USB.search(line)
        if m:
            self._emit(("usb", machine), "USB_INSERT", machine,
                       {"usbVendor": (m.group(1) if m.lastindex else None) or "unknown", "logLine": line[:200]}, now)

    def _windows(self, line, machine, now):
        m = WIN_EVENT_ID.search(line)
        if not m:
            return "USBSTOR" in line and self._usb_win(line, machine, now)
        eid = int(m.group(1))
        ip = (WIN_SRC_IP.search(line) or [None, None])[1]
        user = (WIN_USER.search(line) or [None, None])[1]
        if eid == 4625:
            self._failed_login(machine, ip or "unknown", user, "Windows logon", now)
        elif eid == 4624:
            lt = WIN_LOGON_TYPE.search(line)
            if lt and lt.group(1) == "10" and ip and ip not in self.trusted and ip not in ("127.0.0.1", "-"):
                self._emit(("rdp", machine, ip), "UNK_REMOTE_LOGIN", machine,
                           {"protocol": "RDP", "sourceIp": ip, "user": user, "loginSucceeded": True}, now)
        elif eid in (6416, 2003, 2100) or "USBSTOR" in line:
            self._usb_win(line, machine, now)
        elif eid in (7045, 4697):
            svc = (WIN_SERVICE.search(line) or [None, "unknown"])[1].strip()
            self._emit(("svc", machine, svc), "SUSPICIOUS_SOFTWARE", machine, {"kind": "new-service", "service": svc[:120]}, now)
        elif eid in (1102, 104):
            self._emit(("clear", machine), "SUSPICIOUS_SOFTWARE", machine, {"kind": "audit-log-cleared", "eventId": eid}, now)
        elif eid in (1116, 1117):
            threat = (WIN_THREAT.search(line) or [None, "unknown"])[1].strip()
            self._emit(("av", machine, threat), "SUSPICIOUS_SOFTWARE", machine, {"kind": "antivirus-detection", "threat": threat[:120]}, now)
        else:
            return False
        return True

    def _usb_win(self, line, machine, now):
        self._emit(("usb", machine), "USB_INSERT", machine, {"logLine": line[:200], "os": "windows"}, now)
        return True


# ---------- inputs ----------

def tail_file(path, on_line):
    """Follow a file like `tail -F`, surviving log rotation."""
    while not os.path.exists(path):
        time.sleep(5)
    f = open(path, encoding="utf-8", errors="replace")
    f.seek(0, os.SEEK_END)
    inode = os.fstat(f.fileno()).st_ino
    while True:
        line = f.readline()
        if line:
            on_line(line)
            continue
        time.sleep(0.5)
        try:
            if os.stat(path).st_ino != inode:
                f.close()
                f = open(path, encoding="utf-8", errors="replace")
                inode = os.fstat(f.fileno()).st_ino
        except FileNotFoundError:
            pass


def syslog_server(bind, port, on_line):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((bind, port))
    log(f"syslog listening on udp/{port}")
    while True:
        data, (ip, _port) = s.recvfrom(65535)
        for line in data.decode("utf-8", "replace").splitlines():
            on_line(line, ip)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config")
    ap.add_argument("--replay", help="feed the lines of this file once and exit")
    ap.add_argument("--host", help="sender IP / hostname for --replay lines")
    ap.add_argument("--no-syslog", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="print findings, don't send them")
    args = ap.parse_args()

    cfg = load_config(args.config)
    lcfg = cfg.get("logs", {})
    ncfg = cfg.get("network", {})
    sender = EventSender(cfg, dry_run=args.dry_run)
    det = LogDetector(lcfg, sender.emit, assets=ncfg.get("assets", []), trusted=ncfg.get("trustedRemoteSources", []))

    if args.replay:
        with open(args.replay, encoding="utf-8", errors="replace") as f:
            for line in f:
                det.feed(line, host=args.host)
        sender.flush()
        log(f"replayed {det.stats['lines']} lines, {det.stats['events']} findings")
        return

    threads = []
    for spec in det.c["files"]:
        path, machine = spec["path"], spec.get("machine")
        t = threading.Thread(target=tail_file, args=(path, lambda line, m=machine: det.feed(line, default_machine=m)), daemon=True)
        t.start()
        threads.append(t)
        log(f"watching {path}" + (f" as {machine}" if machine else ""))
    if not args.no_syslog:
        t = threading.Thread(target=syslog_server, args=(det.c["syslogBind"], det.c["syslogPort"], lambda line, ip: det.feed(line, host=ip)), daemon=True)
        t.start()
        threads.append(t)
    if not threads:
        raise SystemExit('Nothing to watch – add "logs.files" to config.json or enable syslog')
    if not args.dry_run:
        start_heartbeat(cfg, ["logs"], lambda: dict(det.stats))
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        sender.flush()


if __name__ == "__main__":
    main()
