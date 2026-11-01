// Boots the real app on a random port against a throwaway database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-test-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.UPLOADS_DIR = path.join(dir, 'uploads');
process.env.FRONTEND_DIST = path.join(dir, 'no-frontend');
process.env.NOTIFY_PROVIDER = 'mock';
process.env.SEED_DEMO = 'true';
process.env.GATEWAY_TOKEN = 'test-gateway-token-0123456789';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789-0123456789';
process.env.TWILIO_AUTH_TOKEN = 'twilio-test-auth-token';
process.env.PUBLIC_URL = 'https://sentinel.example.test';
process.env.WHATSAPP_APP_SECRET = 'wa-test-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'wa-verify';
// AI layer: off unless a test file turns it on; lexical embeddings so tests need no model download.
process.env.EMBEDDINGS ??= 'hash';
process.env.AI_TRIAGE_AUTO ??= 'false';
process.env.KB_DIRS ??= [path.resolve(import.meta.dirname, '..', '..', 'docs', 'playbooks'), path.resolve(import.meta.dirname, '..', '..', 'docs', 'advisories')].join(',');

const { createApp } = await import('../src/app.js');
const { seed } = await import('../src/seed.js');
export const { db } = await import('../src/db.js');
export const { config } = await import('../src/config.js');
export const notify = await import('../src/services/notify.js');
export const watchdog = await import('../src/services/watchdog.js');
export const { resetRateLimits } = await import('../src/security.js');

// Silence the mock provider's console output during tests.
const log = console.log;
console.log = (...a) => (String(a[0]).includes('[notify') ? undefined : log(...a));
console.warn = () => {};

seed();
const server = createApp().listen(0);
await new Promise((r) => server.once('listening', r));
export const base = `http://127.0.0.1:${server.address().port}/api`;

export function close() {
  server.closeAllConnections?.();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

export async function req(method, p, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, data, headers: res.headers };
}

export async function login(username, password = 'sentinel123') {
  const r = await req('POST', '/auth/login', { body: { username, password } });
  if (r.status !== 200) throw new Error(`login ${username}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

export const GW = { 'x-gateway-token': 'test-gateway-token-0123456789', 'x-gateway-id': 'test-pi' };

export async function event(ev) {
  const r = await req('POST', '/events', { body: ev, headers: GW });
  if (r.status !== 201) throw new Error(`event: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.alerts[0];
}

export const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

/** Notifications for an alert (newest first). */
export const notesFor = (alertId) => db.prepare('SELECT * FROM notification_logs WHERE alertEventId = ? ORDER BY id DESC').all(alertId);
