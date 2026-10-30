#!/usr/bin/env python3
"""Write demo.pcap: an hour of normal plant traffic, then an attack, so the real
network monitor can be demonstrated without plant hardware.

  python3 make_demo_pcap.py
  python3 net_monitor.py --pcap demo.pcap          # findings go to the dashboard

Uses the IP addresses from config.json → network.assets.
"""
import os

from sentinel_net import TCP_ACK, TCP_PSH, build_arp, build_modbus, build_tcp, write_pcap

HERE = os.path.dirname(os.path.abspath(__file__))

ENG = ("02:00:00:00:00:05", "192.168.10.5")
HMI1 = ("02:00:00:00:00:21", "192.168.10.21")
HMI2 = ("02:00:00:00:00:22", "192.168.10.22")
CNC = ("02:00:00:00:00:31", "192.168.10.31")
PACK = ("02:00:00:00:00:41", "192.168.10.41")
PLC1 = ("02:00:00:00:01:21", "192.168.10.121")
ROUTER = ("02:00:00:00:00:01", "192.168.10.1")
LAPTOP = ("3c:22:fb:91:0a:7e", "192.168.10.77")  # the visitor's laptop


def main(path=os.path.join(HERE, "demo.pcap")):
    frames = []
    t = 1_700_000_000.0
    # Normal hour: devices announce themselves, the engineering station polls and writes to the PLC.
    for minute in range(62):
        ts = t + minute * 60
        for mac, ip in (ENG, HMI1, HMI2, CNC, PACK, PLC1, ROUTER):
            frames.append((ts, build_arp(mac, ip, ROUTER[1])))
        frames.append((ts + 1, build_tcp(ENG[0], PLC1[0], ENG[1], PLC1[1], 40000, 502, TCP_PSH | TCP_ACK, build_modbus(3))))
        frames.append((ts + 2, build_tcp(ENG[0], PLC1[0], ENG[1], PLC1[1], 40000, 502, TCP_PSH | TCP_ACK, build_modbus(6))))
        frames.append((ts + 3, build_tcp(HMI1[0], PLC1[0], HMI1[1], PLC1[1], 40001, 502, TCP_PSH | TCP_ACK, build_modbus(3))))

    a = t + 62 * 60
    # 1. A laptop appears on the plant network.
    frames.append((a, build_arp(LAPTOP[0], LAPTOP[1], ROUTER[1])))
    # 2. It scans the PLC …
    for i, port in enumerate(list(range(20, 60)) + [102, 443, 502, 8080]):
        frames.append((a + 5 + i * 0.05, build_tcp(LAPTOP[0], PLC1[0], LAPTOP[1], PLC1[1], 51000, port)))
    # 3. … tries RDP on the Press Line 1 HMI over and over …
    for i in range(12):
        frames.append((a + 20 + i * 2, build_tcp(LAPTOP[0], HMI1[0], LAPTOP[1], HMI1[1], 52000 + i, 3389)))
    # 4. … and writes registers on the PLC.
    frames.append((a + 60, build_tcp(LAPTOP[0], PLC1[0], LAPTOP[1], PLC1[1], 53000, 502, TCP_PSH | TCP_ACK, build_modbus(16, data=b"\x00\x10\x00\x02\x04\x00\x63\x00\x00"))))
    # 5. The HMI then connects out to a known-bad port on the internet.
    frames.append((a + 90, build_tcp(HMI1[0], ROUTER[0], HMI1[1], "185.220.101.4", 49152, 4444)))

    write_pcap(path, frames)
    print(f"wrote {path} ({len(frames)} frames)")


if __name__ == "__main__":
    main()
