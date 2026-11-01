---
title: Playbook – Sentinel gateway offline (monitoring gap)
kind: PLAYBOOK
applies_to: GATEWAY_OFFLINE
---

# Playbook – Sentinel gateway offline (monitoring gap)

## Why it matters

While the gateway is offline, nothing on the plant network is being watched. Attackers sometimes disable monitoring first, but the usual causes are mundane: a power cut, an unplugged cable, a full SD card or a switch reconfiguration that removed the mirror port.

## Checks, in order

1. Is the Pi powered (red LED on) and is its network link light on?
2. Can you reach the dashboard from the office? If not, the problem is the office-side network, not the monitor.
3. On the Pi: `systemctl status sentinel-net-monitor sentinel-log-monitor` and `journalctl -u sentinel-net-monitor -n 50`.
4. Is the switch still mirroring to the gateway port? Switch firmware updates and reconfigurations often reset mirror settings.
5. Is the SD card full? Check with `df -h`.

## When it is back

Events seen while the Sentinel backend was unreachable are buffered on the gateway and sent when it reconnects. Events that happened while the gateway itself was off are lost. If the outage overlapped with other alerts, or nobody can explain it, review the machines manually for new devices and software.
