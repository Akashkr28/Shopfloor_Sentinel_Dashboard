import { db, nowIso } from '../db.js';
import { broadcast } from './live.js';
import { notifyRedAlert, notifyResolved } from './notify.js';

export const SEVERITIES = ['GREEN', 'AMBER', 'RED'];
export const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];
export const LANGS = ['en', 'hi', 'mr', 'ta'];
const SEVERITY_RANK = { RED: 3, AMBER: 2, GREEN: 1 };

export function templateByKey(key) {
  return db.prepare('SELECT * FROM alert_templates WHERE eventTypeKey = ?').get(key);
}

export function localizationsFor(templateId) {
  const rows = db.prepare('SELECT * FROM alert_template_localizations WHERE alertTemplateId = ?').all(templateId);
  return Object.fromEntries(rows.map((r) => [r.languageCode, r]));
}

/**
 * Severity rules on top of the template default. Kept deliberately small and
 * readable so an engineer can reason about why something went red.
 */
export function decideSeverity(template, details = {}) {
  let sev = template.defaultSeverity;
  const bump = (to) => {
    if (SEVERITY_RANK[to] > SEVERITY_RANK[sev]) sev = to;
  };
  if (template.eventTypeKey === 'UNK_REMOTE_LOGIN') {
    if (details.loginSucceeded === true || Number(details.failedAttempts) >= 5) bump('RED');
    // From the network monitor: a burst of connection attempts, or a session coming from the internet.
    if (Number(details.connectionAttempts) >= 10 || details.externalSource === true) bump('RED');
  }
  if (template.eventTypeKey === 'ABNORMAL_TRAFFIC') {
    if (Number(details.mbOut) >= 100 || details.knownBadDestination === true || details.kind === 'port-scan') bump('RED');
  }
  if (details.severityOverride && SEVERITIES.includes(details.severityOverride)) sev = details.severityOverride;
  return sev;
}

/** Look up a machine by gateway identifier, auto-registering unknown ones so no event is lost. */
function resolveMachine(identifier) {
  const found = db.prepare('SELECT * FROM machines WHERE identifier = ?').get(identifier);
  if (found) return found;
  const r = db
    .prepare('INSERT INTO machines (name, location, identifier) VALUES (?,?,?)')
    .run(`Unmapped: ${identifier}`, 'Needs setup', identifier);
  const machine = db.prepare('SELECT * FROM machines WHERE id = ?').get(Number(r.lastInsertRowid));
  broadcast('machines', { changed: machine.id });
  return machine;
}

/** Turn a raw gateway / simulated / drill event into a stored alert and fan it out. */
export async function ingestEvent(payload, { isDrill = false, drillTeam = null, startedBy = null } = {}) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!payload || typeof payload !== 'object') throw bad('Event must be a JSON object');
  const eventTypeKey = String(payload.eventTypeKey || '').trim().toUpperCase();
  const machineIdentifier = String(payload.machineIdentifier || '').trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,64}$/.test(eventTypeKey)) throw bad('eventTypeKey must be 2–64 characters A–Z, 0–9, _');
  if (!/^[A-Z0-9_.:-]{2,64}$/.test(machineIdentifier)) throw bad('machineIdentifier must be 2–64 characters A–Z, 0–9, _ . : -');
  if (payload.details !== undefined && (typeof payload.details !== 'object' || Array.isArray(payload.details) || payload.details === null)) throw bad('details must be an object');
  if (JSON.stringify(payload).length > 16000) throw bad('Event payload too large');
  const template = templateByKey(eventTypeKey) || templateByKey('UNKNOWN_EVENT');
  const machine = resolveMachine(machineIdentifier);
  const severity = decideSeverity(template, payload.details);

  let ts = payload.timestamp ? new Date(payload.timestamp) : new Date();
  // Bad or far-future gateway clocks would break ordering and escalation – use arrival time instead.
  if (Number.isNaN(ts.getTime()) || ts.getTime() > Date.now() + 5 * 60000) ts = new Date();

  const r = db
    .prepare(
      `INSERT INTO alert_events (machineId, alertTemplateId, severity, timestamp, isDrill, rawPayload, drillTeam, drillStartedByUserId)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(machine.id, template.id, severity, ts.toISOString(), isDrill ? 1 : 0, JSON.stringify({ ...payload, eventTypeKey, machineIdentifier }), drillTeam, startedBy);
  const alert = getAlert(Number(r.lastInsertRowid));
  broadcast('alert', { id: alert.id, severity: alert.severity, isDrill: alert.isDrill });

  // Drills never reach the owner's phone.
  if (severity === 'RED' && !isDrill) {
    notifyRedAlert(alert).catch((e) => console.error('[notify] red alert failed', e));
  }
  return alert;
}

const ALERT_SELECT = `
  SELECT e.*, m.name AS machineName, m.location AS machineLocation, m.identifier AS machineIdentifier,
         t.eventTypeKey, t.iconName, t.ownerFollowUp
  FROM alert_events e
  JOIN machines m ON m.id = e.machineId
  JOIN alert_templates t ON t.id = e.alertTemplateId`;

function hydrate(row, { withActions = false } = {}) {
  if (!row) return null;
  const actions = db
    .prepare(
      `SELECT a.*, u.name AS userName FROM alert_actions a JOIN users u ON u.id = a.userId
       WHERE a.alertEventId = ? ORDER BY a.timestamp`,
    )
    .all(row.id);
  const stepsDone = [...new Set(actions.filter((a) => a.actionType === 'STEP_COMPLETED').map((a) => a.stepNumber))].sort();
  return {
    ...row,
    isDrill: !!row.isDrill,
    rawPayload: row.rawPayload ? JSON.parse(row.rawPayload) : null,
    localizations: localizationsFor(row.alertTemplateId),
    stepsDone,
    firstActionAt: actions[0]?.timestamp || null,
    ...(withActions ? { actions } : {}),
  };
}

export function getAlert(id, opts) {
  return hydrate(db.prepare(`${ALERT_SELECT} WHERE e.id = ?`).get(id), opts);
}

export function listAlerts({ severity, machineId, status, isDrill, since, until, activeOnly, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (severity) { where.push('e.severity = ?'); args.push(severity); }
  if (machineId) { where.push('e.machineId = ?'); args.push(Number(machineId)); }
  if (status) { where.push('e.status = ?'); args.push(status); }
  if (isDrill === true || isDrill === false) { where.push('e.isDrill = ?'); args.push(isDrill ? 1 : 0); }
  if (since) { where.push('e.timestamp >= ?'); args.push(since); }
  if (until) { where.push('e.timestamp <= ?'); args.push(until); }
  if (activeOnly) where.push("e.status != 'RESOLVED'");
  const sql = `${ALERT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE e.severity WHEN 'RED' THEN 3 WHEN 'AMBER' THEN 2 ELSE 1 END DESC, e.timestamp DESC
    LIMIT ?`;
  return db.prepare(sql).all(...args, Math.min(Number(limit) || 200, 1000)).map((r) => hydrate(r));
}

/** Record operator action; status moves OPEN → ACKNOWLEDGED → RESOLVED (all 3 steps). */
export function recordAction(alertId, user, { actionType, stepNumber, notes }) {
  const alert = db.prepare('SELECT * FROM alert_events WHERE id = ?').get(alertId);
  if (!alert) {
    const err = new Error('Alert not found');
    err.status = 404;
    throw err;
  }
  db.prepare('INSERT INTO alert_actions (alertEventId, userId, actionType, stepNumber, notes, timestamp) VALUES (?,?,?,?,?,?)')
    .run(alertId, user.id, actionType, stepNumber ?? null, notes ?? null, nowIso());

  let status = alert.status;
  if (actionType === 'RESOLVE') status = 'RESOLVED';
  else if (actionType === 'ACKNOWLEDGE' || actionType === 'STEP_COMPLETED') {
    const done = db
      .prepare("SELECT COUNT(DISTINCT stepNumber) AS n FROM alert_actions WHERE alertEventId = ? AND actionType = 'STEP_COMPLETED'")
      .get(alertId).n;
    status = done >= 3 ? 'RESOLVED' : status === 'OPEN' ? 'ACKNOWLEDGED' : status;
  }
  if (status !== alert.status) db.prepare('UPDATE alert_events SET status = ? WHERE id = ?').run(status, alertId);
  const updated = getAlert(alertId, { withActions: true });
  if (status === 'RESOLVED' && alert.status !== 'RESOLVED') notifyResolved(updated, user);
  broadcast('alert-updated', { id: alertId, status });
  return updated;
}
