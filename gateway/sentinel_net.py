"""Minimal, read-only packet handling for the gateway (standard library only):
Ethernet / VLAN / ARP / IPv4 / TCP / UDP / Modbus-TCP parsing, a pcap file
reader + writer, and a Linux AF_PACKET live capture on a SPAN / mirror port.

Nothing in this module ever transmits on the plant network.
"""
import ipaddress
import socket
import struct
import sys

ETH_P_ALL = 0x0003
ETH_IPV4 = 0x0800
ETH_ARP = 0x0806
ETH_VLAN = (0x8100, 0x88A8)

TCP_FIN, TCP_SYN, TCP_RST, TCP_PSH, TCP_ACK = 0x01, 0x02, 0x04, 0x08, 0x10

MODBUS_WRITE_FUNCTIONS = {
    5: "Write Single Coil",
    6: "Write Single Register",
    15: "Write Multiple Coils",
    16: "Write Multiple Registers",
    21: "Write File Record",
    22: "Mask Write Register",
    23: "Read/Write Multiple Registers",
    90: "Vendor programming (UMAS)",
}


def mac_str(b):
    return ":".join(f"{x:02x}" for x in b)


def is_unicast_mac(mac):
    first = int(mac[:2], 16)
    return not (first & 1) and mac != "00:00:00:00:00:00"


class Packet:
    __slots__ = ("ts", "src_mac", "dst_mac", "eth_type", "arp", "src_ip", "dst_ip", "proto", "ip_len",
                 "src_port", "dst_port", "tcp_flags", "payload")

    def __init__(self):
        self.arp = None
        self.src_ip = self.dst_ip = None
        self.proto = None
        self.ip_len = 0
        self.src_port = self.dst_port = None
        self.tcp_flags = 0
        self.payload = b""

    @property
    def is_syn(self):
        return self.proto == 6 and self.tcp_flags & TCP_SYN and not self.tcp_flags & TCP_ACK


def parse(frame, ts=0.0):
    """Parse an Ethernet frame. Returns a Packet or None for frames we don't care about."""
    if len(frame) < 14:
        return None
    p = Packet()
    p.ts = ts
    p.dst_mac, p.src_mac = mac_str(frame[0:6]), mac_str(frame[6:12])
    eth_type = struct.unpack("!H", frame[12:14])[0]
    off = 14
    while eth_type in ETH_VLAN and len(frame) >= off + 4:
        eth_type = struct.unpack("!H", frame[off + 2:off + 4])[0]
        off += 4
    p.eth_type = eth_type

    if eth_type == ETH_ARP and len(frame) >= off + 28:
        oper = struct.unpack("!H", frame[off + 6:off + 8])[0]
        p.arp = {
            "op": oper,
            "sender_mac": mac_str(frame[off + 8:off + 14]),
            "sender_ip": socket.inet_ntoa(frame[off + 14:off + 18]),
            "target_ip": socket.inet_ntoa(frame[off + 24:off + 28]),
        }
        return p

    if eth_type != ETH_IPV4 or len(frame) < off + 20:
        return p
    vihl = frame[off]
    if vihl >> 4 != 4:
        return p
    ihl = (vihl & 0x0F) * 4
    p.ip_len = struct.unpack("!H", frame[off + 2:off + 4])[0]
    p.proto = frame[off + 9]
    p.src_ip = socket.inet_ntoa(frame[off + 12:off + 16])
    p.dst_ip = socket.inet_ntoa(frame[off + 16:off + 20])
    frag = struct.unpack("!H", frame[off + 6:off + 8])[0] & 0x1FFF
    l4 = off + ihl
    end = min(len(frame), off + p.ip_len) if p.ip_len else len(frame)
    if frag:  # non-first fragment: no L4 header
        return p
    if p.proto == 6 and end >= l4 + 20:
        p.src_port, p.dst_port = struct.unpack("!HH", frame[l4:l4 + 4])
        data_off = (frame[l4 + 12] >> 4) * 4
        p.tcp_flags = frame[l4 + 13]
        p.payload = bytes(frame[l4 + data_off:end])
    elif p.proto == 17 and end >= l4 + 8:
        p.src_port, p.dst_port = struct.unpack("!HH", frame[l4:l4 + 4])
        p.payload = bytes(frame[l4 + 8:end])
    return p


def modbus_requests(payload):
    """Yield (unit_id, function_code) for each Modbus/TCP ADU in a TCP payload."""
    off = 0
    while len(payload) - off >= 8:
        _tid, proto, length = struct.unpack("!HHH", payload[off:off + 6])
        if proto != 0 or length < 2 or length > 260:
            return
        yield payload[off + 6], payload[off + 7]
        off += 6 + length


# ---------------------------------------------------------------------------
# Networks
# ---------------------------------------------------------------------------

class Networks:
    def __init__(self, cidrs):
        self.nets = [ipaddress.ip_network(c, strict=False) for c in cidrs]

    def __contains__(self, ip):
        try:
            a = ipaddress.ip_address(ip)
        except ValueError:
            return False
        return any(a in n for n in self.nets)


def is_public(ip):
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return a.is_global and not a.is_multicast


# ---------------------------------------------------------------------------
# pcap files (classic libpcap format, Ethernet link type)
# ---------------------------------------------------------------------------

def read_pcap(path):
    """Yield (timestamp, frame_bytes) from a .pcap file."""
    with open(path, "rb") as f:
        header = f.read(24)
        if len(header) < 24:
            raise ValueError("not a pcap file")
        magic = header[:4]
        if magic in (b"\xd4\xc3\xb2\xa1", b"\x4d\x3c\xb2\xa1"):
            endian = "<"
        elif magic in (b"\xa1\xb2\xc3\xd4", b"\xa1\xb2\x3c\x4d"):
            endian = ">"
        else:
            raise ValueError("not a classic pcap file (pcapng is not supported – convert with: editcap -F pcap in.pcapng out.pcap)")
        nano = magic in (b"\x4d\x3c\xb2\xa1", b"\xa1\xb2\x3c\x4d")
        linktype = struct.unpack(endian + "I", header[20:24])[0]
        if linktype != 1:
            raise ValueError(f"unsupported link type {linktype} (need Ethernet)")
        while True:
            rec = f.read(16)
            if len(rec) < 16:
                return
            sec, frac, incl, _orig = struct.unpack(endian + "IIII", rec)
            data = f.read(incl)
            if len(data) < incl:
                return
            yield sec + frac / (1e9 if nano else 1e6), data


def write_pcap(path, frames):
    """Write [(timestamp, frame_bytes)] as a pcap file (used by the tests)."""
    with open(path, "wb") as f:
        f.write(struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1))
        for ts, data in frames:
            sec = int(ts)
            f.write(struct.pack("<IIII", sec, int((ts - sec) * 1e6), len(data), len(data)))
            f.write(data)


# ---------------------------------------------------------------------------
# Live capture (Linux AF_PACKET, needs root or CAP_NET_RAW)
# ---------------------------------------------------------------------------

SOL_PACKET = 263
PACKET_ADD_MEMBERSHIP = 1
PACKET_MR_PROMISC = 1


def live_capture(iface):
    """Yield (timestamp, frame_bytes) from a network interface in promiscuous mode."""
    import time

    if not hasattr(socket, "AF_PACKET"):
        sys.exit("Live capture needs Linux (Raspberry Pi OS). On this machine use --pcap <file>.")
    try:
        s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.ntohs(ETH_P_ALL))
    except PermissionError:
        sys.exit("Permission denied – run as root or grant: sudo setcap cap_net_raw,cap_net_admin+eip $(readlink -f $(which python3))")
    s.bind((iface, 0))
    # Promiscuous: a mirror port delivers frames addressed to other machines.
    ifindex = socket.if_nametoindex(iface)
    s.setsockopt(SOL_PACKET, PACKET_ADD_MEMBERSHIP, struct.pack("iHH8s", ifindex, PACKET_MR_PROMISC, 0, b""))
    s.settimeout(1.0)
    while True:
        try:
            frame = s.recv(65535)
        except socket.timeout:
            yield time.time(), None  # lets the caller run periodic checks on a quiet network
            continue
        yield time.time(), frame


# ---------------------------------------------------------------------------
# Frame builders (tests and demos)
# ---------------------------------------------------------------------------

def _mac(m):
    return bytes(int(x, 16) for x in m.split(":"))


def _ip_checksum(h):
    s = sum(struct.unpack("!10H", h))
    s = (s >> 16) + (s & 0xFFFF)
    return ~(s + (s >> 16)) & 0xFFFF


def build_ipv4(src_mac, dst_mac, src_ip, dst_ip, proto, l4):
    total = 20 + len(l4)
    hdr = struct.pack("!BBHHHBBH4s4s", 0x45, 0, total, 0, 0x4000, 64, proto, 0, socket.inet_aton(src_ip), socket.inet_aton(dst_ip))
    hdr = hdr[:10] + struct.pack("!H", _ip_checksum(hdr)) + hdr[12:]
    return _mac(dst_mac) + _mac(src_mac) + struct.pack("!H", ETH_IPV4) + hdr + l4


def build_tcp(src_mac, dst_mac, src_ip, dst_ip, sport, dport, flags=TCP_SYN, payload=b""):
    tcp = struct.pack("!HHIIBBHHH", sport, dport, 1, 0, 5 << 4, flags, 65535, 0, 0) + payload
    return build_ipv4(src_mac, dst_mac, src_ip, dst_ip, 6, tcp)


def build_udp(src_mac, dst_mac, src_ip, dst_ip, sport, dport, payload=b""):
    return build_ipv4(src_mac, dst_mac, src_ip, dst_ip, 17, struct.pack("!HHHH", sport, dport, 8 + len(payload), 0) + payload)


def build_arp(sender_mac, sender_ip, target_ip, op=1):
    body = struct.pack("!HHBBH6s4s6s4s", 1, ETH_IPV4, 6, 4, op, _mac(sender_mac), socket.inet_aton(sender_ip), b"\x00" * 6, socket.inet_aton(target_ip))
    return b"\xff" * 6 + _mac(sender_mac) + struct.pack("!H", ETH_ARP) + body


def build_modbus(function, unit=1, tid=1, data=b"\x00\x01\x00\x01"):
    pdu = bytes([function]) + data
    return struct.pack("!HHHB", tid, 0, len(pdu) + 1, unit) + pdu
