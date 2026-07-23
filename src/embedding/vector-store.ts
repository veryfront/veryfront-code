import type {
  Embedding,
  EmbeddingCallOptions,
  SearchOptions,
  SearchResult,
  VectorStore,
  VectorStoreConfig,
} from "./types.ts";
import { cosineSimilarity } from "#veryfront/runtime/runtime-bridge.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import {
  assertPositiveInteger,
  validateEmbeddingCallOptions,
  validateEmbeddingTexts,
  validateEmbeddingVectors,
  validateVectorSearchOptions,
} from "./validation.ts";

interface VectorEntry {
  text: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const ABSOLUTE_MAX_ENTRIES = 100_000;

function cloneMetadata(metadata: Record<string, unknown>, detail: string): Record<string, unknown> {
  try {
    return structuredClone(metadata);
  } catch {
    throw INVALID_ARGUMENT.create({ detail });
  }
}

/**
 * Creates an in-memory vector store with integrated embedding and similarity search.
 *
 * Supports three search strategies:
 * - `"dense"` (default): cosine similarity ranking
 * - `"mmr"`: Maximum Marginal Relevance for diverse results
 * - `"hybrid"`: BM25 and dense fusion via Reciprocal Rank Fusion
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
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw INVALID_ARGUMENT.create({ detail: "Vector store config must be an object" });
  }
  const embedder: Embedding = config.embedder;
  if (
    typeof embedder !== "object" || embedder === null ||
    typeof embedder.embed !== "function" || typeof embedder.embedMany !== "function"
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Vector store embedder is invalid" });
  }
  const maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
  assertPositiveInteger(maxEntries, "maxEntries", ABSOLUTE_MAX_ENTRIES);
  const entries: VectorEntry[] = [];
  let generation = 0;
  let vectorDimension: number | undefined;

  return {
    async add(
      texts: string[],
      metadata?: Record<string, unknown>[],
      options?: EmbeddingCallOptions,
    ): Promise<void> {
      const signal = validateEmbeddingCallOptions(options);
      const embeddingOptions = options === undefined ? undefined : { signal };
      const inputs = validateEmbeddingTexts(texts);
      if (metadata !== undefined) {
        if (!Array.isArray(metadata) || metadata.length !== inputs.length) {
          throw INVALID_ARGUMENT.create({ detail: "Metadata count must match text count" });
        }
      }
      if (entries.length + inputs.length > maxEntries) {
        throw INVALID_ARGUMENT.create({ detail: "Vector store capacity exceeded" });
      }
      if (inputs.length === 0) return;

      const metadataSnapshot = metadata?.map((value, index) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          throw INVALID_ARGUMENT.create({
            detail: `Metadata entry ${index} must be an object`,
          });
        }
        return cloneMetadata(value, `Metadata entry ${index} must be structured-cloneable`);
      });
      const operationGeneration = generation;
      const embeddings = await embedder.embedMany(inputs, embeddingOptions);
      validateEmbeddingVectors(embeddings, inputs.length);
      const nextDimension = embeddings[0]!.length;
      if (operationGeneration !== generation) return;
      if (vectorDimension !== undefined && vectorDimension !== nextDimension) {
        throw INVALID_ARGUMENT.create({
          detail: "Embedding dimension must match existing vector-store entries",
        });
      }
      if (entries.length + inputs.length > maxEntries) {
        throw INVALID_ARGUMENT.create({ detail: "Vector store capacity exceeded" });
      }

      for (let i = 0; i < inputs.length; i++) {
        entries.push({
          text: inputs[i]!,
          vector: [...embeddings[i]!],
          metadata: metadataSnapshot?.[i],
        });
      }
      vectorDimension = nextDimension;
    },

    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      const resolvedOptions = validateVectorSearchOptions(options);
      if (typeof query === "string" && !query.trim()) return [];
      const queryText = validateEmbeddingTexts([query])[0]!;
      if (entries.length === 0) return [];

      const { topK, threshold, filter, strategy, lambda, signal } = resolvedOptions;

      // Filter entries by metadata
      const candidates = filter
        ? entries.filter((e) => matchesFilter(e.metadata, filter))
        : entries.slice();
      if (candidates.length === 0) return [];

      const queryEmbedding = await embedder.embed(queryText, { signal });
      validateEmbeddingVectors([queryEmbedding], 1);
      if (vectorDimension !== queryEmbedding.length) {
        throw INVALID_ARGUMENT.create({
          detail: "Query embedding dimension must match vector-store entries",
        });
      }

      let results: SearchResult[];

      switch (strategy) {
        case "mmr":
          results = searchMMR(queryEmbedding, candidates, topK, lambda);
          break;
        case "hybrid":
          results = searchHybrid(queryText, queryEmbedding, candidates, topK);
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
      generation++;
      entries.length = 0;
      vectorDimension = undefined;
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
    metadata: e.metadata
      ? cloneMetadata(e.metadata, "Stored metadata must be structured-cloneable")
      : undefined,
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
      let maxSim = -Infinity;
      for (const sv of selectedVectors) {
        const sim = cosineSimilarity(candidate.vector, sv);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = selected.length === 0
        ? relevance
        : lambda * relevance - (1 - lambda) * maxSim;
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
      metadata: winner.metadata
        ? cloneMetadata(winner.metadata, "Stored metadata must be structured-cloneable")
        : undefined,
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

  // Build rank maps from index to zero-based rank.
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
    return {
      text: e.text,
      score: rrfScore,
      metadata: e.metadata
        ? cloneMetadata(e.metadata, "Stored metadata must be structured-cloneable")
        : undefined,
    };
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
  const totalTokens = docTokens.reduce((sum, t) => sum + t.length, 0);
  const avgDl = totalTokens === 0 ? 1 : totalTokens / N;

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
  return text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

// --- Metadata filtering ---

function matchesFilter(
  metadata: Record<string, unknown> | undefined,
  filter: Record<string, unknown>,
): boolean {
  if (!metadata) return false;
  return Object.entries(filter).every(([key, value]) => metadata[key] === value);
}
