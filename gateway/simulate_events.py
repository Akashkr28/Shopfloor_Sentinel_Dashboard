#!/usr/bin/env python3
"""Shopfloor Sentinel – gateway event simulator (hackathon / demo).

Pretends to be the passive monitor on the Raspberry Pi and posts realistic
security events to the backend every 30–60 seconds.

Examples:
  python3 simulate_events.py                      # run forever with random events
  python3 simulate_events.py --once               # send one random event and exit
  python3 simulate_events.py --type USB_INSERT --machine PRESS_LINE_1_HMI --once
  python3 simulate_events.py --burst 10           # 10 events quickly (dashboard demo)
  python3 simulate_events.py --interval 5 15      # faster cadence
"""
import argparse
import random
import time

from sentinel_client import load_config, send_events, start_heartbeat, utc_now


def details_for(event_type):
    """Plausible event details, as a real passive monitor would report them."""
    rnd = random.random
    if event_type == "UNK_REMOTE_LOGIN":
        return {
            "protocol": random.choice(["SSH", "RDP", "VNC", "AnyDesk"]),
            "sourceIp": f"{random.choice(['103.21', '45.155', '192.168'])}.{random.randint(1, 254)}.{random.randint(1, 254)}",
            "failedAttempts": random.choice([1, 2, 3, 6, 12]),
            "loginSucceeded": rnd() < 0.15,
        }
    if event_type == "USB_INSERT":
        return {
            "usbVendor": random.choice(["Generic", "SanDisk", "Kingston", "HP"]),
            "port": random.choice(["USB2_FRONT", "USB1_REAR"]),
            "storageDevice": True,
        }
    if event_type == "ABNORMAL_TRAFFIC":
        return {
            "destinationIp": f"{random.randint(20, 220)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}",
            "destinationPort": random.choice([443, 4444, 6667, 8080, 502]),
            "mbOut": random.choice([3, 12, 45, 150, 420]),
            "connectionsPerMin": random.randint(40, 900),
        }
    if event_type == "NEW_DEVICE":
        mac = ":".join(f"{random.randint(0, 255):02x}" for _ in range(6))
        return {"mac": mac, "vendorHint": random.choice(["Unknown", "Xiaomi", "TP-Link", "Dell"]), "dhcpHostname": random.choice(["android-7f3a", "DESKTOP-K2J", ""])}
    if event_type == "SUSPICIOUS_SOFTWARE":
        return {"process": random.choice(["update_svc.exe", "winlogin32.exe", "ransom_note.txt"]), "hash": f"{random.getrandbits(64):016x}"}
    if event_type == "PLC_WRITE":
        return {"protocol": "Modbus/TCP", "sourceIp": f"192.168.10.{random.randint(60, 90)}", "plcIp": "192.168.10.121", "function": 16, "functionName": "Write Multiple Registers"}
    if event_type == "ROUTINE_CHECK":
        return {"check": random.choice(["heartbeat", "open-ports", "login-audit"]), "result": "ok"}
    return {}


def make_event(cfg, event_type=None, machine=None):
    weights = cfg["eventWeights"]
    event_type = event_type or random.choices(list(weights), weights=list(weights.values()))[0]
    return {
        "eventTypeKey": event_type,
        "machineIdentifier": machine or random.choice(cfg["machines"]),
        "timestamp": utc_now(),
        "details": {**details_for(event_type), "source": "gateway-simulator"},
    }


def emit(cfg, events):
    result = send_events(cfg, events)
    for ev in events:
        print(f"[{ev['timestamp']}] {ev['eventTypeKey']:<20} {ev['machineIdentifier']}")
    if result:
        sevs = ", ".join(f"#{a['id']} {a['severity']}" for a in result.get("alerts", []))
        print(f"   -> backend accepted {result['received']}: {sevs}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", help="path to config.json")
    ap.add_argument("--type", help="event type key, e.g. USB_INSERT")
    ap.add_argument("--machine", help="machine identifier, e.g. PRESS_LINE_1_HMI")
    ap.add_argument("--once", action="store_true", help="send a single event and exit")
    ap.add_argument("--burst", type=int, metavar="N", help="send N events one second apart and exit")
    ap.add_argument("--interval", type=float, nargs=2, metavar=("MIN", "MAX"), help="seconds between events")
    args = ap.parse_args()

    cfg = load_config(args.config)
    lo, hi = args.interval or cfg.get("intervalSeconds", [30, 60])
    print(f"Sentinel simulator -> {cfg['backendUrl']}  (passive, one-way; never touches PLCs)")

    if args.once:
        emit(cfg, [make_event(cfg, args.type, args.machine)])
        return
    if args.burst:
        for _ in range(args.burst):
            emit(cfg, [make_event(cfg, args.type, args.machine)])
            time.sleep(1)
        return
    start_heartbeat(cfg, ["simulator"])
    try:
        while True:
            emit(cfg, [make_event(cfg, args.type, args.machine)])
            time.sleep(random.uniform(lo, hi))
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
