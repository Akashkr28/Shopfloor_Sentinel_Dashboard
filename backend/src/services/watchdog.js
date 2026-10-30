import { config } from '../config.js';
import { db, nowIso } from '../db.js';
import { getAlert } from './alerts.js';
import { broadcast } from './live.js';
import { enqueue, escalationMessage, processQueue, recipients } from './notify.js';
import { fmtTime } from './summary.js';

/*
 * Periodic checks (every 30 s from server.js):
 *  1. red alert nobody acknowledged in ESCALATE_UNACK_MINUTES → owners + engineers
 *  2. red alert still unresolved after ESCALATE_UNRESOLVED_MINUTES → owners
 *  3. gateway silent for GATEWAY_OFFLINE_MINUTES → owners + engineers
 * Each escalation fires once per alert and level. Drills never escalate.
 */

const ago = (now, minutes) => new Date(now - minutes * 60000).toISOString();

function escalate(now, { level, minutes, statusClause, roles }) {
  const rows = db
    .prepare(
      `SELECT e.id FROM alert_events e
       WHERE e.severity = 'RED' AND e.isDrill = 0 AND ${statusClause}
         AND e.timestamp <= ? AND e.timestamp >= ?
         AND NOT EXISTS (SELECT 1 FROM notification_logs n WHERE n.alertEventId = e.id AND n.type = 'ESCALATION' AND n.escalationLevel = ?)`,
    )
    .all(ago(now, minutes), ago(now, 24 * 60), level);
  for (const { id } of rows) {
    const alert = getAlert(id);
    const users = recipients(roles);
    // Record the escalation even with no recipients so it doesn't re-fire every 30 s.
    if (users.length) enqueue({ users, type: 'ESCALATION', body: escalationMessage(alert, level, minutes), params: escalationParams(alert, minutes), alertEventId: id, escalationLevel: level });
    else db.prepare(`INSERT INTO notification_logs (alertEventId, type, channel, provider, status, message, error, escalationLevel) VALUES (?, 'ESCALATION', ?, ?, 'FAILED', ?, 'No recipients with a phone number', ?)`)
      .run(id, config.notifyChannel, config.notifyProvider, escalationMessage(alert, level, minutes), level);
    broadcast('alert-updated', { id, escalated: level });
  }
  return rows.length;
}

function escalationParams(alert, minutes) {
  const en = alert.localizations.en || {};
  return [en.title || alert.eventTypeKey, alert.machineName, fmtTime(alert.timestamp), `${minutes} min`, `${alert.stepsDone.length}/3 steps done`];
}

export function gatewayStatus(now = Date.now()) {
  const cutoff = ago(now, config.gatewayOfflineMinutes);
  return db.prepare('SELECT * FROM gateways ORDER BY id').all().map((g) => ({
    ...g,
    monitors: g.monitors ? JSON.parse(g.monitors) : [],
    stats: g.stats ? JSON.parse(g.stats) : null,
    online: g.lastSeenAt > cutoff,
  }));
}

/** Called on every heartbeat or event batch from a gateway. */
export function recordGatewaySeen(id, { hostname, version, monitors, stats, ip } = {}) {
  const prev = db.prepare('SELECT * FROM gateways WHERE id = ?').get(id);
  const now = nowIso();
  if (!prev) {
    db.prepare('INSERT INTO gateways (id, hostname, version, monitors, stats, ip, lastSeenAt) VALUES (?,?,?,?,?,?,?)')
      .run(id, hostname ?? null, version ?? null, monitors ? JSON.stringify(monitors) : null, stats ? JSON.stringify(stats) : null, ip ?? null, now);
    broadcast('gateway', { id, online: true });
    return;
  }
  db.prepare(
    `UPDATE gateways SET lastSeenAt = ?, hostname = COALESCE(?, hostname), version = COALESCE(?, version),
       monitors = COALESCE(?, monitors), stats = COALESCE(?, stats), ip = COALESCE(?, ip), offlineNotifiedAt = NULL WHERE id = ?`,
  ).run(now, hostname ?? null, version ?? null, monitors ? JSON.stringify(monitors) : null, stats ? JSON.stringify(stats) : null, ip ?? null, id);
  if (prev.offlineNotifiedAt) {
    const users = recipients(['OWNER', 'ENGINEER']);
    enqueue({ users, type: 'GATEWAY_OFFLINE', body: `📡 Sentinel gateway "${id}" is back online. Monitoring has resumed.`, params: [id, 'back online', fmtTime(now)], gatewayId: id });
  }
  const wasOffline = prev.lastSeenAt <= ago(Date.now(), config.gatewayOfflineMinutes);
  if (wasOffline || prev.offlineNotifiedAt) broadcast('gateway', { id, online: true });
}

function checkGateways(now) {
  const stale = db
    .prepare('SELECT * FROM gateways WHERE lastSeenAt <= ? AND (offlineNotifiedAt IS NULL OR offlineNotifiedAt < lastSeenAt)')
    .all(ago(now, config.gatewayOfflineMinutes));
  for (const g of stale) {
    const mins = Math.round((now - new Date(g.lastSeenAt).getTime()) / 60000);
    const body = `📡 Sentinel gateway "${g.id}" has not reported since ${fmtTime(g.lastSeenAt)} (${mins} min).\nSecurity monitoring is paused until it is back – check its power and network cable.`;
    enqueue({ users: recipients(['OWNER', 'ENGINEER']), type: 'GATEWAY_OFFLINE', body, params: [g.id, `offline since ${fmtTime(g.lastSeenAt)}`, `${mins} min`], gatewayId: g.id });
    db.prepare('UPDATE gateways SET offlineNotifiedAt = ? WHERE id = ?').run(new Date(now).toISOString(), g.id);
    broadcast('gateway', { id: g.id, online: false });
  }
  return stale.length;
}

export async function runWatchdog(now = Date.now()) {
  const result = {
    unacknowledged: escalate(now, { level: 1, minutes: config.escalateUnackMinutes, statusClause: "e.status = 'OPEN'", roles: ['OWNER', 'ENGINEER'] }),
    unresolved: escalate(now, { level: 2, minutes: config.escalateUnresolvedMinutes, statusClause: "e.status != 'RESOLVED'", roles: ['OWNER'] }),
    gatewaysOffline: checkGateways(now),
  };
  await processQueue();
  return result;
}
