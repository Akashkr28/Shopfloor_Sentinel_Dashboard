import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';

export const ROLES = ['OWNER', 'ENGINEER', 'SUPERVISOR', 'OPERATOR'];

export function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, preferredLanguage: user.preferredLanguage, name: user.name },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

export function publicUser(u) {
  if (!u) return null;
  const { hashedPassword, ...rest } = u;
  return rest;
}

/** Verifies the bearer JWT (or ?token= for EventSource, which can't set headers). */
export function authMiddleware(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    const claims = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(claims.sub));
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = publicUser(user);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

export const roleMiddleware = (...allowed) => (req, res, next) =>
  allowed.includes(req.user?.role) ? next() : res.status(403).json({ error: `Requires role: ${allowed.join(' / ')}` });

/** Gateway → backend auth: shared secret, never a user JWT. */
export function gatewayMiddleware(req, res, next) {
  if (req.get('x-gateway-token') === config.gatewayToken) return next();
  res.status(401).json({ error: 'Invalid gateway token' });
}
