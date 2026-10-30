import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from net_monitor import NetworkDetector  # noqa: E402
from sentinel_net import (  # noqa: E402
    TCP_ACK, TCP_PSH, TCP_SYN, build_arp, build_modbus, build_tcp, build_udp, modbus_requests, parse, read_pcap, write_pcap,
)

HMI_MAC, HMI_IP = "02:00:00:00:00:21", "192.168.10.21"
PLC_MAC, PLC_IP = "02:00:00:00:01:21", "192.168.10.121"
ENG_MAC, ENG_IP = "02:00:00:00:00:05", "192.168.10.5"
ROGUE_MAC, ROGUE_IP = "02:00:00:00:00:99", "192.168.10.99"
GW_MAC = "02:00:00:00:00:01"

CFG = {
    "learnMinutes": 1,
    "assets": [
        {"identifier": "PRESS_LINE_1_HMI", "role": "hmi", "ips": [HMI_IP]},
        {"identifier": "PRESS_LINE_1_PLC", "role": "plc", "ips": [PLC_IP]},
    ],
    "engineeringStations": [ENG_IP],
    "trustedRemoteSources": [ENG_IP],
    "outboundMbThreshold": 0.01,
    "scanDistinctTargets": 10,
    "remoteBurstThreshold": 5,
}


class Collector:
    def __init__(self):
        self.events = []

    def __call__(self, kind, machine, details):
        self.events.append((kind, machine, details))

    def kinds(self):
        return [e[0] for e in self.events]


def detector(**over):
    c = Collector()
    d = NetworkDetector({**CFG, **over}, c, start_ts=0)
    # Finish learning with the two known devices.
    d.feed(parse(build_arp(HMI_MAC, HMI_IP, PLC_IP), 1))
    d.feed(parse(build_arp(ENG_MAC, ENG_IP, PLC_IP), 2))
    d.feed(parse(build_arp(PLC_MAC, PLC_IP, HMI_IP), 61))  # first packet after learning → learned
    c.events.clear()
    return d, c


class ParsingTests(unittest.TestCase):
    def test_tcp_syn_and_ports(self):
        p = parse(build_tcp(ROGUE_MAC, HMI_MAC, ROGUE_IP, HMI_IP, 50000, 3389), 5)
        self.assertEqual((p.src_ip, p.dst_ip, p.src_port, p.dst_port), (ROGUE_IP, HMI_IP, 50000, 3389))
        self.assertTrue(p.is_syn)
        ack = parse(build_tcp(ROGUE_MAC, HMI_MAC, ROGUE_IP, HMI_IP, 50000, 3389, flags=TCP_SYN | TCP_ACK), 5)
        self.assertFalse(ack.is_syn)

    def test_arp(self):
        p = parse(build_arp(ROGUE_MAC, ROGUE_IP, HMI_IP), 1)
        self.assertEqual(p.arp["sender_ip"], ROGUE_IP)
        self.assertEqual(p.arp["sender_mac"], ROGUE_MAC)

    def test_modbus_functions(self):
        payload = build_modbus(3) + build_modbus(16, tid=2)
        self.assertEqual([fn for _u, fn in modbus_requests(payload)], [3, 16])
        self.assertEqual(list(modbus_requests(b"garbage")), [])

    def test_short_and_odd_frames_are_ignored(self):
        self.assertIsNone(parse(b"\x00" * 5))
        udp = parse(build_udp(HMI_MAC, PLC_MAC, HMI_IP, PLC_IP, 1000, 2000, b"hi"))
        self.assertEqual(udp.payload, b"hi")

    def test_pcap_roundtrip(self):
        frames = [(100.5, build_arp(HMI_MAC, HMI_IP, PLC_IP)), (101.25, build_tcp(ROGUE_MAC, HMI_MAC, ROGUE_IP, HMI_IP, 1, 22))]
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "t.pcap")
            write_pcap(path, frames)
            back = list(read_pcap(path))
        self.assertEqual(len(back), 2)
        self.assertAlmostEqual(back[1][0], 101.25, places=3)
        self.assertEqual(back[1][1], frames[1][1])


class DetectionTests(unittest.TestCase):
    def test_learning_then_new_device(self):
        d, c = detector()
        d.feed(parse(build_arp(HMI_MAC, HMI_IP, PLC_IP), 70))  # known → nothing
        self.assertEqual(c.events, [])
        d.feed(parse(build_arp(ROGUE_MAC, ROGUE_IP, HMI_IP), 71))
        self.assertEqual(c.kinds(), ["NEW_DEVICE"])
        self.assertEqual(c.events[0][2]["mac"], ROGUE_MAC)
        d.feed(parse(build_arp(ROGUE_MAC, ROGUE_IP, HMI_IP), 72))  # reported once
        self.assertEqual(len(c.events), 1)

    def test_devices_during_learning_are_silent(self):
        c = Collector()
        d = NetworkDetector({**CFG, "learnMinutes": 10}, c, start_ts=0)
        d.feed(parse(build_arp(ROGUE_MAC, ROGUE_IP, HMI_IP), 30))
        self.assertEqual(c.events, [])

    def test_remote_access_from_untrusted_host(self):
        d, c = detector()
        d.feed(parse(build_tcp(ROGUE_MAC, HMI_MAC, ROGUE_IP, HMI_IP, 50000, 3389), 100))
        rdp = [e for e in c.events if e[0] == "UNK_REMOTE_LOGIN"]
        self.assertEqual(len(rdp), 1)
        kind, machine, details = rdp[0]
        self.assertEqual(machine, "PRESS_LINE_1_HMI")
        self.assertEqual(details["protocol"], "RDP")
        self.assertFalse(details["externalSource"])

    def test_remote_burst_reported_again_for_escalation(self):
        d, c = detector()
        for i in range(5):
            d.feed(parse(build_tcp(ROGUE_MAC, HMI_MAC, ROGUE_IP, HMI_IP, 50000 + i, 22), 100 + i))
        logins = [e[2] for e in c.events if e[0] == "UNK_REMOTE_LOGIN"]
        self.assertEqual([x["connectionAttempts"] for x in logins], [1, 5])

    def test_trusted_engineering_station_is_ignored(self):
        d, c = detector()
        d.feed(parse(build_tcp(ENG_MAC, HMI_MAC, ENG_IP, HMI_IP, 50000, 3389), 100))
        d.feed(parse(build_tcp(ENG_MAC, PLC_MAC, ENG_IP, PLC_IP, 50001, 502, flags=TCP_PSH | TCP_ACK, payload=build_modbus(16)), 101))
        self.assertEqual(c.events, [])

    def test_modbus_write_from_unknown_host(self):
        d, c = detector()
        read = build_tcp(ROGUE_MAC, PLC_MAC, ROGUE_IP, PLC_IP, 50000, 502, flags=TCP_PSH | TCP_ACK, payload=build_modbus(3))
        d.feed(parse(read, 100))
        self.assertNotIn("PLC_WRITE", c.kinds())
        write = build_tcp(ROGUE_MAC, PLC_MAC, ROGUE_IP, PLC_IP, 50000, 502, flags=TCP_PSH | TCP_ACK, payload=build_modbus(6))
        d.feed(parse(write, 101))
        ev = [e for e in c.events if e[0] == "PLC_WRITE"]
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0][1], "PRESS_LINE_1_PLC")
        self.assertEqual(ev[0][2]["functionName"], "Write Single Register")

    def test_plc_talking_to_internet_and_bad_port(self):
        d, c = detector()
        d.feed(parse(build_tcp(PLC_MAC, GW_MAC, PLC_IP, "45.33.32.156", 40000, 4444), 100))
        kinds = sorted(e[2]["kind"] for e in c.events if e[0] == "ABNORMAL_TRAFFIC")
        self.assertIn("known-bad-port", kinds)
        self.assertIn("ot-internet-connection", kinds)

    def test_large_upload(self):
        d, c = detector()
        for i in range(20):
            d.feed(parse(build_tcp(HMI_MAC, GW_MAC, HMI_IP, "8.8.8.8", 40000, 443, flags=TCP_ACK, payload=b"x" * 1000), 100 + i))
        uploads = [e[2] for e in c.events if e[0] == "ABNORMAL_TRAFFIC" and e[2]["kind"] == "large-upload"]
        self.assertEqual(len(uploads), 1)
        self.assertEqual(uploads[0]["destinationIp"], "8.8.8.8")

    def test_port_scan(self):
        d, c = detector()
        for port in range(1, 12):
            d.feed(parse(build_tcp(ROGUE_MAC, PLC_MAC, ROGUE_IP, PLC_IP, 40000, 1000 + port), 100 + port * 0.1))
        scans = [e for e in c.events if e[0] == "ABNORMAL_TRAFFIC" and e[2]["kind"] == "port-scan"]
        self.assertEqual(len(scans), 1)

    def test_known_devices_persist(self):
        with tempfile.TemporaryDirectory() as state:
            c = Collector()
            d = NetworkDetector({**CFG, "learnMinutes": 0}, c, state_dir=state, start_ts=0)
            d.feed(parse(build_arp(HMI_MAC, HMI_IP, PLC_IP), 1))
            self.assertTrue(os.path.exists(os.path.join(state, "known_devices.json")))
            c2 = Collector()
            d2 = NetworkDetector(CFG, c2, state_dir=state)
            d2.feed(parse(build_arp(HMI_MAC, HMI_IP, PLC_IP), 500))
            self.assertEqual(c2.events, [])


if __name__ == "__main__":
    unittest.main()
