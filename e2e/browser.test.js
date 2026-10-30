// End-to-end: real backend (temp database) serving the built React app, driven by Chrome.
//   npm run build         (in /frontend, once)
//   npm test              (here)   – set CHROME_PATH if Chrome isn't in the usual place
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const GW = { 'content-type': 'application/json', 'x-gateway-token': 'e2e-gateway-token-0123456789', 'x-gateway-id': 'e2e-pi' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-e2e-'));
const DB = path.join(tmp, 'e2e.db');

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));

let server;
let browser;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'frontend/dist/index.html')), 'build the frontend first: npm --prefix frontend run build');
  assert.ok(CHROME, 'Chrome not found – set CHROME_PATH');
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
    cwd: path.join(ROOT, 'backend'),
    env: {
      ...process.env, PORT: String(PORT), DB_PATH: DB, UPLOADS_DIR: path.join(tmp, 'uploads'), SEED_DEMO: 'true', NOTIFY_PROVIDER: 'mock',
      GATEWAY_TOKEN: GW['x-gateway-token'], JWT_SECRET: 'e2e-jwt-secret-0123456789-0123456789', NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      /* not up yet */
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

async function sendEvent(ev) {
  const r = await fetch(`${BASE}/api/events`, { method: 'POST', headers: GW, body: JSON.stringify(ev) });
  assert.equal(r.status, 201);
  return (await r.json()).alerts[0];
}

async function newPage(viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.createBrowserContext(); // fresh cookies per user
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('fonts.g') && errors.push(m.text()));
  page.errors = errors;
  return page;
}

async function demoLogin(page, label) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.demo-btn');
  await clickText(page, '.demo-btn', label);
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
}

async function clickText(page, selector, text) {
  await page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t)), { timeout: 8000 }, selector, text);
  await page.evaluate((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t)).click(), selector, text);
}

const textOf = (page, sel) => page.$eval(sel, (e) => e.textContent);

describe('shopfloor flows in a real browser', () => {
  test('operator: red alert appears live within 5 s, 3-step script in Hindi, ticks resolve it', async () => {
    const page = await newPage({ width: 390, height: 844 });
    await demoLogin(page, 'हिन्दी');
    assert.equal(new URL(page.url()).pathname, '/floor');
    await page.waitForSelector('.floor-status');
    assert.match(await textOf(page, '.floor-status'), /सब ठीक है/);

    // Session cookie must be invisible to page scripts.
    assert.ok(!(await page.evaluate(() => document.cookie)).includes('sentinel_session'));

    await page.waitForFunction(() => document.querySelector('.live-chip.on'), { timeout: 5000 });
    const t0 = Date.now();
    const alert = await sendEvent({ eventTypeKey: 'USB_INSERT', machineIdentifier: 'PRESS_LINE_1_HMI', details: { port: 'USB2' } });
    await page.waitForSelector('.alert-card.sev-RED', { timeout: 5000 });
    const latency = Date.now() - t0;
    assert.ok(latency < 5000, `alert took ${latency} ms`);
    assert.match(await textOf(page, '.floor-status'), /खतरा/);

    await page.click('.alert-card.sev-RED');
    await page.waitForSelector('.drawer .step');
    assert.match(await textOf(page, '.drawer'), /आपको क्या दिख रहा है/);
    for (let i = 0; i < 3; i++) {
      await clickText(page, '.drawer .step button:not([disabled])', 'मैंने यह किया');
      await page.waitForFunction((n) => document.querySelectorAll('.drawer .step.done').length === n, {}, i + 1);
    }
    await page.waitForSelector('.ok-banner');

    const status = await page.evaluate(async (id) => (await (await fetch(`/api/alerts/${id}`)).json()).status, alert.id);
    assert.equal(status, 'RESOLVED');
    assert.deepEqual(page.errors, []);
  });

  test('engineer: edits a Marathi script; operators get the new wording', async () => {
    const page = await newPage();
    await demoLogin(page, 'Engineer');
    await page.goto(`${BASE}/templates`, { waitUntil: 'domcontentloaded' });
    await clickText(page, '.tpl-item', 'USB_INSERT');
    await clickText(page, '.tpl-form .lang-switch button', 'मराठी');
    const input = await page.waitForSelector('.tpl-form input[lang="mr"]');
    await input.click({ clickCount: 3 });
    await input.type('USB लावला – लगेच काढा');
    await clickText(page, '.tpl-form button', 'Save template');
    await page.waitForFunction(() => document.querySelector('.save-row .ok'));

    const op = await newPage();
    await demoLogin(op, 'मराठी');
    const t = await op.evaluate(async () => {
      const list = await (await fetch('/api/alert-templates')).json();
      return list.find((x) => x.eventTypeKey === 'USB_INSERT').localizations.mr.title;
    });
    assert.equal(t, 'USB लावला – लगेच काढा');
    assert.deepEqual(page.errors, []);
  });

  test('engineer: drill shows on the floor with a drill label and is scored', async () => {
    const eng = await newPage();
    await demoLogin(eng, 'Engineer');
    await eng.goto(`${BASE}/drills`, { waitUntil: 'domcontentloaded' });
    await clickText(eng, 'form.panel button', 'Start drill');
    await eng.waitForFunction(() => /is live/.test(document.querySelector('form.panel .ok')?.textContent || ''));

    const sup = await newPage();
    await demoLogin(sup, 'Supervisor');
    await sup.waitForSelector('.alert-card .pill.drill', { timeout: 5000 });
    await sup.click('.alert-card .pill.drill');
    await sup.waitForSelector('.drill-banner');
    await sup.click('.drawer .step button');
    await eng.waitForFunction(() => /\d+s/.test(document.querySelector('.timeline tbody tr td:nth-child(6)')?.textContent || ''), { timeout: 5000 });
  });

  test('owner: traffic light, WhatsApp preview and delivery status', async () => {
    const page = await newPage();
    await demoLogin(page, 'Owner');
    await page.waitForSelector('.owner-hero');
    assert.match(await textOf(page, '.owner-headline'), /Needs attention|Mostly OK|All OK/);
    await clickText(page, '.owner-hero button', 'WhatsApp');
    await page.waitForSelector('.wa-bubble');
    assert.match(await textOf(page, '.wa-bubble'), /daily summary/);
    await clickText(page, '.wa-foot button', 'Send');
    await page.waitForFunction(() => /SENT/.test(document.querySelector('.wa-foot .small')?.textContent || ''));
    await page.keyboard.press('Escape').catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => [...document.querySelectorAll('.delivery')].some((d) => /delivered/.test(d.textContent)));
  });

  test('account: change password, old password stops working', async () => {
    const page = await newPage();
    await demoLogin(page, 'Engineer');
    await page.click('.sidebar .user-card');
    await page.waitForSelector('.modal');
    const fields = await page.$$('.modal input[type="password"]');
    await fields[0].type('sentinel123');
    await fields[1].type('brand-new-pass-1');
    await fields[2].type('brand-new-pass-1');
    await page.click('.modal button.btn-primary');
    await page.waitForFunction(() => /Password changed/.test(document.querySelector('.modal')?.textContent || ''));
    const old = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'engineer', password: 'sentinel123' }) });
    assert.equal(old.status, 401);
    const fresh = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'engineer', password: 'brand-new-pass-1' }) });
    assert.equal(fresh.status, 200);
  });

  test('gateway offline banner and setup tabs', async () => {
    await fetch(`${BASE}/api/gateway/heartbeat`, { method: 'POST', headers: GW, body: JSON.stringify({ version: '1.0.0', monitors: ['network'] }) });
    const db = new DatabaseSync(DB);
    db.prepare("UPDATE gateways SET lastSeenAt = '2020-01-01T00:00:00.000Z' WHERE id = 'e2e-pi'").run();
    db.close();
    const page = await newPage();
    await demoLogin(page, 'Owner');
    await page.waitForSelector('.gw-banner', { timeout: 5000 });
    assert.match(await textOf(page, '.gw-banner'), /e2e-pi/);
    for (const tab of ['Users', 'Gateways', 'Notifications', 'Audit log']) {
      await page.goto(`${BASE}/setup`, { waitUntil: 'domcontentloaded' });
      await clickText(page, '.tabs button', tab);
      await sleep(300);
    }
    await page.waitForFunction(() => /login/i.test(document.querySelector('.timeline')?.textContent || ''));
    assert.deepEqual(page.errors, []);
  });
});
