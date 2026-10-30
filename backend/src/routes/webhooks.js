import crypto from 'node:crypto';
import express from 'express';
import { config } from '../config.js';
import { updateDelivery } from '../services/notify.js';

// Delivery receipts from the messaging providers. No user session: each
// request is authenticated by the provider's signature instead.
export const webhooks = express.Router();

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** https://www.twilio.com/docs/usage/webhooks/webhooks-security */
export function twilioSignature(url, params, authToken) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

webhooks.post('/twilio', express.urlencoded({ extended: false, limit: '64kb' }), (req, res) => {
  const { authToken } = config.twilio;
  if (!authToken || !config.publicUrl) return res.status(503).send('Twilio webhook not configured (TWILIO_AUTH_TOKEN, PUBLIC_URL)');
  const expected = twilioSignature(`${config.publicUrl}${req.originalUrl}`, req.body || {}, authToken);
  if (!safeEqual(req.get('x-twilio-signature') || '', expected)) return res.status(403).send('Bad signature');
  const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;
  if (MessageSid && MessageStatus) updateDelivery(MessageSid, MessageStatus, ErrorCode ? `${ErrorCode} ${ErrorMessage || ''}`.trim() : null);
  res.type('text/xml').send('<Response/>');
});

// Meta's subscription handshake.
webhooks.get('/whatsapp', (req, res) => {
  const { verifyToken } = config.whatsappCloud;
  if (verifyToken && req.query['hub.mode'] === 'subscribe' && safeEqual(req.query['hub.verify_token'] || '', verifyToken)) {
    return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  }
  res.sendStatus(403);
});

webhooks.post('/whatsapp', (req, res) => {
  const { appSecret } = config.whatsappCloud;
  if (!appSecret) return res.status(503).send('WHATSAPP_APP_SECRET not configured');
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody || Buffer.alloc(0)).digest('hex');
  if (!safeEqual(req.get('x-hub-signature-256') || '', expected)) return res.sendStatus(403);
  for (const entry of req.body?.entry || []) {
    for (const change of entry.changes || []) {
      for (const st of change.value?.statuses || []) {
        const err = st.errors?.[0];
        updateDelivery(st.id, st.status, err ? `${err.code} ${err.title || ''}`.trim() : null);
      }
    }
  }
  res.sendStatus(200);
});
