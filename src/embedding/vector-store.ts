import { cosineSimilarity } from "ai";
import type {
  Embedding,
  SearchOptions,
  SearchResult,
  VectorStore,
  VectorStoreConfig,
} from "./types.ts";

interface VectorEntry {
  text: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}

/**
 * Creates an in-memory vector store with integrated embedding and similarity search.
 *
 * Supports three search strategies:
 * - `"dense"` (default) — cosine similarity ranking
 * - `"mmr"` — Maximum Marginal Relevance for diverse results
 * - `"hybrid"` — BM25 + dense fusion via Reciprocal Rank Fusion
 *
 * @example
 * ```ts
 * const store = vectorStore({ embedder });
 * await store.add(["chunk 1", "chunk 2"]);
 *
 * // Basic search
 * const results = await store.search("query", { topK: 5 });
 *
 * // With threshold and metadata filtering
 * const filtered = await store.search("query", {
 *   topK: 10,
 *   threshold: 0.7,
 *   filter: { source: "upload" },
 * });
 *
 * // MMR for diverse results
 * const diverse = await store.search("query", { strategy: "mmr", lambda: 0.5 });
 *
 * // Hybrid search (BM25 + dense, fused with RRF)
 * const hybrid = await store.search("query", { strategy: "hybrid" });
 * ```
 */
export function vectorStore(config: VectorStoreConfig): VectorStore {
  const embedder: Embedding = config.embedder;
  const entries: VectorEntry[] = [];

  return {
    async add(texts: string[], metadata?: Record<string, unknown>[]): Promise<void> {
      const embeddings = await embedder.embedMany(texts);
      for (let i = 0; i < texts.length; i++) {
        entries.push({
          text: texts[i]!,
          vector: embeddings[i]!,
          metadata: metadata?.[i],
        });
      }
    },

    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      if (entries.length === 0) return [];

      const topK = options?.topK ?? 5;
      const threshold = options?.threshold;
      const filter = options?.filter;
      const strategy = options?.strategy ?? "dense";

      // Filter entries by metadata
      const candidates = filter
        ? entries.filter((e) => matchesFilter(e.metadata, filter))
        : entries;
      if (candidates.length === 0) return [];

      const queryEmbedding = await embedder.embed(query);

      let results: SearchResult[];

      switch (strategy) {
        case "mmr":
          results = searchMMR(queryEmbedding, candidates, topK, options?.lambda ?? 0.5);
          break;
        case "hybrid":
          results = searchHybrid(query, queryEmbedding, candidates, topK);
          break;
        default:
          results = searchDense(queryEmbedding, candidates, topK);
      }

      // Apply score threshold
      if (threshold !== undefined) {
        results = results.filter((r) => r.score >= threshold);
      }

      return results;
    },

    clear(): void {
      entries.length = 0;
    },

    get size(): number {
      return entries.length;
    },
  };
}

// --- Dense search (cosine similarity) ---

function searchDense(
  queryVector: number[],
  candidates: VectorEntry[],
  topK: number,
): SearchResult[] {
  const scored = candidates.map((e) => ({
    text: e.text,
    score: cosineSimilarity(queryVector, e.vector),
    metadata: e.metadata,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// --- MMR (Maximum Marginal Relevance) ---

function searchMMR(
  queryVector: number[],
  candidates: VectorEntry[],
  topK: number,
  lambda: number,
): SearchResult[] {
  // Score all candidates against query
  const scored = candidates.map((e, i) => ({
    index: i,
    text: e.text,
    vector: e.vector,
    relevance: cosineSimilarity(queryVector, e.vector),
    metadata: e.metadata,
  }));

  const selected: SearchResult[] = [];
  const selectedVectors: number[][] = [];
  const remaining = new Set(scored.map((_, i) => i));

  for (let k = 0; k < Math.min(topK, scored.length); k++) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (const i of remaining) {
      const candidate = scored[i]!;
      const relevance = candidate.relevance;

      // Max similarity to any already-selected document
      let maxSim = 0;
      for (const sv of selectedVectors) {
        const sim = cosineSimilarity(candidate.vector, sv);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    const winner = scored[bestIdx]!;
    remaining.delete(bestIdx);
    selectedVectors.push(winner.vector);
    selected.push({
      text: winner.text,
      score: winner.relevance, // return the actual relevance score, not MMR score
      metadata: winner.metadata,
    });
  }

  return selected;
}

// --- Hybrid search (BM25 + dense, fused with RRF) ---

const RRF_K = 60; // standard RRF constant
const BM25_K1 = 1.2;
const BM25_B = 0.75;

function searchHybrid(
  query: string,
  queryVector: number[],
  candidates: VectorEntry[],
  topK: number,
): SearchResult[] {
  // Dense ranking
  const denseScores = candidates.map((e, i) => ({
    index: i,
    score: cosineSimilarity(queryVector, e.vector),
  }));
  denseScores.sort((a, b) => b.score - a.score);

  // BM25 ranking
  const bm25Scores = computeBM25(query, candidates);
  bm25Scores.sort((a, b) => b.score - a.score);

  // Build rank maps (index → rank, 0-based)
  const denseRank = new Map<number, number>();
  for (let r = 0; r < denseScores.length; r++) {
    denseRank.set(denseScores[r]!.index, r);
  }

  const bm25Rank = new Map<number, number>();
  for (let r = 0; r < bm25Scores.length; r++) {
    bm25Rank.set(bm25Scores[r]!.index, r);
  }

  // Reciprocal Rank Fusion
  const fused = candidates.map((e, i) => {
    const dr = denseRank.get(i) ?? candidates.length;
    const br = bm25Rank.get(i) ?? candidates.length;
    const rrfScore = 1 / (RRF_K + dr) + 1 / (RRF_K + br);
    return { text: e.text, score: rrfScore, metadata: e.metadata };
  });

  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, topK);
}

function computeBM25(
  query: string,
  candidates: VectorEntry[],
): { index: number; score: number }[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) {
    return candidates.map((_, i) => ({ index: i, score: 0 }));
  }

  const N = candidates.length;
  const docTokens = candidates.map((e) => tokenize(e.text));
  const avgDl = docTokens.reduce((sum, t) => sum + t.length, 0) / N;

  // Document frequency per query term
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    if (df.has(term)) continue;
    let count = 0;
    for (const tokens of docTokens) {
      if (tokens.includes(term)) count++;
    }
    df.set(term, count);
  }

  return candidates.map((_, i) => {
    const tokens = docTokens[i]!;
    const dl = tokens.length;
    let score = 0;

    for (const term of queryTerms) {
      const n = df.get(term) ?? 0;
      const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
      const tf = tokens.filter((t) => t === term).length;
      score += idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgDl)));
    }

    return { index: i, score };
  });
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean);
}

// --- Metadata filtering ---

function matchesFilter(
  metadata: Record<string, unknown> | undefined,
  filter: Record<string, unknown>,
): boolean {
  if (!metadata) return false;
  return Object.entries(filter).every(([key, value]) => metadata[key] === value);
}
