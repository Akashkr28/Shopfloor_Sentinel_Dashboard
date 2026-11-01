import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import * as fake from './fake-claude.js';

// Point the real Anthropic SDK at the fake API before anything imports it.
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.ANTHROPIC_BASE_URL = fake.url;
process.env.AI_TRIAGE_AUTO = 'true';

const h = await import('./helpers.js');
const { db, event, login, req, close, base } = h;
const { syncKnowledgeBase, searchKnowledge, parseCsaf, parseMarkdown } = await import('../src/ai/knowledge.js');
const { verifyCitations } = await import('../src/ai/triage.js');

after(() => {
  fake.close();
  close();
});

const tokens = {};
const as = async (u) => (tokens[u] ||= await login(u));

async function waitTriage(alertId, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const t = db.prepare('SELECT * FROM ai_triage WHERE alertEventId = ? ORDER BY id DESC LIMIT 1').get(alertId);
    if (t && ['DONE', 'FAILED'].includes(t.status)) return { ...t, result: t.result && JSON.parse(t.result), sources: t.sources && JSON.parse(t.sources), trace: t.trace && JSON.parse(t.trace), usage: t.usage && JSON.parse(t.usage) };
    if (Date.now() > end) throw new Error(`triage for #${alertId} did not finish (${t?.status})`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** A model that investigates, searches the playbooks and submits a triage citing one real and one invented source. */
function goodScript(alertId) {
  return (body) => {
    const turn = body.messages.filter((m) => m.role === 'assistant').length;
    if (turn === 0) {
      return {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Looking at the alert.' },
          fake.toolUse('get_alert', { alert_id: alertId }),
          fake.toolUse('find_related_events', { alert_id: alertId, hours: 24 }),
          fake.toolUse('search_knowledge_base', { query: 'USB drive plugged into HMI removable media', kind: 'PLAYBOOK' }),
        ],
      };
    }
    if (turn === 1) {
      const r = fake.lastToolResults(body);
      const real = r.search_knowledge_base[0].id;
      return {
        stop_reason: 'tool_use',
        content: [fake.toolUse('submit_triage', {
          headline: 'USB drive plugged into Press Line 1 HMI',
          ownerSummary: 'A pen drive was plugged into the Press Line 1 screen. The operator removed it. Nothing else unusual so far.',
          whatHappened: `USB storage at ${r.get_alert.time} on ${r.get_alert.machine.identifier}.`,
          likelyCause: 'Staff copying files',
          confidence: 'medium',
          isLikelyBenign: false,
          relatedEventIds: r.find_related_events.events.map((e) => e.id).slice(0, 3),
          nextSteps: [
            { who: 'ENGINEER', action: 'Scan the drive on an offline PC', urgency: 'TODAY', sourceIds: [real, 'made-up-doc#9'] },
            { who: 'OWNER', action: 'Remind staff of the USB rule', urgency: 'THIS_WEEK', sourceIds: [] },
          ],
          sources: [{ id: real, why: 'USB response steps' }, { id: 'icsa-00-000-00#1', why: 'invented' }],
        })],
      };
    }
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Triage submitted.' }] };
  };
}

before(async () => {
  const r = await syncKnowledgeBase();
  assert.equal(r.failed.length, 0, JSON.stringify(r.failed));
});

describe('knowledge base', () => {
  test('indexes the playbooks and real CISA advisories', () => {
    const kinds = Object.fromEntries(db.prepare('SELECT kind, COUNT(*) AS n FROM kb_documents GROUP BY kind').all().map((r) => [r.kind, r.n]));
    assert.ok(kinds.PLAYBOOK >= 7 && kinds.GUIDE >= 1, JSON.stringify(kinds));
    assert.ok(kinds.ADVISORY >= 1, 'CISA advisories in docs/advisories/cisa');
  });

  test('search finds the right playbook', async () => {
    const hits = await searchKnowledge('USB pen drive plugged into the HMI', { k: 3 });
    assert.equal(hits[0].documentId, 'usb-removable-media');
    const plc = await searchKnowledge('Modbus write PLC program changed by unknown computer', { k: 3, kind: 'PLAYBOOK' });
    assert.equal(plc[0].documentId, 'plc-unauthorized-write');
    assert.ok(plc.every((x) => x.kind === 'PLAYBOOK'));
  });

  test('re-indexing skips unchanged documents', async () => {
    const r = await syncKnowledgeBase();
    assert.equal(r.added + r.updated, 0);
    assert.ok(r.unchanged >= 8);
  });

  test('markdown front matter and headings become cited sections', () => {
    const d = parseMarkdown('---\ntitle: T\nkind: advisory\nurl: https://x.test\n---\n# T\n\n## Step one\nDo a.\n\n## Step two\nDo b.', 'x.md');
    assert.equal(d.kind, 'ADVISORY');
    assert.equal(d.url, 'https://x.test');
    assert.deepEqual(d.chunks.map((c) => c.heading), ['Step one', 'Step two']);
  });

  test('CSAF advisories: summary, products, worst CVEs first, long CVE lists capped', () => {
    const dir = path.resolve(import.meta.dirname, '..', '..', 'docs', 'advisories', 'cisa');
    const file = fs.readdirSync(dir).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
    const doc = parseCsaf(JSON.parse(fs.readFileSync(file, 'utf8')), file);
    assert.match(doc.title, /^ICSA-/);
    assert.match(doc.url, /cisa\.gov/);
    assert.equal(doc.chunks[0].heading, 'Summary');
    assert.ok(new Set(doc.chunks.map((c) => c.heading).filter((x) => /^CVE-/.test(x || ''))).size <= 15);
    assert.throws(() => parseCsaf({ hello: 1 }, 'x.json'), /not a CSAF/);
  });
});

describe('triage agent', () => {
  test('investigates, cites only retrieved sources and messages the owner once', async () => {
    fake.setScript(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'idle' }] }));
    const before = await event({ eventTypeKey: 'NEW_DEVICE', machineIdentifier: 'PRESS_LINE_1_HMI', details: { mac: '3c:22:fb:00:00:01', ip: '192.168.10.77' } });
    const id = (await event({ eventTypeKey: 'ABNORMAL_TRAFFIC', machineIdentifier: 'CNC_CELL_3_PC', details: {} })).id + 1;
    fake.setScript(goodScript(id));
    const a = await event({ eventTypeKey: 'USB_INSERT', machineIdentifier: 'PRESS_LINE_1_HMI', details: { port: 'USB2_FRONT' } });
    assert.equal(a.id, id);
    const t = await waitTriage(a.id);
    assert.equal(t.status, 'DONE', t.error);
    assert.equal(t.trigger, 'AUTO');

    // Request shape: model, effort, refusal fallback, cached system prompt, strict submit tool, no forced tool_choice.
    const first = fake.requests[0];
    assert.equal(first.url, '/v1/messages');
    assert.equal(first.body.model, 'claude-opus-5-5');
    assert.equal(first.body.max_tokens, 16000);
    assert.deepEqual(first.body.output_config, { effort: 'high' });
    assert.equal(first.body.fallbacks, 'default');
    assert.match(first.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(first.body.system[0].cache_control.type, 'ephemeral');
    assert.equal(first.body.tool_choice, undefined);
    assert.equal(first.body.thinking, undefined);
    assert.equal(first.body.temperature, undefined);
    const submit = first.body.tools.find((x) => x.name === 'submit_triage');
    assert.equal(submit.strict, true);
    assert.equal(submit.input_schema.additionalProperties, false);
    assert.equal(fake.requests.length, 3);
    assert.deepEqual(first.body.thread, { type: 'create' });
    assert.equal(fake.requests[1].body.thread.type, 'continue');

    // Citations: the invented ones are dropped, the real one is resolved to its playbook.
    assert.deepEqual(t.result.droppedCitations.sort(), ['icsa-00-000-00#1', 'made-up-doc#9']);
    assert.equal(t.sources.length, 1);
    assert.equal(t.sources[0].kind, 'PLAYBOOK');
    assert.match(t.sources[0].title, /USB/);
    assert.deepEqual(t.result.nextSteps[0].sourceIds, [t.sources[0].id]);
    assert.ok(t.result.relatedEventIds.includes(before.id), 'same-machine event found');
    assert.deepEqual(t.trace.map((s) => s.tool).sort(), ['find_related_events', 'get_alert', 'search_knowledge_base', 'submit_triage']);
    assert.equal(t.usage.requests, 3);

    // The owner gets the plain-language summary on WhatsApp, once.
    await h.notify.processQueue();
    const msgs = db.prepare("SELECT * FROM notification_logs WHERE alertEventId = ? AND type = 'AI_SUMMARY'").all(a.id);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].message, /pen drive was plugged/);
    assert.match(msgs[0].message, /Based on: Playbook – USB/);

    fake.setScript(goodScript(a.id));
    await req('POST', `/alerts/${a.id}/triage`, { token: await as('engineer') });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await waitTriage(a.id)).trigger, 'MANUAL');
    await h.notify.processQueue();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notification_logs WHERE alertEventId = ? AND type = 'AI_SUMMARY'").get(a.id).n, 1, 're-run does not re-message');

    // The owner's daily summary carries the AI headline for this red alert.
    const s = await req('GET', '/owner/daily-summary', { token: await as('owner') });
    assert.equal(s.data.reds.find((r) => r.id === a.id).ai.headline, 'USB drive plugged into Press Line 1 HMI');
  });

  test('nudges once when the model stops without submitting', async () => {
    const a = await event({ eventTypeKey: 'PLC_WRITE', machineIdentifier: 'NUDGE_1', details: { sourceIp: '192.168.10.99' } });
    fake.setScript((body) => {
      const turn = body.messages.filter((m) => m.role === 'assistant').length;
      if (turn === 0) return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'It looks like a PLC write.' }] };
      if (turn === 1) {
        assert.match(JSON.stringify(body.messages.at(-1)), /call submit_triage/);
        return { stop_reason: 'tool_use', content: [fake.toolUse('submit_triage', {
          headline: 'PLC write from unknown host', ownerSummary: 'x', whatHappened: 'x', likelyCause: 'x', confidence: 'low',
          isLikelyBenign: false, relatedEventIds: [], nextSteps: [], sources: [],
        })] };
      }
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
    });
    await req('POST', `/alerts/${a.id}/triage`, { token: await as('engineer') });
    const t = await waitTriage(a.id);
    assert.equal(t.status, 'DONE', t.error);
    assert.equal(t.result.headline, 'PLC write from unknown host');
  });

  test('a refusal is recorded as failed with its category', async () => {
    fake.setScript(() => ({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' }, content: [] }));
    const a = await event({ eventTypeKey: 'SUSPICIOUS_SOFTWARE', machineIdentifier: 'REFUSE_1' });
    const t = await waitTriage(a.id);
    assert.equal(t.status, 'FAILED');
    assert.match(t.error, /declined.*cyber/);
  });

  test('API errors are reported, not thrown', async () => {
    fake.setScript(() => ({}), 401);
    const a = await event({ eventTypeKey: 'USB_INSERT', machineIdentifier: 'AUTHFAIL_1' });
    const t = await waitTriage(a.id);
    assert.equal(t.status, 'FAILED');
    assert.match(t.error, /API key was rejected/);
    fake.setScript(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }));
  });

  test('drills and amber alerts are not auto-triaged; repeats are deduplicated', async () => {
    const sup = await as('supervisor');
    const m = db.prepare("SELECT id FROM machines WHERE identifier = 'PRESS_LINE_2_HMI'").get();
    const tpl = db.prepare("SELECT id FROM alert_templates WHERE eventTypeKey = 'USB_INSERT'").get();
    const drill = await req('POST', '/drill/start', { token: sup, body: { machineId: m.id, alertTemplateId: tpl.id } });
    const amber = await event({ eventTypeKey: 'NEW_DEVICE', machineIdentifier: 'AMBER_1' });
    await new Promise((r) => setTimeout(r, 100));
    for (const id of [drill.data.id, amber.id]) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_triage WHERE alertEventId = ?').get(id).n, 0);
    // Same red alert on the same machine twice: only the first is triaged automatically.
    const rep1 = await event({ eventTypeKey: 'USB_INSERT', machineIdentifier: 'REPEAT_1' });
    const rep2 = await event({ eventTypeKey: 'USB_INSERT', machineIdentifier: 'REPEAT_1' });
    await waitTriage(rep1.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_triage WHERE alertEventId = ?').get(rep2.id).n, 0);
  });

  test('citation check keeps only retrieved chunks', () => {
    const retrieved = new Map([['a#1', { title: 'A', kind: 'PLAYBOOK', heading: null, url: null, text: 'text' }]]);
    const v = verifyCitations({ nextSteps: [{ sourceIds: ['a#1', 'b#2'] }], sources: [] }, retrieved);
    assert.deepEqual(v.result.nextSteps[0].sourceIds, ['a#1']);
    assert.deepEqual(v.droppedCitations, ['b#2']);
    assert.equal(v.sources[0].title, 'A');
  });
});

describe('AI API access', () => {
  test('roles: operators see nothing, supervisors read, managers run', async () => {
    const a = db.prepare("SELECT alertEventId AS id FROM ai_triage WHERE status = 'DONE' LIMIT 1").get();
    assert.equal((await req('GET', `/alerts/${a.id}/triage`, { token: await as('operator') })).status, 403);
    const sup = await req('GET', `/alerts/${a.id}/triage`, { token: await as('supervisor') });
    assert.equal(sup.status, 200);
    assert.equal(sup.data.triage.status, 'DONE');
    assert.equal((await req('POST', `/alerts/${a.id}/triage`, { token: await as('supervisor') })).status, 403);
    assert.equal((await req('GET', '/kb/search?q=usb', { token: await as('operator') })).status, 403);
    const s = await req('GET', '/ai/status', { token: await as('owner') });
    assert.equal(s.data.ai.enabled, true);
    assert.equal(s.data.kb.store, 'local');
  });

  test('knowledge-base endpoints', async () => {
    const eng = await as('engineer');
    const hits = await req('GET', `/kb/search?q=${encodeURIComponent('ransomware note on HMI screen')}&k=3`, { token: eng });
    assert.equal(hits.data[0].documentId, 'suspicious-software-ransomware');
    const chunk = await req('GET', `/kb/chunks/${encodeURIComponent(hits.data[0].id)}`, { token: eng });
    assert.equal(chunk.data.documentId, 'suspicious-software-ransomware');
    const docs = await req('GET', '/kb/documents', { token: eng });
    assert.ok(docs.data.length >= 9);
    const re = await req('POST', '/kb/reindex', { token: eng });
    assert.equal(re.status, 200);
    assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action = 'KB_REINDEXED'").get());
  });
});

describe('MCP server', () => {
  test('exposes alerts, machines, drills, playbooks and triage as tools', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--disable-warning=ExperimentalWarning', path.resolve(import.meta.dirname, '..', 'src', 'mcp', 'server.js')],
      env: { ...process.env, SENTINEL_URL: base.replace(/\/api$/, ''), SENTINEL_USERNAME: 'engineer', SENTINEL_PASSWORD: 'sentinel123' },
      stderr: 'ignore',
    });
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      assert.deepEqual(names, ['add_alert_note', 'daily_summary', 'get_alert', 'get_triage', 'list_alert_types', 'list_alerts', 'list_drills', 'list_machines', 'search_playbooks', 'start_drill', 'triage_alert']);
      const read = (r) => JSON.parse(r.content[0].text);

      const machines = read(await client.callTool({ name: 'list_machines', arguments: {} }));
      assert.ok(machines.some((m) => m.identifier === 'PRESS_LINE_1_HMI'));

      const reds = read(await client.callTool({ name: 'list_alerts', arguments: { severity: 'RED', limit: 5 } }));
      assert.ok(reds.length > 0 && reds.every((x) => x.severity === 'RED' && !x.isDrill));
      assert.equal(reds[0].title !== undefined, true);

      const pb = read(await client.callTool({ name: 'search_playbooks', arguments: { query: 'unknown remote desktop login', k: 2 } }));
      assert.equal(pb[0].documentId, 'unknown-remote-access');

      const drills = read(await client.callTool({ name: 'list_drills', arguments: {} }));
      assert.ok(Array.isArray(drills));

      const target = await event({ eventTypeKey: 'USB_INSERT', machineIdentifier: 'MCP_1' });
      await waitTriage(target.id); // auto-triage first
      fake.setScript(goodScript(target.id));
      const tri = read(await client.callTool({ name: 'triage_alert', arguments: { alert_id: target.id, wait_seconds: 20 } }));
      assert.equal(tri.status, 'DONE');
      assert.equal(tri.triage.headline, 'USB drive plugged into Press Line 1 HMI');
      assert.equal(db.prepare('SELECT trigger FROM ai_triage WHERE alertEventId = ? ORDER BY id DESC').get(target.id).trigger, 'MCP');

      const note = await client.callTool({ name: 'add_alert_note', arguments: { alert_id: target.id, note: 'Checked via MCP' } });
      assert.equal(read(note).saved, true);

      const missing = await client.callTool({ name: 'get_alert', arguments: { alert_id: 999999 } });
      assert.equal(missing.isError, true);
    } finally {
      await client.close();
    }
  });
});
