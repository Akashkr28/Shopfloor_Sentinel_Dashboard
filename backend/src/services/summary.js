import { config } from '../config.js';
import { db } from '../db.js';

/** Milliseconds east of UTC for a timezone at a given instant. */
function tzOffsetMs(ts, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ts)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** [startIso, endIso) of the factory-local calendar day containing `when`. */
export function factoryDayRange(when = new Date(), timeZone = config.timezone) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone }).format(when); // YYYY-MM-DD
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const start = guess - tzOffsetMs(guess, timeZone);
  return { date: ymd, start: new Date(start).toISOString(), end: new Date(start + 86400000).toISOString() };
}

export const fmtTime = (iso) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/** Today's (non-drill) picture for the owner: traffic light, counts, top issues, open reds. */
export function buildDailySummary(when = new Date()) {
  const { date, start, end } = factoryDayRange(when);
  const rows = db
    .prepare(
      `SELECT e.id, e.severity, e.status, e.timestamp, m.name AS machineName, t.eventTypeKey, t.ownerFollowUp,
              COALESCE(l.title, t.eventTypeKey) AS title,
              (SELECT COUNT(*) FROM alert_actions a WHERE a.alertEventId = e.id) AS actionCount
       FROM alert_events e
       JOIN machines m ON m.id = e.machineId
       JOIN alert_templates t ON t.id = e.alertTemplateId
       LEFT JOIN alert_template_localizations l ON l.alertTemplateId = t.id AND l.languageCode = 'en'
       WHERE e.isDrill = 0 AND e.timestamp >= ? AND e.timestamp < ?
       ORDER BY e.timestamp`,
    )
    .all(start, end);

  const counts = { RED: 0, AMBER: 0, GREEN: 0 };
  const byType = new Map();
  for (const r of rows) {
    counts[r.severity]++;
    if (r.severity === 'GREEN') continue;
    const k = byType.get(r.eventTypeKey) || { eventTypeKey: r.eventTypeKey, title: r.title, count: 0, worst: 'AMBER', machines: new Set() };
    k.count++;
    if (r.severity === 'RED') k.worst = 'RED';
    k.machines.add(r.machineName);
    byType.set(r.eventTypeKey, k);
  }
  const topIssues = [...byType.values()]
    .sort((a, b) => (b.worst === 'RED') - (a.worst === 'RED') || b.count - a.count)
    .slice(0, 3)
    .map((k) => ({ ...k, machines: [...k.machines] }));

  const aiFor = db.prepare("SELECT result FROM ai_triage WHERE alertEventId = ? AND status = 'DONE' ORDER BY id DESC LIMIT 1");
  const ai = (id) => {
    const row = aiFor.get(id);
    if (!row) return null;
    const r = JSON.parse(row.result);
    return { headline: r.headline, ownerSummary: r.ownerSummary, confidence: r.confidence };
  };
  const reds = rows.filter((r) => r.severity === 'RED').map((r) => ({
    ai: ai(r.id),
    id: r.id, title: r.title, machineName: r.machineName, timestamp: r.timestamp, status: r.status,
    operatorActed: r.actionCount > 0, ownerFollowUp: r.ownerFollowUp,
  }));
  const unresolvedRed = reds.filter((r) => r.status !== 'RESOLVED');
  const openAmber = rows.filter((r) => r.severity === 'AMBER' && r.status !== 'RESOLVED').length;

  const light = unresolvedRed.length ? 'RED' : openAmber || reds.length ? 'AMBER' : 'GREEN';
  const nonGreen = rows.filter((r) => r.severity !== 'GREEN');
  const actedOn = nonGreen.filter((r) => r.actionCount > 0).length;

  const drills = db
    .prepare('SELECT COUNT(*) AS n FROM alert_events WHERE isDrill = 1 AND timestamp >= ? AND timestamp < ?')
    .get(start, end).n;

  const summary = { date, light, counts, total: rows.length, topIssues, reds, unresolvedRed, actedOn, needingAction: nonGreen.length, drills };
  return { ...summary, message: formatSummaryMessage(summary), templateParams: summaryTemplateParams(summary) };
}

const LIGHT_EMOJI = { RED: '🔴', AMBER: '🟠', GREEN: '🟢' };

/** Variables for an approved WhatsApp "daily summary" template ({{1}}…{{5}}). */
export function summaryTemplateParams(s) {
  return [
    s.date,
    VERDICT[s.light],
    `Red ${s.counts.RED}, Amber ${s.counts.AMBER}, Green ${s.counts.GREEN}; team responded to ${s.actedOn} of ${s.needingAction}`,
    s.topIssues.length ? s.topIssues.map((t) => `${t.title} x${t.count}`).join('; ') : 'None',
    s.unresolvedRed.length ? s.unresolvedRed.slice(0, 3).map((r) => `${fmtTime(r.timestamp)} ${r.title} – ${r.machineName}`).join('; ') : 'None',
  ];
}

const VERDICT = {
  GREEN: 'All OK today. No action needed.',
  AMBER: 'Mostly OK. Some warnings were handled or need a look.',
  RED: 'Needs your attention: red alerts are still open.',
};

export function formatSummaryMessage(s) {
  const verdict = VERDICT[s.light];
  const lines = [
    `${LIGHT_EMOJI[s.light]} Shopfloor Sentinel – daily summary ${s.date}`,
    verdict,
    '',
    `Alerts: 🔴 ${s.counts.RED}  🟠 ${s.counts.AMBER}  🟢 ${s.counts.GREEN}`,
    `Operator responded to ${s.actedOn} of ${s.needingAction} warnings.`,
  ];
  if (s.topIssues.length) {
    lines.push('', 'Top issues:');
    s.topIssues.forEach((t, i) => lines.push(`${i + 1}. ${t.title} ×${t.count} (${t.machines.join(', ')})`));
  }
  if (s.unresolvedRed.length) {
    lines.push('', 'Still open (red):');
    for (const r of s.unresolvedRed.slice(0, 5)) lines.push(`• ${fmtTime(r.timestamp)} ${r.title} – ${r.machineName}. ${r.ownerFollowUp || ''}`.trim());
  }
  if (s.drills) lines.push('', `Training drills run today: ${s.drills}`);
  return lines.join('\n');
}
