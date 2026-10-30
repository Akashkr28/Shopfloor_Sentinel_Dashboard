## 1. Problem Statement

Small and medium manufacturing factories increasingly connect machines, PLCs, and HMIs to local networks and the internet, but:

- Cybersecurity tools are designed for IT/security experts, not shopfloor operators.
- Alerts are presented in technical English (IP, port scans, lateral movement, RDP brute force) that migrant workers cannot interpret or act on.
- There is **no process or incentive** to co-design and localize security messages into operators’ real languages (Hindi, Marathi, Tamil), literacy levels, and shift workflows.
- Owners only hear about cybersecurity when something breaks, or through long compliance reports they don’t read.
- Existing solutions are expensive, agent-heavy, and often active (sending commands to PLCs / endpoints), which feels risky for factories that must prioritize uptime.

Result:  
Security events on the shopfloor go unnoticed, misunderstood, or are quietly ignored. Operators don’t know what to do, engineers don’t have time to translate logs into procedures, and owners can’t get a simple, actionable picture of risk.

---

## 2. Solution Overview – Shopfloor Sentinel Dashboard

**Shopfloor Sentinel** is a lightweight web + mobile dashboard with a **traffic‑light cyber health view** for SME factories.

Core ideas:

- A **passive monitoring gateway** (Raspberry Pi or old PC) sits on the network, mirrors traffic, and/or watches system logs – but never sends commands to PLCs or HMIs.
- Raw technical security events (e.g., “unknown remote login attempt”, “USB drive inserted in HMI”, “suspicious outbound traffic”) are converted into:
  - **Human‑friendly alert cards** with **green/amber/red** status,
  - **Icon‑based** visuals plus **short 3‑step scripts** in Hindi, Marathi, and Tamil (with optional audio).
- **Owners** get:
  - A **daily WhatsApp/SMS summary** of all events,  
  - Plus **instant messages only for red alerts** (to avoid desensitization / alert fatigue).
- **Engineers** get:
  - A **React-based dashboard** they can install and run easily,
  - A **simple alert template editor** to customize wording/icons per machine and language,
  - A **“drill mode”** to simulate alerts during shift-change, so operators can practice the 3‑step response.
- **Prototype focus**: Use Node.js for backend + alert logic, React for UI, and Python on the Raspberry Pi to simulate events and push them to the backend.

The result is a practical “cyber shield” that is cheap, understandable, and fits into existing shopfloor routines.

---

## 3. Target Users

### 3.1 Factory Owners / Managing Partners (SMEs)

- Need a **simple overall picture of cyber risk** without technical details.
- Often offsite: want **mobile-friendly** and **WhatsApp/SMS** based updates.
- Hate false alarms and long reports; they want:
  - “Are we okay today?”  
  - “What went wrong, and what did my team do?”

### 3.2 Maintenance & Automation Engineers

- Intermediate technical skill (PLC, HMIs, basic networks), but usually **not security specialists**.
- Need:
  - A **clear dashboard** showing which machine/network segment is at risk.
  - Ability to **customize alert templates** (icons, language text, mapping machine names).
  - A **simple setup** that does not require deep Linux / cyber expertise.
- Also responsible for **training operators** – they want a built-in **drill / simulation mode**.

### 3.3 Basic IT Staff (if present)

- Responsible for network, antivirus, backups.
- Needs:
  - **Logs and summaries** that can be shared with external security consultants.
  - Ability to help configure **role-based access** (who sees what).

### 3.4 Shopfloor Operators / Supervisors

- Migrant or local workers, often:
  - Limited English literacy,
  - Different native languages (Hindi, Marathi, Tamil).
- Need:
  - **Icon + color-coded alerts** they can understand at a glance.
  - **Short 3-step instructions** in their language (with option to listen as audio).
  - A **drill mode** to practice what to do during different events.

---

## 4. Key Features

You must build all of these in the prototype.

1. **Traffic-Light Alert System**
   - Central dashboard showing machine/network health with **green/amber/red** severity.
   - Each alert card includes:  
     - Color severity (green/amber/red),  
     - Icon,  
     - Short description in local language,  
     - 3-step response.

2. **Localized Operator Scripts**
   - For each type of event, define **3-step scripts** per language:
     1. **What you see** (on machine, HMI, or physical environment),
     2. **What to do now** (immediate safe actions),
     3. **Whom to call** (role/phone).
   - Available in **Hindi, Marathi, and Tamil**, with support for:
     - Fallback to English,
     - Optional **audio playback** of the script.

3. **SMS/WhatsApp Alerts for Owners**
   - Daily **WhatsApp/SMS summary** of all events per day.
   - **Instant messages only for red alerts** with:
     - Event type,
     - Time & affected machine/area,
     - Was operator action taken (Y/N/unknown),
     - Recommended owner follow‑up.

4. **Simulated Alert Environment**
   - A **Raspberry Pi (or old PC) gateway** that:
     - Passively monitors the network or log files (in real world),
     - For prototype, **generates simulated events** using Python scripts:
       - Unknown remote login,
       - USB insertions,
       - Abnormal network traffic.
   - A “Simulate Event” interface in the dashboard to trigger test events.

5. **User-Friendly Interface**
   - **React-based** responsive dashboard.
   - Clear **navigation by roles** (Owner / Engineer / Operator).
   - Visual layout optimized for:
     - Large shopfloor screen (TV/tablet),
     - Basic Android phone browser access.

6. **Role-Based Access Control**
   - Basic roles and permissions:
     - **Owner** – full overview, receive summaries.
     - **Engineer / IT** – manage templates, view detailed events, create drills.
     - **Operator / Supervisor** – see only relevant alerts and drill mode.
   - Implemented via **JWT-based auth** and role flags.

Additionally integrated concepts:

- **Template Editor for Alerts**  
  Embedded in “Localized Operator Scripts / User-Friendly Interface”:
  - Simple UI for engineers to customize alert cards (icons, text, languages).
- **Drill Mode**  
  Embedded in “Simulated Alert Environment / User-Friendly Interface”:
  - Supervisor can run a guided drill that looks/feels like a real alert, scored and logged.

---

## 5. User Flow

### 5.1 Setup (Maintenance Engineer)

1. **Install gateway**:
   - Connect Raspberry Pi / old PC to factory network (SPAN/mirror port if possible).
   - Install Python agent and configure backend URL.
2. **Run backend and dashboard**:
   - Deploy Node.js backend (on same gateway or separate server).
   - Deploy React front-end (served via Node or static hosting).
3. **Create initial users**:
   - Owner account (phone number for WhatsApp/SMS).
   - Engineer account(s).
   - Operator/supervisor accounts (optional; can also use shared login for prototype).
4. **Configure machines / zones**:
   - Engineer defines machines/zones (e.g., “Press Line 1”, “Packaging HMI A”).
   - Map them to identifiers used in events coming from the Pi.

### 5.2 Template & Localization Setup (Engineer)

5. **Open Template Editor** (Engineer role):
   - Go to “Alert Templates” in dashboard.
6. **For each event type**, define:
   - Name (e.g., “Unknown Remote Login Attempt”).
   - Severity mapping: default amber or red.
   - Icons: “remote connection”, “USB”, “network flood”.
   - Scripts per language (Hindi/Marathi/Tamil):
     - Step 1 – what operator should notice.
     - Step 2 – immediate safe action.
     - Step 3 – whom to call (role/phone).
   - Optionally record/upload **audio** for each language version.
7. **Save templates**:
   - Node backend stores templates in database.

### 5.3 Daily Operation – Operators & Engineers

8. **Passive monitoring runs continuously**:
   - Python scripts on the Pi generate **simulated events** during hackathon:
     - Unknown SSH login attempt to a test device.
     - USB insertion event from a dummy log file.
     - Abnormal traffic (e.g., unusual connection to external IP).
   - In real deployment, Pi would parse actual logs/packets passively.
9. **Events sent to backend**:
   - Python scripts POST JSON events to Node backend.
   - Node matches each event to:
     - Machine/zone,  
     - Template type,  
     - Severity (green/amber/red).
10. **Dashboard displays alerts**:
    - React fetches active alerts and shows:
      - List of alert cards sorted by time/severity.
      - Color-coded status.
      - Icon + short text + language toggles + play-audio button.
11. **Operator sees an alert**:
    - Operator screen shows large **red/amber/green** blocks.
    - Taps on an alert:
      - Sees “What you see / What to do / Whom to call” in chosen local language.
      - May listen to the audio instructions.
    - Operator performs the steps and optionally marks:
      - “I did this” (Checklist tick) – stored as event action log.

12. **Engineer view**:
    - Can see:
      - Timeline of alerts,
      - Which ones were acted upon,
      - Filter by machine, severity, or status.

### 5.4 Owners’ Alerts – WhatsApp/SMS

13. **Daily summary** (cron job in backend):
    - At set time (e.g., 8 PM), Node backend:
      - Summarizes all alerts of the day:
        - Count by severity,
        - Top 3 issues,
        - Any unresolved red alerts.
      - Sends summary via WhatsApp/SMS API to owner.
14. **Instant red alerts**:
    - When an alert of severity red occurs:
      - Backend immediately sends a short WhatsApp/SMS:
        - “Red alert: USB plugged into HMI on Press Line 1 at 14:03. Operator advised to disconnect and call Engineer. Status: pending/acknowledged.”

### 5.5 Drill Mode (Supervisors & Operators)

15. **Supervisor starts a drill** (Engineer or Supervisor role):
    - From dashboard, click “Drill Mode”.
    - Select:
      - Machine/zone,
      - Alert type (e.g., suspicious software, unknown login),
      - Target shift/team.
16. **System generates a simulated alert**:
    - Backend flags event as a “DRILL”.
    - Operator screen shows it as a normal alert (with a subtle “Drill” label).
17. **Operator responds**:
    - Follows the 3-step script.
    - Ticks actions complete.
18. **Drill report**:
    - Drill completion time and steps taken are recorded.
    - Engineer/supervisor can review:
      - Response time,
      - Steps missed,
      - Training notes.

---

## 6. Technical Approach

### 6.1 Architecture Overview

- **Client (UI)**: React web app, responsive for desktop and mobile.
- **Backend API + Business Logic**: Node.js + Express (or Fastify).
- **Gateway / Event Generator**: Python scripts running on Raspberry Pi / old PC.
- **Database**: Lightweight option – SQLite or PostgreSQL (Postgres preferred for future scale).
- **Notifications**: WhatsApp/SMS via Twilio, Meta WhatsApp Cloud API, or similar.
- **Auth & RBAC**: JWT-based auth with role claims.

#### Data Flow

1. Python gateway detects or simulates events.
2. Python posts JSON to a `/events` endpoint on Node backend.
3. Backend:
   - Validates event,
   - Maps to machine and alert template,
   - Decides severity,
   - Persists event.
4. React UI queries `/alerts` and `/machines` for display.
5. Scheduled job on backend generates daily summary + sends via WhatsApp/SMS.
6. Red alerts trigger immediate message.

---

### 6.2 Backend (Node.js) – Detailed Plan

**Tech stack:**

- Node.js 18+
- Express.js
- PostgreSQL or SQLite via Prisma/TypeORM/Knex
- JSON Web Tokens (JWT) for auth
- node-cron for scheduled tasks
- WhatsApp/SMS API client (e.g., Twilio SDK or direct HTTP to WhatsApp Cloud API)

#### Core Data Models (simplified)

- `User`
  - id
  - name
  - phoneNumber
  - role: "OWNER" | "ENGINEER" | "OPERATOR"
  - preferredLanguage: "en" | "hi" | "mr" | "ta"
  - hashedPassword

- `Machine`
  - id
  - name (e.g., Press Line 1)
  - location
  - identifier (used by gateway to tag events)
  - isActive

- `AlertTemplate`
  - id
  - eventTypeKey (e.g., UNK_REMOTE_LOGIN, USB_INSERT, ABNORMAL_TRAFFIC)
  - defaultSeverity: "GREEN" | "AMBER" | "RED"
  - iconName (string to map to front-end icon set)
  - createdByUserId

- `AlertTemplateLocalization`
  - id
  - alertTemplateId
  - languageCode: "en" | "hi" | "mr" | "ta"
  - title
  - whatYouSee
  - whatToDo
  - whomToCall
  - audioUrl (optional)

- `AlertEvent`
  - id
  - machineId
  - alertTemplateId
  - severity: "GREEN" | "AMBER" | "RED"
  - timestamp
  - isDrill: boolean
  - status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED"
  - rawPayload (JSON) – original event data from gateway

- `AlertAction`
  - id
  - alertEventId
  - userId (operator)
  - actionType: "ACKNOWLEDGE" | "STEP_COMPLETED"
  - stepNumber (1–3)
  - timestamp
  - notes (optional)

- `NotificationLog`
  - id
  - alertEventId (optional)
  - userId (receiver)
  - type: "DAILY_SUMMARY" | "RED_ALERT"
  - channel: "WHATSAPP" | "SMS"
  - status: "SENT" | "FAILED"
  - timestamp

#### API Endpoints (examples)

- **Auth**
  - `POST /auth/login` – returns JWT with role.
- **Users & Roles**
  - `GET /me` – returns current user and role.
- **Machines**
  - `GET /machines`
  - `POST /machines` (ENGINEER/OWNER only)
- **Alert Templates**
  - `GET /alert-templates`
  - `POST /alert-templates` – create template.
  - `PUT /alert-templates/:id` – update.
  - `GET /alert-templates/:id/localizations`
  - `POST /alert-templates/:id/localizations`
- **Events & Alerts**
  - `POST /events` – from gateway (no auth or token-based shared secret).
  - `GET /alerts` – filter by severity, machine, status, isDrill.
  - `GET /alerts/:id`
  - `POST /alerts/:id/actions` – operator actions (acknowledge/complete step).
- **Drill**
  - `POST /drill/start` – ENGINEER/SUPERVISOR; backend creates a DRILL alert event.
- **Owner Summaries**
  - `GET /owner/daily-summary` – for UI preview.

#### Business Logic

- Map incoming event payload to template:
  - event type key + machine identifier → `alertTemplateId`, `machineId`.
- Determine severity:
  - use `defaultSeverity` from template, optionally adjusted if rules demand.
- Avoid sending repeated red alerts to owner:
  - Only first red event of unique type per machine within some time window triggers message (configurable).
- Role-based checks:
  - Only OWNER/ENGINEER can see all alerts.
  - OPERATOR sees only active open alerts for their machines or globally for MVP.

---

### 6.3 Gateway & Simulation (Python on Raspberry Pi)

**Tech stack:**

- Python 3.x
- `requests` library (or `httpx`) for POSTing events.
- Simple configuration file (YAML/JSON) for backend URL and factory-specific IDs.

#### Components

1. **Event Simulator (for hackathon)**:
   - Script `simulate_events.py`:
     - Periodically (e.g., every 30–60 seconds) sends random simulated events:
       - Type: `UNK_REMOTE_LOGIN`, `USB_INSERT`, `ABNORMAL_TRAFFIC`.
       - Machine identifier: one of configured machines.
     - Payload example:
       ```json
       {
         "eventTypeKey": "USB_INSERT",
         "machineIdentifier": "PRESS_LINE_1_HMI",
         "timestamp": "2026-10-30T12:34:56Z",
         "details": {
           "usbVendor": "Generic",
           "port": "USB2_FRONT"
         }
       }
       ```

2. **(Optional) Passive Monitor for Real Deployment (outline only)**:
   - Read system authentication logs for login attempts.
   - Watch `/var/log/messages` or Windows event logs (if applicable).
   - Use simple heuristics to generate events (e.g., failed logins > threshold).
   - Never send any commands to PLCs or devices (strictly one-way observe → API).

3. **Drill Integration**:
   - For MVP, drills generated directly in backend (no gateway involvement needed).
   - Optionally, gateway can tag some events as `isSimulated`/`isDrill`, but not strictly required.

---

### 6.4 Frontend (React)

**Tech stack:**

- React 18+
- TypeScript (recommended but optional)
- Router (React Router)
- UI framework: Material-UI / Chakra UI / Tailwind CSS
- i18n: react-i18next (frontend localization; but the operator scripts come from backend)

#### Main Screens

1. **Login Page**
   - Simple username/password.
   - After login, route based on role (Owner / Engineer / Operator).

2. **Dashboard – Operator View**
   - Large, color-coded alert list:
     - Red at top, then amber, then green.
   - Each alert card:
     - Icon,
     - Title (localized),
     - Color strip/border,
     - Machine name,
     - Age (e.g., “2 min ago”).
   - Clicking card → **Alert Detail Drawer**:
     - Language selector (Hindi, Marathi, Tamil; defaults from user preference).
     - 3-step script with big numbered steps.
     - “Play audio” buttons if audioUrl exists.
     - “I have done this” checkboxes.
   - Quick filter: “Active only | All”.

3. **Dashboard – Engineer / IT View**
   - Alert timeline with filters:
     - Date, machine, severity, status, isDrill.
   - Stats widgets:
     - Count by severity last 24h.
     - Machines with most alerts.
   - Buttons:
     - “Start Drill”
     - “Simulate Event” (for demo)

4. **Template Editor**
   - List of alert templates:
     - EventTypeKey, defaultSeverity, icon preview.
   - Edit/create template:
     - EventTypeKey (select from predefined for MVP),
     - Default severity dropdown,
     - Icon selection (predefined icon list).
   - Localization sub-form:
     - Tabs: English, Hindi, Marathi, Tamil.
     - Fields: title, whatYouSee, whatToDo, whomToCall.
     - Audio upload (optional).
   - Save – sends to `/alert-templates` and localization endpoints.

5. **Drill Mode Screen**
   - Form:
     - Choose machine,
     - Choose alert template,
     - Choose target shift/team (just a text note for MVP).
   - “Start Drill” → calls `/drill/start`.
   - List of recent drills with:
     - Status, response time, step completion.

6. **Owner View**
   - Simplified summary dashboard:
     - Today’s status: big traffic light (green/amber/red).
     - # of alerts by severity.
     - List of red alerts and their status.
   - “Preview Today’s WhatsApp Summary” button.

#### UI & Accessibility Notes

- Use **large icons** and bold colors for operators.
- Minimize text on operator cards; detailed text only inside alert detail.
- Make audio button obvious (speaker icon).
- Ensure mobile-first layout for low-end Android phones.

---

### 6.5 Role-Based Access Control Implementation

- **Authentication:**
  - Simple login with username/password.
  - Backend returns JWT with:
    - `sub` (userId), `role`, `preferredLanguage`.
- **Middleware:**
  - `authMiddleware` verifies JWT on protected routes.
  - `roleMiddleware(requiredRoles)` ensures only allowed roles access certain endpoints.
- **Frontend routing:**
  - Store JWT in memory or HTTP-only cookies.
  - Redirect based on `role` to correct initial view.
  - Hide UI elements based on role (e.g., Template Editor only for ENGINEER/OWNER).

---

### 6.6 Non-Functional Requirements (Prototype-Appropriate)

- **Low-cost & minimal dependencies**:
  - Run all services on Pi / old PC if necessary (just Node, DB, Python).
- **Security (basic)**:
  - HTTPS for API if possible.
  - Shared secret or token between gateway and backend.
- **Offline-first (optional)**:
  - If network drops, gateway buffers events locally and retries when online.

---

## 7. Success Metrics

To evaluate if **Shopfloor Sentinel** is working during and after the hackathon:

### 7.1 Operator Understanding & Response

- **Task completion in drills**:
  - ≥ 80% of operators can correctly perform all 3 steps in **at least 2 drill scenarios** without external help.
- **Time to action**:
  - Median time from alert appearing to operator marking step 1 as done in drills **< 60 seconds**.
- **Language/icon comprehension** (through quick user feedback):
  - Operators can correctly explain the meaning of **≥ 4 out of 5 icons/colors** when tested.

### 7.2 Owner Awareness & Signal Quality

- **Owner engagement**:
  - Owners read or open **≥ 70%** of daily WhatsApp summaries (track via delivery/read receipts if available).
- **Alert fatigue control**:
  - No more than **2–3 red alerts per day** per factory in test environment (indicating deduplication/logic is working).
- **Owner recall**:
  - Owner can summarize “what went wrong today” correctly based on the daily summary.

### 7.3 Engineer Usability

- **Setup time**:
  - One maintenance engineer can:
    - Install the gateway,
    - Set up dashboard,
    - Configure at least 3 machines and 3 templates  
    within **2 hours** using provided instructions.
- **Template creation**:
  - Engineer can create or modify **at least 3 alert templates** including local language scripts during the hackathon, without developer assistance.

### 7.4 System Reliability (Prototype-Level)

- **Event delivery**:
  - ≥ 95% of simulated events appear as alerts on the dashboard within **5 seconds**.
- **Notification reliability**:
  - ≥ 90% of red alerts generate a corresponding WhatsApp/SMS message in test environment.

---

This plan provides enough detail for an AI prototyping tool (or student team) to:

- Scaffold the **React** front-end (with distinct role-based views).
- Implement the **Node.js** backend, models, and endpoints.
- Build a **Python** event simulator on the Raspberry Pi.
- Wire up **traffic-light alerts, localized operator scripts, owner WhatsApp/SMS alerts, simulated environment, user-friendly UI, and RBAC** into a coherent prototype for the hackathon.