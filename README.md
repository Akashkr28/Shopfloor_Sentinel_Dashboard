# Shopfloor Sentinel

A traffic-light cyber health dashboard for small and medium factories. A **passive** gateway (Raspberry Pi or an old PC) watches the plant network and machine logs. Sentinel turns each finding into a **green / amber / red** alert card with a **3-step script in Hindi, Marathi, Tamil or English** (with audio). It also messages the owner on **WhatsApp or SMS**: instantly for red alerts, with escalation if nobody responds, and with a summary every evening.

```
 Raspberry Pi gateway (read-only)                 Node.js backend (Express + SQLite)               React dashboard
┌───────────────────────────────┐  POST /api/   ┌──────────────────────────────────────┐  SSE    ┌──────────────────────┐
│ net_monitor.py  ◀─ SPAN port  │──events──────▶│ machine + template → severity        │───────▶│ Operator  big cards  │
│   new devices, RDP/SSH/VNC,   │  X-Gateway-   │ alerts · drills · audit log          │        │ Engineer  timeline   │
│   Modbus writes, scans,       │  Token        │ cookie sessions · roles · rate limits│◀───────│ Owner     traffic    │
│   PLC→internet, uploads       │──heartbeat──▶│ watchdog: escalation, gateway offline│  REST   │           light      │
│ log_monitor.py ◀─ syslog/logs │               │ message queue: retry, SMS fallback   │        │ Templates · Drills   │
│   Windows 4624/4625/7045/…    │               └──────────────────┬───────────────────┘        │ Setup · Audit log    │
│ buffers events when offline   │                                  │ Twilio / WhatsApp Cloud    └──────────────────────┘
└───────────────────────────────┘                                  ▼   (delivery webhooks)
        never transmits to PLCs/HMIs                         Owner & engineer phones 📱
```

## Quick start (demo, about 2 minutes)

You need **Node.js 22.13 or newer** (the backend uses Node's built-in SQLite, so there is no native database driver) and **Python 3.8+** (the gateway uses only the standard library).

```bash
npm run install:all
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:4000 and use the one-tap demo logins. Every demo account's password is `sentinel123`.

| Username | Role | Lands on | Language |
|---|---|---|---|
| `owner` | OWNER | Today's traffic light, WhatsApp preview | English |
| `engineer` | ENGINEER | Dashboard, templates, drills, setup | English |
| `supervisor` | SUPERVISOR | Operator screen + drill mode | Tamil |
| `operator` | OPERATOR | Operator screen | Hindi |
| `operator2` | OPERATOR | Operator screen | Marathi |

Then feed it events. Pick one of the three:

**Real network detector on a recorded attack.** This replays a normal hour on the plant network, then an attack: a new laptop, a port scan, an RDP brute force, a Modbus write and an HMI calling out to a bad host.

```bash
python3 gateway/make_demo_pcap.py && python3 gateway/net_monitor.py --pcap gateway/demo.pcap
```

**Random simulated events** every 5–15 seconds:

```bash
python3 gateway/simulate_events.py --interval 5 15
```

**One specific event:**

```bash
python3 gateway/simulate_events.py --once --type USB_INSERT --machine PRESS_LINE_1_HMI
```

While `NOTIFY_PROVIDER=mock` (the default), owner messages print in the backend terminal.

For a real factory, follow **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. It covers the Pi and mirror port, HTTPS, systemd services, Windows log forwarding, Twilio or WhatsApp setup with the message templates to get approved, backups, and a security checklist.

### Development mode (hot reload)

```bash
npm run dev:api
```

```bash
npm run dev:web
```

The Vite dev server runs on http://localhost:5173 and proxies `/api` to port 4000. It also listens on your LAN, so phones and the shopfloor TV on the same Wi-Fi can open `http://<your-ip>:5173`.

### Reset demo data

```bash
npm run seed:reset
```

## Tests

```bash
npm test
```

This runs the backend API suite and the gateway detector tests. It needs no browser and no network.

```bash
npm run test:e2e
```

This builds the dashboard, starts a real server on a temporary database, and drives Chrome through the main flows. Set `CHROME_PATH` if Chrome isn't in the usual place.

| Suite | What it covers |
|---|---|
| `backend/test/api.test.js` (33 tests with the migration test) | HttpOnly cookie and CSRF, login rate limits, sign-out on password change, disabled users, role-based access, owner-account protection, gateway auth and validation, severity rules, red-alert dedup, drills never messaging owners, escalation levels, gateway-offline and back-online messages, retry with backoff, WhatsApp templates, Twilio and WhatsApp webhook signatures, read receipts never going backwards, CSV formula injection, audit log, security headers |
| `backend/test/migrate.test.js` | A prototype database upgrades in place without losing data |
| `gateway/tests/` (26 tests) | Packet parsing (Ethernet, ARP, TCP, Modbus), pcap round-trip, device learning and baseline persistence, remote-access and burst detection, trusted engineering stations, Modbus writes, port scans, PLC-to-internet traffic, large uploads, Linux auth and USB logs, Windows 4624 / 4625 / 7045 / 1102 / 1116 / 6416 in NXLog JSON and key=value formats |
| `e2e/browser.test.js` (6 flows) | A red alert reaches the operator's phone screen in under 5 s; the Hindi 3-step script is ticked through to resolved; the session cookie is invisible to JavaScript; an engineer edits Marathi wording; a drill is labelled and scored; the owner's WhatsApp preview is sent and shows delivery ticks; a password change; the gateway-offline banner; all Setup tabs |

## Detection (gateway)

| Monitor | Finding | Event | Severity |
|---|---|---|---|
| `net_monitor.py` (mirror port) | A MAC address not seen during the learning period | `NEW_DEVICE` | amber |
| | SSH / Telnet / RDP / VNC / TeamViewer / AnyDesk to a machine from an untrusted host | `UNK_REMOTE_LOGIN` | amber; **red** at 10+ attempts or from the internet |
| | Modbus/TCP write or programming request from a computer that isn't an engineering station | `PLC_WRITE` | **red** |
| | Port scan (30+ targets in 60 s) | `ABNORMAL_TRAFFIC` | **red** |
| | PLC/HMI talking to the internet; known-bad ports (4444, 6667, …); large uploads | `ABNORMAL_TRAFFIC` | amber; **red** if bad port or ≥ 100 MB |
| `log_monitor.py` (files + syslog udp/5514) | SSH or Windows 4625 failed-logon bursts | `UNK_REMOTE_LOGIN` | **red** at 5+ |
| | Successful SSH, or RDP (4624 type 10), from an untrusted IP | `UNK_REMOTE_LOGIN` | **red** |
| | USB storage (Linux kernel, 6416, DriverFrameworks, USBSTOR) | `USB_INSERT` | **red** |
| | New service (7045 / 4697), audit log cleared (1102 / 104), Defender detection (1116 / 1117) | `SUSPICIOUS_SOFTWARE` | **red** |

Each finding is reported at most once per cooldown (default 10 min), so a brute-force run becomes one event, not hundreds. When the backend is unreachable, events are saved to `buffer.jsonl` (capped) and sent once it is back. Every monitor sends a heartbeat each minute.

## Owner messaging

| When | Who gets it |
|---|---|
| A red alert (the same alert on the same machine at most once per 30 min) | Owners |
| A red alert nobody acknowledged for 10 min | Owners + engineers |
| A red alert still unresolved after 60 min | Owners |
| A red alert marked handled | Owners ("✅ handled by …") |
| A gateway silent for 10 min, and again when it is back | Owners + engineers |
| 8 PM daily summary | Owners |
| Drills | Nobody |

Every message is queued in the database. If sending fails it is retried with backoff (30 s, 2 min, 10 min). With Twilio, a WhatsApp message that keeps failing is re-sent as SMS. Delivery receipts (sent / delivered / read) come back through signed webhooks and show as ticks on the owner page, which also shows the 30-day read rate of the daily summary (target ≥ 70%). All thresholds are in `backend/.env.example`.

## Security

- **Sessions:** HttpOnly, `SameSite=Strict` cookie; `Secure` in production. The browser never handles the token, and the live-update stream is authenticated by the same cookie.
- **CSRF:** writes made with the cookie must carry `X-Sentinel-Request`. Scripts may use `Authorization: Bearer <token>` instead.
- **Login protection:** rate limits per IP and per account, bcrypt hashing, and a constant-time response for unknown users.
- **Sign-out on change:** changing or resetting a password signs out every older session, and disabling a user takes effect immediately.
- **Roles:** enforced on every endpoint. Only owners can manage owner accounts, and the last active owner can't be removed.
- **Gateway:** a shared secret compared in constant time, plus strict validation, size limits and a rate limit on ingest.
- **Headers:** a Content Security Policy, plus `X-Frame-Options: DENY`, `nosniff` and `no-referrer`. CSV exports are protected against formula injection.
- **Audit log:** logins, failed and blocked logins, account changes, template edits, drills, exports and test messages (**Setup → Audit log**).
- **Startup check:** production refuses to start with the development secrets.

## Roles

| | Operator | Supervisor | Engineer | Owner |
|---|---|---|---|---|
| Active alerts (last 24h), 3-step script, tick steps | ✓ | ✓ | ✓ | ✓ |
| Start drills, add training notes, mark handled | | ✓ | ✓ | |
| Full timeline, filters, raw gateway data, CSV export | | | ✓ | ✓ |
| Templates, machines, users, gateways, notifications, audit log | | | ✓ | ✓ |
| Manage owner accounts | | | | ✓ |
| Change own password | ✓ | ✓ | ✓ | ✓ |

## API

All routes are under `/api`.

| Method | Path | Who |
|---|---|---|
| POST | `/auth/login` → sets the cookie, returns `{ user, token }` · GET `/auth/session` · POST `/auth/logout` | public |
| GET/PATCH | `/me` · POST `/me/password` | any |
| POST | `/events` (single object or array of up to 100) · `/gateway/heartbeat`, both with `X-Gateway-Token` and `X-Gateway-Id` headers | gateway |
| GET | `/gateway/status` | any |
| GET | `/alerts?severity&machineId&status&isDrill&since&until&activeOnly` · `/alerts/:id` | any (operators: last 24h, no raw data) |
| POST | `/alerts/:id/actions` `{ actionType: ACKNOWLEDGE \| STEP_COMPLETED \| NOTE \| RESOLVE, stepNumber }` | any (NOTE/RESOLVE: not operators) |
| GET | `/alerts/export.csv` | owner, engineer |
| GET/POST/PUT | `/machines`, `/machines/:id` | GET any; write owner, engineer |
| GET/POST/PUT | `/alert-templates[/:id]`, `/alert-templates/:id/localizations`, POST/DELETE `…/:lang/audio` | GET any; write owner, engineer |
| GET/POST/PATCH | `/users`, `/users/:id` · POST `/users/:id/password` | owner, engineer |
| POST | `/simulate` · GET `/stats` · GET `/audit?action=` | owner, engineer |
| POST | `/drill/start` · GET `/drills` | engineer, supervisor (GET also owner) |
| GET | `/owner/daily-summary` · POST `/owner/daily-summary/send` | owner, engineer |
| GET | `/notifications` · `/notifications/config` · POST `/notifications/test` · `/notifications/:id/retry` | owner, engineer |
| POST | `/webhooks/twilio` · GET/POST `/webhooks/whatsapp` | provider (signature-verified) |
| GET | `/stream` (Server-Sent Events) | any |

## Repository layout

```
backend/        Node.js + Express API
  src/app.js        the Express app (security headers, CORS, static dashboard)
  src/server.js     boot: config check, seed, cron, watchdog, graceful shutdown
  src/db.js         SQLite schema + versioned migrations
  src/auth.js       cookie/Bearer sessions, roles, gateway secret
  src/security.js   rate limits, CSRF guard, validation, audit log
  src/routes/       api.js (REST) · webhooks.js (Twilio / WhatsApp receipts)
  src/services/     alerts · notify (queue, providers, templates) · watchdog (escalation, gateways) · summary · live (SSE)
  test/             API + migration tests (node:test)
frontend/       React 18 + Vite – operator, engineer, owner, templates, drills, setup
gateway/        Python, standard library only
  net_monitor.py      passive network detector (live AF_PACKET or --pcap)
  log_monitor.py      log files + syslog receiver (Linux and Windows events)
  simulate_events.py  random / targeted demo events
  make_demo_pcap.py   writes a demo attack capture
  sentinel_net.py     packet parsing, pcap reader/writer, capture
  sentinel_client.py  buffered sender, heartbeat, cooldowns
  systemd/            service units for the Pi
  tests/              detector tests (unittest)
e2e/            Chrome end-to-end tests (puppeteer-core)
docs/           DEPLOYMENT.md
```

## Known limits

- **Industrial protocols:** only Modbus/TCP writes are decoded. S7comm, EtherNet/IP and OPC UA traffic is still covered by the device, remote-access, scan and internet rules, but not decoded.
- **Live capture:** needs Linux (`AF_PACKET`). On macOS and Windows, analyse `.pcap` files instead.
- **Text-to-speech:** quality for Marathi and Tamil depends on the device's installed voices. Recorded audio is the reliable option.
- **WhatsApp outside the 24-hour window:** business-initiated messages need approved templates (see the deployment guide). Until they are approved, use SMS through Twilio.
