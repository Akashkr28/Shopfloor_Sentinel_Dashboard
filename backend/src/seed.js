import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { db, tx } from './db.js';
import * as data from './seedData.js';

/** Seed demo data. With reset=true, wipes everything first. Safe to call on every boot. */
export function seed({ reset = false } = {}) {
  if (reset) {
    db.exec(`DELETE FROM notification_logs; DELETE FROM alert_actions; DELETE FROM alert_events;
             DELETE FROM alert_template_localizations; DELETE FROM alert_templates;
             DELETE FROM machines; DELETE FROM users; DELETE FROM sqlite_sequence;`);
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return false;

  tx(() => {
    const hash = bcrypt.hashSync(data.DEMO_PASSWORD, 10);
    const insUser = db.prepare(
      'INSERT INTO users (username, name, phoneNumber, role, preferredLanguage, hashedPassword) VALUES (?,?,?,?,?,?)',
    );
    let engineerId;
    for (const u of data.users) {
      const r = insUser.run(u.username, u.name, u.phoneNumber, u.role, u.preferredLanguage, hash);
      if (u.role === 'ENGINEER') engineerId = Number(r.lastInsertRowid);
    }

    const insMachine = db.prepare('INSERT INTO machines (name, location, identifier) VALUES (?,?,?)');
    for (const m of data.machines) insMachine.run(m.name, m.location, m.identifier);

    const insTpl = db.prepare(
      'INSERT INTO alert_templates (eventTypeKey, defaultSeverity, iconName, ownerFollowUp, createdByUserId) VALUES (?,?,?,?,?)',
    );
    const insLoc = db.prepare(
      'INSERT INTO alert_template_localizations (alertTemplateId, languageCode, title, whatYouSee, whatToDo, whomToCall) VALUES (?,?,?,?,?,?)',
    );
    for (const t of data.templates) {
      const id = Number(insTpl.run(t.eventTypeKey, t.defaultSeverity, t.iconName, t.ownerFollowUp, engineerId).lastInsertRowid);
      for (const [lang, [title, see, todo, call]] of Object.entries(t.loc)) insLoc.run(id, lang, title, see, todo, call);
    }
  });
  console.log('[seed] demo users, machines and templates created');
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed({ reset: process.argv.includes('--reset') });
}
