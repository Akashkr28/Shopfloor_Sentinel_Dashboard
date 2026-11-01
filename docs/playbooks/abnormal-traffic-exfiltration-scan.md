---
title: Playbook – Unusual network activity (scans, internet connections, large uploads)
kind: PLAYBOOK
applies_to: ABNORMAL_TRAFFIC
---

# Playbook – Unusual network activity (scans, internet connections, large uploads)

## The four kinds Sentinel reports

- **Port scan:** one computer probing many machines or ports in a short time. This is how attackers and worms map a network before attacking. Sentinel marks it red.
- **Known-bad port:** a connection to a port commonly used by attack tools or botnets (for example 4444 or 6667). Red.
- **PLC or HMI talking to the internet:** industrial controllers and HMIs normally have no reason to connect to internet addresses. Amber, but it often reveals an unknown modem, a vendor cloud connector or malware.
- **Large upload:** a machine sending much more data than usual to the internet in a few minutes. It can be backup or vendor telemetry, or data theft before ransomware.

## Immediate actions

1. Operator: keep the machine running only if safe; don't restart the PC; note what is on the screen.
2. Engineer: identify the source computer and the destination IP in the alert details. Look up the destination owner with an IP lookup service.
3. For a scan or bad-port alert from an unknown computer, find it (by MAC or IP on the switch) and disconnect it from the plant network.

## Investigation

- Combine with other alerts: a NEW_DEVICE alert followed by a scan points to an unauthorised laptop. A USB or suspicious-software alert followed by internet connections points to infected software.
- For internet connections from a PLC or HMI, ask the machine vendor whether the device has remote monitoring or cloud features, and whether they are supposed to be on.
- For large uploads, check whether a backup job, a camera or a vendor tool explains the timing and volume.

## Containment

- Block the destination at the factory firewall or router if it is not a known service.
- Disable unused cloud and remote features on PLCs and HMIs.
- If data theft is suspected, treat it as a serious incident: isolate the source, preserve evidence and inform the owner and the IT vendor the same day.

## Prevention

- Separate the plant network from the office and the internet; allow only the specific connections that are needed.
- Keep an inventory of which machines are allowed to reach which external services.
