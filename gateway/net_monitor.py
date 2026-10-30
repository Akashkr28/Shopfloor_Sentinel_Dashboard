#!/usr/bin/env python3
"""Shopfloor Sentinel – passive network monitor.

Plug the Raspberry Pi into a SPAN / mirror port of the plant switch and run:

  sudo python3 net_monitor.py --iface eth0

or analyse a capture taken elsewhere (works on any OS):

  python3 net_monitor.py --pcap capture.pcap --dry-run

It only LISTENS. It never sends a single packet to the plant network, never
talks to PLCs or HMIs, and only reports findings to the Sentinel backend.

Detections (all configurable in config.json → "network"):
  NEW_DEVICE          a MAC address not seen during the learning period
  UNK_REMOTE_LOGIN    SSH / Telnet / RDP / VNC / TeamViewer / AnyDesk connection attempts
                      to a machine from a computer that is not on the trusted list
  PLC_WRITE           Modbus/TCP write or programming request to a PLC from a
                      computer that is not an engineering station
  ABNORMAL_TRAFFIC    a PLC/HMI talking to the internet, traffic to known-bad ports,
                      large uploads to the internet, or a port scan
"""
import argparse
import json
import os
from collections import defaultdict

from sentinel_client import Cooldown, EventSender, load_config, log, start_heartbeat
from sentinel_net import MODBUS_WRITE_FUNCTIONS, Networks, is_public, is_unicast_mac, live_capture, modbus_requests, parse, read_pcap

REMOTE_PORTS = {22: "SSH", 23: "Telnet", 3389: "RDP", 5900: "VNC", 5901: "VNC", 5902: "VNC", 5938: "TeamViewer", 7070: "AnyDesk", 6568: "AnyDesk"}
DEFAULTS = {
    "internalNetworks": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
    "learnMinutes": 60,
    "assets": [],
    "engineeringStations": [],
    "trustedRemoteSources": [],
    "ignoreMacs": [],
    "defaultMachine": "OFFICE_LAN",
    "outboundMbThreshold": 50,
    "windowSeconds": 300,
    "scanDistinctTargets": 30,
    "scanWindowSeconds": 60,
    "remoteBurstThreshold": 10,
    "cooldownMinutes": 10,
    "badPorts": [4444, 6667, 1337, 31337],
}


class NetworkDetector:
    """Feed it parsed packets; it calls emit(eventTypeKey, machineIdentifier, details)."""

    def __init__(self, ncfg, emit, state_dir=None, start_ts=None):
        c = {**DEFAULTS, **(ncfg or {})}
        self.c = c
        self.emit = emit
        self.internal = Networks(c["internalNetworks"])
        self.eng_stations = set(c["engineeringStations"])
        self.trusted_remote = set(c["trustedRemoteSources"]) | self.eng_stations
        self.ignore_macs = {m.lower() for m in c["ignoreMacs"]}
        self.bad_ports = set(c["badPorts"])
        self.ip_to_asset = {}
        for a in c["assets"]:
            for ip in a.get("ips", []):
                self.ip_to_asset[ip] = a
        self.cool = Cooldown(c["cooldownMinutes"] * 60)
        self.state_file = os.path.join(state_dir, "known_devices.json") if state_dir else None
        self.known = self._load_known()
        self.start_ts = start_ts
        self.remote_hits = defaultdict(list)  # (src, dst, port) -> [ts]
        self.scan = defaultdict(dict)  # src -> {(dst, port): ts}
        self.outbound = defaultdict(lambda: {"bytes": 0, "dsts": defaultdict(int), "start": None})
        self.stats = {"packets": 0, "events": 0, "knownDevices": len(self.known.get("macs", {}))}

    # ---------- state ----------
    def _load_known(self):
        if self.state_file and os.path.exists(self.state_file):
            try:
                with open(self.state_file, encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, ValueError):
                log("known_devices.json unreadable – relearning")
        return {"macs": {}}

    def _save_known(self):
        if not self.state_file:
            return
        os.makedirs(os.path.dirname(self.state_file), exist_ok=True)
        tmp = self.state_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.known, f, indent=1)
        os.replace(tmp, self.state_file)

    def learning(self, ts):
        if self.known.get("learnedAt"):
            return False
        if self.start_ts is None:
            self.start_ts = ts
        if ts - self.start_ts >= self.c["learnMinutes"] * 60:
            self.known["learnedAt"] = ts
            self._save_known()
            log(f"learning finished – {len(self.known['macs'])} devices are now the baseline")
            return False
        return True

    # ---------- helpers ----------
    def machine_for(self, *ips):
        for ip in ips:
            a = self.ip_to_asset.get(ip)
            if a:
                return a["identifier"]
        return self.c["defaultMachine"]

    def role_of(self, ip):
        return (self.ip_to_asset.get(ip) or {}).get("role")

    def _emit(self, key, event_type, machine, details):
        if not self.cool.ready(key, details.get("_ts")):
            return
        details.pop("_ts", None)
        self.stats["events"] += 1
        self.emit(event_type, machine, {**details, "source": "net-monitor"})

    # ---------- main entry ----------
    def feed(self, pkt):
        if pkt is None:
            return
        self.stats["packets"] += 1
        ts = pkt.ts
        self._devices(pkt, ts)
        if pkt.src_ip is None:
            return
        if pkt.proto == 6:
            if pkt.is_syn:
                self._remote_access(pkt, ts)
                self._port_scan(pkt, ts)
            if pkt.dst_port == 502 and pkt.payload:
                self._modbus(pkt, ts)
        self._outbound(pkt, ts)

    def _devices(self, pkt, ts):
        candidates = []
        if pkt.arp and pkt.arp["sender_ip"] != "0.0.0.0":
            candidates.append((pkt.arp["sender_mac"], pkt.arp["sender_ip"]))
        elif pkt.src_ip and pkt.src_ip in self.internal:
            candidates.append((pkt.src_mac, pkt.src_ip))
        for mac, ip in candidates:
            if not is_unicast_mac(mac) or mac in self.ignore_macs:
                continue
            macs = self.known.setdefault("macs", {})
            if mac in macs:
                if macs[mac].get("ip") != ip:
                    macs[mac]["ip"] = ip
                continue
            macs[mac] = {"ip": ip, "firstSeen": ts}
            self.stats["knownDevices"] = len(macs)
            learning = self.learning(ts)
            self._save_known()
            if not learning:
                self._emit(("dev", mac), "NEW_DEVICE", self.machine_for(ip), {"mac": mac, "ip": ip, "oui": mac[:8], "_ts": ts})

    def _remote_access(self, pkt, ts):
        service = REMOTE_PORTS.get(pkt.dst_port)
        if not service or pkt.src_ip in self.trusted_remote:
            return
        if pkt.dst_ip not in self.internal:  # outbound remote sessions are the IT team's business
            return
        key = (pkt.src_ip, pkt.dst_ip, pkt.dst_port)
        hits = [t for t in self.remote_hits[key] if ts - t < self.c["windowSeconds"]] + [ts]
        self.remote_hits[key] = hits
        external = pkt.src_ip not in self.internal
        details = {"protocol": service, "sourceIp": pkt.src_ip, "targetIp": pkt.dst_ip, "port": pkt.dst_port,
                   "connectionAttempts": len(hits), "externalSource": external, "_ts": ts}
        machine = self.machine_for(pkt.dst_ip)
        if len(hits) == 1:
            self._emit(("remote", key), "UNK_REMOTE_LOGIN", machine, details)
        elif len(hits) == self.c["remoteBurstThreshold"]:
            # A burst (password guessing) is reported once more so the backend can raise it to red.
            self._emit(("remote-burst", key), "UNK_REMOTE_LOGIN", machine, details)

    def _port_scan(self, pkt, ts):
        seen = self.scan[pkt.src_ip]
        seen[(pkt.dst_ip, pkt.dst_port)] = ts
        window = self.c["scanWindowSeconds"]
        if len(seen) > 4 * self.c["scanDistinctTargets"]:
            for k in [k for k, t in seen.items() if ts - t > window]:
                del seen[k]
        recent = [k for k, t in seen.items() if ts - t <= window]
        if len(recent) >= self.c["scanDistinctTargets"]:
            hosts = {h for h, _ in recent}
            self._emit(("scan", pkt.src_ip), "ABNORMAL_TRAFFIC", self.machine_for(*sorted(hosts), pkt.src_ip), {
                "kind": "port-scan", "sourceIp": pkt.src_ip, "distinctTargets": len(recent),
                "hosts": len(hosts), "windowSeconds": window, "_ts": ts,
            })
            seen.clear()

    def _modbus(self, pkt, ts):
        if pkt.src_ip in self.eng_stations:
            return
        for unit, fn in modbus_requests(pkt.payload):
            if fn in MODBUS_WRITE_FUNCTIONS:
                self._emit(("modbus", pkt.src_ip, pkt.dst_ip), "PLC_WRITE", self.machine_for(pkt.dst_ip), {
                    "protocol": "Modbus/TCP", "sourceIp": pkt.src_ip, "plcIp": pkt.dst_ip, "unitId": unit,
                    "function": fn, "functionName": MODBUS_WRITE_FUNCTIONS[fn], "_ts": ts,
                })
                return

    def _outbound(self, pkt, ts):
        src, dst = pkt.src_ip, pkt.dst_ip
        if src not in self.internal or not is_public(dst):
            return
        machine = self.machine_for(src)
        if pkt.dst_port in self.bad_ports:
            self._emit(("badport", src, dst, pkt.dst_port), "ABNORMAL_TRAFFIC", machine, {
                "kind": "known-bad-port", "sourceIp": src, "destinationIp": dst, "destinationPort": pkt.dst_port,
                "knownBadDestination": True, "_ts": ts,
            })
        if self.role_of(src) in ("plc", "hmi"):
            self._emit(("ot-internet", src), "ABNORMAL_TRAFFIC", machine, {
                "kind": "ot-internet-connection", "sourceIp": src, "destinationIp": dst, "destinationPort": pkt.dst_port, "_ts": ts,
            })
        o = self.outbound[src]
        if o["start"] is None or ts - o["start"] > self.c["windowSeconds"]:
            o.update(bytes=0, dsts=defaultdict(int), start=ts)
        o["bytes"] += pkt.ip_len
        o["dsts"][dst] += pkt.ip_len
        mb = o["bytes"] / 1e6
        if mb >= self.c["outboundMbThreshold"]:
            top = sorted(o["dsts"].items(), key=lambda kv: -kv[1])[:3]
            self._emit(("upload", src), "ABNORMAL_TRAFFIC", machine, {
                "kind": "large-upload", "sourceIp": src, "mbOut": round(mb, 1), "windowSeconds": self.c["windowSeconds"],
                "topDestinations": [d for d, _ in top], "destinationIp": top[0][0], "_ts": ts,
            })
            o.update(bytes=0, dsts=defaultdict(int), start=ts)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--iface", help="mirror-port interface, e.g. eth0 (default: config network.interface)")
    src.add_argument("--pcap", help="analyse a .pcap file instead of live capture")
    ap.add_argument("--config", help="path to config.json")
    ap.add_argument("--dry-run", action="store_true", help="print findings, don't send them")
    ap.add_argument("--no-learning", action="store_true", help="skip the learning period: report every device not already in the saved baseline")
    args = ap.parse_args()

    cfg = load_config(args.config)
    ncfg = dict(cfg.get("network", {}))
    if args.no_learning:
        ncfg["learnMinutes"] = 0
    sender = EventSender(cfg, dry_run=args.dry_run)
    state_dir = None if args.pcap else cfg["stateDir"]
    det = NetworkDetector(ncfg, sender.emit, state_dir=state_dir)

    if args.pcap:
        frames = read_pcap(args.pcap)
        log(f"analysing {args.pcap}")
    else:
        iface = args.iface or ncfg.get("interface", "eth0")
        frames = live_capture(iface)
        if not args.dry_run:
            start_heartbeat(cfg, ["network"], lambda: {**det.stats, "learning": not det.known.get("learnedAt")})
        log(f"listening on {iface} (read-only). Learning period: {det.c['learnMinutes']} min")

    try:
        for ts, frame in frames:
            if frame is not None:
                det.feed(parse(frame, ts))
    except KeyboardInterrupt:
        pass
    sender.flush()
    log(f"done: {det.stats['packets']} packets, {det.stats['events']} findings")


if __name__ == "__main__":
    main()
