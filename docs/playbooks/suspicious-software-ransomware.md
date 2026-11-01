---
title: Playbook – Suspicious software or ransomware on an HMI or PC
kind: PLAYBOOK
applies_to: SUSPICIOUS_SOFTWARE
---

# Playbook – Suspicious software or ransomware on an HMI or PC

## Why it matters

Ransomware and other malware on Windows-based HMIs and engineering PCs are the most common cause of cyber-related production stops in manufacturing. Signs include new programs or services, a cleared security log, antivirus detections, files renamed with strange extensions, or a note asking for payment.

## Immediate actions

1. Do not click anything and do not pay or reply to any ransom note. Take a phone photo of the screen.
2. If the HMI stops responding, stop the machine with its normal safe stop.
3. Engineer: disconnect the affected HMI or PC from the network to stop spread. Leave it powered on if possible, because memory evidence is lost on shutdown, unless it is actively encrypting files and you need to save data.
4. Check other machines at once: in Sentinel, look for SUSPICIOUS_SOFTWARE, ABNORMAL_TRAFFIC or remote-login alerts on other machines in the same period.

## How to read the alert

- **New service installed (Windows 7045 / 4697):** often legitimate (an update or a vendor tool) but also a classic persistence method. Check the service name and path with the vendor.
- **Audit log cleared (1102 / 104):** rarely legitimate during production. Treat it as a strong sign of an intruder covering tracks.
- **Antivirus detection (Defender 1116 / 1117):** check whether the antivirus removed or only detected the threat, and where the file came from.

## Containment and recovery

- Do not reconnect the machine until it has been rebuilt or cleaned by someone qualified.
- Rebuild the HMI from the vendor's installation media and restore the HMI project from a known-good offline backup. Backups stored on the same network share may also be encrypted, so check them before relying on them.
- Change passwords used on the affected machine, especially shared or administrator accounts.
- Ransomware and attacks on industrial systems generally have to be reported to CERT-In within 6 hours (see the basics guide).

## Prevention

- Keep offline, tested backups of HMI projects and PLC programs (on a USB drive in a locked cabinet, refreshed after every change).
- Remove internet access from HMIs; allow only what the vendor requires.
- Keep antivirus definitions current, using an offline update process where needed.
- Restrict administrator rights on HMIs to the engineer.
