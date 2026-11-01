import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

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

// ---------------------------------------------------------------------------
// Schema migrations, tracked with PRAGMA user_version. Each entry runs once,
// in order, inside a transaction. Never edit a shipped migration – add one.
// ---------------------------------------------------------------------------
export const MIGRATIONS = [
  // 1 – prototype schema
  `
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
  `,

  // 2 – hardening: account state, audit log, delivery tracking + retries, escalation, gateways
  `
  ALTER TABLE users ADD COLUMN isActive INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE users ADD COLUMN passwordChangedAt TEXT;

  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username TEXT,
    action TEXT NOT NULL,
    target TEXT,
    details TEXT,
    ip TEXT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_audit_ts ON audit_logs(timestamp);

  CREATE TABLE notification_logs_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alertEventId INTEGER REFERENCES alert_events(id) ON DELETE SET NULL,
    userId INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('DAILY_SUMMARY','RED_ALERT','ESCALATION','RESOLVED_UPDATE','GATEWAY_OFFLINE','TEST')),
    channel TEXT NOT NULL CHECK (channel IN ('WHATSAPP','SMS')),
    provider TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING','SENT','FAILED')),
    message TEXT NOT NULL,
    templateParams TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt TEXT,
    providerMessageId TEXT,
    deliveryStatus TEXT,
    deliveryUpdatedAt TEXT,
    escalationLevel INTEGER,
    gatewayId TEXT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  INSERT INTO notification_logs_v2 (id, alertEventId, userId, type, channel, provider, status, message, error, attempts, deliveryStatus, timestamp)
    SELECT id, alertEventId, userId, type, channel, provider, status, message, error, 1, lower(status), timestamp FROM notification_logs;
  DROP TABLE notification_logs;
  ALTER TABLE notification_logs_v2 RENAME TO notification_logs;
  CREATE INDEX idx_notify_queue ON notification_logs(status, nextAttemptAt);
  CREATE INDEX idx_notify_alert ON notification_logs(alertEventId, type);
  CREATE INDEX idx_notify_provider_id ON notification_logs(providerMessageId);

  CREATE TABLE gateways (
    id TEXT PRIMARY KEY,
    hostname TEXT,
    version TEXT,
    monitors TEXT,
    stats TEXT,
    ip TEXT,
    firstSeenAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    lastSeenAt TEXT NOT NULL,
    offlineNotifiedAt TEXT
  );
  `,
  // 3 – AI layer: triage results, playbook knowledge base, AI owner summaries
  `
  CREATE TABLE ai_triage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alertEventId INTEGER NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
    trigger TEXT NOT NULL CHECK (trigger IN ('AUTO','MANUAL','MCP')),
    requestedByUserId INTEGER REFERENCES users(id) ON DELETE SET NULL,
    model TEXT,
    result TEXT,
    sources TEXT,
    trace TEXT,
    usage TEXT,
    error TEXT,
    createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    startedAt TEXT,
    finishedAt TEXT
  );
  CREATE INDEX idx_triage_alert ON ai_triage(alertEventId, id);

  CREATE TABLE kb_documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('PLAYBOOK','ADVISORY','GUIDE')),
    source TEXT NOT NULL,
    url TEXT,
    hash TEXT NOT NULL,
    meta TEXT,
    chunkCount INTEGER NOT NULL DEFAULT 0,
    indexedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE kb_chunks (
    id TEXT PRIMARY KEY,
    documentId TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    heading TEXT,
    text TEXT NOT NULL,
    embedding BLOB
  );
  CREATE INDEX idx_kb_chunks_doc ON kb_chunks(documentId, seq);

  CREATE TABLE notification_logs_v3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alertEventId INTEGER REFERENCES alert_events(id) ON DELETE SET NULL,
    userId INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('DAILY_SUMMARY','RED_ALERT','ESCALATION','RESOLVED_UPDATE','GATEWAY_OFFLINE','TEST','AI_SUMMARY')),
    channel TEXT NOT NULL CHECK (channel IN ('WHATSAPP','SMS')),
    provider TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING','SENT','FAILED')),
    message TEXT NOT NULL,
    templateParams TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt TEXT,
    providerMessageId TEXT,
    deliveryStatus TEXT,
    deliveryUpdatedAt TEXT,
    escalationLevel INTEGER,
    gatewayId TEXT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  INSERT INTO notification_logs_v3 SELECT * FROM notification_logs;
  DROP TABLE notification_logs;
  ALTER TABLE notification_logs_v3 RENAME TO notification_logs;
  CREATE INDEX idx_notify_queue ON notification_logs(status, nextAttemptAt);
  CREATE INDEX idx_notify_alert ON notification_logs(alertEventId, type);
  CREATE INDEX idx_notify_provider_id ON notification_logs(providerMessageId);
  `,
];

function migrate() {
  let version = db.prepare('PRAGMA user_version').get().user_version;
  // Databases created by the prototype predate user_version but already have schema 1.
  if (version === 0 && db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) version = 1;
  for (let v = version; v < MIGRATIONS.length; v++) {
    tx(() => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

migrate();
