import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a prototype (schema 1) database upgrades in place without losing data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-migrate-'));
  const file = path.join(dir, 'old.db');
  // Build a database exactly as the prototype did: schema 1, user_version never set.
  process.env.DB_PATH = ':memory:';
  const { MIGRATIONS } = await import('../src/db.js');
  const old = new DatabaseSync(file);
  old.exec(MIGRATIONS[0]);
  old.exec(`INSERT INTO users (username, name, role, hashedPassword) VALUES ('owner', 'O', 'OWNER', 'x');
            INSERT INTO notification_logs (userId, type, channel, provider, status, message) VALUES (1, 'RED_ALERT', 'WHATSAPP', 'mock', 'SENT', 'old message');`);
  old.close();

  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', "await import('./src/db.js')"], {
    cwd: backend, env: { ...process.env, DB_PATH: file }, input: '', stdio: ['pipe', 'inherit', 'inherit'],
  });

  const db = new DatabaseSync(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  const n = db.prepare('SELECT * FROM notification_logs').get();
  assert.equal(n.message, 'old message');
  assert.equal(n.deliveryStatus, 'sent');
  assert.equal(db.prepare('SELECT isActive FROM users').get().isActive, 1);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'audit_logs'").get());
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
