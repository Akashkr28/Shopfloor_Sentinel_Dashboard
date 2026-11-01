import { config } from '../config.js';
import { db } from '../db.js';
import { cosine } from './embeddings.js';

/*
 * Vector stores behind one interface:
 *   upsert(chunks)          chunks: [{ id, documentId, embedding, text, ... }]
 *   deleteDocument(docId)
 *   query(vector, k)  →    [{ id, score }]
 * Chunk text and metadata always live in SQLite (kb_chunks) so citations can be
 * shown even when the vectors live in Chroma.
 */

class LocalStore {
  name = 'local';

  async upsert(chunks) {
    const stmt = db.prepare('UPDATE kb_chunks SET embedding = ? WHERE id = ?');
    for (const c of chunks) stmt.run(Buffer.from(new Float32Array(c.embedding).buffer), c.id);
  }

  async deleteDocument() {
    /* rows are removed with the kb_chunks rows themselves */
  }

  /** Brute-force cosine – a factory's playbooks and advisories are a few thousand chunks at most. */
  async query(vector, k) {
    const rows = db.prepare('SELECT id, embedding FROM kb_chunks WHERE embedding IS NOT NULL').all();
    return rows
      .map((r) => {
        const e = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
        return { id: r.id, score: cosine(vector, e) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async count() {
    return db.prepare('SELECT COUNT(*) AS n FROM kb_chunks WHERE embedding IS NOT NULL').get().n;
  }
}

class ChromaStore {
  name = 'chroma';
  collection = null;

  async col() {
    if (this.collection) return this.collection;
    const { ChromaClient } = await import('chromadb');
    const u = new URL(config.kb.chromaUrl);
    const client = new ChromaClient({ host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 8000)), ssl: u.protocol === 'https:' });
    // We supply our own vectors, so no embedding function on the collection.
    this.collection = await client.getOrCreateCollection({
      name: config.kb.chromaCollection,
      embeddingFunction: null,
      configuration: { hnsw: { space: 'cosine' } },
    });
    return this.collection;
  }

  async upsert(chunks) {
    if (!chunks.length) return;
    const col = await this.col();
    for (let i = 0; i < chunks.length; i += 100) {
      const part = chunks.slice(i, i + 100);
      await col.upsert({
        ids: part.map((c) => c.id),
        embeddings: part.map((c) => c.embedding),
        documents: part.map((c) => c.text),
        metadatas: part.map((c) => ({ documentId: c.documentId, title: c.title, kind: c.kind, heading: c.heading || '' })),
      });
    }
  }

  async deleteDocument(documentId) {
    const col = await this.col();
    await col.delete({ where: { documentId } });
  }

  async query(vector, k) {
    const col = await this.col();
    const r = await col.query({ queryEmbeddings: [vector], nResults: k });
    return (r.ids[0] || []).map((id, i) => ({ id, score: 1 - (r.distances?.[0]?.[i] ?? 1) }));
  }

  async count() {
    return (await this.col()).count();
  }
}

let store = null;
export function vectorStore() {
  store ||= config.kb.store === 'chroma' ? new ChromaStore() : new LocalStore();
  return store;
}

/** For tests. */
export function _resetVectorStore() {
  store = null;
}
