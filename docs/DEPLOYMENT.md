# Deploying Shopfloor Sentinel in a factory

This guide takes you from a fresh Raspberry Pi to a monitored plant network, with real WhatsApp or SMS messages to the owner. It assumes one Pi runs everything: the backend, the dashboard and both monitors. You can also run the backend on a separate PC and keep only the monitors on the Pi.

## 1. Hardware and network

- **Pi:** a Raspberry Pi 4 or 5 with 4 GB RAM and a good SD card or USB SSD, running Raspberry Pi OS Lite (64-bit).
- **Two network ports:**
  - **eth0 → the switch's SPAN / mirror port.** In the switch's port-mirroring settings, mirror the PLC/HMI VLAN or ports to this port. The monitor only listens on it.
  - **Second NIC (a USB Ethernet adapter, or Wi-Fi) → the office LAN.** The dashboard, phones and internet access for WhatsApp go through this one.
- **If your switch has no mirror port:** put a passive network TAP in front of the PLC switch's uplink instead. Don't use a hub.

> The gateway never transmits on the mirror interface. It never sends commands to PLCs or HMIs.

## 2. Install

```bash
sudo apt update && sudo apt install -y git python3 curl
```

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

```bash
sudo useradd --system --create-home --home-dir /opt/shopfloor-sentinel sentinel
```

```bash
sudo -u sentinel git clone <your-repo-url> /opt/shopfloor-sentinel
```

```bash
cd /opt/shopfloor-sentinel && sudo -u sentinel npm --prefix backend ci && sudo -u sentinel npm --prefix frontend ci && sudo -u sentinel npm run build
```

## 3. Configure the backend

```bash
sudo -u sentinel cp backend/.env.example backend/.env
```

Edit `backend/.env`:

1. Generate `JWT_SECRET` and `GATEWAY_TOKEN` with the command below, once for each:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Set `INITIAL_OWNER_PASSWORD` (8+ characters) and `INITIAL_OWNER_PHONE`. The first owner account is created on first boot. After that, add everyone else under **Setup → Users**.
3. Keep `SEED_DEMO=false`.

The backend **refuses to start** in production with missing or default secrets.

## 4. HTTPS with Caddy (recommended)

The session cookie is `Secure` in production, so the dashboard has to be served over HTTPS.

```bash
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`, for a public domain:

```
sentinel.yourfactory.in {
    reverse_proxy 127.0.0.1:4000
}
```

For a LAN-only setup, Caddy's internal certificate authority works:

```
https://sentinel.local {
    tls internal
    reverse_proxy 127.0.0.1:4000
}
```

Set `PUBLIC_URL=https://sentinel.yourfactory.in` and `TRUST_PROXY=loopback` in `.env`.

## 5. Configure the gateway

Edit `gateway/config.json`:

| Key | What to put |
|---|---|
| `gatewayToken` | Same value as `GATEWAY_TOKEN` |
| `gatewayId` | A name for this Pi, e.g. `pi-shed-a` |
| `network.interface` | The mirror-port interface (`eth0`) |
| `network.assets` | Every PLC/HMI/PC: `identifier` (must match **Setup → Machines**), `role` (`plc`, `hmi`, `pc`), `ips`, and `hostnames` (for Windows logs) |
| `network.engineeringStations` | IPs allowed to write to PLCs (Modbus) |
| `network.trustedRemoteSources` | IPs allowed to SSH/RDP/VNC into machines |
| `network.learnMinutes` | How long to learn the normal devices before alerting on new ones (default 60) |
| `logs.files` | Local log files to watch |

The first time `net_monitor.py` runs, it spends `learnMinutes` learning which devices are normal. The list is kept in `gateway/state/known_devices.json`. Delete that file to relearn.

## 6. Start everything as services

```bash
sudo cp gateway/systemd/*.service /etc/systemd/system/
```

```bash
sudo usermod -aG adm sentinel
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now sentinel-backend sentinel-net-monitor sentinel-log-monitor
```

Check them:

```bash
journalctl -u sentinel-net-monitor -f
```

Within a minute, **Setup → Gateways** should show the Pi as online. If the Pi loses power or its cable, owners and engineers get a WhatsApp/SMS after `GATEWAY_OFFLINE_MINUTES`.

## 7. Forward Windows HMI logs (optional, recommended)

Install [NXLog Community Edition](https://nxlog.co/downloads/nxlog-ce) on each Windows HMI or engineering PC, and use this as `C:\Program Files\nxlog\conf\nxlog.conf`:

```
<Extension json>
    Module xm_json
</Extension>
<Input eventlog>
    Module im_msvistalog
    <QueryXML>
        <QueryList><Query Id="0">
            <Select Path="Security">*[System[(EventID=4624 or EventID=4625 or EventID=1102 or EventID=4697 or EventID=6416)]]</Select>
            <Select Path="System">*[System[(EventID=7045 or EventID=104)]]</Select>
            <Select Path="Microsoft-Windows-Windows Defender/Operational">*[System[(EventID=1116 or EventID=1117)]]</Select>
            <Select Path="Microsoft-Windows-DriverFrameworks-UserMode/Operational">*[System[(EventID=2003 or EventID=2100)]]</Select>
        </Query></QueryList>
    </QueryXML>
    Exec to_json();
</Input>
<Output sentinel>
    Module om_udp
    Host   192.168.10.2
    Port   5514
</Output>
<Route r>
    Path eventlog => sentinel
</Route>
```

Replace `192.168.10.2` with the gateway's office-LAN IP. On the Windows side, enable auditing of logon events and of "Plug and Play events" (Local Security Policy → Advanced Audit Policy).

## 8. Owner messaging

### Option A – Twilio (WhatsApp and SMS)

1. Create a Twilio account. For testing, join the WhatsApp Sandbox from the owner's phone. For production, register a WhatsApp sender.
2. Set `NOTIFY_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`. Set `TWILIO_SMS_FROM` if you have an SMS number.
3. **Messages outside the 24-hour window need approved templates.** In Twilio Content Template Builder, create the templates from the table below and put their `HX…` SIDs into `TWILIO_CONTENT_SID_*`.
4. For delivery receipts, set `PUBLIC_URL`. Sentinel then asks Twilio to call `PUBLIC_URL/api/webhooks/twilio` and verifies Twilio's signature on every callback.

### Option B – Meta WhatsApp Cloud API

1. In Meta for Developers, create an app → WhatsApp → add a phone number. Copy a permanent access token and the phone number ID into `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`.
2. Copy the app secret into `WHATSAPP_APP_SECRET` (it is used to verify webhooks), and choose any string for `WHATSAPP_VERIFY_TOKEN`.
3. Under Webhooks, set the callback to `PUBLIC_URL/api/webhooks/whatsapp` with your verify token, and subscribe to **messages**. This gives you sent / delivered / read receipts.
4. Create and get approval for the templates below (category **Utility**, language English), and put their names into `WHATSAPP_TEMPLATE_*`.

### Message templates

Sentinel fills the variables in this order. Keep the wording close to this so it is approved quickly.

| Template | Body |
|---|---|
| **RED_ALERT** | `🔴 Red alert: {{1}} on {{2}} at {{3}}. Operator advised: {{4}} Your follow-up: {{5}}` |
| **DAILY_SUMMARY** | `Shopfloor Sentinel daily summary {{1}}. {{2}} Alerts: {{3}}. Top issues: {{4}}. Still open: {{5}}.` |
| **ESCALATION** | `⏰ Escalation: red alert {{1}} on {{2}} (since {{3}}) has had no response for {{4}}. Progress: {{5}}. Please call the shift supervisor.` |
| **RESOLVED_UPDATE** | `✅ Handled: {{1}} on {{2}} ({{3}}) was marked handled by {{4}} after {{5}}.` |
| **GATEWAY_OFFLINE** | `📡 Sentinel gateway {{1}} is {{2}} ({{3}}). Security monitoring depends on it – please check its power and network cable.` |

Without templates, Sentinel sends free text. WhatsApp only delivers free text if the owner has messaged the business number in the last 24 hours.

Use **Setup → Notifications → Send test** to check the setup. Every message, retry and delivery receipt appears on the owner page.

## 9. Backups

The whole state is one SQLite file plus the uploaded audio. Back them up nightly with a crontab line for the `sentinel` user:

```
0 2 * * * cd /opt/shopfloor-sentinel/backend && node -e "new (require('node:sqlite').DatabaseSync)('data/sentinel.db').exec(\"VACUUM INTO 'data/backup-$(date +\%a).db'\")" && tar czf data/uploads-$(date +\%a).tgz uploads
```

This keeps seven rolling copies. Copy them off the Pi as well, for example to a USB stick or the office NAS.

## 10. Security checklist

- [ ] `NODE_ENV=production`, with unique `JWT_SECRET` and `GATEWAY_TOKEN`
- [ ] The dashboard is served over HTTPS only, and `COOKIE_SECURE=true`
- [ ] Demo data is off (`SEED_DEMO=false`), and the initial owner password has been changed
- [ ] Every person has their own account (no shared logins), and leavers are disabled under **Setup → Users**
- [ ] The Pi's SSH uses keys only, and only from the engineering station
- [ ] The mirror-port interface has no IP address (`sudo nmcli dev set eth0 managed no`, or `ip addr flush dev eth0`)
- [ ] Review the audit log weekly (**Setup → Audit log**)
- [ ] Run a drill at every shift change for the first month
