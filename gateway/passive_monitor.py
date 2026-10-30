#!/usr/bin/env python3
"""Shopfloor Sentinel – passive log monitor (real-deployment starting point).

Tails Linux log files on the gateway (or logs shipped to it via syslog) and
turns a few well-understood patterns into Sentinel events:

  * repeated failed SSH / login attempts      -> UNK_REMOTE_LOGIN
  * a successful login from an unknown IP      -> UNK_REMOTE_LOGIN (loginSucceeded)
  * a USB mass-storage device being attached   -> USB_INSERT

It only READS logs and POSTs to the Sentinel backend. It never sends anything
to PLCs, HMIs or other plant devices.

Traffic-based detection (ABNORMAL_TRAFFIC, NEW_DEVICE) would sit on a SPAN /
mirror port with a tool such as Zeek or tcpdump; that is out of scope for the
prototype and is simulated by simulate_events.py instead.

Usage:
  sudo python3 passive_monitor.py --machine PRESS_LINE_1_HMI \
      --auth-log /var/log/auth.log --kern-log /var/log/kern.log
"""
import argparse
import os
import re
import time
from collections import defaultdict, deque

from sentinel_client import load_config, send_events, utc_now

FAILED_RE = re.compile(r"Failed password for (?:invalid user )?(\S+) from (\d+\.\d+\.\d+\.\d+)")
ACCEPTED_RE = re.compile(r"Accepted \S+ for (\S+) from (\d+\.\d+\.\d+\.\d+)")
USB_RE = re.compile(r"usb-storage|USB Mass Storage device detected|New USB device found.*idVendor=(\w+)")

FAIL_THRESHOLD = 5        # failed attempts from one IP ...
FAIL_WINDOW_SEC = 300     # ... within this many seconds


def follow(path):
    """Yield new lines appended to a file (like tail -F), surviving log rotation."""
    while not os.path.exists(path):
        time.sleep(2)
    f = open(path, encoding="utf-8", errors="replace")
    f.seek(0, os.SEEK_END)
    inode = os.fstat(f.fileno()).st_ino
    while True:
        line = f.readline()
        if line:
            yield line
            continue
        time.sleep(0.5)
        try:
            if os.stat(path).st_ino != inode:
                f.close()
                f = open(path, encoding="utf-8", errors="replace")
                inode = os.fstat(f.fileno()).st_ino
        except FileNotFoundError:
            pass
        yield None  # lets the caller interleave several files


def main():
    ap = argparse.ArgumentParser(description="Passive log monitor for Shopfloor Sentinel")
    ap.add_argument("--machine", required=True, help="machine identifier these logs belong to")
    ap.add_argument("--auth-log", default="/var/log/auth.log")
    ap.add_argument("--kern-log", default="/var/log/kern.log")
    ap.add_argument("--trusted-ips", default="", help="comma-separated IPs that may log in without an alert")
    ap.add_argument("--config")
    args = ap.parse_args()

    cfg = load_config(args.config)
    trusted = {ip.strip() for ip in args.trusted_ips.split(",") if ip.strip()}
    failures = defaultdict(deque)
    alerted_ips = {}

    def event(kind, details):
        ev = {"eventTypeKey": kind, "machineIdentifier": args.machine, "timestamp": utc_now(),
              "details": {**details, "source": "passive-monitor"}}
        send_events(cfg, [ev])
        print(f"[{ev['timestamp']}] {kind} {details}")

    streams = [("auth", follow(args.auth_log)), ("kern", follow(args.kern_log))]
    print(f"Watching {args.auth_log} and {args.kern_log} for {args.machine} (read-only)")
    while True:
        for name, stream in streams:
            line = next(stream)
            if not line:
                continue
            if name == "auth":
                m = FAILED_RE.search(line)
                if m:
                    user, ip = m.groups()
                    now = time.time()
                    q = failures[ip]
                    q.append(now)
                    while q and now - q[0] > FAIL_WINDOW_SEC:
                        q.popleft()
                    # One alert per IP per window, so a brute-force run is one event, not hundreds.
                    if len(q) >= FAIL_THRESHOLD and now - alerted_ips.get(ip, 0) > FAIL_WINDOW_SEC:
                        alerted_ips[ip] = now
                        event("UNK_REMOTE_LOGIN", {"protocol": "SSH", "sourceIp": ip, "user": user, "failedAttempts": len(q)})
                    continue
                m = ACCEPTED_RE.search(line)
                if m and m.group(2) not in trusted:
                    event("UNK_REMOTE_LOGIN", {"protocol": "SSH", "sourceIp": m.group(2), "user": m.group(1), "loginSucceeded": True})
            elif name == "kern" and USB_RE.search(line):
                m = USB_RE.search(line)
                event("USB_INSERT", {"usbVendor": m.group(1) if m.lastindex else "unknown", "logLine": line.strip()[:200]})


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nstopped")
