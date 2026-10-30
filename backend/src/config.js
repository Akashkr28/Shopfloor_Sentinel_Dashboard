import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

const env = process.env;
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

export const isProduction = env.NODE_ENV === 'production';
const DEV_JWT = 'dev-only-change-me';
const DEV_GATEWAY = 'dev-gateway-token';

export const config = {
  port: num(env.PORT, 4000),
  dbPath: env.DB_PATH || path.join(ROOT, 'data', 'sentinel.db'),
  uploadsDir: env.UPLOADS_DIR || path.join(ROOT, 'uploads'),
  frontendDist: env.FRONTEND_DIST || path.resolve(ROOT, '..', 'frontend', 'dist'),
  // Public base URL (https://sentinel.example.com) – needed for provider delivery webhooks.
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  trustProxy: env.TRUST_PROXY || false, // e.g. "loopback" or "1" behind nginx/Caddy
  corsOrigin: env.CORS_ORIGIN || '', // only needed if the UI is served from another origin
  seedDemoData: bool(env.SEED_DEMO, !isProduction),

  jwtSecret: env.JWT_SECRET || DEV_JWT,
  jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
  cookieSecure: bool(env.COOKIE_SECURE, isProduction),

  // Shared secret every gateway sends in the X-Gateway-Token header.
  gatewayToken: env.GATEWAY_TOKEN || DEV_GATEWAY,
  gatewayOfflineMinutes: num(env.GATEWAY_OFFLINE_MINUTES, 10),

  // Only the first red alert of a given type per machine inside this window pings the owner.
  redDedupMinutes: num(env.RED_DEDUP_MINUTES, 30),
  // Escalation: red alert nobody acknowledged / nobody resolved.
  escalateUnackMinutes: num(env.ESCALATE_UNACK_MINUTES, 10),
  escalateUnresolvedMinutes: num(env.ESCALATE_UNRESOLVED_MINUTES, 60),
  notifyResolved: bool(env.NOTIFY_RESOLVED, true),

  dailySummaryCron: env.DAILY_SUMMARY_CRON || '0 20 * * *',
  timezone: env.TZ_NAME || 'Asia/Kolkata',

  // mock | twilio | whatsapp_cloud
  notifyProvider: env.NOTIFY_PROVIDER || 'mock',
  notifyChannel: (env.NOTIFY_CHANNEL || 'WHATSAPP').toUpperCase() === 'SMS' ? 'SMS' : 'WHATSAPP',
  notifyMaxAttempts: num(env.NOTIFY_MAX_ATTEMPTS, 4),
  // With Twilio, a WhatsApp message that keeps failing is re-sent as SMS.
  smsFallback: bool(env.SMS_FALLBACK, true),
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    from: env.TWILIO_FROM, // WhatsApp-enabled sender, e.g. +14155238886
    smsFrom: env.TWILIO_SMS_FROM || env.TWILIO_FROM,
    // Approved WhatsApp content templates (HX…), needed outside the 24h customer-service window.
    contentSids: {
      RED_ALERT: env.TWILIO_CONTENT_SID_RED_ALERT,
      DAILY_SUMMARY: env.TWILIO_CONTENT_SID_DAILY_SUMMARY,
      ESCALATION: env.TWILIO_CONTENT_SID_ESCALATION,
      RESOLVED_UPDATE: env.TWILIO_CONTENT_SID_RESOLVED_UPDATE,
      GATEWAY_OFFLINE: env.TWILIO_CONTENT_SID_GATEWAY_OFFLINE,
    },
  },
  whatsappCloud: {
    token: env.WHATSAPP_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    appSecret: env.WHATSAPP_APP_SECRET, // verifies webhook signatures
    verifyToken: env.WHATSAPP_VERIFY_TOKEN, // webhook subscription handshake
    apiVersion: env.WHATSAPP_API_VERSION || 'v20.0',
    templateLang: env.WHATSAPP_TEMPLATE_LANG || 'en',
    templates: {
      RED_ALERT: env.WHATSAPP_TEMPLATE_RED_ALERT,
      DAILY_SUMMARY: env.WHATSAPP_TEMPLATE_DAILY_SUMMARY,
      ESCALATION: env.WHATSAPP_TEMPLATE_ESCALATION,
      RESOLVED_UPDATE: env.WHATSAPP_TEMPLATE_RESOLVED_UPDATE,
      GATEWAY_OFFLINE: env.WHATSAPP_TEMPLATE_GATEWAY_OFFLINE,
    },
  },
};

/** Refuse to run a real deployment with the well-known development secrets. */
export function assertSafeConfig() {
  const problems = [];
  if (config.jwtSecret === DEV_JWT || config.jwtSecret.length < 32) problems.push('JWT_SECRET must be set to a random string of 32+ characters');
  if (config.gatewayToken === DEV_GATEWAY || config.gatewayToken.length < 24) problems.push('GATEWAY_TOKEN must be set to a random string of 24+ characters');
  if (!problems.length) return;
  if (isProduction) {
    console.error(`[config] refusing to start in production:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.warn(`[config] development secrets in use (fine for a demo, not for a factory):\n  - ${problems.join('\n  - ')}`);
}
