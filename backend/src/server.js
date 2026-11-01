import cron from 'node-cron';
import { createApp } from './app.js';
import { assertSafeConfig, config } from './config.js';
import { seed } from './seed.js';
import { processQueue, sendDailySummary } from './services/notify.js';
import { runWatchdog } from './services/watchdog.js';
import { syncKnowledgeBase } from './ai/knowledge.js';
import { aiStatus } from './ai/triage.js'; // also subscribes auto-triage to new red alerts

assertSafeConfig();
seed();

const app = createApp();

// AI layer: keep the playbook index in step with docs/.
syncKnowledgeBase()
  .then((r) => console.log(`[kb] knowledge base ready (+${r.added} ~${r.updated} -${r.removed}${r.failed.length ? `, ${r.failed.length} failed` : ''})`))
  .catch((e) => console.error('[kb] indexing failed', e));
const ai = aiStatus();
console.log(ai.enabled ? `[ai] triage on (${ai.model}, effort ${ai.effort}, auto ${ai.autoTriage ? 'on' : 'off'})` : '[ai] triage off – set ANTHROPIC_API_KEY to enable');

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
