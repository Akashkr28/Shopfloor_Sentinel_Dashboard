#!/usr/bin/env node
// Knowledge base CLI.
//   node scripts/kb.js index                 index docs/playbooks + docs/advisories (skips unchanged files)
//   node scripts/kb.js search "usb on hmi"   semantic search, shows what the agent would see
//   node scripts/kb.js status
const { syncKnowledgeBase, searchKnowledge, knowledgeStatus } = await import('../src/ai/knowledge.js');

const [cmd = 'status', ...rest] = process.argv.slice(2);
if (cmd === 'index') {
  const t = Date.now();
  const r = await syncKnowledgeBase();
  console.log(`indexed in ${((Date.now() - t) / 1000).toFixed(1)}s:`, r);
  console.log(await knowledgeStatus());
} else if (cmd === 'search') {
  for (const h of await searchKnowledge(rest.join(' '), { k: Number(process.env.K || 5) })) {
    console.log(`\n[${h.id}] ${h.score}  ${h.kind}  ${h.title}${h.heading ? ` › ${h.heading}` : ''}\n  ${h.text.slice(0, 220).replace(/\n/g, ' ')}…`);
  }
} else {
  console.log(await knowledgeStatus());
}
