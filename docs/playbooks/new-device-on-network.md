---
title: Playbook – New device on the plant network
kind: PLAYBOOK
applies_to: NEW_DEVICE
---

# Playbook – New device on the plant network

## Why it matters

Every device on the plant network can talk to the PLCs. A laptop plugged in by a contractor, a phone hotspot, a cheap Wi-Fi router added to "fix coverage", or a 4G modem fitted by a machine vendor can bring malware in or open a path from the internet. Sentinel learns the normal devices during its learning period and then reports any new device it sees.

## Immediate actions

1. Supervisor: ask who connected a device near the machine named in the alert. Write down the device type and the person's name.
2. Do not unplug machine cables. Only the new device should be removed, and only if nobody can identify it.
3. Engineer: use the MAC address and IP in the alert to find the switch port. The first part of the MAC (the OUI) identifies the manufacturer, which often makes it obvious whether it is a phone, a laptop or an industrial device.

## Decide

- **Known and approved** (a new HMI, a replacement PLC, a vendor laptop during a planned visit): record it and add it to the asset list in the gateway configuration.
- **Known but not approved** (a personal laptop or a Wi-Fi router): remove it, explain the rule to the person, and check the machine it was near for other alerts.
- **Unknown:** remove it, keep it if possible, and check Sentinel for scans, remote-access attempts or PLC writes from its IP. Escalate to the owner.

## Prevention

- Lock unused switch ports or enable port security on managed switches.
- Provide a separate guest or vendor network that cannot reach the PLCs.
- Tell all vendors in writing that devices may only be connected with the engineer's approval.
