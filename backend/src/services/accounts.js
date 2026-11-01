import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { db, nowIso, tx } from '../db.js';
import { password, PHONE_RE, str, USERNAME_RE, ValidationError } from '../security.js';

/*
 * Real accounts for one factory per installation.
 *
 * First run: nobody exists yet, so the first person to open the dashboard
 * creates the factory and the Owner account – but only with the one-time
 * setup code printed in the server log (or set as SETUP_CODE). On a public
 * server that stops a stranger who finds the URL first from taking over.
 *
 * After that, people join only through invite links. The invite carries the
 * role, so nobody can choose their own role. Links are random, single-use,
 * expire, and only their SHA-256 hash is stored.
 */

export const ROLES = ['OWNER', 'ENGINEER', 'SUPERVISOR', 'OPERATOR'];
const LANGS = ['en', 'hi', 'mr', 'ta'];

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// ---------------------------------------------------------------- settings

export function getSetting(key, fallback = null) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value, updatedAt) VALUES (?,?,?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
  ).run(key, String(value), nowIso());
}

export const factoryName = () => getSetting('factoryName', config.seedDemoData ? 'Demo Factory' : null);

// ---------------------------------------------------------------- first-run setup

export const needsSetup = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;

let generatedCode = null;
/** The one-time setup code: SETUP_CODE if set, otherwise generated once per server start. */
export function setupCode() {
  if (config.setupCode) return config.setupCode;
  // 12 characters from an unambiguous alphabet, shown as XXXX-XXXX-XXXX.
  generatedCode ||= Array.from(crypto.randomBytes(12), (b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('').replace(/(.{4})(?=.)/g, '$1-');
  return generatedCode;
}

const sameCode = (given) => {
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const a = Buffer.from(norm(given));
  const b = Buffer.from(norm(setupCode()));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function userFields(input) {
  const username = str(input.username, 'Username', { required: true, max: 32 })?.toLowerCase();
  if (!USERNAME_RE.test(username)) throw new ValidationError('Username: 3–32 characters, a–z 0–9 . _ -');
  const preferredLanguage = input.preferredLanguage || 'en';
  if (!LANGS.includes(preferredLanguage)) throw new ValidationError('Unsupported language');
  return {
    username,
    name: str(input.name, 'Name', { required: true, max: 80 }),
    phoneNumber: str(input.phoneNumber, 'Phone', { max: 16, pattern: PHONE_RE }),
    preferredLanguage,
    hashedPassword: bcrypt.hashSync(password(input.password), 10),
  };
}

function insertUser(f, role) {
  try {
    const id = Number(db.prepare('INSERT INTO users (username, name, phoneNumber, role, preferredLanguage, hashedPassword) VALUES (?,?,?,?,?,?)')
      .run(f.username, f.name, f.phoneNumber, role, f.preferredLanguage, f.hashedPassword).lastInsertRowid);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw fail('That username is taken – choose another', 409);
    throw e;
  }
}

/** Create the factory and its first Owner. Only possible while there are no users. */
export function completeSetup(input) {
  if (!needsSetup()) throw fail('This factory is already set up – sign in instead', 409);
  if (!sameCode(input.setupCode)) throw fail('Wrong setup code – copy it from the server log', 403);
  const factory = str(input.factoryName, 'Factory name', { required: true, max: 80 });
  const f = userFields(input);
  return tx(() => {
    if (!needsSetup()) throw fail('This factory is already set up – sign in instead', 409);
    setSetting('factoryName', factory);
    return insertUser(f, 'OWNER');
  });
}

// ---------------------------------------------------------------- invites

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/** Owners may invite anyone; engineers may invite anyone except owners. */
export function canInvite(actor, role) {
  if (!ROLES.includes(role)) return false;
  if (actor.role === 'OWNER') return true;
  return actor.role === 'ENGINEER' && role !== 'OWNER';
}

function inviteStatus(i, now = nowIso()) {
  if (i.revokedAt) return 'REVOKED';
  if (i.usedAt) return 'USED';
  if (i.expiresAt <= now) return 'EXPIRED';
  return 'PENDING';
}

export function createInvite(actor, input) {
  const role = input.role;
  if (!ROLES.includes(role)) throw new ValidationError('Invalid role');
  if (!canInvite(actor, role)) throw fail('Only an owner can invite another owner', 403);
  const preferredLanguage = input.preferredLanguage || 'en';
  if (!LANGS.includes(preferredLanguage)) throw new ValidationError('Unsupported language');
  const days = Math.min(Math.max(Number(input.expiresInDays) || 7, 1), 30);
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const id = Number(db.prepare(
    'INSERT INTO invites (tokenHash, role, name, phoneNumber, preferredLanguage, createdByUserId, expiresAt) VALUES (?,?,?,?,?,?,?)',
  ).run(hashToken(token), role, str(input.name, 'Name', { max: 80 }), str(input.phoneNumber, 'Phone', { max: 16, pattern: PHONE_RE }), preferredLanguage, actor.id, expiresAt).lastInsertRowid);
  return { ...getInvite(id), token };
}

export function getInvite(id) {
  const i = db.prepare('SELECT i.*, u.name AS createdByName, v.username AS usedByUsername FROM invites i LEFT JOIN users u ON u.id = i.createdByUserId LEFT JOIN users v ON v.id = i.usedByUserId WHERE i.id = ?').get(Number(id));
  if (!i) return null;
  const { tokenHash, ...rest } = i;
  return { ...rest, status: inviteStatus(i) };
}

export function listInvites() {
  return db.prepare('SELECT id FROM invites ORDER BY id DESC LIMIT 200').all().map((r) => getInvite(r.id));
}

export function revokeInvite(actor, id) {
  const i = getInvite(id);
  if (!i) throw fail('Invite not found', 404);
  if (!canInvite(actor, i.role)) throw fail('Only an owner can revoke an owner invite', 403);
  if (i.status !== 'PENDING') throw fail(`This invite is already ${i.status.toLowerCase()}`, 409);
  db.prepare('UPDATE invites SET revokedAt = ? WHERE id = ?').run(nowIso(), i.id);
  return getInvite(i.id);
}

function findValidInvite(token) {
  const i = db.prepare('SELECT * FROM invites WHERE tokenHash = ?').get(hashToken(token));
  if (!i) throw fail('This invite link is not valid – ask for a new one', 404);
  const status = inviteStatus(i);
  if (status !== 'PENDING') throw fail(`This invite link has ${{ USED: 'already been used', EXPIRED: 'expired', REVOKED: 'been cancelled' }[status]} – ask for a new one`, 410);
  return i;
}

/** What the join page shows before the person sets a password. */
export function lookupInvite(token) {
  const i = findValidInvite(token);
  return { role: i.role, name: i.name, phoneNumber: i.phoneNumber, preferredLanguage: i.preferredLanguage, expiresAt: i.expiresAt, factoryName: factoryName() };
}

/** Create the account with the invite's role (never the caller's choice) and use up the invite. */
export function acceptInvite(token, input) {
  const f = userFields(input);
  return tx(() => {
    const i = findValidInvite(token); // re-checked inside the transaction: a link can't be used twice
    const user = insertUser(f, i.role);
    db.prepare('UPDATE invites SET usedAt = ?, usedByUserId = ? WHERE id = ?').run(nowIso(), user.id, i.id);
    return { user, inviteId: i.id, invitedBy: i.createdByUserId };
  });
}
