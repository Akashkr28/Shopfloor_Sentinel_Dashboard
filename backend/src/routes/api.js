import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import express from 'express';
import { authMiddleware, gatewayMiddleware, publicUser, roleMiddleware, ROLES, signToken } from '../auth.js';
import { config } from '../config.js';
import { db, nowIso, tx } from '../db.js';
import {
  getAlert, ingestEvent, LANGS, listAlerts, localizationsFor, recordAction, SEVERITIES, STATUSES,
} from '../services/alerts.js';
import { broadcast, subscribe } from '../services/live.js';
import { redAlertMessage, sendDailySummary } from '../services/notify.js';
import { buildDailySummary } from '../services/summary.js';

export const api = express.Router();

const MANAGERS = ['OWNER', 'ENGINEER'];
const DRILL_RUNNERS = ['ENGINEER', 'SUPERVISOR'];
const ICONS = ['remote', 'usb', 'network', 'bug', 'device', 'shield', 'alert', 'lock', 'wifi', 'power'];

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const intParam = (v) => (v === undefined || v === '' ? undefined : Number(v));

// ---------- Health ----------
api.get('/health', (_req, res) => res.json({ ok: true, time: nowIso(), notifyProvider: config.notifyProvider }));

// ---------- Auth ----------
api.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.hashedPassword)) return bad(res, 'Wrong username or password', 401);
  res.json({ token: signToken(user), user: publicUser(user) });
});

// ---------- Gateway ingest (shared secret, no user JWT) ----------
api.post('/events', gatewayMiddleware, async (req, res) => {
  const batch = Array.isArray(req.body) ? req.body : [req.body];
  const created = [];
  for (const ev of batch) {
    const isDrill = ev.isDrill === true; // gateway may tag simulated drills
    created.push(await ingestEvent(ev, { isDrill }));
  }
  res.status(201).json({ received: created.length, alerts: created.map((a) => ({ id: a.id, severity: a.severity })) });
});

// Everything below needs a logged-in user.
api.use(authMiddleware);

api.get('/me', (req, res) => res.json(req.user));
api.patch('/me', (req, res) => {
  const { preferredLanguage } = req.body || {};
  if (!LANGS.includes(preferredLanguage)) return bad(res, 'Unsupported language');
  db.prepare('UPDATE users SET preferredLanguage = ? WHERE id = ?').run(preferredLanguage, req.user.id);
  res.json({ ...req.user, preferredLanguage });
});

api.get('/stream', subscribe);

// ---------- Users (RBAC admin) ----------
api.get('/users', roleMiddleware(...MANAGERS), (_req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY role, name').all().map(publicUser));
});
api.post('/users', roleMiddleware(...MANAGERS), (req, res) => {
  const { username, name, password, role, phoneNumber = null, preferredLanguage = 'en' } = req.body || {};
  if (!username || !name || !password) return bad(res, 'username, name and password are required');
  if (!ROLES.includes(role)) return bad(res, 'Invalid role');
  if (role === 'OWNER' && req.user.role !== 'OWNER') return bad(res, 'Only an owner can create another owner', 403);
  if (!LANGS.includes(preferredLanguage)) return bad(res, 'Unsupported language');
  try {
    const r = db
      .prepare('INSERT INTO users (username, name, phoneNumber, role, preferredLanguage, hashedPassword) VALUES (?,?,?,?,?,?)')
      .run(String(username).trim().toLowerCase(), name, phoneNumber, role, preferredLanguage, bcrypt.hashSync(password, 10));
    res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid))));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return bad(res, 'Username already exists', 409);
    throw e;
  }
});

// ---------- Machines ----------
api.get('/machines', (_req, res) => {
  res.json(
    db.prepare(
      `SELECT m.*,
         (SELECT COUNT(*) FROM alert_events e WHERE e.machineId = m.id AND e.isDrill = 0 AND e.status != 'RESOLVED' AND e.severity = 'RED') AS openRed,
         (SELECT COUNT(*) FROM alert_events e WHERE e.machineId = m.id AND e.isDrill = 0 AND e.status != 'RESOLVED' AND e.severity = 'AMBER') AS openAmber
       FROM machines m ORDER BY m.isActive DESC, m.name`,
    ).all(),
  );
});
api.post('/machines', roleMiddleware(...MANAGERS), (req, res) => {
  const { name, location = null, identifier } = req.body || {};
  if (!name || !identifier) return bad(res, 'name and identifier are required');
  try {
    const r = db.prepare('INSERT INTO machines (name, location, identifier) VALUES (?,?,?)')
      .run(name, location, String(identifier).trim().toUpperCase());
    broadcast('machines', {});
    res.status(201).json(db.prepare('SELECT * FROM machines WHERE id = ?').get(Number(r.lastInsertRowid)));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return bad(res, 'Identifier already used', 409);
    throw e;
  }
});
api.put('/machines/:id', roleMiddleware(...MANAGERS), (req, res) => {
  const m = db.prepare('SELECT * FROM machines WHERE id = ?').get(Number(req.params.id));
  if (!m) return bad(res, 'Machine not found', 404);
  const { name = m.name, location = m.location, identifier = m.identifier, isActive = !!m.isActive } = req.body || {};
  db.prepare('UPDATE machines SET name = ?, location = ?, identifier = ?, isActive = ? WHERE id = ?')
    .run(name, location, String(identifier).trim().toUpperCase(), isActive ? 1 : 0, m.id);
  broadcast('machines', {});
  res.json(db.prepare('SELECT * FROM machines WHERE id = ?').get(m.id));
});

// ---------- Alert templates & localizations ----------
const templateWithLocs = (t) => t && { ...t, localizations: localizationsFor(t.id) };

api.get('/alert-templates', (_req, res) => {
  res.json(db.prepare('SELECT * FROM alert_templates ORDER BY id').all().map(templateWithLocs));
});
api.get('/alert-templates/:id', (req, res) => {
  const t = templateWithLocs(db.prepare('SELECT * FROM alert_templates WHERE id = ?').get(Number(req.params.id)));
  return t ? res.json(t) : bad(res, 'Template not found', 404);
});

function validateTemplate(body) {
  if (body.defaultSeverity && !SEVERITIES.includes(body.defaultSeverity)) return 'Invalid severity';
  if (body.iconName && !ICONS.includes(body.iconName)) return `Icon must be one of ${ICONS.join(', ')}`;
  return null;
}

function upsertLocalizations(templateId, locs) {
  const stmt = db.prepare(
    `INSERT INTO alert_template_localizations (alertTemplateId, languageCode, title, whatYouSee, whatToDo, whomToCall, audioUrl)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (alertTemplateId, languageCode) DO UPDATE SET
       title = excluded.title, whatYouSee = excluded.whatYouSee, whatToDo = excluded.whatToDo,
       whomToCall = excluded.whomToCall, audioUrl = COALESCE(excluded.audioUrl, alert_template_localizations.audioUrl)`,
  );
  for (const l of locs) {
    if (!LANGS.includes(l.languageCode)) throw Object.assign(new Error(`Unsupported language ${l.languageCode}`), { status: 400 });
    if (!l.title?.trim()) continue; // empty tab in the editor = no translation yet; English fallback applies
    stmt.run(templateId, l.languageCode, l.title.trim(), l.whatYouSee || '', l.whatToDo || '', l.whomToCall || '', l.audioUrl || null);
  }
}

api.post('/alert-templates', roleMiddleware(...MANAGERS), (req, res) => {
  const b = req.body || {};
  const key = String(b.eventTypeKey || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (!key) return bad(res, 'eventTypeKey is required');
  const err = validateTemplate(b);
  if (err) return bad(res, err);
  try {
    const id = tx(() => {
      const r = db.prepare('INSERT INTO alert_templates (eventTypeKey, defaultSeverity, iconName, ownerFollowUp, createdByUserId) VALUES (?,?,?,?,?)')
        .run(key, b.defaultSeverity || 'AMBER', b.iconName || 'alert', b.ownerFollowUp || null, req.user.id);
      const newId = Number(r.lastInsertRowid);
      upsertLocalizations(newId, b.localizations ? Object.entries(b.localizations).map(([languageCode, l]) => ({ ...l, languageCode })) : []);
      return newId;
    });
    res.status(201).json(templateWithLocs(db.prepare('SELECT * FROM alert_templates WHERE id = ?').get(id)));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return bad(res, 'A template for this event type already exists', 409);
    throw e;
  }
});

api.put('/alert-templates/:id', roleMiddleware(...MANAGERS), (req, res) => {
  const t = db.prepare('SELECT * FROM alert_templates WHERE id = ?').get(Number(req.params.id));
  if (!t) return bad(res, 'Template not found', 404);
  const b = req.body || {};
  const err = validateTemplate(b);
  if (err) return bad(res, err);
  tx(() => {
    db.prepare('UPDATE alert_templates SET defaultSeverity = ?, iconName = ?, ownerFollowUp = ?, updatedAt = ? WHERE id = ?')
      .run(b.defaultSeverity || t.defaultSeverity, b.iconName || t.iconName, b.ownerFollowUp ?? t.ownerFollowUp, nowIso(), t.id);
    if (b.localizations) upsertLocalizations(t.id, Object.entries(b.localizations).map(([languageCode, l]) => ({ ...l, languageCode })));
  });
  broadcast('templates', { id: t.id });
  res.json(templateWithLocs(db.prepare('SELECT * FROM alert_templates WHERE id = ?').get(t.id)));
});

api.get('/alert-templates/:id/localizations', (req, res) => {
  res.json(Object.values(localizationsFor(Number(req.params.id))));
});
api.post('/alert-templates/:id/localizations', roleMiddleware(...MANAGERS), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM alert_templates WHERE id = ?').get(id)) return bad(res, 'Template not found', 404);
  upsertLocalizations(id, Array.isArray(req.body) ? req.body : [req.body]);
  broadcast('templates', { id });
  res.status(201).json(Object.values(localizationsFor(id)));
});

// Audio for one language version: raw audio body (audio/webm, audio/mpeg, ...).
const AUDIO_EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' };
api.post(
  '/alert-templates/:id/localizations/:lang/audio',
  roleMiddleware(...MANAGERS),
  express.raw({ type: 'audio/*', limit: '8mb' }),
  (req, res) => {
    const id = Number(req.params.id);
    const { lang } = req.params;
    const loc = db.prepare('SELECT * FROM alert_template_localizations WHERE alertTemplateId = ? AND languageCode = ?').get(id, lang);
    if (!loc) return bad(res, 'Save the text for this language first', 404);
    const mime = (req.get('content-type') || '').split(';')[0];
    const ext = AUDIO_EXT[mime];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 'Send an audio file (mp3, wav, webm, ogg, m4a)');
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    const file = `tpl${id}-${lang}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(config.uploadsDir, file), req.body);
    if (loc.audioUrl?.startsWith('/uploads/')) fs.rm(path.join(config.uploadsDir, path.basename(loc.audioUrl)), { force: true }, () => {});
    db.prepare('UPDATE alert_template_localizations SET audioUrl = ? WHERE id = ?').run(`/uploads/${file}`, loc.id);
    broadcast('templates', { id });
    res.status(201).json({ audioUrl: `/uploads/${file}` });
  },
);
api.delete('/alert-templates/:id/localizations/:lang/audio', roleMiddleware(...MANAGERS), (req, res) => {
  const loc = db.prepare('SELECT * FROM alert_template_localizations WHERE alertTemplateId = ? AND languageCode = ?')
    .get(Number(req.params.id), req.params.lang);
  if (!loc) return bad(res, 'Not found', 404);
  if (loc.audioUrl?.startsWith('/uploads/')) fs.rm(path.join(config.uploadsDir, path.basename(loc.audioUrl)), { force: true }, () => {});
  db.prepare('UPDATE alert_template_localizations SET audioUrl = NULL WHERE id = ?').run(loc.id);
  res.json({ ok: true });
});

// ---------- Alerts ----------
const isFloorRole = (u) => u.role === 'OPERATOR' || u.role === 'SUPERVISOR';
const forRole = (alert, user) => (isFloorRole(user) ? { ...alert, rawPayload: undefined } : alert);

api.get('/alerts', (req, res) => {
  const q = req.query;
  if (q.severity && !SEVERITIES.includes(q.severity)) return bad(res, 'Invalid severity');
  if (q.status && !STATUSES.includes(q.status)) return bad(res, 'Invalid status');
  const filters = {
    severity: q.severity, status: q.status, machineId: intParam(q.machineId),
    isDrill: q.isDrill === 'true' ? true : q.isDrill === 'false' ? false : undefined,
    since: q.since, until: q.until, activeOnly: q.activeOnly === 'true', limit: q.limit,
  };
  // Shopfloor roles see only the last 24h – enough for a shift, no history digging.
  if (isFloorRole(req.user)) {
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    if (!filters.since || filters.since < dayAgo) filters.since = dayAgo;
  }
  res.json(listAlerts(filters).map((a) => forRole(a, req.user)));
});

api.get('/alerts/export.csv', roleMiddleware(...MANAGERS), (req, res) => {
  const rows = listAlerts({ since: req.query.since, until: req.query.until, limit: 1000 });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['id', 'timestamp', 'severity', 'status', 'isDrill', 'machine', 'machineIdentifier', 'eventType', 'firstActionAt', 'stepsDone', 'rawPayload'].join(',')];
  for (const a of rows) {
    lines.push([a.id, a.timestamp, a.severity, a.status, a.isDrill, a.machineName, a.machineIdentifier, a.eventTypeKey, a.firstActionAt, a.stepsDone.join('|'), JSON.stringify(a.rawPayload)].map(esc).join(','));
  }
  res.set('Content-Type', 'text/csv').set('Content-Disposition', 'attachment; filename="sentinel-alerts.csv"').send(lines.join('\n'));
});

api.get('/alerts/:id', (req, res) => {
  const a = getAlert(Number(req.params.id), { withActions: true });
  return a ? res.json(forRole(a, req.user)) : bad(res, 'Alert not found', 404);
});

api.post('/alerts/:id/actions', (req, res) => {
  const { actionType, stepNumber, notes } = req.body || {};
  if (!['ACKNOWLEDGE', 'STEP_COMPLETED', 'NOTE', 'RESOLVE'].includes(actionType)) return bad(res, 'Invalid actionType');
  if (actionType === 'STEP_COMPLETED' && ![1, 2, 3].includes(Number(stepNumber))) return bad(res, 'stepNumber must be 1–3');
  if (actionType === 'RESOLVE' && !MANAGERS.includes(req.user.role) && req.user.role !== 'SUPERVISOR') return bad(res, 'Not allowed', 403);
  const a = recordAction(Number(req.params.id), req.user, {
    actionType, stepNumber: stepNumber ? Number(stepNumber) : null, notes: notes ? String(notes).slice(0, 1000) : null,
  });
  res.status(201).json(forRole(a, req.user));
});

// ---------- Simulate (demo button in the dashboard) ----------
api.post('/simulate', roleMiddleware(...MANAGERS), async (req, res) => {
  const { eventTypeKey, machineId, details = {} } = req.body || {};
  const m = db.prepare('SELECT * FROM machines WHERE id = ?').get(Number(machineId));
  if (!m) return bad(res, 'Pick a machine');
  const alert = await ingestEvent({
    eventTypeKey, machineIdentifier: m.identifier, timestamp: nowIso(),
    details: { ...details, source: 'dashboard-simulator' },
  });
  res.status(201).json(alert);
});

// ---------- Drills ----------
api.post('/drill/start', roleMiddleware(...DRILL_RUNNERS), async (req, res) => {
  const { machineId, alertTemplateId, team = null } = req.body || {};
  const m = db.prepare('SELECT * FROM machines WHERE id = ?').get(Number(machineId));
  const t = db.prepare('SELECT * FROM alert_templates WHERE id = ?').get(Number(alertTemplateId));
  if (!m || !t) return bad(res, 'Pick a machine and an alert type');
  const alert = await ingestEvent(
    { eventTypeKey: t.eventTypeKey, machineIdentifier: m.identifier, timestamp: nowIso(), details: { source: 'drill', severityOverride: t.defaultSeverity } },
    { isDrill: true, drillTeam: team ? String(team).slice(0, 120) : null, startedBy: req.user.id },
  );
  res.status(201).json(alert);
});

api.get('/drills', roleMiddleware('OWNER', ...DRILL_RUNNERS), (_req, res) => {
  const drills = listAlerts({ isDrill: true, limit: 100 }).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const starter = db.prepare('SELECT name FROM users WHERE id = ?');
  res.json(
    drills.map((d) => {
      const full = getAlert(d.id, { withActions: true });
      const start = new Date(d.timestamp).getTime();
      const secs = (iso) => (iso ? Math.round((new Date(iso).getTime() - start) / 1000) : null);
      const steps = full.actions.filter((a) => a.actionType === 'STEP_COMPLETED');
      const step1 = steps.find((a) => a.stepNumber === 1);
      const lastStep = d.stepsDone.length === 3 ? steps.at(-1) : null;
      return {
        id: d.id, timestamp: d.timestamp, machineName: d.machineName, eventTypeKey: d.eventTypeKey,
        title: d.localizations.en?.title || d.eventTypeKey, iconName: d.iconName, severity: d.severity,
        status: d.status, team: d.drillTeam, startedBy: d.drillStartedByUserId ? starter.get(d.drillStartedByUserId)?.name : null,
        responseSeconds: secs(full.actions[0]?.timestamp),
        step1Seconds: secs(step1?.timestamp),
        completionSeconds: secs(lastStep?.timestamp),
        stepsDone: d.stepsDone,
        stepsMissed: [1, 2, 3].filter((n) => !d.stepsDone.includes(n)),
        respondedBy: [...new Set(full.actions.filter((a) => a.actionType !== 'NOTE').map((a) => a.userName))],
        notes: full.actions.filter((a) => a.actionType === 'NOTE').map((a) => ({ by: a.userName, text: a.notes, at: a.timestamp })),
      };
    }),
  );
});

// ---------- Stats (engineer dashboard widgets) ----------
api.get('/stats', roleMiddleware(...MANAGERS), (_req, res) => {
  const since = new Date(Date.now() - 86400000).toISOString();
  const counts = { RED: 0, AMBER: 0, GREEN: 0 };
  for (const r of db.prepare('SELECT severity, COUNT(*) AS n FROM alert_events WHERE isDrill = 0 AND timestamp >= ? GROUP BY severity').all(since)) counts[r.severity] = r.n;
  const topMachines = db.prepare(
    `SELECT m.id, m.name, COUNT(*) AS n, SUM(e.severity = 'RED') AS red
     FROM alert_events e JOIN machines m ON m.id = e.machineId
     WHERE e.isDrill = 0 AND e.timestamp >= ? AND e.severity != 'GREEN'
     GROUP BY m.id ORDER BY red DESC, n DESC LIMIT 5`,
  ).all(since);
  const responseTimes = db.prepare(
    `SELECT (julianday(MIN(a.timestamp)) - julianday(e.timestamp)) * 86400 AS secs
     FROM alert_events e JOIN alert_actions a ON a.alertEventId = e.id
     WHERE e.timestamp >= ? AND e.severity != 'GREEN' GROUP BY e.id`,
  ).all(since).map((r) => r.secs).sort((a, b) => a - b);
  const median = responseTimes.length ? Math.round(responseTimes[Math.floor(responseTimes.length / 2)]) : null;
  const open = db.prepare("SELECT COUNT(*) AS n FROM alert_events WHERE status != 'RESOLVED' AND severity != 'GREEN' AND isDrill = 0").get().n;
  const redSentToday = db.prepare("SELECT COUNT(*) AS n FROM notification_logs WHERE type = 'RED_ALERT' AND status = 'SENT' AND timestamp >= ?").get(since).n;
  res.json({ counts, topMachines, medianResponseSeconds: median, openNeedingAction: open, redMessagesLast24h: redSentToday });
});

// ---------- Owner summaries & notification log ----------
api.get('/owner/daily-summary', roleMiddleware(...MANAGERS), (_req, res) => res.json(buildDailySummary()));
api.post('/owner/daily-summary/send', roleMiddleware(...MANAGERS), async (_req, res) => res.json(await sendDailySummary()));
api.get('/owner/red-alert-preview/:id', roleMiddleware(...MANAGERS), (req, res) => {
  const a = getAlert(Number(req.params.id), { withActions: true });
  return a ? res.json({ message: redAlertMessage(a) }) : bad(res, 'Alert not found', 404);
});
api.get('/notifications', roleMiddleware(...MANAGERS), (_req, res) => {
  res.json(db.prepare(
    `SELECT n.*, u.name AS userName, u.phoneNumber FROM notification_logs n LEFT JOIN users u ON u.id = n.userId
     ORDER BY n.timestamp DESC LIMIT 50`,
  ).all());
});
