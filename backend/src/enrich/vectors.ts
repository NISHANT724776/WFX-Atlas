// Text → vector for semantic matching. The built-in embedder runs offline with no model download: it maps words to
// WFX concepts through the terminology dictionary (documented aliases, abbreviations, synonym groups), adds word
// stems and character trigrams (so "deleet delivry" still lands near "delete delivery"), weights them by rarity and
// hashes them into a fixed-size vector compared by cosine similarity. It understands vocabulary, not meaning: a
// paraphrase that shares no words or documented aliases with the knowledge will not match. A neural embedding model
// can replace it behind the same interface (Embedder); kn_meta records which embedder built the stored vectors so a
// change re-embeds everything.
import { normalize, STOP, stem } from '../search/lexicon.ts';
import type { Concepts } from './terminology.ts';

export interface Embedder { name: string; dim: number; embed(text: string): Float32Array }

const DIM = 1024;
/** Question words that say nothing about the topic (kept out of the vector; the question TYPE is matched separately). */
const QWORDS = new Set(('how what why where when which who can could do does did i we you my our is are was be the a an to of in on for with it this that there please tell me show explain want need able unable cant cannot wont doesnt not get ' +
  'work works working mean meaning means example find option happens happen happened after before check steps step way does done use used using system wfx').split(' '));

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export interface Features { [feature: string]: number }

/** Weighted features of a text: concepts (strongest), stems, trigrams (weakest). */
export function features(text: string, concepts: Concepts): Features {
  const words = normalize(text).split(' ').filter(Boolean);
  const f: Features = {};
  const bump = (k: string, w: number) => { f[k] = (f[k] ?? 0) + w; };
  const used = new Array(words.length).fill(false);
  for (let len = concepts.maxLen; len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      if (used.slice(i, i + len).some(Boolean)) continue;
      const p = words.slice(i, i + len).join(' ');
      const keys = concepts.map.get(p);
      if (!keys) continue;
      for (const k of keys) bump(k, len > 1 ? 1.6 : 1.2);
      if (len > 1) for (let j = i; j < i + len; j++) used[j] = true;
    }
  }
  for (const w of words) {
    if (QWORDS.has(w) || STOP.has(w) || w.length < 2) continue;
    const s = stem(w);
    bump(`w:${s}`, 1);
    const padded = `#${s}#`;
    for (let i = 0; i + 3 <= padded.length; i++) bump(`t:${padded.slice(i, i + 3)}`, 0.18);
  }
  return f;
}

/** Corpus rarity of each feature, so "order" (everywhere) counts less than "desync". */
export function idfOf(docs: Features[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) for (const k of Object.keys(d)) df.set(k, (df.get(k) ?? 0) + 1);
  const n = docs.length || 1;
  return new Map([...df].map(([k, v]) => [k, Math.log(1 + n / v)]));
}

export function toVector(f: Features, idf: Map<string, number>, fallbackIdf: number): Float32Array {
  const v = new Float32Array(DIM);
  for (const [k, w] of Object.entries(f)) {
    const h = fnv(k);
    // rarity counts more than linearly: a topic word must outweigh words every unit shares ("sales order")
    v[h % DIM] += (h & 0x80000000 ? -1 : 1) * w * Math.pow(idf.get(k) ?? fallbackIdf, 1.5);
  }
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export const toBlob = (v: Float32Array) => new Uint8Array(v.buffer.slice(0));
export const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export const LOCAL_EMBEDDER = 'local-concept-hash-v1';
export const VECTOR_DIM = DIM;
