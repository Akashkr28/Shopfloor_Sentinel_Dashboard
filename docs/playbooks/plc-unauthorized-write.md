---
title: Playbook – PLC program or settings changed by an unknown computer
kind: PLAYBOOK
applies_to: PLC_WRITE
---

# Playbook – PLC program or settings changed by an unknown computer

## Why it matters

A PLC directly controls motors, valves, heaters and presses. A change to its program or registers (setpoints, recipes, limits) can damage product, damage equipment or create a safety hazard. Industrial protocols such as Modbus/TCP have no authentication, so any computer on the plant network can write to a PLC unless the network prevents it. Sentinel raises this alert when a write or programming request reaches a PLC from a computer that is not a listed engineering station.

## Immediate actions

1. Operator: watch the machine closely. If it behaves differently from normal (speed, temperature, pressure, cycle), stop it with the normal safe stop. Do not change any settings back yourself.
2. Engineer: identify the source computer from the alert (source IP). Is it a new engineering laptop, a SCADA server that was not on the list, or something unknown?
3. If the source is unknown, disconnect that computer from the network (not the PLC). Keep the PLC running if it is safe.

## Verify the PLC

- Compare the running program and key setpoints with the last known-good backup. Most engineering software (TIA Portal, Studio 5000, GX Works, Codesys) can compare online and offline programs.
- Check the PLC's diagnostic buffer or event log for program downloads, mode changes (RUN to STOP or PROGRAM) and forced I/O.
- Note which Modbus function was used (in the alert details). A single register write may be a setpoint change; repeated multi-register writes or vendor programming functions point to a program change.

## Recovery

- If anything differs from the backup and nobody can explain it, restore the known-good program during a planned stop, and test the machine before production.
- Keep the evidence: the PLC project as found, the alert export, and photos of the HMI.

## When to escalate

Always tell the owner the same day. Escalate to the IT or security vendor immediately if the source computer is unknown, if more than one PLC was written to, or if the change cannot be explained. Consider whether a CERT-In report is required (see the basics guide).

## Prevention

- Keep an up-to-date list of engineering stations in the gateway configuration.
- Put the key switch on PLCs that support it in RUN (not PROGRAM or REMOTE) during production.
- Separate the PLC network from the office network with a firewall that allows only the engineering stations and SCADA to reach the PLCs.
- Back up every PLC program after each approved change, with a date in the file name.
