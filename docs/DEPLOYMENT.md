# Deploying Shopfloor Sentinel

There are three ways to run it:
- **Fly.io** (below): the simplest hosted option, with no server to manage.
- **Cloud VPS with Docker**: the dashboard runs on a small server with HTTPS. Raspberry Pi gateways in the factory connect out to it, so the factory needs no open ports.
- **Everything on a Raspberry Pi in the factory** (sections 1–10): plant data never leaves the site.

Either way, it is **one factory per installation**.

## Fly.io

The app runs as **one always-on machine** with a persistent disk, in Singapore (the closest Fly region to India; Fly has no India region). HTTPS at `https://<app>.fly.dev` is automatic. Vercel and other serverless hosts don't fit: the app needs a permanent disk for SQLite, an always-running process for escalations and the daily summary, and long-lived connections for live updates.

**First deployment** (needs a Fly.io account and the `fly` CLI):

```bash
fly auth login
```

```bash
./deploy/fly-deploy.sh your-app-name
```

The script creates the app and a 3 GB volume, generates the secrets (they go straight to Fly and are never printed), builds the image on Fly's servers and deploys. It's safe to re-run.

**Memory:** keep at least **2 GB** (`fly.toml`). On 1 GB the embedding model is killed for running out of memory while indexing.

**Useful commands:**

| Task | Command |
|---|---|
| Deploy a new version | `fly deploy --ha=false` |
| See the setup code | `fly logs --no-tail \| grep "Setup code"` |
| Show the gateway token | `fly ssh console -C "printenv GATEWAY_TOKEN"` |
| Add AI or messaging settings | `fly secrets set ANTHROPIC_API_KEY=... NOTIFY_PROVIDER=twilio ...` |
| Check health | `fly status` |
| Back up the data | `fly ssh sftp get /data/sentinel.db sentinel-backup.db` |
| Snapshot the disk | `fly volumes snapshots create <volume-id>` |

Keep it to **one machine**: SQLite lives on that machine's volume, so never scale past 1.

**Gateways:** set `backendUrl` to `https://<app>.fly.dev/api` and `gatewayToken` to the token above in `gateway/config.json` on each Pi.

## Cloud VPS with Docker

**You need:**
- a VPS with Ubuntu 22.04/24.04 or Debian 12, 2 vCPU and 2 GB RAM (DigitalOcean, AWS Lightsail, Hetzner, …)
- a domain name with a DNS **A record** pointing to the server, for example `sentinel.patilauto.in`
- ports **80 and 443** open in the provider's firewall

**Install:**

```bash
git clone https://github.com/Akashkr28/Shopfloor_Sentinel_Dashboard.git && cd Shopfloor_Sentinel_Dashboard
```

```bash
sudo ./deploy/install.sh sentinel.patilauto.in
```

The installer:
- installs Docker if it is missing
- writes `backend/.env` with fresh random secrets (it never overwrites an existing file)
- builds the image and starts the app behind Caddy, which gets and renews the HTTPS certificate automatically
- prints the **setup code** and the gateway token

**First run:**
1. Open `https://<your domain>`. On a fresh install it goes straight to **Set up your factory**.
2. Enter the setup code, the factory name and the Owner's details. The code is needed only once.
3. Lost the code? Print it again with:
   ```bash
   docker compose logs sentinel | grep "Setup code"
   ```

**Add people:** go to **Setup → Users → Invite people**.
- Choose the role (operator, supervisor, engineer, or owner – only owners can invite owners).
- Optionally add a name, phone and language, then create the link.
- Send it with **Share on WhatsApp**, or copy it.
- The person opens it, picks a username and password, and is signed in with the role you chose. They cannot choose a different one.
- Links work once and expire (7 days by default), and you can revoke pending links.
- For a shared shopfloor-screen login, use **Create an account directly**.

**Connect the factory gateways:** on each Raspberry Pi, set these in `gateway/config.json` and run the monitors from section 6:
- `backendUrl: "https://<your domain>/api"`
- `gatewayToken`: the token the installer printed

The Pi only makes outbound HTTPS connections. Syslog from the HMIs still goes to the Pi on the factory LAN, never over the internet.

**Turn on messaging and AI:** edit `backend/.env` (sections 8 and 8b), then apply it with:

```bash
docker compose up -d
```

**Update to a new version:**

```bash
git pull && docker compose up -d --build
```

Database migrations run by themselves on start.

**Back up:** the whole state is in the `sentinel-data` volume (database and model cache) and the `sentinel-uploads` volume (recorded audio). This copies them to the current folder:

```bash
docker run --rm -v shopfloor_sentinel_dashboard_sentinel-data:/d -v "$PWD":/b alpine tar czf /b/sentinel-data-$(date +%F).tgz -C /d .
```

```bash
docker run --rm -v shopfloor_sentinel_dashboard_sentinel-uploads:/d -v "$PWD":/b alpine tar czf /b/sentinel-uploads-$(date +%F).tgz -C /d .
```

The volume names start with the folder name, so check them with `docker volume ls`. Copy the archives off the server.

**Smaller image:** to build without the local embedding model (keyword search instead), run:

```bash
docker compose build --build-arg WITH_EMBEDDINGS=false && docker compose up -d
```

---

# Running everything on a Raspberry Pi in the factory

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
2. Start the backend (step 6), open the dashboard and create the Owner with the **setup code** printed in the log (`journalctl -u sentinel-backend | grep "Setup code"`). After that, invite everyone else from **Setup → Users**.
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

## 8b. AI triage and the knowledge base (optional)

1. Add `ANTHROPIC_API_KEY` to `backend/.env`. Triage runs on Anthropic's API, so the Pi needs outbound HTTPS to `api.anthropic.com`. Alert data sent for triage includes machine names, IPs and log details. Check that this is acceptable for your factory first, or set `AI_TRIAGE_AUTO=false` and triage only on demand.
2. Fetch the advisories for your equipment vendors and index them:
   ```bash
   sudo -u sentinel npm --prefix backend run kb:fetch-cisa -- --match "Siemens|Schneider|Rockwell|Mitsubishi|Delta" --limit 60
   ```
   ```bash
   sudo -u sentinel npm --prefix backend run kb:index
   ```
3. Add your own procedures as Markdown files in `docs/playbooks/`, with the engineer's real phone numbers and your machine names. The agent cites them.
4. **Pi footprint.** The local embedding runtime is an optional dependency, and the biggest part of `node_modules`. On a small SD card, install without it and use keyword-style search instead:
   ```bash
   npm --prefix backend ci --omit=optional
   ```
   Then set `EMBEDDINGS=hash`. To use Chroma, run it on another machine (`docker run -p 8000:8000 chromadb/chroma`) and set `VECTOR_STORE=chroma` and `CHROMA_URL`.
5. For the MCP server, create a dedicated Sentinel account (ENGINEER, or SUPERVISOR for read-mostly use) and see the README's "MCP server" section.

## 9. Backups

The whole state is one SQLite file plus the uploaded audio. Back them up nightly with a crontab line for the `sentinel` user:

```
0 2 * * * cd /opt/shopfloor-sentinel/backend && node -e "new (require('node:sqlite').DatabaseSync)('data/sentinel.db').exec(\"VACUUM INTO 'data/backup-$(date +\%a).db'\")" && tar czf data/uploads-$(date +\%a).tgz uploads
```

This keeps seven rolling copies. Copy them off the Pi as well, for example to a USB stick or the office NAS.

## 10. Security checklist

- [ ] `NODE_ENV=production`, with unique `JWT_SECRET` and `GATEWAY_TOKEN`
- [ ] The dashboard is served over HTTPS only, and `COOKIE_SECURE=true`
- [ ] Demo data is off (`SEED_DEMO=false`), and `ALLOW_SIMULATE` is off
- [ ] Pending invite links you no longer need are revoked (**Setup → Users**)
- [ ] Every person has their own account (no shared logins), and leavers are disabled under **Setup → Users**
- [ ] The Pi's SSH uses keys only, and only from the engineering station
- [ ] The mirror-port interface has no IP address (`sudo nmcli dev set eth0 managed no`, or `ip addr flush dev eth0`)
- [ ] Review the audit log weekly (**Setup → Audit log**)
- [ ] Run a drill at every shift change for the first month
