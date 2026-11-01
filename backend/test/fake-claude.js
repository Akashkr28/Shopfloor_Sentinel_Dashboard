// A stand-in for the Claude Messages API, so the triage agent runs through the
// real Anthropic SDK and tool runner without network or cost. A test sets a
// `script(body, n)` that returns the assistant reply for each request.
import http from 'node:http';

export const requests = [];
// Server-side message threads (beta message-threads-2026-08-12): the SDK tool runner sends only the
// new turn plus thread.previous_message_id, so rebuild the full history the way the API does.
const threads = new Map();
let seq = 0;
let script = () => ({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
let status = 200;

export function setScript(fn, httpStatus = 200) {
  script = fn;
  status = httpStatus;
  requests.length = 0;
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const prior = body.thread?.type === 'continue' ? threads.get(body.thread.previous_message_id) || [] : [];
    const full = { ...body, messages: [...prior, ...(body.messages || [])] };
    requests.push({ url: req.url, headers: req.headers, body, full });
    if (status !== 200) {
      res.writeHead(status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: status === 401 ? 'authentication_error' : 'api_error', message: 'fake failure' } }));
    }
    const reply = script(full, requests.length);
    const id = `msg_fake_${++seq}`;
    threads.set(id, [...full.messages, { role: 'assistant', content: reply.content || [] }]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id, type: 'message', role: 'assistant', model: body.model, stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: requests.length > 1 ? 900 : 0, cache_creation_input_tokens: requests.length > 1 ? 0 : 900 },
      ...reply,
    }));
  });
});
server.listen(0);
await new Promise((r) => server.once('listening', r));
export const url = `http://127.0.0.1:${server.address().port}`;
export const close = () => server.close();

let n = 0;
export const toolUse = (name, input) => ({ type: 'tool_use', id: `toolu_${++n}`, name, input });

/** Tool results from the last user turn, parsed, keyed by tool name of the matching tool_use. */
export function lastToolResults(body) {
  const msgs = body.messages;
  const assistant = msgs[msgs.length - 2];
  const user = msgs[msgs.length - 1];
  const names = Object.fromEntries((assistant?.content || []).filter((b) => b.type === 'tool_use').map((b) => [b.id, b.name]));
  const out = {};
  for (const b of Array.isArray(user?.content) ? user.content : []) {
    if (b.type !== 'tool_result') continue;
    const text = typeof b.content === 'string' ? b.content : b.content.map((c) => c.text).join('');
    try {
      out[names[b.tool_use_id]] = JSON.parse(text);
    } catch {
      out[names[b.tool_use_id]] = text;
    }
  }
  return out;
}
