import { config } from '../config.js';
import { db } from '../db.js';
import { broadcast } from './live.js';
import { buildDailySummary, fmtTime } from './summary.js';

/**
 * Deliver one text message. Providers:
 *  - mock: prints to the console and logs as SENT (default; no account needed)
 *  - twilio: WhatsApp (whatsapp: prefix) or SMS via Twilio REST API
 *  - whatsapp_cloud: Meta WhatsApp Cloud API text message
 */
async function deliver(to, body, channel) {
  const provider = config.notifyProvider;
  if (provider === 'mock') {
    console.log(`\n[notify:mock → ${channel} ${to}]\n${body}\n`);
    return;
  }
  if (provider === 'twilio') {
    const { accountSid, authToken, from } = config.twilio;
    if (!accountSid || !authToken || !from) throw new Error('Twilio env vars missing');
    const prefix = channel === 'WHATSAPP' ? 'whatsapp:' : '';
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: prefix + from, To: prefix + to, Body: body }),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
    return;
  }
  if (provider === 'whatsapp_cloud') {
    const { token, phoneNumberId } = config.whatsappCloud;
    if (!token || !phoneNumberId) throw new Error('WhatsApp Cloud env vars missing');
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'text', text: { body } }),
    });
    if (!res.ok) throw new Error(`WhatsApp Cloud ${res.status}: ${await res.text()}`);
    return;
  }
  throw new Error(`Unknown NOTIFY_PROVIDER "${provider}"`);
}

function owners() {
  return db.prepare("SELECT * FROM users WHERE role = 'OWNER' AND phoneNumber IS NOT NULL AND phoneNumber != ''").all();
}

async function sendAndLog({ user, type, body, alertEventId = null }) {
  const channel = config.notifyChannel === 'SMS' ? 'SMS' : 'WHATSAPP';
  let status = 'SENT';
  let error = null;
  try {
    await deliver(user.phoneNumber, body, channel);
  } catch (e) {
    status = 'FAILED';
    error = String(e.message || e);
    console.error(`[notify] ${type} to ${user.phoneNumber} failed: ${error}`);
  }
  db.prepare(
    'INSERT INTO notification_logs (alertEventId, userId, type, channel, provider, status, message, error) VALUES (?,?,?,?,?,?,?,?)',
  ).run(alertEventId, user.id, type, channel, config.notifyProvider, status, body, error);
  broadcast('notification', { type, status });
  return { to: user.phoneNumber, status, error };
}

export function redAlertMessage(alert) {
  const en = alert.localizations.en || Object.values(alert.localizations)[0] || {};
  const acted = alert.firstActionAt ? 'Yes' : alert.status === 'OPEN' ? 'Unknown (just happened)' : 'Yes';
  return [
    `🔴 RED ALERT – Shopfloor Sentinel`,
    `${en.title || alert.eventTypeKey} on ${alert.machineName}${alert.machineLocation ? ` (${alert.machineLocation})` : ''} at ${fmtTime(alert.timestamp)}.`,
    `Operator advised: ${en.whatToDo || 'follow the on-screen steps'}`,
    `Operator action taken: ${acted}. Status: ${alert.status.toLowerCase()}.`,
    alert.ownerFollowUp ? `Your follow-up: ${alert.ownerFollowUp}` : null,
  ].filter(Boolean).join('\n');
}

/**
 * Instant owner message for red alerts — but only the first red of the same
 * type on the same machine inside RED_DEDUP_MINUTES, to avoid alert fatigue.
 */
const inFlight = new Map(); // dedup key -> ms; covers bursts that arrive before the first send is logged

export async function notifyRedAlert(alert) {
  const key = `${alert.alertTemplateId}:${alert.machineId}`;
  if (inFlight.has(key)) {
    console.log(`[notify] red alert #${alert.id} suppressed (send already in progress)`);
    return { suppressed: true };
  }
  inFlight.set(key, Date.now());
  try {
    return await notifyRedAlertOnce(alert);
  } finally {
    inFlight.delete(key);
  }
}

async function notifyRedAlertOnce(alert) {
  const windowStart = new Date(new Date(alert.timestamp).getTime() - config.redDedupMinutes * 60000).toISOString();
  const recent = db
    .prepare(
      `SELECT COUNT(*) AS n FROM notification_logs n
       JOIN alert_events e ON e.id = n.alertEventId
       WHERE n.type = 'RED_ALERT' AND n.status = 'SENT'
         AND e.alertTemplateId = ? AND e.machineId = ? AND e.timestamp >= ? AND e.id != ?`,
    )
    .get(alert.alertTemplateId, alert.machineId, windowStart, alert.id).n;
  if (recent > 0) {
    console.log(`[notify] red alert #${alert.id} suppressed (duplicate within ${config.redDedupMinutes} min)`);
    return { suppressed: true };
  }
  const body = redAlertMessage(alert);
  return { results: await Promise.all(owners().map((user) => sendAndLog({ user, type: 'RED_ALERT', body, alertEventId: alert.id }))) };
}

export async function sendDailySummary() {
  const summary = buildDailySummary();
  const results = await Promise.all(owners().map((user) => sendAndLog({ user, type: 'DAILY_SUMMARY', body: summary.message })));
  return { summary, results };
}
