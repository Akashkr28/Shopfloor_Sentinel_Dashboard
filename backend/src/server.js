import cron from 'node-cron';
import { createApp } from './app.js';
import { assertSafeConfig, config } from './config.js';
import { seed } from './seed.js';
import { processQueue, sendDailySummary } from './services/notify.js';
import { runWatchdog } from './services/watchdog.js';

assertSafeConfig();
seed();

const app = createApp();

cron.schedule(config.dailySummaryCron, () => {
  sendDailySummary().catch((e) => console.error('[cron] daily summary failed', e));
}, { timezone: config.timezone });

// Escalations, gateway-offline checks and notification retries.
setInterval(() => {
  runWatchdog().catch((e) => console.error('[watchdog]', e));
}, 30000).unref();
processQueue().catch(() => {}); // anything left PENDING from before a restart

const server = app.listen(config.port, () => {
  console.log(`Shopfloor Sentinel API on http://localhost:${config.port}  (notify: ${config.notifyProvider}, daily summary: "${config.dailySummaryCron}" ${config.timezone})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} – shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
