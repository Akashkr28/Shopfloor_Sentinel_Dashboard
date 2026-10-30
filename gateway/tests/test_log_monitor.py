import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from log_monitor import LogDetector  # noqa: E402

ASSETS = [{"identifier": "PRESS_LINE_1_HMI", "ips": ["192.168.10.21"], "hostnames": ["PRESS1-HMI"]}]


class Collector(list):
    def __call__(self, kind, machine, details):
        self.append((kind, machine, details))


def detector(**over):
    c = Collector()
    return LogDetector({"failedLoginThreshold": 3, **over}, c, assets=ASSETS, trusted=["192.168.10.5"]), c


class LinuxTests(unittest.TestCase):
    def test_ssh_brute_force_reported_once(self):
        d, c = detector()
        line = "Oct 30 10:00:01 hmi sshd[123]: Failed password for invalid user admin from 45.1.2.3 port 5000 ssh2"
        for i in range(6):
            d.feed(line, host="192.168.10.21", now=1000 + i)
        self.assertEqual(len(c), 1)
        kind, machine, details = c[0]
        self.assertEqual((kind, machine), ("UNK_REMOTE_LOGIN", "PRESS_LINE_1_HMI"))
        self.assertEqual(details["failedAttempts"], 3)
        self.assertEqual(details["sourceIp"], "45.1.2.3")

    def test_failures_outside_window_dont_count(self):
        d, c = detector(failedLoginWindowSeconds=60)
        line = "sshd[1]: Failed password for root from 10.0.0.9 port 1 ssh2"
        for i in range(3):
            d.feed(line, now=1000 + i * 100)
        self.assertEqual(c, [])

    def test_accepted_login_untrusted_vs_trusted(self):
        d, c = detector()
        d.feed("sshd[1]: Accepted password for pi from 192.168.10.5 port 1 ssh2", now=1)
        self.assertEqual(c, [])
        d.feed("sshd[1]: Accepted publickey for pi from 10.9.9.9 port 1 ssh2", now=2)
        self.assertTrue(c[0][2]["loginSucceeded"])

    def test_usb_storage(self):
        d, c = detector()
        d.feed("kernel: [123.4] usb-storage 1-1:1.0: USB Mass Storage device detected", default_machine="CNC_CELL_3_PC", now=1)
        self.assertEqual(c[0][:2], ("USB_INSERT", "CNC_CELL_3_PC"))


class WindowsTests(unittest.TestCase):
    def test_rdp_logon_from_untrusted_ip_nxlog_json(self):
        d, c = detector()
        line = '<14>{"EventID":4624,"Hostname":"PRESS1-HMI","LogonType":"10","IpAddress":"10.20.30.40","TargetUserName":"operator"}'
        d.feed(line, host="192.168.99.1", now=1)
        self.assertEqual(len(c), 1)
        kind, machine, details = c[0]
        self.assertEqual((kind, machine, details["protocol"]), ("UNK_REMOTE_LOGIN", "PRESS_LINE_1_HMI", "RDP"))
        self.assertEqual(details["user"], "operator")

    def test_interactive_logon_is_not_an_alert(self):
        d, c = detector()
        d.feed('{"EventID":4624,"LogonType":"2","IpAddress":"-"}', host="192.168.10.21", now=1)
        self.assertEqual(c, [])

    def test_failed_logons_kv_format(self):
        d, c = detector()
        for i in range(3):
            d.feed("EventID=4625 Computer=PRESS1-HMI IpAddress=10.0.0.66 TargetUserName=admin", now=10 + i)
        self.assertEqual(c[0][0], "UNK_REMOTE_LOGIN")
        self.assertEqual(c[0][2]["protocol"], "Windows logon")

    def test_new_service_and_log_cleared(self):
        d, c = detector()
        d.feed('{"EventID":7045,"ServiceName":"updsvc32","Hostname":"PRESS1-HMI"}', now=1)
        d.feed('{"EventID":1102,"Hostname":"PRESS1-HMI"}', now=2)
        self.assertEqual([x[2]["kind"] for x in c], ["new-service", "audit-log-cleared"])
        self.assertEqual(c[0][2]["service"], "updsvc32")

    def test_defender_detection(self):
        d, c = detector()
        d.feed('{"EventID":1116,"Threat Name":"Trojan:Win32/Emotet","Hostname":"PRESS1-HMI"}', now=1)
        self.assertEqual(c[0][2]["threat"], "Trojan:Win32/Emotet")

    def test_usb_on_windows(self):
        d, c = detector()
        d.feed("EventID=6416 Computer=PRESS1-HMI DeviceDescription=USB Mass Storage Device USBSTOR\\Disk", now=1)
        self.assertEqual(c[0][:2], ("USB_INSERT", "PRESS_LINE_1_HMI"))

    def test_unrelated_lines_ignored(self):
        d, c = detector()
        d.feed('{"EventID":4688,"NewProcessName":"notepad.exe"}', now=1)
        d.feed("cron[1]: (root) CMD (run-parts /etc/cron.hourly)", now=2)
        self.assertEqual(c, [])


if __name__ == "__main__":
    unittest.main()
