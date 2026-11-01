---
title: OT incident response basics for small factories
kind: GUIDE
applies_to: all
---

# OT incident response basics for small factories

## Principles: safety first, then evidence, then recovery

In a factory the first duty is the safety of people and machines, not the computer. Never ask an operator to do anything that could create a hazard: no pulling power from a running press, no bypassing an interlock, no restarting a PLC mid-cycle. If a machine behaves strangely, stop it using the normal, safe stop procedure for that machine.

Second, preserve evidence. Most small-factory incidents are cleaned up so fast that nobody can later say what happened. Before anything is rebooted, reinstalled or "fixed", write down the time, what was on the screen and who was nearby, and take phone photos of screens and connected devices.

Third, recover deliberately. Restore from a known-good backup of the PLC program or HMI project, not from whatever is on the machine now.

## Roles during an incident

- **Operator:** notices, follows the 3-step card, keeps the machine safe, and calls the engineer. Does not investigate.
- **Maintenance / automation engineer:** confirms whether the alert is real, isolates the affected machine from the network if needed, collects evidence, restores from backup.
- **Owner / managing partner:** decides on production stops, calls the IT or security vendor, handles customer communication, and makes regulatory reports.
- **IT vendor or security consultant:** forensic analysis, cleanup of infected PCs, password resets across systems.

## Isolation without stopping production

Isolating a machine means removing its network connection while it keeps running locally. Most PLCs and HMIs keep running their current program without the network. Unplug the HMI or PC from the switch (not from power) only when the engineer confirms the machine does not need the network for safe operation, for example recipe downloads or remote I/O. Remote I/O and drive networks (PROFINET, EtherNet/IP) must not be disconnected while a machine is moving.

## Evidence checklist

- Time the alert appeared and time each step was taken (Sentinel records this).
- Photos of the HMI or PC screen, including any pop-up or ransom note.
- Any USB drive or unknown device: keep it in a bag, do not plug it in anywhere.
- Names of everyone who used the machine in that shift, including vendors and contractors.
- Export Sentinel's alert log (Engineer dashboard → Export CSV) and the gateway's logs.

## Reporting in India

CERT-In's directions of April 2022 under section 70B(6) of the IT Act require many types of cyber incident (including ransomware, unauthorised access to IT systems and attacks on OT and industrial control systems) to be reported to CERT-In within 6 hours of noticing them. Report via incident@cert-in.org.in or the CERT-In website, and check the current requirements on cert-in.org.in. Keep logs for the period CERT-In requires. If personal data may be involved, also consider your obligations under the Digital Personal Data Protection Act.

## After the incident

Within a week, hold a 30-minute review with the operator, the engineer and the owner. What happened, what worked, what was slow? Update the Sentinel alert template wording if operators misunderstood it, and schedule a drill of the same scenario at the next shift change.
