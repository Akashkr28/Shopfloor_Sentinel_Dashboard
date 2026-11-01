import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../config.js';
import { db, nowIso, tx } from '../db.js';
import { embed } from './embeddings.js';
import { vectorStore } from './vectorstore.js';

/*
 * Playbook / advisory knowledge base for RAG.
 *
 * Sources (config.kb.dirs, default docs/playbooks and docs/advisories):
 *   *.md / *.txt   incident-response guides, with optional front matter
 *                  (title, kind: PLAYBOOK|GUIDE|ADVISORY, url, applies_to)
 *   *.json         CISA ICS advisories in CSAF 2.0 format
 *                  (github.com/cisagov/CSAF – see scripts/fetch-cisa-advisories.js)
 *
 * Documents are split into ~900-character chunks that keep their section
 * heading, embedded, and stored. Re-indexing skips unchanged files (hash).
 */

const MAX_CHUNK = 900;

const slug = (s) => s.toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

// ---------------------------------------------------------------- parsing

function frontMatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

/** Split text into chunks of at most MAX_CHUNK characters, on paragraph then sentence boundaries. */
function splitText(text) {
  const out = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = '';
  };
  for (const para of text.split(/\n{2,}/)) {
    if ((cur + '\n\n' + para).length <= MAX_CHUNK) {
      cur = cur ? `${cur}\n\n${para}` : para;
      continue;
    }
    push();
    if (para.length <= MAX_CHUNK) {
      cur = para;
      continue;
    }
    for (const sentence of para.split(/(?<=[.!?])\s+/)) {
      if ((cur + ' ' + sentence).length > MAX_CHUNK) push();
      cur = cur ? `${cur} ${sentence}` : sentence.slice(0, MAX_CHUNK * 2);
    }
  }
  push();
  return out;
}

/** Markdown → sections by heading → chunks that remember their heading. */
export function parseMarkdown(raw, file) {
  const { meta, body } = frontMatter(raw.replace(/\r\n/g, '\n'));
  const titleLine = body.match(/^#\s+(.+)$/m);
  const title = meta.title || titleLine?.[1].trim() || path.basename(file);
  const sections = [];
  let heading = null;
  let buf = [];
  for (const line of body.split('\n')) {
    const h = line.match(/^#{1,4}\s+(.+)$/);
    if (h) {
      if (buf.join('').trim()) sections.push({ heading, text: buf.join('\n') });
      heading = h[1].trim() === title ? null : h[1].trim();
      buf = [];
    } else buf.push(line);
  }
  if (buf.join('').trim()) sections.push({ heading, text: buf.join('\n') });
  const chunks = sections.flatMap((s) => splitText(s.text).map((t) => ({ heading: s.heading, text: t })));
  const kind = ['PLAYBOOK', 'GUIDE', 'ADVISORY'].includes((meta.kind || '').toUpperCase()) ? meta.kind.toUpperCase() : 'PLAYBOOK';
  return { id: slug(meta.id || path.basename(file)), title, kind, url: meta.url || null, meta, chunks };
}

function csafProducts(tree) {
  const names = new Set();
  const walk = (branches, vendor) => {
    for (const b of branches || []) {
      const v = b.category === 'vendor' ? b.name : vendor;
      if (b.category === 'product_name' || b.category === 'product_family') names.add(v ? `${v} ${b.name}` : b.name);
      walk(b.branches, v);
    }
  };
  walk(tree?.branches);
  for (const p of tree?.full_product_names || []) names.add(p.name);
  return [...names].slice(0, 40);
}

/** CISA ICS advisory (CSAF 2.0 JSON) → document with summary, products, per-CVE and mitigation chunks. */
export function parseCsaf(json, file) {
  const d = json.document;
  if (!d?.tracking?.id || !d.title) throw new Error('not a CSAF document');
  const id = slug(d.tracking.id);
  const self = (d.references || []).find((r) => r.category === 'self' && /cisa\.gov/.test(r.url)) || (d.references || [])[0];
  const notes = (d.notes || []).filter((n) => n.text);
  const products = csafProducts(json.product_tree);
  const sections = [];
  const summary = notes.filter((n) => ['summary', 'general', 'description'].includes(n.category)).map((n) => `${n.title ? `${n.title}: ` : ''}${n.text}`).join('\n\n');
  sections.push({
    heading: 'Summary',
    text: `${d.title} (${d.tracking.id}, published by ${d.publisher?.name || 'CISA'}, ${(d.tracking.current_release_date || '').slice(0, 10)}).\n\n${summary}`.trim(),
  });
  if (products.length) sections.push({ heading: 'Affected products', text: products.join('; ') });
  const cvss = (v) => v.scores?.[0]?.cvss_v3 || v.scores?.[0]?.cvss_v4;
  const vulns = [...(json.vulnerabilities || [])].sort((a, b) => (cvss(b)?.baseScore || 0) - (cvss(a)?.baseScore || 0));
  // Some advisories (e.g. a bundled Linux subsystem) list hundreds of CVEs; detail the
  // worst ones and summarise the rest so one advisory doesn't flood every search.
  if (vulns.length > 15) {
    const bySev = {};
    for (const v of vulns) bySev[cvss(v)?.baseSeverity || 'UNSCORED'] = (bySev[cvss(v)?.baseSeverity || 'UNSCORED'] || 0) + 1;
    sections.push({
      heading: `Vulnerabilities (${vulns.length} CVEs)`,
      text: `${vulns.length} CVEs: ${Object.entries(bySev).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ')}. The 15 most severe are listed separately. Others: ${vulns.slice(15).map((v) => v.cve).filter(Boolean).join(', ')}`.slice(0, MAX_CHUNK * 2),
    });
  }
  for (const v of vulns.slice(0, 15)) {
    const score = cvss(v);
    const desc = (v.notes || []).map((n) => n.text).join(' ');
    const rem = (v.remediations || []).map((r) => `${r.category}: ${r.details}`).join('\n');
    sections.push({
      heading: `${v.cve || 'Vulnerability'}${v.title ? ` – ${v.title}` : ''}`,
      text: [score ? `CVSS ${score.baseScore} (${score.baseSeverity}).` : '', desc, rem ? `Remediation:\n${rem}` : ''].filter(Boolean).join('\n\n'),
    });
  }
  const other = notes.filter((n) => !['summary', 'general', 'description', 'legal_disclaimer'].includes(n.category));
  for (const n of other) sections.push({ heading: n.title || n.category, text: n.text });
  const chunks = sections.flatMap((s) => splitText(s.text).map((t) => ({ heading: s.heading, text: t })));
  return { id, title: `${d.tracking.id}: ${d.title}`, kind: 'ADVISORY', url: self?.url || null, meta: { trackingId: d.tracking.id, products }, chunks };
}

export function parseFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) return parseCsaf(JSON.parse(raw), file);
  return parseMarkdown(raw, file);
}

// ---------------------------------------------------------------- indexing

/** Store one parsed document (replacing any older version) and embed its chunks. */
export async function indexDocument(doc, source) {
  const hash = crypto.createHash('sha256').update(JSON.stringify([doc.title, doc.kind, doc.url, doc.chunks])).digest('hex');
  const existing = db.prepare('SELECT hash FROM kb_documents WHERE id = ?').get(doc.id);
  if (existing?.hash === hash) {
    const missing = db.prepare('SELECT COUNT(*) AS n FROM kb_chunks WHERE documentId = ? AND embedding IS NULL').get(doc.id).n;
    if (!missing || vectorStore().name !== 'local') return 'unchanged';
  }
  const vectors = await embed(doc.chunks.map((c) => `${doc.title}\n${c.heading || ''}\n${c.text}`));
  const rows = doc.chunks.map((c, i) => ({ id: `${doc.id}#${i + 1}`, documentId: doc.id, seq: i + 1, heading: c.heading, text: c.text, title: doc.title, kind: doc.kind, embedding: vectors[i] }));
  if (existing) await vectorStore().deleteDocument(doc.id);
  tx(() => {
    db.prepare('DELETE FROM kb_documents WHERE id = ?').run(doc.id);
    db.prepare('INSERT INTO kb_documents (id, title, kind, source, url, hash, meta, chunkCount, indexedAt) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(doc.id, doc.title, doc.kind, source, doc.url, hash, JSON.stringify(doc.meta), rows.length, nowIso());
    const ins = db.prepare('INSERT INTO kb_chunks (id, documentId, seq, heading, text) VALUES (?,?,?,?,?)');
    for (const r of rows) ins.run(r.id, r.documentId, r.seq, r.heading, r.text);
  });
  await vectorStore().upsert(rows);
  return existing ? 'updated' : 'added';
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(md|txt|json)$/i.test(e.name) && !/^readme\.md$/i.test(e.name) ? [p] : [];
  });
}

let syncing = null;

/** Index every file under the KB directories; drop documents whose file was deleted. */
export function syncKnowledgeBase({ dirs = config.kb.dirs } = {}) {
  syncing ||= (async () => {
    const result = { added: 0, updated: 0, unchanged: 0, removed: 0, failed: [] };
    const seen = new Set();
    for (const file of dirs.flatMap(walk)) {
      try {
        const doc = parseFile(file);
        seen.add(doc.id);
        result[await indexDocument(doc, path.relative(path.resolve(ROOT, '..'), file))]++;
      } catch (e) {
        result.failed.push({ file: path.basename(file), error: e.message });
      }
    }
    for (const d of db.prepare('SELECT id FROM kb_documents').all()) {
      if (!seen.has(d.id)) {
        await vectorStore().deleteDocument(d.id);
        db.prepare('DELETE FROM kb_documents WHERE id = ?').run(d.id);
        result.removed++;
      }
    }
    return result;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

// ---------------------------------------------------------------- search

/**
 * Semantic search. Returns the best chunks with their document title, kind
 * and URL so the agent (and the UI) can cite them.
 */
export async function searchKnowledge(query, { k = 5, kind } = {}) {
  const [vector] = await embed([query]);
  const hits = await vectorStore().query(vector, Math.max(k * 4, 20));
  const get = db.prepare(
    `SELECT c.id, c.documentId, c.seq, c.heading, c.text, d.title, d.kind, d.url
     FROM kb_chunks c JOIN kb_documents d ON d.id = c.documentId WHERE c.id = ?`,
  );
  const out = [];
  for (const h of hits) {
    const row = get.get(h.id);
    if (!row || (kind && row.kind !== kind)) continue;
    out.push({ ...row, score: Math.round(h.score * 1000) / 1000 });
    if (out.length >= k) break;
  }
  return out;
}

export async function knowledgeStatus() {
  const docs = db.prepare('SELECT kind, COUNT(*) AS n, SUM(chunkCount) AS chunks FROM kb_documents GROUP BY kind').all();
  return {
    store: vectorStore().name,
    embedder: config.kb.embeddings === 'hash' ? 'hash' : `local:${config.kb.embeddingModel}`,
    documents: Object.fromEntries(docs.map((d) => [d.kind, d.n])),
    chunks: docs.reduce((s, d) => s + (d.chunks || 0), 0),
  };
}

export function listDocuments() {
  return db.prepare('SELECT id, title, kind, source, url, chunkCount, indexedAt FROM kb_documents ORDER BY kind, title').all();
}

export function getChunk(id) {
  return db.prepare('SELECT c.*, d.title, d.kind, d.url FROM kb_chunks c JOIN kb_documents d ON d.id = c.documentId WHERE c.id = ?').get(id);
}
