import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';
import { COOKIE, readCookie } from './security.js';

export const ROLES = ['OWNER', 'ENGINEER', 'SUPERVISOR', 'OPERATOR'];

export function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, preferredLanguage: user.preferredLanguage, name: user.name },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

function maxAgeSeconds(token) {
  const { exp, iat } = jwt.decode(token);
  return exp - iat;
}

/** HttpOnly session cookie – the browser UI never sees the JWT. */
export function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/',
    maxAge: maxAgeSeconds(token) * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/' });
}

export function publicUser(u) {
  if (!u) return null;
  const { hashedPassword, ...rest } = u;
  return { ...rest, isActive: rest.isActive === undefined ? true : !!rest.isActive };
}

/**
 * Resolve the caller from the session cookie (browser) or a Bearer token
 * (scripts, tests). Returns { user } or { error }.
 */
export function resolveSession(req) {
  const header = req.get('authorization') || '';
  let token = null;
  if (header.startsWith('Bearer ')) {
    token = header.slice(7);
    req.authVia = 'bearer';
  } else {
    token = readCookie(req, COOKIE);
    req.authVia = 'cookie';
  }
  if (!token) return { error: 'Login required' };
  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret);
  } catch {
    return { error: 'Session expired, please log in again' };
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(claims.sub));
  if (!user || !user.isActive) return { error: 'Account is disabled' };
  // A password change (or reset) signs out every older session.
  if (user.passwordChangedAt && claims.iat * 1000 < new Date(user.passwordChangedAt).getTime() - 1000) {
    return { error: 'Password was changed, please log in again' };
  }
  return { user: publicUser(user) };
}

export function authMiddleware(req, res, next) {
  const { user, error } = resolveSession(req);
  if (!user) return res.status(401).json({ error });
  req.user = user;
  next();
}

export const roleMiddleware = (...allowed) => (req, res, next) =>
  allowed.includes(req.user?.role) ? next() : res.status(403).json({ error: `Requires role: ${allowed.join(' / ')}` });

/** Gateway → backend auth: shared secret (constant-time compare), never a user JWT. */
export function gatewayMiddleware(req, res, next) {
  const given = Buffer.from(String(req.get('x-gateway-token') || ''));
  const expected = Buffer.from(config.gatewayToken);
  if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) {
    req.gatewayId = String(req.get('x-gateway-id') || 'default').slice(0, 64);
    return next();
  }
  res.status(401).json({ error: 'Invalid gateway token' });
}
