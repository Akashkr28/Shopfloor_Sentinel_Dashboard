import crypto from 'node:crypto';
import { config } from '../config.js';

/*
 * Text → vector. Two embedders, same 384-dimension output:
 *  - local: all-MiniLM-L6-v2 via transformers.js. Semantic, runs offline on
 *    a Raspberry Pi; the 23 MB model is downloaded once into data/models.
 *  - hash:  feature-hashed word unigrams + bigrams. No model, no download –
 *    lexical only. Used for tests and as an automatic fallback.
 */

export const DIMS = 384;

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

const tokens = (text) => text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || [];

export function hashEmbed(text) {
  const v = new Array(DIMS).fill(0);
  const t = tokens(text);
  const feats = [...t, ...t.slice(1).map((w, i) => `${t[i]}_${w}`)];
  for (const f of feats) {
    const h = crypto.createHash('md5').update(f).digest();
    const idx = h.readUInt32LE(0) % DIMS;
    v[idx] += h[4] & 1 ? 1 : -1;
  }
  return normalize(v);
}

let extractor = null;
let mode = null;

async function loadLocal() {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = config.kb.modelCache;
  return pipeline('feature-extraction', config.kb.embeddingModel, { dtype: 'q8' });
}

/** Which embedder is active ('local' or 'hash'); loads the model on first use. */
export async function embedderMode() {
  if (mode) return mode;
  if (config.kb.embeddings === 'hash') return (mode = 'hash');
  try {
    extractor = await loadLocal();
    mode = 'local';
  } catch (e) {
    console.warn(`[kb] local embedding model unavailable (${e.message}) – falling back to lexical hashing`);
    mode = 'hash';
  }
  return mode;
}

export async function embed(texts) {
  const m = await embedderMode();
  if (m === 'hash') return texts.map(hashEmbed);
  const out = [];
  for (let i = 0; i < texts.length; i += 16) {
    const t = await extractor(texts.slice(i, i + 16), { pooling: 'mean', normalize: true });
    out.push(...t.tolist());
  }
  return out;
}

export const cosine = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** For tests: force an embedder. */
export function _setEmbedderMode(m) {
  mode = m;
}
