import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';

// A real installation: no demo data, a known setup code.
process.env.SEED_DEMO = 'false';
process.env.SETUP_CODE = 'ABCD-EFGH-JKLM';
process.env.ALLOW_SIMULATE = 'false';

const { db, req, close, resetRateLimits } = await import('./helpers.js');
after(close);
beforeEach(() => resetRateLimits());

const OWNER = { setupCode: 'abcd efgh jklm', factoryName: 'Patil Auto Components', name: 'Suresh Patil', username: 'suresh', password: 'owner-pass-1', phoneNumber: '+919800000001', preferredLanguage: 'en' };
const cookieOf = (r) => r.headers.get('set-cookie')?.split(';')[0];
let ownerToken;

async function loginToken(username, password) {
  const r = await req('POST', '/auth/login', { body: { username, password } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token;
}

async function invite(token, body) {
  const r = await req('POST', '/invites', { token, body });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { ...r.data, token: r.data.url.split('/join/')[1] };
}

describe('first-run setup', () => {
  test('a fresh install has no demo accounts and asks for setup', async () => {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    const m = await req('GET', '/meta');
    assert.deepEqual(m.data, { factoryName: null, needsSetup: true, demo: false, simulate: false });
    assert.equal((await req('POST', '/auth/login', { body: { username: 'owner', password: 'sentinel123' } })).status, 401);
  });

  test('wrong setup code is refused', async () => {
    const r = await req('POST', '/setup', { body: { ...OWNER, setupCode: 'WRONG-CODE-0000' } });
    assert.equal(r.status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
  });

  test('weak or invalid owner details are refused', async () => {
    assert.equal((await req('POST', '/setup', { body: { ...OWNER, password: 'short' } })).status, 400);
    assert.equal((await req('POST', '/setup', { body: { ...OWNER, username: 'Bad Name!' } })).status, 400);
    assert.equal((await req('POST', '/setup', { body: { ...OWNER, factoryName: '' } })).status, 400);
  });

  test('the right code creates the factory and its Owner, and signs them in', async () => {
    const r = await req('POST', '/setup', { body: OWNER });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.user.role, 'OWNER');
    const me = await req('GET', '/me', { headers: { cookie: cookieOf(r) } });
    assert.equal(me.data.username, 'suresh');
    const m = await req('GET', '/meta');
    assert.equal(m.data.factoryName, 'Patil Auto Components');
    assert.equal(m.data.needsSetup, false);
    ownerToken = await loginToken('suresh', 'owner-pass-1');
  });

  test('setup cannot be run twice', async () => {
    const r = await req('POST', '/setup', { body: { ...OWNER, username: 'intruder' } });
    assert.equal(r.status, 409);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'OWNER'").get().n, 1);
  });
});

describe('invite links', () => {
  let engToken;

  test('an invite carries the role; the invitee cannot choose another', async () => {
    const inv = await invite(ownerToken, { role: 'ENGINEER', name: 'Ramesh Kumar', phoneNumber: '+919800000002', preferredLanguage: 'en' });
    assert.match(inv.url, /\/join\/[A-Za-z0-9_-]{30,}$/);
    assert.equal(inv.status, 'PENDING');

    const look = await req('GET', `/join/${inv.token}`);
    assert.equal(look.data.role, 'ENGINEER');
    assert.equal(look.data.name, 'Ramesh Kumar');
    assert.equal(look.data.factoryName, 'Patil Auto Components');

    const r = await req('POST', `/join/${inv.token}`, { body: { name: 'Ramesh Kumar', username: 'ramesh', password: 'eng-pass-12', role: 'OWNER', preferredLanguage: 'en' } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.user.role, 'ENGINEER', 'role comes from the invite, not the request');
    assert.ok(cookieOf(r), 'signed in straight away');
    engToken = await loginToken('ramesh', 'eng-pass-12');
  });

  test('a link works only once', async () => {
    const inv = await invite(ownerToken, { role: 'OPERATOR' });
    assert.equal((await req('POST', `/join/${inv.token}`, { body: { name: 'A', username: 'op.one', password: 'operator-1' } })).status, 201);
    const again = await req('POST', `/join/${inv.token}`, { body: { name: 'B', username: 'op.two', password: 'operator-2' } });
    assert.equal(again.status, 410);
    assert.match(again.data.error, /already been used/);
    assert.equal((await req('GET', `/join/${inv.token}`)).status, 410);
  });

  test('expired, revoked and made-up links are refused', async () => {
    const exp = await invite(ownerToken, { role: 'OPERATOR' });
    db.prepare('UPDATE invites SET expiresAt = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), exp.id);
    assert.match((await req('GET', `/join/${exp.token}`)).data.error, /expired/);

    const rev = await invite(ownerToken, { role: 'SUPERVISOR' });
    assert.equal((await req('DELETE', `/invites/${rev.id}`, { token: ownerToken })).status, 200);
    assert.match((await req('POST', `/join/${rev.token}`, { body: { name: 'X', username: 'sup.x', password: 'supervisor1' } })).data.error, /cancelled/);

    assert.equal((await req('GET', '/join/not-a-real-token-at-all')).status, 404);
  });

  test('only the hash of a link is stored', () => {
    const rows = db.prepare('SELECT * FROM invites').all();
    assert.ok(rows.length >= 4);
    for (const r of rows) {
      assert.match(r.tokenHash, /^[0-9a-f]{64}$/);
      assert.equal(r.token, undefined);
    }
  });

  test('engineers can invite staff but not owners; operators cannot invite', async () => {
    assert.equal((await req('POST', '/invites', { token: engToken, body: { role: 'OWNER' } })).status, 403);
    const sup = await invite(engToken, { role: 'SUPERVISOR', preferredLanguage: 'ta' });
    assert.equal(sup.role, 'SUPERVISOR');
    const opToken = await loginToken('op.one', 'operator-1');
    assert.equal((await req('POST', '/invites', { token: opToken, body: { role: 'OPERATOR' } })).status, 403);
    assert.equal((await req('GET', '/invites', { token: opToken })).status, 403);
  });

  test('taken usernames and bad passwords are reported without using up the link', async () => {
    const inv = await invite(ownerToken, { role: 'OPERATOR' });
    assert.equal((await req('POST', `/join/${inv.token}`, { body: { name: 'Dup', username: 'ramesh', password: 'whatever-1' } })).status, 409);
    assert.equal((await req('POST', `/join/${inv.token}`, { body: { name: 'Weak', username: 'weak.one', password: '123' } })).status, 400);
    assert.equal((await req('GET', `/join/${inv.token}`)).status, 200, 'still usable');
  });

  test('the invite list shows status but never the link', async () => {
    const list = await req('GET', '/invites', { token: ownerToken });
    const statuses = new Set(list.data.map((i) => i.status));
    for (const s of ['PENDING', 'USED', 'EXPIRED', 'REVOKED']) assert.ok(statuses.has(s), s);
    assert.ok(list.data.every((i) => !('tokenHash' in i) && !('token' in i) && !('url' in i)));
    assert.equal(list.data.find((i) => i.status === 'USED' && i.role === 'ENGINEER').usedByUsername, 'ramesh');
  });

  test('invite actions are audited', () => {
    const actions = new Set(db.prepare('SELECT action FROM audit_logs').all().map((r) => r.action));
    for (const a of ['FACTORY_SETUP', 'INVITE_CREATED', 'INVITE_ACCEPTED', 'INVITE_REVOKED']) assert.ok(actions.has(a), a);
  });
});

describe('production behaviour', () => {
  test('only the owner can rename the factory', async () => {
    const eng = await loginToken('ramesh', 'eng-pass-12');
    assert.equal((await req('PATCH', '/settings', { token: eng, body: { factoryName: 'X' } })).status, 403);
    const r = await req('PATCH', '/settings', { token: ownerToken, body: { factoryName: 'Patil Auto, Chakan' } });
    assert.equal(r.status, 200);
    assert.equal((await req('GET', '/meta')).data.factoryName, 'Patil Auto, Chakan');
  });

  test('simulated events are off unless enabled', async () => {
    const m = db.prepare('INSERT INTO machines (name, identifier) VALUES (?, ?)').run('Line 1', 'LINE_1');
    const r = await req('POST', '/simulate', { token: ownerToken, body: { machineId: Number(m.lastInsertRowid), eventTypeKey: 'USB_INSERT' } });
    assert.equal(r.status, 403);
  });

  test('setup and join endpoints are rate-limited', async () => {
    let last;
    for (let i = 0; i < 11; i++) last = await req('POST', '/setup', { body: OWNER });
    assert.equal(last.status, 429);
    for (let i = 0; i < 31; i++) last = await req('GET', '/join/x');
    assert.equal(last.status, 429);
  });
});
