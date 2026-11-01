---
title: Playbook – Unknown remote login or remote-access attempts
kind: PLAYBOOK
applies_to: UNK_REMOTE_LOGIN
---

# Playbook – Unknown remote login or remote-access attempts

## Why it matters

Remote-access tools (RDP, VNC, TeamViewer, AnyDesk, SSH) are how vendors support machines, and also how many attackers get in. Exposed or shared remote-access accounts with weak passwords are among the most frequently exploited weaknesses in industrial sites. A successful remote login gives an attacker the same control as a person standing at the HMI.

## How to read the Sentinel alert

- **Connection attempts only (amber):** someone tried to connect. Many attempts in a short time (a burst) usually means password guessing.
- **Successful login (red):** someone got in from a computer that is not on the trusted list.
- **External source (red):** the attempt came from the internet, which means the machine is reachable from outside the factory. That alone is a serious finding.

## Immediate actions

1. Operator: don't touch the mouse or keyboard; note the time and what is on the screen. If the mouse is moving by itself, call the engineer at once.
2. Engineer: confirm with known vendors and staff whether anyone was connecting at that time. Check the source IP in the alert details against the engineering-station and vendor lists.
3. If nobody recognises the session, disconnect the machine's network cable (only if safe for that machine) or end the remote session from the remote-access tool, and disable the account that was used.

## Investigation

- Check Sentinel for a NEW_DEVICE or port-scan alert shortly before; that pattern means someone on the plant network is probing.
- On Windows HMIs, review event 4624 (logon type 10 = RDP) and 4625 (failed logons) for the source IP and user name.
- Check whether the remote tool is set to start automatically and whether it has unattended access with a saved password.
- If the source is external, find out how the machine is reachable: a port forward on the router, a 4G modem on the machine, or a vendor cloud connector.

## Containment and recovery

- Change the passwords of every account used for remote access on that machine, and of any account with the same password elsewhere.
- Remove port forwards that expose RDP or VNC to the internet. Vendor access should go through a single, logged access path that is switched on only when a vendor needs it.
- If the attacker had a successful session, treat the machine as possibly compromised: check for new software and services (see the suspicious-software playbook) and compare the PLC program with the last backup.

## Prevention

- Keep a written list of who may connect remotely, from where, and how.
- Use unique accounts per vendor, with multi-factor authentication where the tool supports it.
- Turn remote-access tools off when they are not in use.
