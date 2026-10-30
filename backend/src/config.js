import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

const env = process.env;

export const config = {
  port: Number(env.PORT || 4000),
  dbPath: env.DB_PATH || path.join(ROOT, 'data', 'sentinel.db'),
  uploadsDir: env.UPLOADS_DIR || path.join(ROOT, 'uploads'),
  frontendDist: env.FRONTEND_DIST || path.resolve(ROOT, '..', 'frontend', 'dist'),

  jwtSecret: env.JWT_SECRET || 'dev-only-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',

  // Shared secret the Python gateway sends in the X-Gateway-Token header.
  gatewayToken: env.GATEWAY_TOKEN || 'dev-gateway-token',

  // Only the first red alert of a given type per machine inside this window pings the owner.
  redDedupMinutes: Number(env.RED_DEDUP_MINUTES || 30),

  dailySummaryCron: env.DAILY_SUMMARY_CRON || '0 20 * * *',
  timezone: env.TZ_NAME || 'Asia/Kolkata',

  // mock | twilio | whatsapp_cloud
  notifyProvider: env.NOTIFY_PROVIDER || 'mock',
  notifyChannel: (env.NOTIFY_CHANNEL || 'WHATSAPP').toUpperCase(), // WHATSAPP | SMS
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    from: env.TWILIO_FROM, // e.g. +14155238886 (WhatsApp sandbox) or an SMS-capable number
  },
  whatsappCloud: {
    token: env.WHATSAPP_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  },
};

if (config.jwtSecret === 'dev-only-change-me' && env.NODE_ENV === 'production') {
  console.warn('[config] JWT_SECRET is not set – do not run like this in a real factory.');
}
