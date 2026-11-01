---
title: Playbook – USB drive or removable media on a machine
kind: PLAYBOOK
applies_to: USB_INSERT
---

# Playbook – USB drive or removable media on a machine

## Why it matters

USB drives are one of the most common ways malware reaches machines that are not connected to the internet. Well-known industrial malware such as Stuxnet spread through removable media, and ordinary ransomware travels the same way when a technician copies a recipe file or a movie onto an HMI. A single infected HMI can stop a line for days.

## Immediate actions (first 15 minutes)

1. Do not open any file on the drive and do not click any pop-up that appeared.
2. Remove the drive gently; the machine can keep running. Put the drive in a bag labelled with the machine name and time. Do not plug it into any other computer, including the office PC, to "check what is on it".
3. Note who was at the machine. Ask politely; the most common cause is an employee or a vendor technician moving files, not an attacker.
4. The engineer checks the HMI for new programs, new desktop icons, changed recipes and unusual CPU or disk activity.

## Investigation by the engineer

- Check Sentinel for other events on the same machine in the last 24 hours, especially new services (SUSPICIOUS_SOFTWARE) and outbound connections (ABNORMAL_TRAFFIC). USB followed by either one is a likely infection.
- Scan the drive on an isolated, up-to-date offline scanning PC (a "sheep-dip" or kiosk station), never on a production machine.
- If the HMI shows any sign of infection, isolate it from the network (see the basics guide) and plan a restore from a known-good backup.

## When to escalate

Escalate to the owner and the IT vendor the same day if any of these is true: the drive contained executables or scripts, the HMI shows new software, other machines reported USB or software alerts in the same shift, or nobody can explain where the drive came from.

## Prevention

- Disable USB mass storage on HMIs and engineering PCs where it is not needed (Windows Group Policy, or the HMI vendor's lockdown mode).
- Provide one approved, scanned transfer drive per shift, kept by the supervisor.
- Brief vendors: no personal USB drives on machines; use the approved drive.
- Run a USB drill at shift change every month for the first quarter.
