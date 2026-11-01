// End-to-end for a real (non-demo) installation: first-run setup with the
// one-time code, then an invite link accepted in a separate browser session.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4800 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-signup-'));
const CODE = 'TEST-CODE-2468';
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));

let server;
let browser;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  assert.ok(CHROME, 'Chrome not found – set CHROME_PATH');
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
    cwd: path.join(ROOT, 'backend'),
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ANTHROPIC_'))),
      NODE_ENV: 'production', PORT: String(PORT), DB_PATH: path.join(tmp, 'db.sqlite'), UPLOADS_DIR: path.join(tmp, 'uploads'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'), GATEWAY_TOKEN: crypto.randomBytes(24).toString('hex'),
      SETUP_CODE: CODE, COOKIE_SECURE: 'false', AI_ENABLED: 'false', EMBEDDINGS: 'hash', NOTIFY_PROVIDER: 'mock',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      /* starting */
    }
    await sleep(200);
  }
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
});

after(async () => {
  await browser?.close();
  server?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function page() {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  return p;
}

async function fill(p, selector, value) {
  await p.waitForSelector(selector);
  await p.$eval(selector, (el) => (el.value = ''));
  await p.type(selector, value);
}

test('first run → owner → invite → supervisor joins with the invited role', async () => {
  const owner = await page();
  await owner.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await owner.waitForFunction(() => location.pathname === '/setup-factory');
  assert.equal(await owner.$('.demo-logins'), null, 'no demo accounts on a real install');

  const inputs = 'form.login-card input';
  await owner.waitForSelector(inputs);
  const fields = await owner.$$(inputs);
  const values = ['wrong-code-0000', 'Patil Auto Components', 'Suresh Patil', 'suresh', 'owner-pass-123', 'owner-pass-123', '+919800000001'];
  for (const [i, v] of values.entries()) await fields[i].type(v);
  await owner.click('form.login-card button.btn-primary');
  await owner.waitForFunction(() => /Wrong setup code/.test(document.querySelector('form.login-card .error')?.textContent || ''));

  await fill(owner, 'form.login-card input.mono', CODE.toLowerCase());
  await owner.click('form.login-card button.btn-primary');
  await owner.waitForFunction(() => location.pathname === '/owner');

  await owner.goto(`${BASE}/setup?tab=users`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.panel form.form-row select');
  await owner.select('.panel form.form-row select', 'SUPERVISOR');
  await fill(owner, '.panel form.form-row input[placeholder^="Name"]', 'Lakshmi Iyer');
  await owner.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Create invite link')).click());
  await owner.waitForSelector('.invite-link input');
  const url = await owner.$eval('.invite-link input', (el) => el.value);
  assert.match(url, /\/join\/[A-Za-z0-9_-]{30,}$/);

  const invitee = await page();
  await invitee.goto(url.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'domcontentloaded' });
  await invitee.waitForFunction(() => /Join Patil Auto Components/.test(document.querySelector('h1')?.textContent || ''));
  assert.match(await invitee.$eval('form.login-card', (f) => f.textContent), /Supervisor/);
  assert.equal(await invitee.$eval('form.login-card input', (el) => el.value), 'Lakshmi Iyer', 'name prefilled from the invite');
  const jf = await invitee.$$('form.login-card input');
  await jf[1].type('lakshmi');
  await jf[2].type('super-pass-1');
  await jf[3].type('super-pass-1');
  await invitee.click('form.login-card button.btn-primary');
  await invitee.waitForFunction(() => location.pathname === '/floor');
  const me = await invitee.evaluate(async () => (await fetch('/api/me')).json());
  assert.equal(me.role, 'SUPERVISOR');

  // The link is used up; the owner sees who used it.
  const again = await (await fetch(`${BASE}/api/join/${url.split('/join/')[1]}`)).json();
  assert.match(again.error, /already been used/);
  await owner.reload({ waitUntil: 'domcontentloaded' });
  await owner.waitForFunction(() => [...document.querySelectorAll('table tbody tr')].some((r) => /lakshmi/.test(r.textContent)));
});
