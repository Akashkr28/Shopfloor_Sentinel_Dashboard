import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, beforeEach, describe, test } from 'node:test';
import {
  close, config, db, event, GW, login, minutesAgo, notesFor, notify, req, resetRateLimits, watchdog,
} from './helpers.js';
import { twilioSignature } from '../src/routes/webhooks.js';

after(close);
beforeEach(() => resetRateLimits());

const tokens = {};
const as = async (u) => (tokens[u] ||= await login(u));

describe('authentication', () => {
  test('wrong password is rejected and audited', async () => {
    const r = await req('POST', '/auth/login', { body: { username: 'owner', password: 'nope' } });
    assert.equal(r.status, 401);
    const row = db.prepare("SELECT * FROM audit_logs WHERE action = 'LOGIN_FAILED' ORDER BY id DESC").get();
    assert.equal(row.target, 'owner');
  });

  test('login sets an HttpOnly, SameSite=Strict cookie that authenticates', async () => {
    const r = await req('POST', '/auth/login', { body: { username: 'engineer', password: 'sentinel123' } });
    assert.equal(r.status, 200);
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, /sentinel_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    const session = cookie.split(';')[0];
    const me = await req('GET', '/me', { headers: { cookie: session } });
    assert.equal(me.data.username, 'engineer');
    assert.equal(me.data.hashedPassword, undefined);
  });

  test('cookie-authenticated writes need the CSRF header; bearer tokens do not', async () => {
    const r = await req('POST', '/auth/login', { body: { username: 'engineer', password: 'sentinel123' } });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const body = { name: 'CSRF Line', identifier: 'CSRF_LINE' };
    assert.equal((await req('POST', '/machines', { headers: { cookie }, body })).status, 403);
    assert.equal((await req('POST', '/machines', { headers: { cookie, 'x-sentinel-request': '1' }, body })).status, 201);
    assert.equal((await req('POST', '/machines', { token: r.data.token, body: { name: 'B', identifier: 'BEARER_LINE' } })).status, 201);
  });

  test('per-account login limit blocks brute force', async () => {
    for (let i = 0; i < 10; i++) await req('POST', '/auth/login', { body: { username: 'supervisor', password: 'x' } });
    const r = await req('POST', '/auth/login', { body: { username: 'supervisor', password: 'sentinel123' } });
    assert.equal(r.status, 429);
    assert.ok(r.headers.get('retry-after'));
  });

  test('password change signs out old sessions', async () => {
    const old = await login('operator2');
    await new Promise((r) => setTimeout(r, 1100)); // JWT iat has 1 s resolution
    const r = await req('POST', '/me/password', { token: old, body: { currentPassword: 'sentinel123', newPassword: 'new-password-1' } });
    assert.equal(r.status, 200);
    await new Promise((r2) => setTimeout(r2, 1100));
    const fresh = await login('operator2', 'new-password-1');
    assert.equal((await req('GET', '/me', { token: fresh })).status, 200);
    // The old token predates the change.
    db.prepare("UPDATE users SET passwordChangedAt = ? WHERE username = 'operator2'").run(new Date(Date.now()).toISOString());
    assert.equal((await req('GET', '/me', { token: old })).status, 401);
  });

  test('weak passwords and wrong current password are refused', async () => {
    const t = await as('supervisor');
    assert.equal((await req('POST', '/me/password', { token: t, body: { currentPassword: 'wrong', newPassword: 'long-enough-1' } })).status, 403);
    assert.equal((await req('POST', '/me/password', { token: t, body: { currentPassword: 'sentinel123', newPassword: 'short' } })).status, 400);
  });
});

describe('role-based access', () => {
  test('operators cannot reach manager endpoints', async () => {
    const op = await as('operator');
    for (const p of ['/users', '/stats', '/audit', '/notifications', '/owner/daily-summary', '/alerts/export.csv']) {
      assert.equal((await req('GET', p, { token: op })).status, 403, p);
    }
    assert.equal((await req('POST', '/drill/start', { token: op, body: {} })).status, 403);
  });

  test('operators never see raw gateway payloads and cannot resolve', async () => {
    const a = await event({ eventTypeKey: 'NEW_DEVICE', machineIdentifier: 'PRESS_LINE_2_HMI', details: { mac: 'aa:bb' } });
    const op = await as('operator');
    const r = await req('GET', `/alerts/${a.id}`, { token: op });
    assert.equal(r.data.rawPayload, undefined);
    assert.equal((await req('POST', `/alerts/${a.id}/actions`, { token: op, body: { actionType: 'RESOLVE' } })).status, 403);
    const eng = await as('engineer');
    assert.deepEqual((await req('GET', `/alerts/${a.id}`, { token: eng })).data.rawPayload.details, { mac: 'aa:bb' });
  });

  test('engineers cannot touch owner accounts; the last owner cannot be removed', async () => {
    const eng = await as('engineer');
    const owner = db.prepare("SELECT id FROM users WHERE username = 'owner'").get();
    assert.equal((await req('PATCH', `/users/${owner.id}`, { token: eng, body: { name: 'x' } })).status, 403);
    assert.equal((await req('POST', `/users/${owner.id}/password`, { token: eng, body: { newPassword: 'abcdefgh' } })).status, 403);
    assert.equal((await req('POST', '/users', { token: eng, body: { username: 'boss2', name: 'B', password: 'abcdefgh', role: 'OWNER' } })).status, 403);
    const own = await as('owner');
    assert.equal((await req('PATCH', `/users/${owner.id}`, { token: own, body: { isActive: false } })).status, 400);
  });

  test('disabled users are signed out and cannot log in', async () => {
    const eng = await as('engineer');
    const created = await req('POST', '/users', { token: eng, body: { username: 'temp.op', name: 'Temp', password: 'abcdefgh', role: 'OPERATOR', preferredLanguage: 'ta' } });
    assert.equal(created.status, 201);
    const t = await login('temp.op', 'abcdefgh');
    await req('PATCH', `/users/${created.data.id}`, { token: eng, body: { isActive: false } });
    assert.equal((await req('GET', '/me', { token: t })).status, 401);
    assert.equal((await req('POST', '/auth/login', { body: { username: 'temp.op', password: 'abcdefgh' } })).status, 401);
  });

  test('user input is validated', async () => {
    const eng = await as('engineer');
    const bad = [
      { username: 'x', name: 'N', password: 'abcdefgh', role: 'OPERATOR' },
      { username: 'good.name', name: 'N', password: 'abcdefgh', role: 'OPERATOR', phoneNumber: '98765' },
      { username: 'good.name', name: 'N', password: 'abcdefgh', role: 'ADMIN' },
    ];
    for (const body of bad) assert.equal((await req('POST', '/users', { token: eng, body })).status, 400, JSON.stringify(body));
  });
});

describe('gateway ingest', () => {
  test('requires the shared token', async () => {
    const r = await req('POST', '/events', { body: { eventTypeKey: 'USB_INSERT', machineIdentifier: 'X1' }, headers: { 'x-gateway-token': 'wrong' } });
    assert.equal(r.status, 401);
  });

  test('rejects malformed events', async () => {
    for (const ev of [{ eventTypeKey: 'bad key!', machineIdentifier: 'A1' }, { eventTypeKey: 'USB_INSERT' }, { eventTypeKey: 'USB_INSERT', machineIdentifier: 'A1', details: 'x' }]) {
      assert.equal((await req('POST', '/events', { body: ev, headers: GW })).status, 400);
    }
  });

  test('unknown machines are auto-registered and unknown types use the fallback template', async () => {
    const a = await event({ eventTypeKey: 'SOMETHING_NEW', machineIdentifier: 'brand_new_box' });
    const row = db.prepare('SELECT m.name, t.eventTypeKey FROM alert_events e JOIN machines m ON m.id = e.machineId JOIN alert_templates t ON t.id = e.alertTemplateId WHERE e.id = ?').get(a.id);
    assert.equal(row.name, 'Unmapped: BRAND_NEW_BOX');
    assert.equal(row.eventTypeKey, 'UNKNOWN_EVENT');
  });

  test('severity rules raise amber events to red', async () => {
    const cases = [
      [{ eventTypeKey: 'UNK_REMOTE_LOGIN', details: { failedAttempts: 2 } }, 'AMBER'],
      [{ eventTypeKey: 'UNK_REMOTE_LOGIN', details: { failedAttempts: 6 } }, 'RED'],
      [{ eventTypeKey: 'UNK_REMOTE_LOGIN', details: { connectionAttempts: 10 } }, 'RED'],
      [{ eventTypeKey: 'UNK_REMOTE_LOGIN', details: { externalSource: true } }, 'RED'],
      [{ eventTypeKey: 'ABNORMAL_TRAFFIC', details: { kind: 'port-scan' } }, 'RED'],
      [{ eventTypeKey: 'ABNORMAL_TRAFFIC', details: { mbOut: 5 } }, 'AMBER'],
      [{ eventTypeKey: 'PLC_WRITE', details: {} }, 'RED'],
    ];
    for (const [ev, sev] of cases) {
      const a = await event({ ...ev, machineIdentifier: `SEV_${crypto.randomUUID().slice(0, 6).toUpperCase()}` });
      assert.equal(a.severity, sev, JSON.stringify(ev));
    }
  });

  test('future timestamps are replaced with arrival time', async () => {
    const a = await event({ eventTypeKey: 'ROUTINE_CHECK', machineIdentifier: 'OFFICE_LAN', timestamp: '2099-01-01T00:00:00Z' });
    const ts = db.prepare('SELECT timestamp FROM alert_events WHERE id = ?').get(a.id).timestamp;
    assert.ok(new Date(ts).getTime() < Date.now() + 1000);
  });

  test('heartbeats register the gateway', async () => {
    const r = await req('POST', '/gateway/heartbeat', { headers: GW, body: { hostname: 'pi', version: '1.0.0', monitors: ['network'], stats: { packets: 5 } } });
    assert.equal(r.status, 200);
    const s = await req('GET', '/gateway/status', { token: await as('engineer') });
    const gw = s.data.gateways.find((g) => g.id === 'test-pi');
    assert.equal(gw.online, true);
    assert.deepEqual(gw.monitors, ['network']);
  });
});

describe('alert lifecycle and owner messages', () => {
  test('steps move OPEN → ACKNOWLEDGED → RESOLVED and the owner hears it was handled', async () => {
    const a = await event({ eventTypeKey: 'USB_INSERT', machineIdentifier: 'LIFECYCLE_1' });
    await notify.processQueue();
    assert.equal(notesFor(a.id).filter((n) => n.type === 'RED_ALERT').length, 1);
    const op = await as('operator');
    let r = await req('POST', `/alerts/${a.id}/actions`, { token: op, body: { actionType: 'STEP_COMPLETED', stepNumber: 1 } });
    assert.equal(r.data.status, 'ACKNOWLEDGED');
    await req('POST', `/alerts/${a.id}/actions`, { token: op, body: { actionType: 'STEP_COMPLETED', stepNumber: 2 } });
    r = await req('POST', `/alerts/${a.id}/actions`, { token: op, body: { actionType: 'STEP_COMPLETED', stepNumber: 3 } });
    assert.equal(r.data.status, 'RESOLVED');
    await notify.processQueue();
    const handled = notesFor(a.id).find((n) => n.type === 'RESOLVED_UPDATE');
    assert.equal(handled.status, 'SENT');
    assert.match(handled.message, /Ravi Yadav/);
  });

  test('repeat red alerts on the same machine are deduplicated', async () => {
    const a = await event({ eventTypeKey: 'USB_INSERT', machineIdentifier: 'DEDUP_1' });
    await notify.processQueue();
    const b = await event({ eventTypeKey: 'USB_INSERT', machineIdentifier: 'DEDUP_1' });
    await notify.processQueue();
    assert.equal(notesFor(a.id).length, 1);
    assert.equal(notesFor(b.id).length, 0);
  });

  test('drills never message the owner', async () => {
    const sup = await as('supervisor');
    const m = db.prepare("SELECT id FROM machines WHERE identifier = 'PRESS_LINE_1_HMI'").get();
    const t = db.prepare("SELECT id FROM alert_templates WHERE eventTypeKey = 'SUSPICIOUS_SOFTWARE'").get();
    const r = await req('POST', '/drill/start', { token: sup, body: { machineId: m.id, alertTemplateId: t.id, team: 'Shift B' } });
    assert.equal(r.status, 201);
    assert.equal(r.data.isDrill, true);
    await notify.processQueue();
    assert.equal(notesFor(r.data.id).length, 0);
  });

  test('daily summary is queued, sent and reported', async () => {
    const r = await req('POST', '/owner/daily-summary/send', { token: await as('owner') });
    assert.equal(r.status, 200);
    assert.equal(r.data.results[0].status, 'SENT');
    assert.equal(r.data.summary.templateParams.length, 5);
  });
});

describe('escalation watchdog', () => {
  test('unacknowledged red escalates once to owner + engineer; unresolved escalates again', async () => {
    const a = await event({ eventTypeKey: 'PLC_WRITE', machineIdentifier: 'ESC_1', timestamp: minutesAgo(15) });
    await watchdog.runWatchdog();
    let esc = notesFor(a.id).filter((n) => n.type === 'ESCALATION');
    assert.equal(esc.length, 2); // owner + engineer
    assert.ok(esc.every((n) => n.escalationLevel === 1 && n.status === 'SENT'));
    await watchdog.runWatchdog();
    assert.equal(notesFor(a.id).filter((n) => n.type === 'ESCALATION').length, 2, 'not repeated');

    const op = await as('operator');
    await req('POST', `/alerts/${a.id}/actions`, { token: op, body: { actionType: 'ACKNOWLEDGE' } });
    await watchdog.runWatchdog(Date.now() + 60 * 60000);
    esc = notesFor(a.id).filter((n) => n.type === 'ESCALATION' && n.escalationLevel === 2);
    assert.equal(esc.length, 1); // owners only
  });

  test('acknowledged alerts are not escalated as unacknowledged', async () => {
    const a = await event({ eventTypeKey: 'USB_INSERT', machineIdentifier: 'ESC_2', timestamp: minutesAgo(12) });
    await req('POST', `/alerts/${a.id}/actions`, { token: await as('operator'), body: { actionType: 'STEP_COMPLETED', stepNumber: 1 } });
    await watchdog.runWatchdog();
    assert.equal(notesFor(a.id).filter((n) => n.type === 'ESCALATION').length, 0);
  });

  test('a silent gateway alerts once, and again when it is back', async () => {
    await req('POST', '/gateway/heartbeat', { headers: { ...GW, 'x-gateway-id': 'pi-quiet' }, body: {} });
    const later = Date.now() + (config.gatewayOfflineMinutes + 1) * 60000;
    await watchdog.runWatchdog(later);
    await watchdog.runWatchdog(later + 60000);
    const msgs = () => db.prepare("SELECT * FROM notification_logs WHERE type = 'GATEWAY_OFFLINE' AND gatewayId = 'pi-quiet' ORDER BY id").all();
    assert.equal(msgs().length, 2); // owner + engineer, once
    assert.match(msgs()[0].message, /has not reported/);
    assert.equal(watchdog.gatewayStatus(later).find((g) => g.id === 'pi-quiet').online, false);
    await req('POST', '/gateway/heartbeat', { headers: { ...GW, 'x-gateway-id': 'pi-quiet' }, body: {} });
    await notify.processQueue();
    assert.match(msgs().at(-1).message, /back online/);
  });
});

describe('notification delivery', () => {
  test('a provider outage is retried with backoff, a bad config fails permanently', async () => {
    const realFetch = globalThis.fetch;
    config.notifyProvider = 'whatsapp_cloud';
    config.whatsappCloud.token = 't';
    config.whatsappCloud.phoneNumberId = '123';
    globalThis.fetch = async (url, opts) => (String(url).includes('graph.facebook.com') ? new Response('down', { status: 503 }) : realFetch(url, opts));
    try {
      const owner = db.prepare("SELECT * FROM users WHERE username = 'owner'").get();
      const [id] = notify.enqueue({ users: [owner], type: 'TEST', body: 'hello' });
      await notify.processQueue();
      let n = db.prepare('SELECT * FROM notification_logs WHERE id = ?').get(id);
      assert.equal(n.status, 'PENDING');
      assert.equal(n.attempts, 1);
      assert.ok(new Date(n.nextAttemptAt) > new Date());
      assert.match(n.error, /503/);

      // Provider comes back; force the retry to be due now.
      globalThis.fetch = async (url, opts) => (String(url).includes('graph.facebook.com') ? Response.json({ messages: [{ id: 'wamid.OK1' }] }) : realFetch(url, opts));
      db.prepare('UPDATE notification_logs SET nextAttemptAt = ? WHERE id = ?').run(new Date(0).toISOString(), id);
      await notify.processQueue();
      n = db.prepare('SELECT * FROM notification_logs WHERE id = ?').get(id);
      assert.equal(n.status, 'SENT');
      assert.equal(n.providerMessageId, 'wamid.OK1');

      config.notifyChannel = 'SMS'; // WhatsApp Cloud can't send SMS → permanent
      const [id2] = notify.enqueue({ users: [owner], type: 'TEST', body: 'x' });
      await notify.processQueue();
      assert.equal(db.prepare('SELECT status FROM notification_logs WHERE id = ?').get(id2).status, 'FAILED');
    } finally {
      globalThis.fetch = realFetch;
      config.notifyProvider = 'mock';
      config.notifyChannel = 'WHATSAPP';
    }
  });

  test('approved WhatsApp templates are used when configured', async () => {
    const realFetch = globalThis.fetch;
    let sent;
    config.notifyProvider = 'whatsapp_cloud';
    config.whatsappCloud.templates.RED_ALERT = 'sentinel_red_alert';
    globalThis.fetch = async (url, opts) => {
      if (!String(url).includes('graph.facebook.com')) return realFetch(url, opts);
      sent = JSON.parse(opts.body);
      return Response.json({ messages: [{ id: 'wamid.TPL' }] });
    };
    try {
      await event({ eventTypeKey: 'USB_INSERT', machineIdentifier: 'TPL_1' });
      await notify.processQueue();
      assert.equal(sent.type, 'template');
      assert.equal(sent.template.name, 'sentinel_red_alert');
      const params = sent.template.components[0].parameters;
      assert.equal(params.length, 5);
      assert.ok(params.every((p) => !p.text.includes('\n')));
    } finally {
      globalThis.fetch = realFetch;
      config.notifyProvider = 'mock';
      delete config.whatsappCloud.templates.RED_ALERT;
    }
  });

  test('Twilio status webhook: valid signature updates delivery, invalid is refused', async () => {
    const owner = db.prepare("SELECT * FROM users WHERE username = 'owner'").get();
    const [id] = notify.enqueue({ users: [owner], type: 'TEST', body: 'hi' });
    await notify.processQueue();
    const sid = db.prepare('SELECT providerMessageId FROM notification_logs WHERE id = ?').get(id).providerMessageId;
    db.prepare("UPDATE notification_logs SET deliveryStatus = 'sent' WHERE id = ?").run(id);
    const params = { MessageSid: sid, MessageStatus: 'read' };
    const body = new URLSearchParams(params).toString();
    const sig = twilioSignature(`${config.publicUrl}/api/webhooks/twilio`, params, config.twilio.authToken);
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    assert.equal((await req('POST', '/webhooks/twilio', { raw: true, body, headers: { ...headers, 'x-twilio-signature': 'forged' } })).status, 403);
    assert.equal((await req('POST', '/webhooks/twilio', { raw: true, body, headers: { ...headers, 'x-twilio-signature': sig } })).status, 200);
    assert.equal(db.prepare('SELECT deliveryStatus FROM notification_logs WHERE id = ?').get(id).deliveryStatus, 'read');
  });

  test('WhatsApp webhook: handshake, signature check, read receipts never go backwards', async () => {
    const hs = await req('GET', '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wa-verify&hub.challenge=42');
    assert.equal(hs.data, 42);
    assert.equal((await req('GET', '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1')).status, 403);

    const owner = db.prepare("SELECT * FROM users WHERE username = 'owner'").get();
    const [id] = notify.enqueue({ users: [owner], type: 'TEST', body: 'hi' });
    await notify.processQueue();
    db.prepare("UPDATE notification_logs SET providerMessageId = 'wamid.HOOK', deliveryStatus = 'sent' WHERE id = ?").run(id);
    const send = (status, secret = config.whatsappCloud.appSecret) => {
      const raw = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.HOOK', status }] } }] }] });
      const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
      return req('POST', '/webhooks/whatsapp', { raw: true, body: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } });
    };
    assert.equal((await send('read', 'wrong-secret')).status, 403);
    assert.equal((await send('read')).status, 200);
    await send('delivered'); // arrives late – must not downgrade
    assert.equal(db.prepare('SELECT deliveryStatus FROM notification_logs WHERE id = ?').get(id).deliveryStatus, 'read');
  });

  test('test message endpoint reports the result', async () => {
    const r = await req('POST', '/notifications/test', { token: await as('engineer'), body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.data.results[0].status, 'SENT');
  });
});

describe('exports and audit', () => {
  test('CSV export neutralises spreadsheet formulas', async () => {
    await event({ eventTypeKey: 'ROUTINE_CHECK', machineIdentifier: 'CSV_1', details: { note: '=HYPERLINK("http://evil")' } });
    const db2 = db.prepare("UPDATE machines SET name = '=cmd|calc' WHERE identifier = 'CSV_1'");
    db2.run();
    const r = await req('GET', '/alerts/export.csv', { token: await as('engineer') });
    assert.equal(r.status, 200);
    assert.ok(!/(^|,)"=/m.test(r.data), 'no cell starts with =');
    assert.match(r.data, /"'=cmd\|calc"/);
  });

  test('security-relevant actions are in the audit log', async () => {
    const actions = new Set(db.prepare('SELECT DISTINCT action FROM audit_logs').all().map((r) => r.action));
    for (const a of ['LOGIN', 'LOGIN_FAILED', 'LOGIN_BLOCKED', 'PASSWORD_CHANGED', 'USER_CREATED', 'USER_DISABLED', 'MACHINE_CREATED', 'DRILL_STARTED', 'ALERTS_EXPORTED']) {
      assert.ok(actions.has(a), a);
    }
    const r = await req('GET', '/audit?action=LOGIN_FAILED', { token: await as('owner') });
    assert.ok(r.data.length > 0 && r.data.every((x) => x.action === 'LOGIN_FAILED'));
  });

  test('security headers are set', async () => {
    const r = await req('GET', '/health');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
  });
});
