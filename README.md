# Shopfloor Sentinel

A traffic-light cyber health dashboard for small and medium factories. A **passive** gateway (Raspberry Pi or an old PC) reports security events. Sentinel turns each one into a **green / amber / red** alert card with a **3-step script in Hindi, Marathi, Tamil or English** (with audio), and sends the owner a **WhatsApp/SMS**: a daily summary, plus an instant message only for red alerts.

```
 Raspberry Pi / old PC                 Node.js backend (Express + SQLite)            React dashboard
┌──────────────────────┐  POST /api/  ┌────────────────────────────────────┐  SSE   ┌───────────────────────┐
│ simulate_events.py   │──events────▶│ map machine + template → severity  │──────▶│ Operator  (big cards) │
│ passive_monitor.py   │ X-Gateway-  │ store alert · dedup red alerts      │       │ Engineer  (timeline)  │
│ (read-only, buffers  │   Token     │ JWT + role checks · drills          │◀─────│ Owner     (light)     │
│  when offline)       │             │ node-cron 8 PM summary              │ REST  │ Templates · Drills    │
└──────────────────────┘             └───────────────┬────────────────────┘       └───────────────────────┘
        never talks to PLCs/HMIs                      │ Twilio / WhatsApp Cloud / mock
                                                      ▼
                                              Owner's phone 📱
```

## Quick start (about 2 minutes)

You need **Node.js 22.13 or newer**, because the backend uses Node's built-in SQLite and needs no native database driver. You also need **Python 3.8+**, standard library only.

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

In a second terminal, start the simulated gateway:

```bash
python3 gateway/simulate_events.py --interval 5 15
```

For a live demo, fire specific events:

```bash
python3 gateway/simulate_events.py --once --type USB_INSERT --machine PRESS_LINE_1_HMI
```

```bash
python3 gateway/simulate_events.py --burst 10
```

Owner messages print in the backend terminal while `NOTIFY_PROVIDER=mock`, which is the default. See [Real WhatsApp / SMS](#real-whatsapp--sms).

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

## A 5-minute demo script

1. **Operator** (`operator`, Hindi): the screen is green, "सब ठीक है" ("all clear").
2. **Engineer** → Dashboard → **Simulate event** → *USB drive plugged into machine* on Press Line 1. Within a second the operator screen turns red and chimes. The backend terminal prints the owner's WhatsApp message.
3. Simulate the same event again. It is **deduplicated**: no second owner message within 30 minutes.
4. On the operator screen, tap the card, switch Hindi / मराठी / தமிழ், press **सुनें** ("listen"), and tick **मैंने यह किया** ("I did this") for each step. The card shows the progress dots, and the engineer timeline shows `3/3` and *resolved*.
5. **Engineer** → Drill mode → start a drill for "Shift B". It appears on the operator screen with a dashed **DRILL** label, and the owner is *not* messaged. Complete it, then look at the scorecard: time to step 1, steps missed, % completed.
6. **Engineer** → Alert templates: edit the Marathi wording, pick an icon, **Record** audio in the browser, then save. The operator preview updates live.
7. **Owner**: big traffic light, red alerts with "operator acted: yes/no", **Preview today's WhatsApp summary** → *Send to owner now*.

## What's in the repo

```
backend/               Node.js + Express API
  src/server.js        app, static hosting of the React build, 8 PM cron
  src/db.js            SQLite schema (node:sqlite)
  src/auth.js          JWT login, authMiddleware, roleMiddleware, gateway shared secret
  src/routes/api.js    all REST endpoints
  src/services/
    alerts.js          event → machine/template mapping, severity rules, status machine
    notify.js          red-alert dedup + Twilio / WhatsApp Cloud / mock delivery
    summary.js         daily owner summary + traffic light
    live.js            Server-Sent Events hub (alerts appear in < 1 s)
  src/seedData.js      demo users, 5 machines, 7 templates × 4 languages
frontend/              React 18 + Vite + React Router (plain CSS, no UI kit)
  src/pages/           OperatorView, EngineerView, TemplateEditor, DrillMode, OwnerView, Setup, Login
  src/components/      AlertCard, AlertDetail (3-step drawer), AudioButton, Icon set
gateway/               Python, stdlib only
  simulate_events.py   random / targeted / burst events for the hackathon
  passive_monitor.py   real-deployment starter: tails auth.log / kern.log (read-only)
  sentinel_client.py   POST with offline buffer (buffer.jsonl) and retry
  config.json          backend URL, gateway token, machine identifiers
```

## Features

| Requirement | Where |
|---|---|
| Traffic-light alerts (colour, icon, local-language text, 3 steps) | `AlertCard.jsx`, `AlertDetail.jsx`, `OperatorView.jsx` |
| Localized scripts in hi / mr / ta with English fallback | templates in `seedData.js`; fallback in `i18n.js#pickLoc` |
| Audio playback | engineer-recorded audio per language; falls back to the device's text-to-speech |
| Owner WhatsApp/SMS: daily summary + instant red only | `notify.js`, `summary.js`, cron in `server.js` |
| Red-alert dedup (alert fatigue) | first red per *type × machine* per `RED_DEDUP_MINUTES` |
| Simulated gateway | `gateway/simulate_events.py` + **Simulate event** panel |
| Drill mode, scored and logged | `POST /api/drill/start`, `GET /api/drills`, `DrillMode.jsx` |
| Template editor (icons, severity, 4 languages, audio) | `TemplateEditor.jsx` |
| Role-based access (JWT + role flags) | `auth.js`, route guards in `main.jsx` |
| Logs for external consultants | **Export CSV** on the engineer dashboard |
| Large shopfloor screen + low-end Android | responsive CSS; extra-large cards at ≥ 1800 px |

### Roles

| | Operator | Supervisor | Engineer | Owner |
|---|---|---|---|---|
| Active alerts (last 24h), 3-step script, tick steps | ✓ | ✓ | ✓ | ✓ |
| Start drills, add training notes, mark handled | | ✓ | ✓ | |
| Full timeline, filters, raw gateway data, CSV export | | | ✓ | ✓ |
| Templates, machines, users, simulate events | | | ✓ | ✓ |
| Owner summary, notification log | | | ✓ | ✓ |

### Severity rules

Each event gets its template's default severity. Two simple rules can raise it:

- `UNK_REMOTE_LOGIN` → **red** if `failedAttempts ≥ 5` or `loginSucceeded`.
- `ABNORMAL_TRAFFIC` → **red** if `mbOut ≥ 100` or `knownBadDestination`.

An unknown `eventTypeKey` uses the `UNKNOWN_EVENT` template. An unknown `machineIdentifier` is auto-registered as "Unmapped: …" so no event is lost; rename it under **Machines & users**.

Alert status goes from `OPEN` to `ACKNOWLEDGED` (first tick) to `RESOLVED` (all 3 steps, or a supervisor/engineer marks it handled).

## API

All routes are under `/api`. Every route except `POST /auth/login` and `POST /events` needs `Authorization: Bearer <jwt>`.

| Method | Path | Roles |
|---|---|---|
| POST | `/auth/login` → `{ token, user }` | public |
| GET/PATCH | `/me` (PATCH sets `preferredLanguage`) | any |
| POST | `/events` (single object or array), header `X-Gateway-Token` | gateway |
| GET | `/alerts?severity&machineId&status&isDrill&since&until&activeOnly` | any (operators: last 24h) |
| GET | `/alerts/:id` | any |
| POST | `/alerts/:id/actions` `{ actionType: ACKNOWLEDGE \| STEP_COMPLETED \| NOTE \| RESOLVE, stepNumber }` | any (RESOLVE: not operator) |
| GET | `/alerts/export.csv` | owner, engineer |
| GET/POST/PUT | `/machines`, `/machines/:id` | GET any; write owner/engineer |
| GET/POST/PUT | `/alert-templates`, `/alert-templates/:id` | GET any; write owner/engineer |
| GET/POST | `/alert-templates/:id/localizations` | GET any; write owner/engineer |
| POST/DELETE | `/alert-templates/:id/localizations/:lang/audio` (raw `audio/*` body) | owner, engineer |
| POST | `/simulate` `{ eventTypeKey, machineId }` | owner, engineer |
| POST | `/drill/start` `{ machineId, alertTemplateId, team }` | engineer, supervisor |
| GET | `/drills` (response times, steps missed, notes) | engineer, supervisor, owner |
| GET | `/stats` | owner, engineer |
| GET | `/owner/daily-summary` · POST `/owner/daily-summary/send` | owner, engineer |
| GET | `/notifications` | owner, engineer |
| GET | `/users` · POST `/users` | owner, engineer |
| GET | `/stream?token=` (Server-Sent Events) | any |

Example gateway event:

```json
{
  "eventTypeKey": "USB_INSERT",
  "machineIdentifier": "PRESS_LINE_1_HMI",
  "timestamp": "2026-10-30T12:34:56Z",
  "details": { "usbVendor": "Generic", "port": "USB2_FRONT" }
}
```

## Real WhatsApp / SMS

Copy `backend/.env.example` to `backend/.env`; it is loaded automatically. Then set one of these:

- **Twilio**: `NOTIFY_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, and `NOTIFY_CHANNEL=WHATSAPP` or `SMS`. The Twilio WhatsApp sandbox works for a hackathon: the owner's phone must first send the sandbox join code.
- **Meta WhatsApp Cloud API**: `NOTIFY_PROVIDER=whatsapp_cloud`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. Free-form text only reaches numbers that messaged you in the last 24 hours. Production use needs approved message templates.

Owner phone numbers come from users with role OWNER (**Machines & users**). Every attempt is logged in `notification_logs` and shown on the owner page.

## Deploying on a Raspberry Pi

1. Install Node 22 LTS and Python 3 on the Pi. Clone the repo, then run `npm run install:all && npm run build`.
2. Set `JWT_SECRET` and `GATEWAY_TOKEN` in `backend/.env`. Put the same token in `gateway/config.json`.
3. Run `npm start` under systemd or pm2. The dashboard is at `http://<pi-ip>:4000`.
4. Connect the Pi to a **SPAN/mirror port** if your switch has one, then run `passive_monitor.py` (log-based) or simulate. The gateway only reads and reports; it never sends commands to PLCs or HMIs.

## Prototype limits

- The JWT is kept in memory and in `sessionStorage`, so a refresh on the shopfloor TV keeps the operator logged in. Use HTTPS and HTTP-only cookies for production.
- The SSE stream authenticates with `?token=`, because `EventSource` can't send headers. Put HTTPS in front of it.
- Text-to-speech quality for Marathi and Tamil depends on the device's installed voices. Recorded audio is the reliable option.
- Network-traffic detection (`ABNORMAL_TRAFFIC`, `NEW_DEVICE`) is simulated. A real deployment would add Zeek or Suricata on the mirror port and post the same JSON.
