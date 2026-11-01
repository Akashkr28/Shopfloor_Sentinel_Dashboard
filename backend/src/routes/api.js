import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import express from 'express';
import {
  authMiddleware, clearSessionCookie, gatewayMiddleware, publicUser, resolveSession, roleMiddleware, ROLES, setSessionCookie, signToken,
} from '../auth.js';
import { config } from '../config.js';
import { db, nowIso, tx } from '../db.js';
import {
  audit, csrfGuard, hit, IDENTIFIER_RE, password, PHONE_RE, rateLimit, str, USERNAME_RE, ValidationError,
} from '../security.js';
import {
  getAlert, ingestEvent, LANGS, listAlerts, localizationsFor, recordAction, SEVERITIES, STATUSES,
} from '../services/alerts.js';
import { broadcast, subscribe } from '../services/live.js';
import {
  deliveryResults, enqueue, notificationConfigStatus, processQueue, redAlertMessage, sendDailySummary,
} from '../services/notify.js';
import { buildDailySummary } from '../services/summary.js';
import { gatewayStatus, recordGatewaySeen } from '../services/watchdog.js';
import { getChunk, knowledgeStatus, listDocuments, searchKnowledge, syncKnowledgeBase } from '../ai/knowledge.js';
import { aiStatus, latestTriage, requestTriage } from '../ai/triage.js';

export const api = express.Router();

const MANAGERS = ['OWNER', 'ENGINEER'];
const DRILL_RUNNERS = ['ENGINEER', 'SUPERVISOR'];
const ICONS = ['remote', 'usb', 'network', 'bug', 'device', 'shield', 'alert', 'lock', 'wifi', 'power'];

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const intParam = (v) => (v === undefined || v === '' ? undefined : Number(v));
const isoParam = (v, field) => {
  if (v === undefined || v === '') return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${field} must be a date`);
  return d.toISOString();
};

// ---------- Health ----------
api.get('/health', (_req, res) => res.json({ ok: true, time: nowIso(), notifyProvider: config.notifyProvider }));

// ---------- Auth ----------
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

api.post('/auth/login', rateLimit({ name: 'login-ip', limit: 30, windowMs: 15 * 60000 }), (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase().slice(0, 64);
  const pw = String(req.body?.password || '').slice(0, 200);
  req.auditUsername = username;
  // Per-account limit stops password guessing against one user from many IPs.
  const retry = hit(`login-user:${username}`, 10, 15 * 60000);
  if (retry) {
    audit(req, 'LOGIN_BLOCKED', username);
    return res.set('Retry-After', String(retry)).status(429).json({ error: `Too many attempts – try again in ${Math.ceil(retry / 60)} min` });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ok = bcrypt.compareSync(pw, user?.hashedPassword || DUMMY_HASH);
  if (!user || !ok || !user.isActive) {
    audit(req, 'LOGIN_FAILED', username, user && !user.isActive ? { reason: 'disabled' } : null);
    return bad(res, 'Wrong username or password', 401);
  }
  const token = signToken(user);
  setSessionCookie(res, token);
  req.user = publicUser(user);
  audit(req, 'LOGIN', username);
  // The browser relies on the HttpOnly cookie; the token is returned for scripts and the gateway CLI.
  res.json({ user: publicUser(user), token });
});

// The UI asks this on load: 200 either way, so a logged-out visitor isn't an error.
api.get('/auth/session', (req, res) => res.json({ user: resolveSession(req).user || null }));

api.post('/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- Gateway (shared secret, no user session) ----------
const gatewayLimit = rateLimit({ name: 'gateway', limit: 600, windowMs: 60000 });

api.post('/events', gatewayLimit, gatewayMiddleware, async (req, res) => {
  const batch = Array.isArray(req.body) ? req.body : [req.body];
  if (batch.length > 100) return bad(res, 'At most 100 events per request');
  recordGatewaySeen(req.gatewayId, { ip: req.ip });
  const created = [];
  for (const ev of batch) created.push(await ingestEvent(ev, { isDrill: ev?.isDrill === true }));
  res.status(201).json({ received: created.length, alerts: created.map((a) => ({ id: a.id, severity: a.severity })) });
});

api.post('/gateway/heartbeat', gatewayLimit, gatewayMiddleware, (req, res) => {
  const b = req.body || {};
  recordGatewaySeen(req.gatewayId, {
    hostname: str(b.hostname, 'hostname', { max: 100 }),
    version: str(b.version, 'version', { max: 40 }),
    monitors: Array.isArray(b.monitors) ? b.monitors.slice(0, 20).map((m) => String(m).slice(0, 40)) : null,
    stats: b.stats && typeof b.stats === 'object' && JSON.stringify(b.stats).length < 4000 ? b.stats : null,
    ip: req.ip,
  });
  res.json({ ok: true, serverTime: nowIso() });
});

// ---------- Webhooks are mounted separately (routes/webhooks.js). Everything below needs a session. ----------
api.use(authMiddleware, csrfGuard);

api.get('/me', (req, res) => res.json(req.user));
api.patch('/me', (req, res) => {
  const { preferredLanguage } = req.body || {};
  if (!LANGS.includes(preferredLanguage)) return bad(res, 'Unsupported language');
  db.prepare('UPDATE users SET preferredLanguage = ? WHERE id = ?').run(preferredLanguage, req.user.id);
  res.json({ ...req.user, preferredLanguage });
});

api.post('/me/password', rateLimit({ name: 'pw-change', limit: 10, windowMs: 15 * 60000, key: (req) => req.user.id }), (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const row = db.prepare('SELECT hashedPassword FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(currentPassword || ''), row.hashedPassword)) {
    audit(req, 'PASSWORD_CHANGE_FAILED', req.user.username);
    return bad(res, 'Current password is wrong', 403);
  }
  const next = password(newPassword, 'New password');
  if (next === currentPassword) return bad(res, 'New password must be different');
  db.prepare('UPDATE users SET hashedPassword = ?, passwordChangedAt = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), nowIso(), req.user.id);
  // Old sessions are now invalid; give this browser a fresh one.
  setSessionCookie(res, signToken(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
  audit(req, 'PASSWORD_CHANGED', req.user.username);
  res.json({ ok: true });
});

api.get('/stream', subscribe);

// ---------- Users (RBAC admin) ----------
function loadUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
}

/** Engineers manage floor staff and other engineers; only owners touch owner accounts. */
function canManage(actor, target) {
  return actor.role === 'OWNER' || target.role !== 'OWNER';
}

api.get('/users', roleMiddleware(...MANAGERS), (_req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY isActive DESC, role, name').all().map(publicUser));
});

api.post('/users', roleMiddleware(...MANAGERS), (req, res) => {
  const b = req.body || {};
  const username = str(b.username, 'Username', { required: true, max: 32 })?.toLowerCase();
  if (!USERNAME_RE.test(username)) return bad(res, 'Username: 3–32 characters, a–z 0–9 . _ -');
  const name = str(b.name, 'Name', { required: true, max: 80 });
  const pw = password(b.password);
  if (!ROLES.includes(b.role)) return bad(res, 'Invalid role');
  if (b.role === 'OWNER' && req.user.role !== 'OWNER') return bad(res, 'Only an owner can create another owner', 403);
  const preferredLanguage = b.preferredLanguage || 'en';
  if (!LANGS.includes(preferredLanguage)) return bad(res, 'Unsupported language');
  const phoneNumber = str(b.phoneNumber, 'Phone', { max: 16, pattern: PHONE_RE });
  try {
    const r = db
      .prepare('INSERT INTO users (username, name, phoneNumber, role, preferredLanguage, hashedPassword) VALUES (?,?,?,?,?,?)')
      .run(username, name, phoneNumber, b.role, preferredLanguage, bcrypt.hashSync(pw, 10));
    audit(req, 'USER_CREATED', username, { role: b.role });
    res.status(201).json(publicUser(loadUser(r.lastInsertRowid)));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return bad(res, 'Username already exists', 409);
    throw e;
  }
});

api.patch('/users/:id', roleMiddleware(...MANAGERS), (req, res) => {
  const u = loadUser(req.params.id);
  if (!u) return bad(res, 'User not found', 404);
  if (!canManage(req.user, u)) return bad(res, 'Only an owner can change an owner account', 403);
  const b = req.body || {};
  const next = {
    name: b.name !== undefined ? str(b.name, 'Name', { required: true, max: 80 }) : u.name,
    phoneNumber: b.phoneNumber !== undefined ? str(b.phoneNumber, 'Phone', { max: 16, pattern: PHONE_RE }) : u.phoneNumber,
    role: b.role ?? u.role,
    preferredLanguage: b.preferredLanguage ?? u.preferredLanguage,
    isActive: b.isActive !== undefined ? (b.isActive ? 1 : 0) : u.isActive,
  };
  if (!ROLES.includes(next.role)) return bad(res, 'Invalid role');
  if (next.role === 'OWNER' && req.user.role !== 'OWNER') return bad(res, 'Only an owner can grant the owner role', 403);
  if (!LANGS.includes(next.preferredLanguage)) return bad(res, 'Unsupported language');
  if (u.id === req.user.id && (!next.isActive || next.role !== u.role)) return bad(res, 'You cannot disable yourself or change your own role');
  if (u.role === 'OWNER' && (next.role !== 'OWNER' || !next.isActive)) {
    const owners = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'OWNER' AND isActive = 1").get().n;
    if (owners <= 1) return bad(res, 'The factory needs at least one active owner');
  }
  db.prepare('UPDATE users SET name = ?, phoneNumber = ?, role = ?, preferredLanguage = ?, isActive = ? WHERE id = ?')
    .run(next.name, next.phoneNumber, next.role, next.preferredLanguage, next.isActive, u.id);
  const changed = Object.keys(next).filter((k) => next[k] !== u[k]);
  if (changed.length) audit(req, next.isActive !== u.isActive ? (next.isActive ? 'USER_ENABLED' : 'USER_DISABLED') : 'USER_UPDATED', u.username, { changed });
  res.json(publicUser(loadUser(u.id)));
});

api.post('/users/:id/password', roleMiddleware(...MANAGERS), (req, res) => {
  const u = loadUser(req.params.id);
  if (!u) return bad(res, 'User not found', 404);
  if (!canManage(req.user, u)) return bad(res, 'Only an owner can reset an owner password', 403);
  const pw = password(req.body?.newPassword, 'New password');
  db.prepare('UPDATE users SET hashedPassword = ?, passwordChangedAt = ? WHERE id = ?').run(bcrypt.hashSync(pw, 10), nowIso(), u.id);
  audit(req, 'PASSWORD_RESET', u.username);
  res.json({ ok: true });
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

function machineFields(b, current = {}) {
  const identifier = (b.identifier !== undefined ? str(b.identifier, 'Identifier', { required: true, max: 64 }) : current.identifier)?.toUpperCase();
  if (!IDENTIFIER_RE.test(identifier || '')) throw new ValidationError('Identifier: 2–64 characters A–Z 0–9 _ . : -');
  return {
    name: b.name !== undefined || !current.name ? str(b.name, 'Name', { required: true, max: 80 }) : current.name,
    location: b.location !== undefined ? str(b.location, 'Location', { max: 80 }) : current.location ?? null,
    identifier,
    isActive: b.isActive !== undefined ? (b.isActive ? 1 : 0) : current.isActive ?? 1,
  };
}

api.post('/machines', roleMiddleware(...MANAGERS), (req, res) => {
  const m = machineFields(req.body || {});
  try {
    const r = db.prepare('INSERT INTO machines (name, location, identifier, isActive) VALUES (?,?,?,?)').run(m.name, m.location, m.identifier, m.isActive);
    broadcast('machines', {});
    audit(req, 'MACHINE_CREATED', m.identifier, { name: m.name });
    res.status(201).json(db.prepare('SELECT * FROM machines WHERE id = ?').get(Number(r.lastInsertRowid)));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return bad(res, 'Identifier already used', 409);
    throw e;
  }
});

api.put('/machines/:id', roleMiddleware(...MANAGERS), (req, res) => {
  const cur = db.prepare('SELECT * FROM machines WHERE id = ?').get(Number(req.params.id));
  if (!cur) return bad(res, 'Machine not found', 404);
  const m = machineFields(req.body || {}, cur);
  try {
    db.prepare('UPDATE machines SET name = ?, location = ?, identifier = ?, isActive = ? WHERE id = ?').run(m.name, m.location, m.identifier, m.isActive, cur.id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return bad(res, 'Identifier already used', 409);
    throw e;
  }
  broadcast('machines', {});
  audit(req, 'MACHINE_UPDATED', m.identifier, { from: cur.identifier !== m.identifier ? cur.identifier : undefined, name: m.name, isActive: !!m.isActive });
  res.json(db.prepare('SELECT * FROM machines WHERE id = ?').get(cur.id));
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
  str(body.ownerFollowUp, 'Owner follow-up', { max: 300 });
  return null;
}

function upsertLocalizations(templateId, locs) {
  const stmt = db.prepare(
    `INSERT INTO alert_template_localizations (alertTemplateId, languageCode, title, whatYouSee, whatToDo, whomToCall)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (alertTemplateId, languageCode) DO UPDATE SET
       title = excluded.title, whatYouSee = excluded.whatYouSee, whatToDo = excluded.whatToDo, whomToCall = excluded.whomToCall`,
  );
  for (const l of locs) {
    if (!LANGS.includes(l.languageCode)) throw new ValidationError(`Unsupported language ${l.languageCode}`);
    const title = str(l.title, 'Title', { max: 120 });
    if (!title) continue; // empty tab in the editor = no translation yet; English fallback applies
    stmt.run(templateId, l.languageCode, title, str(l.whatYouSee, 'What you see', { max: 600 }) || '', str(l.whatToDo, 'What to do', { max: 600 }) || '', str(l.whomToCall, 'Whom to call', { max: 200 }) || '');
  }
}
const locList = (obj) => (obj ? Object.entries(obj).map(([languageCode, l]) => ({ ...l, languageCode })) : []);

api.post('/alert-templates', roleMiddleware(...MANAGERS), (req, res) => {
  const b = req.body || {};
  const key = String(b.eventTypeKey || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64);
  if (key.length < 2) return bad(res, 'eventTypeKey is required');
  const err = validateTemplate(b);
  if (err) return bad(res, err);
  if (!b.localizations?.en?.title?.trim()) return bad(res, 'English text is required – it is the fallback for every language');
  try {
    const id = tx(() => {
      const r = db.prepare('INSERT INTO alert_templates (eventTypeKey, defaultSeverity, iconName, ownerFollowUp, createdByUserId) VALUES (?,?,?,?,?)')
        .run(key, b.defaultSeverity || 'AMBER', b.iconName || 'alert', b.ownerFollowUp?.trim() || null, req.user.id);
      const newId = Number(r.lastInsertRowid);
      upsertLocalizations(newId, locList(b.localizations));
      return newId;
    });
    audit(req, 'TEMPLATE_CREATED', key);
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
      .run(b.defaultSeverity || t.defaultSeverity, b.iconName || t.iconName, b.ownerFollowUp !== undefined ? b.ownerFollowUp?.trim() || null : t.ownerFollowUp, nowIso(), t.id);
    if (b.localizations) upsertLocalizations(t.id, locList(b.localizations));
  });
  broadcast('templates', { id: t.id });
  audit(req, 'TEMPLATE_UPDATED', t.eventTypeKey, { languages: b.localizations ? Object.keys(b.localizations) : [] });
  res.json(templateWithLocs(db.prepare('SELECT * FROM alert_templates WHERE id = ?').get(t.id)));
});

api.get('/alert-templates/:id/localizations', (req, res) => {
  res.json(Object.values(localizationsFor(Number(req.params.id))));
});
api.post('/alert-templates/:id/localizations', roleMiddleware(...MANAGERS), (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM alert_templates WHERE id = ?').get(id);
  if (!t) return bad(res, 'Template not found', 404);
  upsertLocalizations(id, Array.isArray(req.body) ? req.body : [req.body]);
  broadcast('templates', { id });
  audit(req, 'TEMPLATE_UPDATED', t.eventTypeKey);
  res.status(201).json(Object.values(localizationsFor(id)));
});

// Audio for one language version: raw audio body (audio/webm, audio/mpeg, ...).
const AUDIO_EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' };
const removeUpload = (url) => url?.startsWith('/uploads/') && fs.rm(path.join(config.uploadsDir, path.basename(url)), { force: true }, () => {});

api.post(
  '/alert-templates/:id/localizations/:lang/audio',
  roleMiddleware(...MANAGERS),
  express.raw({ type: 'audio/*', limit: '8mb' }),
  (req, res) => {
    const id = Number(req.params.id);
    const { lang } = req.params;
    if (!LANGS.includes(lang)) return bad(res, 'Unsupported language');
    const loc = db.prepare('SELECT * FROM alert_template_localizations WHERE alertTemplateId = ? AND languageCode = ?').get(id, lang);
    if (!loc) return bad(res, 'Save the text for this language first', 404);
    const mime = (req.get('content-type') || '').split(';')[0];
    const ext = AUDIO_EXT[mime];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 'Send an audio file (mp3, wav, webm, ogg, m4a)');
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    const file = `tpl${id}-${lang}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(config.uploadsDir, file), req.body);
    removeUpload(loc.audioUrl);
    db.prepare('UPDATE alert_template_localizations SET audioUrl = ? WHERE id = ?').run(`/uploads/${file}`, loc.id);
    broadcast('templates', { id });
    audit(req, 'TEMPLATE_AUDIO_UPLOADED', `${id}/${lang}`, { bytes: req.body.length });
    res.status(201).json({ audioUrl: `/uploads/${file}` });
  },
);
api.delete('/alert-templates/:id/localizations/:lang/audio', roleMiddleware(...MANAGERS), (req, res) => {
  const loc = db.prepare('SELECT * FROM alert_template_localizations WHERE alertTemplateId = ? AND languageCode = ?')
    .get(Number(req.params.id), req.params.lang);
  if (!loc) return bad(res, 'Not found', 404);
  removeUpload(loc.audioUrl);
  db.prepare('UPDATE alert_template_localizations SET audioUrl = NULL WHERE id = ?').run(loc.id);
  audit(req, 'TEMPLATE_AUDIO_REMOVED', `${req.params.id}/${req.params.lang}`);
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
    since: isoParam(q.since, 'since'), until: isoParam(q.until, 'until'), activeOnly: q.activeOnly === 'true', limit: q.limit,
  };
  // Shopfloor roles see only the last 24h – enough for a shift, no history digging.
  if (isFloorRole(req.user)) {
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    if (!filters.since || filters.since < dayAgo) filters.since = dayAgo;
  }
  res.json(listAlerts(filters).map((a) => forRole(a, req.user)));
});

api.get('/alerts/export.csv', roleMiddleware(...MANAGERS), (req, res) => {
  const rows = listAlerts({ since: isoParam(req.query.since, 'since'), until: isoParam(req.query.until, 'until'), limit: 1000 });
  // Prefix cells that a spreadsheet would treat as formulas (CSV injection).
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [['id', 'timestamp', 'severity', 'status', 'isDrill', 'machine', 'machineIdentifier', 'eventType', 'firstActionAt', 'stepsDone', 'rawPayload'].join(',')];
  for (const a of rows) {
    lines.push([a.id, a.timestamp, a.severity, a.status, a.isDrill, a.machineName, a.machineIdentifier, a.eventTypeKey, a.firstActionAt, a.stepsDone.join('|'), JSON.stringify(a.rawPayload)].map(esc).join(','));
  }
  audit(req, 'ALERTS_EXPORTED', null, { rows: rows.length });
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
  if ((actionType === 'RESOLVE' || actionType === 'NOTE') && req.user.role === 'OPERATOR') return bad(res, 'Not allowed', 403);
  const a = recordAction(Number(req.params.id), req.user, {
    actionType, stepNumber: stepNumber ? Number(stepNumber) : null, notes: str(notes, 'Note', { max: 1000 }),
  });
  if (actionType === 'RESOLVE') audit(req, 'ALERT_RESOLVED', a.id);
  res.status(201).json(forRole(a, req.user));
});

// ---------- Simulate (demo button in the dashboard) ----------
api.post('/simulate', roleMiddleware(...MANAGERS), async (req, res) => {
  const { eventTypeKey, machineId, details = {} } = req.body || {};
  const m = db.prepare('SELECT * FROM machines WHERE id = ?').get(Number(machineId));
  if (!m) return bad(res, 'Pick a machine');
  const alert = await ingestEvent({
    eventTypeKey, machineIdentifier: m.identifier, timestamp: nowIso(),
    details: { ...(typeof details === 'object' && details ? details : {}), source: 'dashboard-simulator' },
  });
  audit(req, 'EVENT_SIMULATED', alert.id, { eventTypeKey: alert.eventTypeKey, machine: m.identifier });
  res.status(201).json(alert);
});

// ---------- Drills ----------
api.post('/drill/start', roleMiddleware(...DRILL_RUNNERS), async (req, res) => {
  const { machineId, alertTemplateId } = req.body || {};
  const team = str(req.body?.team, 'Team', { max: 120 });
  const m = db.prepare('SELECT * FROM machines WHERE id = ?').get(Number(machineId));
  const t = db.prepare('SELECT * FROM alert_templates WHERE id = ?').get(Number(alertTemplateId));
  if (!m || !t) return bad(res, 'Pick a machine and an alert type');
  const alert = await ingestEvent(
    { eventTypeKey: t.eventTypeKey, machineIdentifier: m.identifier, timestamp: nowIso(), details: { source: 'drill', severityOverride: t.defaultSeverity } },
    { isDrill: true, drillTeam: team, startedBy: req.user.id },
  );
  audit(req, 'DRILL_STARTED', alert.id, { eventTypeKey: t.eventTypeKey, machine: m.identifier, team });
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
     WHERE e.timestamp >= ? AND e.severity != 'GREEN' AND e.isDrill = 0 GROUP BY e.id`,
  ).all(since).map((r) => r.secs).sort((a, b) => a - b);
  const median = responseTimes.length ? Math.round(responseTimes[Math.floor(responseTimes.length / 2)]) : null;
  const open = db.prepare("SELECT COUNT(*) AS n FROM alert_events WHERE status != 'RESOLVED' AND severity != 'GREEN' AND isDrill = 0").get().n;
  const redSentToday = db.prepare("SELECT COUNT(*) AS n FROM notification_logs WHERE type = 'RED_ALERT' AND status = 'SENT' AND timestamp >= ?").get(since).n;
  res.json({ counts, topMachines, medianResponseSeconds: median, openNeedingAction: open, redMessagesLast24h: redSentToday });
});

// ---------- Gateways ----------
api.get('/gateway/status', (_req, res) => res.json({ offlineAfterMinutes: config.gatewayOfflineMinutes, gateways: gatewayStatus() }));

// ---------- Owner summaries & notifications ----------
api.get('/owner/daily-summary', roleMiddleware(...MANAGERS), (_req, res) => res.json(buildDailySummary()));
api.post('/owner/daily-summary/send', roleMiddleware(...MANAGERS), async (req, res) => {
  audit(req, 'SUMMARY_SENT_MANUALLY');
  res.json(await sendDailySummary());
});
api.get('/owner/red-alert-preview/:id', roleMiddleware(...MANAGERS), (req, res) => {
  const a = getAlert(Number(req.params.id), { withActions: true });
  return a ? res.json({ message: redAlertMessage(a) }) : bad(res, 'Alert not found', 404);
});

api.get('/notifications', roleMiddleware(...MANAGERS), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db.prepare(
    `SELECT n.id, n.alertEventId, n.userId, n.type, n.channel, n.provider, n.status, n.message, n.error, n.attempts, n.nextAttemptAt,
            n.deliveryStatus, n.deliveryUpdatedAt, n.escalationLevel, n.gatewayId, n.timestamp, u.name AS userName, u.phoneNumber
     FROM notification_logs n LEFT JOIN users u ON u.id = n.userId ORDER BY n.id DESC LIMIT ?`,
  ).all(limit);
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const s = db.prepare(
    `SELECT COUNT(*) AS sent, SUM(deliveryStatus = 'read') AS read, SUM(deliveryStatus IN ('delivered','read')) AS delivered
     FROM notification_logs WHERE type = 'DAILY_SUMMARY' AND status = 'SENT' AND timestamp >= ?`,
  ).get(since);
  res.json({ items: rows, summaryStats: { sent: s.sent, delivered: s.delivered || 0, read: s.read || 0 } });
});

api.get('/notifications/config', roleMiddleware(...MANAGERS), (_req, res) => res.json(notificationConfigStatus()));

api.post('/notifications/test', roleMiddleware(...MANAGERS), rateLimit({ name: 'notify-test', limit: 5, windowMs: 60000, key: (req) => req.user.id }), async (req, res) => {
  const target = req.body?.userId ? loadUser(req.body.userId) : loadUser(req.user.id);
  if (!target) return bad(res, 'User not found', 404);
  if (!target.phoneNumber) return bad(res, `${target.name} has no phone number`);
  const ids = enqueue({ users: [target], type: 'TEST', body: `✅ Test message from Shopfloor Sentinel to ${target.name}. Owner alerts are working.` });
  await processQueue();
  audit(req, 'NOTIFICATION_TEST', target.username);
  res.json({ results: deliveryResults(ids) });
});

api.post('/notifications/:id/retry', roleMiddleware(...MANAGERS), async (req, res) => {
  const n = db.prepare('SELECT * FROM notification_logs WHERE id = ?').get(Number(req.params.id));
  if (!n) return bad(res, 'Not found', 404);
  if (n.status !== 'FAILED') return bad(res, 'Only failed messages can be retried');
  db.prepare("UPDATE notification_logs SET status = 'PENDING', attempts = 0, nextAttemptAt = ?, error = NULL, deliveryStatus = 'queued' WHERE id = ?").run(nowIso(), n.id);
  await processQueue();
  audit(req, 'NOTIFICATION_RETRIED', n.id);
  res.json(deliveryResults([n.id])[0]);
});

// ---------- Audit log ----------
api.get('/audit', roleMiddleware(...MANAGERS), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const action = req.query.action ? String(req.query.action) : null;
  const rows = action
    ? db.prepare('SELECT * FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT ?').all(action, limit)
    : db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })));
});

// ---------- AI layer: triage + knowledge base ----------
const TRIAGE_READERS = ['OWNER', 'ENGINEER', 'SUPERVISOR'];

api.get('/ai/status', roleMiddleware(...MANAGERS), async (_req, res) => {
  res.json({ ai: aiStatus(), kb: await knowledgeStatus() });
});

api.get('/alerts/:id/triage', roleMiddleware(...TRIAGE_READERS), (req, res) => {
  res.json({ ai: aiStatus(), triage: latestTriage(req.params.id) });
});

api.post('/alerts/:id/triage', roleMiddleware(...MANAGERS), rateLimit({ name: 'triage', limit: 20, windowMs: 3600000, key: (req) => req.user.id }), (req, res) => {
  const trigger = req.get('x-sentinel-client') === 'mcp' ? 'MCP' : 'MANUAL';
  const t = requestTriage(req.params.id, { trigger, userId: req.user.id });
  audit(req, 'AI_TRIAGE_REQUESTED', req.params.id, { trigger });
  res.status(202).json(t);
});

api.get('/kb/search', roleMiddleware(...MANAGERS), async (req, res) => {
  const q = str(req.query.q, 'q', { required: true, max: 500 });
  const kind = ['PLAYBOOK', 'ADVISORY', 'GUIDE'].includes(req.query.kind) ? req.query.kind : undefined;
  res.json(await searchKnowledge(q, { k: Math.min(Number(req.query.k) || 5, 20), kind }));
});

api.get('/kb/documents', roleMiddleware(...MANAGERS), (_req, res) => res.json(listDocuments()));

api.get('/kb/chunks/:id', roleMiddleware(...TRIAGE_READERS), (req, res) => {
  const c = getChunk(req.params.id);
  return c ? res.json({ ...c, embedding: undefined }) : bad(res, 'Not found', 404);
});

api.post('/kb/reindex', roleMiddleware(...MANAGERS), async (req, res) => {
  const r = await syncKnowledgeBase();
  audit(req, 'KB_REINDEXED', null, { added: r.added, updated: r.updated, removed: r.removed, failed: r.failed.length });
  res.json({ ...r, status: await knowledgeStatus() });
});
