#!/usr/bin/env node
/*
 * Shopfloor Sentinel MCP server (stdio).
 *
 * Exposes the Sentinel REST API – alerts, machines, drills, playbook search and
 * AI triage – as MCP tools for Claude Code, Claude Desktop or any MCP client.
 * It calls the API as a normal Sentinel user, so that user's role decides what
 * the tools may do, and every write appears in the audit log.
 *
 *   SENTINEL_URL=http://localhost:4000 SENTINEL_USERNAME=engineer SENTINEL_PASSWORD=... node src/mcp/server.js
 *
 * stdout carries the MCP protocol – log to stderr only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.SENTINEL_URL || 'http://localhost:4000').replace(/\/$/, '') + '/api';
let token = process.env.SENTINEL_TOKEN || null;

async function login() {
  const { SENTINEL_USERNAME: username, SENTINEL_PASSWORD: password } = process.env;
  if (!username || !password) throw new Error('Set SENTINEL_USERNAME and SENTINEL_PASSWORD (or SENTINEL_TOKEN) for the MCP server');
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sentinel login failed: ${body.error || res.status}`);
  token = body.token;
}

async function call(method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) await login();
    const res = await fetch(BASE + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'x-sentinel-client': 'mcp', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0 && process.env.SENTINEL_USERNAME) {
      token = null; // expired – log in again once
      continue;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }
  throw new Error('Not authorised');
}

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
const tool = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Sentinel: ${e.message}` }] };
  }
};

/** Compact alert for an LLM: English title, machine, details – not all four languages. */
function compactAlert(a) {
  const en = a.localizations?.en || {};
  return {
    id: a.id, time: a.timestamp, severity: a.severity, status: a.status, isDrill: a.isDrill,
    eventType: a.eventTypeKey, title: en.title, machine: a.machineName, machineIdentifier: a.machineIdentifier, location: a.machineLocation,
    stepsDone: a.stepsDone, details: a.rawPayload?.details, operatorAdvice: en.whatToDo,
    ...(a.actions ? { actions: a.actions.map((x) => ({ time: x.timestamp, by: x.userName, type: x.actionType, step: x.stepNumber, note: x.notes })) } : {}),
  };
}

const READ = { readOnlyHint: true, openWorldHint: false };
const server = new McpServer({ name: 'shopfloor-sentinel', version: '1.0.0' });

server.registerTool('list_alerts', {
  title: 'List alerts',
  description: 'List Sentinel security alerts, newest and most severe first. Filter by severity (RED/AMBER/GREEN), status (OPEN/ACKNOWLEDGED/RESOLVED), machine id, drills, and time window.',
  inputSchema: {
    severity: z.enum(['RED', 'AMBER', 'GREEN']).optional(),
    status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
    machine_id: z.number().int().optional().describe('Numeric machine id from list_machines'),
    include_drills: z.boolean().optional().describe('Default false: real events only'),
    since_hours: z.number().int().min(1).max(720).optional().describe('Only alerts from the last N hours (default 24)'),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: READ,
}, tool(async ({ severity, status, machine_id, include_drills, since_hours = 24, limit = 50 }) => {
  const q = new URLSearchParams({ limit: String(limit), since: new Date(Date.now() - since_hours * 3600000).toISOString() });
  if (severity) q.set('severity', severity);
  if (status) q.set('status', status);
  if (machine_id) q.set('machineId', String(machine_id));
  if (!include_drills) q.set('isDrill', 'false');
  return (await call('GET', `/alerts?${q}`)).map(compactAlert);
}));

server.registerTool('get_alert', {
  title: 'Get alert',
  description: 'Full details of one alert, including gateway details (IPs, protocol, counts) and the steps operators have completed.',
  inputSchema: { alert_id: z.number().int() },
  annotations: READ,
}, tool(async ({ alert_id }) => compactAlert(await call('GET', `/alerts/${alert_id}`))));

server.registerTool('add_alert_note', {
  title: 'Add note to alert',
  description: 'Attach a note to an alert (visible in its activity log). Requires a supervisor, engineer or owner account.',
  inputSchema: { alert_id: z.number().int(), note: z.string().min(1).max(1000) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, tool(async ({ alert_id, note }) => {
  const a = await call('POST', `/alerts/${alert_id}/actions`, { actionType: 'NOTE', notes: note });
  return { saved: true, alert: compactAlert(a) };
}));

server.registerTool('list_machines', {
  title: 'List machines',
  description: 'Machines and zones known to Sentinel with their gateway identifier and open red/amber alert counts.',
  inputSchema: {},
  annotations: READ,
}, tool(async () => (await call('GET', '/machines')).map((m) => ({
  id: m.id, name: m.name, location: m.location, identifier: m.identifier, active: !!m.isActive, openRed: m.openRed, openAmber: m.openAmber,
}))));

server.registerTool('list_drills', {
  title: 'List drills',
  description: 'Recent practice drills with response time, time to step 1, steps missed and training notes.',
  inputSchema: {},
  annotations: READ,
}, tool(async () => call('GET', '/drills')));

server.registerTool('start_drill', {
  title: 'Start a drill',
  description: 'Start a practice alert on the operator screens (labelled DRILL; owners are not messaged). Needs a supervisor or engineer account. Get machine ids from list_machines and template ids from list_alert_types.',
  inputSchema: { machine_id: z.number().int(), alert_template_id: z.number().int(), team: z.string().max(120).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, tool(async ({ machine_id, alert_template_id, team }) => compactAlert(await call('POST', '/drill/start', { machineId: machine_id, alertTemplateId: alert_template_id, team }))));

server.registerTool('list_alert_types', {
  title: 'List alert types',
  description: 'Alert templates (event types) with default severity and English title.',
  inputSchema: {},
  annotations: READ,
}, tool(async () => (await call('GET', '/alert-templates')).map((t) => ({ id: t.id, eventType: t.eventTypeKey, severity: t.defaultSeverity, title: t.localizations?.en?.title }))));

server.registerTool('search_playbooks', {
  title: 'Search playbooks and advisories',
  description: "Semantic search over the factory's incident-response playbooks and CISA ICS advisories. Returns passages with ids, titles and URLs to cite.",
  inputSchema: { query: z.string().min(2).max(500), kind: z.enum(['PLAYBOOK', 'ADVISORY', 'GUIDE']).optional(), k: z.number().int().min(1).max(20).optional() },
  annotations: READ,
}, tool(async ({ query, kind, k = 5 }) => call('GET', `/kb/search?${new URLSearchParams({ q: query, k: String(k), ...(kind ? { kind } : {}) })}`)));

function triageView(t) {
  if (!t) return { status: 'NONE' };
  return { status: t.status, model: t.model, finishedAt: t.finishedAt, error: t.error, ...(t.result ? { triage: t.result, sources: t.sources } : {}) };
}

server.registerTool('triage_alert', {
  title: 'AI-triage an alert',
  description: "Run Sentinel's triage agent on an alert: it gathers related events, writes a plain-language owner summary and cited next steps. Waits up to wait_seconds for the result (default 120). Needs an engineer or owner account and ANTHROPIC_API_KEY on the Sentinel server.",
  inputSchema: { alert_id: z.number().int(), wait_seconds: z.number().int().min(0).max(600).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, tool(async ({ alert_id, wait_seconds = 120 }) => {
  await call('POST', `/alerts/${alert_id}/triage`);
  const end = Date.now() + wait_seconds * 1000;
  for (;;) {
    const { triage } = await call('GET', `/alerts/${alert_id}/triage`);
    if (!triage || ['DONE', 'FAILED'].includes(triage.status) || Date.now() > end) return triageView(triage);
    await new Promise((r) => setTimeout(r, 2000));
  }
}));

server.registerTool('get_triage', {
  title: 'Get latest triage',
  description: 'The latest AI triage of an alert (status, owner summary, next steps, cited sources), without starting a new one.',
  inputSchema: { alert_id: z.number().int() },
  annotations: READ,
}, tool(async ({ alert_id }) => triageView((await call('GET', `/alerts/${alert_id}/triage`)).triage)));

server.registerTool('daily_summary', {
  title: "Today's summary",
  description: "Today's traffic light (RED/AMBER/GREEN), alert counts, top issues and unresolved red alerts – the same data as the owner's WhatsApp summary.",
  inputSchema: {},
  annotations: READ,
}, tool(async () => {
  const s = await call('GET', '/owner/daily-summary');
  return { date: s.date, light: s.light, counts: s.counts, topIssues: s.topIssues, unresolvedRed: s.unresolvedRed, drills: s.drills };
}));

await server.connect(new StdioServerTransport());
console.error(`[sentinel-mcp] ready – ${BASE}`);
