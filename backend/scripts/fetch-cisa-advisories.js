#!/usr/bin/env node
// Download CISA ICS advisories (CSAF 2.0 JSON) from CISA's official repository
// github.com/cisagov/CSAF into docs/advisories/cisa/, keeping only the ones that
// mention your equipment vendors. Re-index afterwards (npm run kb:index).
//
//   node scripts/fetch-cisa-advisories.js --match "Siemens|Schneider|Rockwell" --limit 40
//   node scripts/fetch-cisa-advisories.js --since 2025 --scan 300
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/cisagov/CSAF/develop/csaf_files/OT/white';
const here = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []),
);
const match = args.match ? new RegExp(args.match, 'i') : null;
const limit = Number(args.limit || 25);
const scan = Number(args.scan || 200);
const since = Number(args.since || 0);
const out = path.resolve(args.out || path.join(here, '..', '..', 'docs', 'advisories', 'cisa'));

const index = (await (await fetch(`${BASE}/index.txt`)).text()).split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.json'));
const candidates = index.filter((p) => !since || Number(p.split('/')[0]) >= since).slice(0, scan);
fs.mkdirSync(out, { recursive: true });

let kept = 0;
let scanned = 0;
for (const rel of candidates) {
  if (kept >= limit) break;
  scanned++;
  const res = await fetch(`${BASE}/${rel}`);
  if (!res.ok) continue;
  const text = await res.text();
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    continue;
  }
  const haystack = `${doc.document?.title || ''} ${JSON.stringify(doc.product_tree || {})}`;
  if (match && !match.test(haystack)) continue;
  fs.writeFileSync(path.join(out, path.basename(rel)), text);
  kept++;
  console.log(`✓ ${doc.document?.tracking?.id}  ${doc.document?.title}`);
}
console.log(`\nSaved ${kept} advisories to ${path.relative(process.cwd(), out)} (scanned ${scanned}). Re-index: npm run kb:index`);
