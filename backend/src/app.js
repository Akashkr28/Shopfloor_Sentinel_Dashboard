import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import './db.js';
import { api } from './routes/api.js';
import { webhooks } from './routes/webhooks.js';
import { corsOptions, securityHeaders } from './security.js';

/** The Express app without listening or timers, so tests can start it on any port. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.use(securityHeaders);
  app.use('/api', cors(corsOptions()));
  // Keep the raw bytes: WhatsApp webhook signatures are computed over them.
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

  app.use('/api/webhooks', webhooks);
  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '1h' }));

  // Serve the built React app (npm run build in /frontend) from the same port.
  if (fs.existsSync(config.frontendDist)) {
    app.use(express.static(config.frontendDist, { index: false, maxAge: '1h', setHeaders: (res, p) => p.endsWith('.html') && res.set('Cache-Control', 'no-cache') }));
    app.get(/^\/(?!api|uploads).*/, (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(config.frontendDist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
  });
  return app;
}
