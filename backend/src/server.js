import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import './db.js';
import { api } from './routes/api.js';
import { seed } from './seed.js';
import { sendDailySummary } from './services/notify.js';

seed();

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use('/api', api);
app.use('/uploads', express.static(config.uploadsDir, { maxAge: '1h' }));

// Serve the built React app (npm run build in /frontend) from the same port.
if (fs.existsSync(config.frontendDist)) {
  app.use(express.static(config.frontendDist));
  app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(config.frontendDist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
});

cron.schedule(config.dailySummaryCron, () => {
  sendDailySummary().catch((e) => console.error('[cron] daily summary failed', e));
}, { timezone: config.timezone });

app.listen(config.port, () => {
  console.log(`Shopfloor Sentinel API on http://localhost:${config.port}  (notify: ${config.notifyProvider}, daily summary: "${config.dailySummaryCron}" ${config.timezone})`);
});
