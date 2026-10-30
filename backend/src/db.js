import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phoneNumber TEXT,
  role TEXT NOT NULL CHECK (role IN ('OWNER','ENGINEER','SUPERVISOR','OPERATOR')),
  preferredLanguage TEXT NOT NULL DEFAULT 'en' CHECK (preferredLanguage IN ('en','hi','mr','ta')),
  hashedPassword TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  identifier TEXT NOT NULL UNIQUE,
  isActive INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS alert_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eventTypeKey TEXT NOT NULL UNIQUE,
  defaultSeverity TEXT NOT NULL CHECK (defaultSeverity IN ('GREEN','AMBER','RED')),
  iconName TEXT NOT NULL,
  ownerFollowUp TEXT,
  createdByUserId INTEGER REFERENCES users(id),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS alert_template_localizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alertTemplateId INTEGER NOT NULL REFERENCES alert_templates(id) ON DELETE CASCADE,
  languageCode TEXT NOT NULL CHECK (languageCode IN ('en','hi','mr','ta')),
  title TEXT NOT NULL,
  whatYouSee TEXT NOT NULL,
  whatToDo TEXT NOT NULL,
  whomToCall TEXT NOT NULL,
  audioUrl TEXT,
  UNIQUE (alertTemplateId, languageCode)
);

CREATE TABLE IF NOT EXISTS alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machineId INTEGER NOT NULL REFERENCES machines(id),
  alertTemplateId INTEGER NOT NULL REFERENCES alert_templates(id),
  severity TEXT NOT NULL CHECK (severity IN ('GREEN','AMBER','RED')),
  timestamp TEXT NOT NULL,
  receivedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  isDrill INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  rawPayload TEXT,
  drillTeam TEXT,
  drillStartedByUserId INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON alert_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_dedup ON alert_events(alertTemplateId, machineId, severity, timestamp);

CREATE TABLE IF NOT EXISTS alert_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alertEventId INTEGER NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  userId INTEGER NOT NULL REFERENCES users(id),
  actionType TEXT NOT NULL CHECK (actionType IN ('ACKNOWLEDGE','STEP_COMPLETED','NOTE','RESOLVE')),
  stepNumber INTEGER CHECK (stepNumber BETWEEN 1 AND 3),
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alertEventId INTEGER REFERENCES alert_events(id) ON DELETE SET NULL,
  userId INTEGER REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('DAILY_SUMMARY','RED_ALERT')),
  channel TEXT NOT NULL CHECK (channel IN ('WHATSAPP','SMS')),
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SENT','FAILED')),
  message TEXT NOT NULL,
  error TEXT,
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

/** Run fn inside a transaction; rolls back on throw. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const nowIso = () => new Date().toISOString();
