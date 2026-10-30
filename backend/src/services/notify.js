import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, nowIso } from '../db.js';
import { broadcast } from './live.js';
import { buildDailySummary, fmtTime } from './summary.js';

/*
 * Owner / engineer messaging.
 *
 * Every message is first written to notification_logs as PENDING, then a
 * worker delivers it. Failures are retried with backoff (30s, 2m, 10m) up to
 * NOTIFY_MAX_ATTEMPTS; with Twilio a WhatsApp message that still fails is
 * re-sent once as SMS. Providers report delivered / read / failed back
 * through webhooks (routes/webhooks.js) into deliveryStatus.
 *
 * Providers:
 *  - mock: prints to the console (default; no account needed)
 *  - twilio: WhatsApp (content templates or free text) and SMS
 *  - whatsapp_cloud: Meta WhatsApp Cloud API (approved templates or free text)
 */

const BACKOFF_SECONDS = [30, 120, 600, 1800];
const ACTIVE_STATUSES = "('PENDING','SENT')";

class PermanentError extends Error {}

/** WhatsApp template parameters may not contain newlines, tabs or 4+ spaces. */
const param = (v) => String(v ?? '–').replace(/[\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').slice(0, 900) || '–';

async function providerError(res, label) {
  const text = await res.text();
  const err = res.status >= 400 && res.status < 500 && res.status !== 429 ? new PermanentError() : new Error();
  err.message = `${label} ${res.status}: ${text.slice(0, 300)}`;
  return err;
}

async function deliverTwilio({ to, body, channel, type, params }) {
  const { accountSid, authToken, from, smsFrom, contentSids } = config.twilio;
  if (!accountSid || !authToken || !from) throw new PermanentError('Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM)');
  const wa = channel === 'WHATSAPP';
  const form = new URLSearchParams({ From: wa ? `whatsapp:${from}` : smsFrom, To: wa ? `whatsapp:${to}` : to });
  const contentSid = wa && params && contentSids[type];
  if (contentSid) {
    form.set('ContentSid', contentSid);
    form.set('ContentVariables', JSON.stringify(Object.fromEntries(params.map((p, i) => [String(i + 1), param(p)]))));
  } else {
    form.set('Body', body);
  }
  if (config.publicUrl) form.set('StatusCallback', `${config.publicUrl}/api/webhooks/twilio`);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw await providerError(res, 'Twilio');
  const json = await res.json();
  return { providerMessageId: json.sid, deliveryStatus: json.status || 'queued' };
}

async function deliverWhatsAppCloud({ to, body, channel, type, params }) {
  const { token, phoneNumberId, apiVersion, templates, templateLang } = config.whatsappCloud;
  if (channel === 'SMS') throw new PermanentError('WhatsApp Cloud API cannot send SMS – use NOTIFY_PROVIDER=twilio for SMS');
  if (!token || !phoneNumberId) throw new PermanentError('WhatsApp Cloud is not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)');
  const template = params && templates[type];
  const payload = template
    ? {
        messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'template',
        template: { name: template, language: { code: templateLang }, components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: param(p) })) }] },
      }
    : { messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'text', text: { body, preview_url: false } };
  const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw await providerError(res, 'WhatsApp Cloud');
  const json = await res.json();
  return { providerMessageId: json.messages?.[0]?.id || null, deliveryStatus: 'sent' };
}

async function deliver(msg) {
  if (config.notifyProvider === 'mock') {
    console.log(`\n[notify:mock → ${msg.channel} ${msg.to}] ${msg.type}\n${msg.body}\n`);
    return { providerMessageId: `mock-${crypto.randomUUID()}`, deliveryStatus: 'delivered' };
  }
  if (config.notifyProvider === 'twilio') return deliverTwilio(msg);
  if (config.notifyProvider === 'whatsapp_cloud') return deliverWhatsAppCloud(msg);
  throw new PermanentError(`Unknown NOTIFY_PROVIDER "${config.notifyProvider}"`);
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

/** Active users with a phone number in any of `roles`. */
export function recipients(roles) {
  if (!roles.length) return [];
  return db
    .prepare(`SELECT * FROM users WHERE isActive = 1 AND phoneNumber IS NOT NULL AND phoneNumber != '' AND role IN (${roles.map(() => '?').join(',')})`)
    .all(...roles);
}

/** Queue one message per user. Returns the new notification ids. */
export function enqueue({ users, type, body, params = null, alertEventId = null, escalationLevel = null, gatewayId = null, channel = config.notifyChannel }) {
  const stmt = db.prepare(
    `INSERT INTO notification_logs (alertEventId, userId, type, channel, provider, status, message, templateParams, attempts, nextAttemptAt, escalationLevel, gatewayId, deliveryStatus)
     VALUES (?,?,?,?,?, 'PENDING', ?,?, 0, ?,?,?, 'queued')`,
  );
  const now = nowIso();
  const ids = users.map((u) =>
    Number(stmt.run(alertEventId, u.id, type, channel, config.notifyProvider, body, params ? JSON.stringify(params) : null, now, escalationLevel, gatewayId).lastInsertRowid),
  );
  if (ids.length) {
    broadcast('notification', { type, status: 'PENDING' });
    setImmediate(() => processQueue().catch((e) => console.error('[notify] queue error', e)));
  }
  return ids;
}

let running = null;

/** Deliver everything that is due. Safe to call often; concurrent calls share one run. */
export function processQueue() {
  running ||= drain().finally(() => {
    running = null;
  });
  return running;
}

async function drain() {
  for (;;) {
    const due = db
      .prepare(
        `SELECT n.*, u.phoneNumber AS to_, u.isActive AS userActive FROM notification_logs n LEFT JOIN users u ON u.id = n.userId
         WHERE n.status = 'PENDING' AND n.nextAttemptAt <= ? ORDER BY n.id LIMIT 25`,
      )
      .all(nowIso());
    if (!due.length) return;
    for (const n of due) await attempt(n);
  }
}

async function attempt(n) {
  const attempts = n.attempts + 1;
  try {
    if (!n.to_ || !n.userActive) throw new PermanentError('Recipient has no phone number or is disabled');
    const r = await deliver({ to: n.to_, body: n.message, channel: n.channel, type: n.type, params: n.templateParams ? JSON.parse(n.templateParams) : null });
    db.prepare(
      `UPDATE notification_logs SET status = 'SENT', attempts = ?, providerMessageId = ?, deliveryStatus = ?, deliveryUpdatedAt = ?, error = NULL, nextAttemptAt = NULL WHERE id = ?`,
    ).run(attempts, r.providerMessageId, r.deliveryStatus, nowIso(), n.id);
  } catch (e) {
    const error = String(e.message || e).slice(0, 500);
    const giveUp = e instanceof PermanentError || attempts >= config.notifyMaxAttempts;
    if (giveUp) {
      db.prepare(`UPDATE notification_logs SET status = 'FAILED', attempts = ?, error = ?, deliveryStatus = 'failed', deliveryUpdatedAt = ?, nextAttemptAt = NULL WHERE id = ?`)
        .run(attempts, error, nowIso(), n.id);
      console.error(`[notify] #${n.id} ${n.type} failed permanently: ${error}`);
      fallbackToSms(n);
    } else {
      const next = new Date(Date.now() + BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)] * 1000).toISOString();
      db.prepare('UPDATE notification_logs SET attempts = ?, error = ?, nextAttemptAt = ? WHERE id = ?').run(attempts, error, next, n.id);
      console.warn(`[notify] #${n.id} ${n.type} attempt ${attempts} failed, retrying at ${next}: ${error}`);
    }
  }
  broadcast('notification', { id: n.id });
}

/** A WhatsApp message that could not be delivered is re-sent once as SMS (Twilio only). */
function fallbackToSms(n) {
  if (!config.smsFallback || config.notifyProvider !== 'twilio' || n.channel !== 'WHATSAPP' || !n.userId) return;
  db.prepare(
    `INSERT INTO notification_logs (alertEventId, userId, type, channel, provider, status, message, attempts, nextAttemptAt, escalationLevel, gatewayId, deliveryStatus)
     VALUES (?,?,?, 'SMS', ?, 'PENDING', ?, 0, ?,?,?, 'queued')`,
  ).run(n.alertEventId, n.userId, n.type, n.provider, n.message, nowIso(), n.escalationLevel, n.gatewayId);
}

const DELIVERY_RANK = { queued: 0, accepted: 0, sending: 1, sent: 2, delivered: 3, read: 4 };

/** Provider webhook → delivery status. Never moves backwards (read stays read). */
export function updateDelivery(providerMessageId, status, error = null) {
  const n = db.prepare('SELECT * FROM notification_logs WHERE providerMessageId = ?').get(providerMessageId);
  if (!n) return false;
  const s = String(status).toLowerCase();
  if (s === 'failed' || s === 'undelivered') {
    db.prepare(`UPDATE notification_logs SET status = 'FAILED', deliveryStatus = ?, error = COALESCE(?, error), deliveryUpdatedAt = ? WHERE id = ?`)
      .run(s, error, nowIso(), n.id);
    fallbackToSms(n);
    setImmediate(() => processQueue().catch(() => {}));
  } else if ((DELIVERY_RANK[s] ?? -1) > (DELIVERY_RANK[n.deliveryStatus] ?? -1)) {
    db.prepare('UPDATE notification_logs SET deliveryStatus = ?, deliveryUpdatedAt = ? WHERE id = ?').run(s, nowIso(), n.id);
  } else {
    return true;
  }
  broadcast('notification', { id: n.id, deliveryStatus: s });
  return true;
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

const enLoc = (alert) => alert.localizations.en || Object.values(alert.localizations)[0] || {};
const machineLabel = (a) => `${a.machineName}${a.machineLocation ? ` (${a.machineLocation})` : ''}`;

export function redAlertMessage(alert) {
  const en = enLoc(alert);
  const acted = alert.firstActionAt ? 'Yes' : alert.status === 'OPEN' ? 'Unknown (just happened)' : 'Yes';
  return [
    `🔴 RED ALERT – Shopfloor Sentinel`,
    `${en.title || alert.eventTypeKey} on ${machineLabel(alert)} at ${fmtTime(alert.timestamp)}.`,
    `Operator advised: ${en.whatToDo || 'follow the on-screen steps'}`,
    `Operator action taken: ${acted}. Status: ${alert.status.toLowerCase()}.`,
    alert.ownerFollowUp ? `Your follow-up: ${alert.ownerFollowUp}` : null,
  ].filter(Boolean).join('\n');
}

const redAlertParams = (alert) => {
  const en = enLoc(alert);
  return [en.title || alert.eventTypeKey, machineLabel(alert), fmtTime(alert.timestamp), en.whatToDo, alert.ownerFollowUp || 'Check with your engineer'];
};

export function escalationMessage(alert, level, minutes) {
  const en = enLoc(alert);
  const what = `${en.title || alert.eventTypeKey} on ${machineLabel(alert)} (since ${fmtTime(alert.timestamp)})`;
  return level === 1
    ? `⏰ ESCALATION – red alert not acknowledged for ${minutes} min\n${what}.\nNobody on the shopfloor has responded yet. Please call the shift supervisor now.`
    : `⚠️ ESCALATION – red alert still not resolved after ${minutes} min\n${what}.\nSteps done: ${alert.stepsDone.length}/3. ${alert.ownerFollowUp || ''}`.trim();
}

/**
 * Red alert → owners, unless the same alert type on the same machine already
 * messaged them inside RED_DEDUP_MINUTES (alert-fatigue control).
 */
const inFlight = new Set();
export async function notifyRedAlert(alert) {
  const key = `${alert.alertTemplateId}:${alert.machineId}`;
  if (inFlight.has(key)) return { suppressed: true };
  inFlight.add(key);
  try {
    const windowStart = new Date(new Date(alert.timestamp).getTime() - config.redDedupMinutes * 60000).toISOString();
    const recent = db
      .prepare(
        `SELECT COUNT(*) AS n FROM notification_logs n JOIN alert_events e ON e.id = n.alertEventId
         WHERE n.type = 'RED_ALERT' AND n.status IN ${ACTIVE_STATUSES}
           AND e.alertTemplateId = ? AND e.machineId = ? AND e.timestamp >= ? AND e.id != ?`,
      )
      .get(alert.alertTemplateId, alert.machineId, windowStart, alert.id).n;
    if (recent > 0) {
      console.log(`[notify] red alert #${alert.id} suppressed (duplicate within ${config.redDedupMinutes} min)`);
      return { suppressed: true };
    }
    return { ids: enqueue({ users: recipients(['OWNER']), type: 'RED_ALERT', body: redAlertMessage(alert), params: redAlertParams(alert), alertEventId: alert.id }) };
  } finally {
    inFlight.delete(key);
  }
}

/** Tell the owner a red alert they were messaged about has been handled ("what did my team do?"). */
export function notifyResolved(alert, byUser) {
  if (!config.notifyResolved || alert.isDrill || alert.severity !== 'RED') return [];
  const told = db.prepare(`SELECT COUNT(*) AS n FROM notification_logs WHERE alertEventId = ? AND type = 'RED_ALERT' AND status IN ${ACTIVE_STATUSES}`).get(alert.id).n;
  if (!told) return [];
  const en = enLoc(alert);
  const mins = Math.max(1, Math.round((Date.now() - new Date(alert.timestamp).getTime()) / 60000));
  const body = `✅ Handled – ${en.title || alert.eventTypeKey} on ${machineLabel(alert)} (${fmtTime(alert.timestamp)}) was marked handled by ${byUser.name} after ${mins} min. Steps done: ${alert.stepsDone.length}/3.`;
  return enqueue({ users: recipients(['OWNER']), type: 'RESOLVED_UPDATE', body, params: [en.title || alert.eventTypeKey, machineLabel(alert), fmtTime(alert.timestamp), byUser.name, `${mins} min`], alertEventId: alert.id });
}

/** Queue today's summary for every owner and wait for the delivery attempt. */
export async function sendDailySummary() {
  const summary = buildDailySummary();
  const ids = enqueue({ users: recipients(['OWNER']), type: 'DAILY_SUMMARY', body: summary.message, params: summary.templateParams });
  await processQueue();
  return { summary, results: deliveryResults(ids) };
}

export function deliveryResults(ids) {
  if (!ids.length) return [];
  return db
    .prepare(`SELECT n.id, n.status, n.error, n.deliveryStatus, u.phoneNumber AS "to" FROM notification_logs n LEFT JOIN users u ON u.id = n.userId WHERE n.id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids);
}

/** What the engineer sees on the Setup page: is messaging ready, and what's missing (never the secrets). */
export function notificationConfigStatus() {
  const p = config.notifyProvider;
  const missing = [];
  const templates = {};
  if (p === 'twilio') {
    for (const k of ['accountSid', 'authToken', 'from']) if (!config.twilio[k]) missing.push(`TWILIO_${k.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`);
    Object.assign(templates, Object.fromEntries(Object.entries(config.twilio.contentSids).map(([k, v]) => [k, !!v])));
  } else if (p === 'whatsapp_cloud') {
    if (!config.whatsappCloud.token) missing.push('WHATSAPP_TOKEN');
    if (!config.whatsappCloud.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!config.whatsappCloud.appSecret) missing.push('WHATSAPP_APP_SECRET (webhook signature check)');
    Object.assign(templates, Object.fromEntries(Object.entries(config.whatsappCloud.templates).map(([k, v]) => [k, !!v])));
  }
  return {
    provider: p,
    channel: config.notifyChannel,
    ready: p === 'mock' || missing.length === 0,
    missing,
    templates,
    smsFallback: config.smsFallback && p === 'twilio',
    webhooks: config.publicUrl
      ? { twilio: `${config.publicUrl}/api/webhooks/twilio`, whatsapp: `${config.publicUrl}/api/webhooks/whatsapp` }
      : null,
    escalation: { unackMinutes: config.escalateUnackMinutes, unresolvedMinutes: config.escalateUnresolvedMinutes, gatewayOfflineMinutes: config.gatewayOfflineMinutes },
    recipients: { owners: recipients(['OWNER']).length, engineers: recipients(['ENGINEER']).length },
  };
}
