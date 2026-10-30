import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { db, tx } from './db.js';
import * as data from './seedData.js';

function insertTemplate(t, createdByUserId = null) {
  const id = Number(
    db.prepare('INSERT INTO alert_templates (eventTypeKey, defaultSeverity, iconName, ownerFollowUp, createdByUserId) VALUES (?,?,?,?,?)')
      .run(t.eventTypeKey, t.defaultSeverity, t.iconName, t.ownerFollowUp, createdByUserId).lastInsertRowid,
  );
  const insLoc = db.prepare(
    'INSERT INTO alert_template_localizations (alertTemplateId, languageCode, title, whatYouSee, whatToDo, whomToCall) VALUES (?,?,?,?,?,?)',
  );
  for (const [lang, [title, see, todo, call]] of Object.entries(t.loc)) insLoc.run(id, lang, title, see, todo, call);
}

/** Built-in templates are product content: add any that are missing (never overwrite engineer edits). */
export function ensureTemplates() {
  const have = new Set(db.prepare('SELECT eventTypeKey FROM alert_templates').all().map((r) => r.eventTypeKey));
  const missing = data.templates.filter((t) => !have.has(t.eventTypeKey));
  if (missing.length) tx(() => missing.forEach((t) => insertTemplate(t)));
  return missing.length;
}

/**
 * First boot. Demo mode creates the demo users and machines (password
 * sentinel123). Production creates a single owner from INITIAL_OWNER_* env
 * vars; everything else is set up in the dashboard.
 */
export function seed({ reset = false } = {}) {
  if (reset) {
    db.exec(`DELETE FROM notification_logs; DELETE FROM audit_logs; DELETE FROM alert_actions; DELETE FROM alert_events;
             DELETE FROM alert_template_localizations; DELETE FROM alert_templates; DELETE FROM gateways;
             DELETE FROM machines; DELETE FROM users; DELETE FROM sqlite_sequence;`);
  }
  ensureTemplates();
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return false;

  const insUser = db.prepare(
    'INSERT INTO users (username, name, phoneNumber, role, preferredLanguage, hashedPassword) VALUES (?,?,?,?,?,?)',
  );

  if (!config.seedDemoData) {
    const pw = process.env.INITIAL_OWNER_PASSWORD;
    if (!pw || pw.length < 8) {
      console.warn('[seed] no users yet – set INITIAL_OWNER_PASSWORD (8+ chars) and restart to create the first owner account');
      return false;
    }
    insUser.run(
      (process.env.INITIAL_OWNER_USERNAME || 'owner').toLowerCase(),
      process.env.INITIAL_OWNER_NAME || 'Factory Owner',
      process.env.INITIAL_OWNER_PHONE || null,
      'OWNER',
      'en',
      bcrypt.hashSync(pw, 10),
    );
    console.log('[seed] first owner account created – log in and add machines and users');
    return true;
  }

  tx(() => {
    const hash = bcrypt.hashSync(data.DEMO_PASSWORD, 10);
    for (const u of data.users) insUser.run(u.username, u.name, u.phoneNumber, u.role, u.preferredLanguage, hash);
    const insMachine = db.prepare('INSERT INTO machines (name, location, identifier) VALUES (?,?,?)');
    for (const m of data.machines) insMachine.run(m.name, m.location, m.identifier);
  });
  console.log('[seed] demo users and machines created (password: sentinel123)');
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed({ reset: process.argv.includes('--reset') });
}
