import { config } from './config.js';
import { db } from './db.js';

// ---------- Security headers ----------
export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
}

// ---------- Rate limiting (fixed window, in memory – one process on a Pi is enough) ----------
const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, 60000).unref();

/** Returns true if `key` is over `limit` hits per `windowMs`. Counts the hit. */
export function hit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  return b.count > limit ? Math.ceil((b.reset - now) / 1000) : 0;
}

export const rateLimit = ({ name, limit, windowMs, key = (req) => req.ip }) => (req, res, next) => {
  const retry = hit(`${name}:${key(req)}`, limit, windowMs);
  if (!retry) return next();
  res.set('Retry-After', String(retry)).status(429).json({ error: `Too many requests – try again in ${retry}s` });
};

export function resetRateLimits() {
  buckets.clear();
}

// ---------- Cookies & CSRF ----------
export const COOKIE = 'sentinel_session';

export function readCookie(req, name) {
  for (const part of (req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * Cookie-authenticated writes must carry X-Sentinel-Request. Browsers can't add
 * a custom header cross-site without a CORS preflight we never approve, so a
 * forged form or link from another site is rejected. Bearer-token clients
 * (scripts, tests) aren't exposed to CSRF and skip this.
 */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.authVia !== 'cookie') return next();
  if (req.get('x-sentinel-request') === '1') return next();
  res.status(403).json({ error: 'Missing X-Sentinel-Request header' });
}

// ---------- Audit log ----------
export function audit(req, action, target = null, details = null) {
  db.prepare('INSERT INTO audit_logs (userId, username, action, target, details, ip) VALUES (?,?,?,?,?,?)').run(
    req?.user?.id ?? null,
    req?.user?.username ?? req?.auditUsername ?? null,
    action,
    target == null ? null : String(target),
    details == null ? null : JSON.stringify(details),
    req?.ip ?? null,
  );
}

// ---------- Input validation ----------
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Trimmed string with a max length; `required` rejects empty. */
export function str(value, field, { max = 200, required = false, pattern } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw new ValidationError(`${field} must be text`);
  const s = String(value).trim();
  if (required && !s) throw new ValidationError(`${field} is required`);
  if (s.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  if (s && pattern && !pattern.test(s)) throw new ValidationError(`${field} is not valid`);
  return s || null;
}

export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
export const PHONE_RE = /^\+[1-9]\d{7,14}$/; // E.164
export const IDENTIFIER_RE = /^[A-Z0-9_.:-]{2,64}$/;

export function password(value, field = 'password') {
  if (typeof value !== 'string' || value.length < 8) throw new ValidationError(`${field} must be at least 8 characters`);
  if (value.length > 200) throw new ValidationError(`${field} is too long`);
  return value;
}

export const corsOptions = () => (config.corsOrigin ? { origin: config.corsOrigin.split(','), credentials: true } : { origin: false });
