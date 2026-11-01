import { config } from '../config.js';
import { db } from '../db.js';
import { getAlert } from '../services/alerts.js';
import { gatewayStatus } from '../services/watchdog.js';

/*
 * Read-only investigation helpers for the triage agent. They return compact,
 * JSON-friendly objects – only what helps reasoning, never secrets.
 */

const IP_KEYS = ['sourceIp', 'srcIp', 'targetIp', 'destinationIp', 'plcIp'];

const localFmt = new Intl.DateTimeFormat('en-IN', { timeZone: config.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
/** Factory wall-clock time – what people on the floor and the owner see. */
export const localTime = (iso) => localFmt.format(new Date(iso));

function brief(a) {
  const en = a.localizations.en || {};
  return {
    id: a.id,
    time: a.timestamp,
    localTime: localTime(a.timestamp),
    severity: a.severity,
    status: a.status,
    isDrill: a.isDrill,
    eventType: a.eventTypeKey,
    title: en.title,
    machine: { name: a.machineName, location: a.machineLocation, identifier: a.machineIdentifier },
    details: a.rawPayload?.details || {},
    stepsDone: a.stepsDone,
  };
}

export function alertForTriage(id) {
  const a = getAlert(Number(id), { withActions: true });
  if (!a) return null;
  const en = a.localizations.en || {};
  return {
    ...brief(a),
    operatorScript: { whatYouSee: en.whatYouSee, whatToDo: en.whatToDo, whomToCall: en.whomToCall },
    ownerFollowUpTemplate: a.ownerFollowUp,
    actions: (a.actions || []).map((x) => ({ time: x.timestamp, localTime: localTime(x.timestamp), by: x.userName, type: x.actionType, step: x.stepNumber, note: x.notes })),
  };
}

const ROW = `SELECT e.id, e.timestamp, e.severity, e.status, e.isDrill, e.rawPayload, m.name AS machine, m.identifier, t.eventTypeKey
  FROM alert_events e JOIN machines m ON m.id = e.machineId JOIN alert_templates t ON t.id = e.alertTemplateId`;

function compact(r, relation) {
  const details = r.rawPayload ? JSON.parse(r.rawPayload).details || {} : {};
  return { id: r.id, time: r.timestamp, localTime: localTime(r.timestamp), severity: r.severity, status: r.status, eventType: r.eventTypeKey, machine: r.machine, relation, details };
}

/**
 * Events around the alert: same machine, same IP address anywhere on the
 * network, and the same event type on other machines. Drills are excluded.
 */
export function relatedEvents(alertId, hours = 24) {
  const a = getAlert(Number(alertId));
  if (!a) return null;
  const h = Math.min(Math.max(Number(hours) || 24, 1), 168);
  const t = new Date(a.timestamp).getTime();
  const from = new Date(t - h * 3600000).toISOString();
  const to = new Date(t + h * 3600000).toISOString();
  const seen = new Map();
  const add = (rows, relation) => {
    for (const r of rows) if (r.id !== a.id && !seen.has(r.id)) seen.set(r.id, compact(r, relation));
  };

  add(db.prepare(`${ROW} WHERE e.machineId = ? AND e.isDrill = 0 AND e.timestamp BETWEEN ? AND ? ORDER BY e.timestamp`).all(a.machineId, from, to), 'same machine');

  const ips = new Set(IP_KEYS.map((k) => a.rawPayload?.details?.[k]).filter((v) => typeof v === 'string' && v.length < 64));
  if (ips.size) {
    const rows = db.prepare(`${ROW} WHERE e.isDrill = 0 AND e.timestamp BETWEEN ? AND ? ORDER BY e.timestamp`).all(from, to);
    add(rows.filter((r) => {
      const d = r.rawPayload ? JSON.parse(r.rawPayload).details || {} : {};
      return IP_KEYS.some((k) => ips.has(d[k]));
    }), 'same IP address');
  }

  const near = 2 * 3600000;
  add(db.prepare(`${ROW} WHERE e.alertTemplateId = ? AND e.machineId != ? AND e.isDrill = 0 AND e.timestamp BETWEEN ? AND ?`)
    .all(a.alertTemplateId, a.machineId, new Date(t - near).toISOString(), new Date(t + near).toISOString()), 'same event type, other machine');

  const list = [...seen.values()].sort((x, y) => x.time.localeCompare(y.time));
  return { windowHours: h, count: list.length, events: list.slice(-40), truncated: list.length > 40 };
}

/** Baseline for one machine: how noisy is it normally, what is open, recent drills. */
export function machineHistory(identifier, days = 7) {
  const m = db.prepare('SELECT * FROM machines WHERE identifier = ? OR name = ?').get(String(identifier).toUpperCase(), String(identifier));
  if (!m) return null;
  const d = Math.min(Math.max(Number(days) || 7, 1), 90);
  const since = new Date(Date.now() - d * 86400000).toISOString();
  const byType = db.prepare(
    `SELECT t.eventTypeKey AS eventType, e.severity, COUNT(*) AS n FROM alert_events e JOIN alert_templates t ON t.id = e.alertTemplateId
     WHERE e.machineId = ? AND e.isDrill = 0 AND e.timestamp >= ? GROUP BY t.eventTypeKey, e.severity ORDER BY n DESC`,
  ).all(m.id, since);
  const open = db.prepare(`${ROW} WHERE e.machineId = ? AND e.isDrill = 0 AND e.status != 'RESOLVED' AND e.severity != 'GREEN' ORDER BY e.timestamp DESC LIMIT 10`).all(m.id);
  const drills = db.prepare(
    `SELECT e.id, e.timestamp, t.eventTypeKey AS eventType, (SELECT COUNT(DISTINCT stepNumber) FROM alert_actions a WHERE a.alertEventId = e.id AND a.actionType = 'STEP_COMPLETED') AS stepsDone
     FROM alert_events e JOIN alert_templates t ON t.id = e.alertTemplateId WHERE e.machineId = ? AND e.isDrill = 1 ORDER BY e.timestamp DESC LIMIT 5`,
  ).all(m.id);
  return {
    machine: { name: m.name, location: m.location, identifier: m.identifier, active: !!m.isActive },
    days: d,
    countsByType: byType,
    openAlerts: open.map((r) => compact(r, 'open')),
    recentDrills: drills,
  };
}

export function gatewayHealth() {
  return gatewayStatus().map((g) => ({ id: g.id, online: g.online, lastSeenAt: g.lastSeenAt, monitors: g.monitors }));
}
