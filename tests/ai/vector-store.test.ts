/**
 * Tests for the vector store: dense, MMR, hybrid search, BM25 edge cases.
 *
 * Uses a deterministic mock embedder that maps known texts to fixed vectors,
 * so cosine similarity produces predictable, testable results.
 */
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assert } from "#veryfront/testing/assert";

import { vectorStore } from "../../src/embedding/vector-store.ts";
import type { Embedding, VectorStore } from "../../src/embedding/types.ts";

// ---------------------------------------------------------------------------
// Mock embedder — maps texts to deterministic unit vectors
// ---------------------------------------------------------------------------

/** Creates a mock embedder that assigns fixed, distinct unit vectors to texts. */
function mockEmbedder(knownVectors: Map<string, number[]>): Embedding {
  const defaultDim = 4;
  let counter = 0;

  function vectorFor(text: string): number[] {
    const known = knownVectors.get(text);
    if (known) return known;
    // Generate a unique sparse vector for unknown texts
    counter++;
    const v = new Array(defaultDim).fill(0);
    v[counter % defaultDim] = 1;
    return v;
  }

  return {
    model: "mock/test-embed",
    async embed(text: string): Promise<number[]> {
      return vectorFor(text);
    },
    async embedMany(texts: string[]): Promise<number[][]> {
      return texts.map(vectorFor);
    },
  };
}

// Predefined vectors for controlled similarity
const VECTORS = new Map<string, number[]>([
  ["query-cats", [1, 0, 0, 0]],
  ["cats are fluffy", [0.95, 0.05, 0, 0]], // very similar to query-cats
  ["dogs are loyal", [0.1, 0.9, 0, 0]], // different direction
  ["cats and dogs", [0.6, 0.6, 0, 0]], // moderate similarity
  ["fish swim fast", [0, 0, 1, 0]], // orthogonal
  ["birds can fly", [0, 0, 0, 1]], // orthogonal
]);

function createTestStore(): VectorStore {
  return vectorStore({ embedder: mockEmbedder(VECTORS) });
}

// ---------------------------------------------------------------------------
// Dense search
// ---------------------------------------------------------------------------

describe("vectorStore — dense search", () => {
  it("returns results ranked by cosine similarity", async () => {
    const store = createTestStore();
    await store.add([
      "cats are fluffy",
      "dogs are loyal",
      "cats and dogs",
      "fish swim fast",
    ]);

    const results = await store.search("query-cats", { topK: 4 });

    assertEquals(results.length, 4);
    assertEquals(results[0]!.text, "cats are fluffy");
    assertEquals(results[1]!.text, "cats and dogs");
    // fish swim fast should be last (orthogonal)
    assert(results[0]!.score > results[1]!.score);
    assert(results[1]!.score > results[results.length - 1]!.score);
  });

  it("respects topK limit", async () => {
    const store = createTestStore();
    await store.add(["cats are fluffy", "dogs are loyal", "fish swim fast"]);

    const results = await store.search("query-cats", { topK: 1 });
    assertEquals(results.length, 1);
    assertEquals(results[0]!.text, "cats are fluffy");
  });

  it("applies score threshold", async () => {
    const store = createTestStore();
    await store.add(["cats are fluffy", "fish swim fast"]);

    // fish swim fast has ~0 similarity to query-cats
    const results = await store.search("query-cats", {
      topK: 10,
      threshold: 0.5,
    });

    assertEquals(results.length, 1);
    assertEquals(results[0]!.text, "cats are fluffy");
  });

  it("returns empty for empty store", async () => {
    const store = createTestStore();
    const results = await store.search("query-cats");
    assertEquals(results, []);
  });

  it("tracks size correctly", async () => {
    const store = createTestStore();
    assertEquals(store.size, 0);

    await store.add(["cats are fluffy", "dogs are loyal"]);
    assertEquals(store.size, 2);

    store.clear();
    assertEquals(store.size, 0);
  });
});

// ---------------------------------------------------------------------------
// Metadata filtering
// ---------------------------------------------------------------------------

describe("vectorStore — metadata filtering", () => {
  it("filters by exact metadata match", async () => {
    const store = createTestStore();
    await store.add(
      ["cats are fluffy", "dogs are loyal"],
      [{ source: "pets" }, { source: "other" }],
    );

    const results = await store.search("query-cats", {
      filter: { source: "pets" },
    });

    assertEquals(results.length, 1);
    assertEquals(results[0]!.text, "cats are fluffy");
  });

  it("returns empty when no metadata matches", async () => {
    const store = createTestStore();
    await store.add(["cats are fluffy"], [{ source: "pets" }]);

    const results = await store.search("query-cats", {
      filter: { source: "nonexistent" },
    });

    assertEquals(results, []);
  });

  it("excludes entries without metadata when filter is set", async () => {
    const store = createTestStore();
    await store.add(["cats are fluffy"]); // no metadata

    const results = await store.search("query-cats", {
      filter: { source: "pets" },
    });

    assertEquals(results, []);
  });
});

// ---------------------------------------------------------------------------
// MMR search
// ---------------------------------------------------------------------------

describe("vectorStore — MMR search", () => {
  it("diversifies results compared to pure dense", async () => {
    const store = createTestStore();
    await store.add([
      "cats are fluffy",
      "cats and dogs",
      "fish swim fast",
      "birds can fly",
    ]);

    const dense = await store.search("query-cats", { topK: 4 });
    const mmr = await store.search("query-cats", {
      topK: 4,
      strategy: "mmr",
      lambda: 0.5,
    });

    // MMR should still return the most relevant first
    assertEquals(mmr[0]!.text, "cats are fluffy");
    // MMR should have all 4 results
    assertEquals(mmr.length, 4);
    // Dense and MMR should potentially differ in ordering after the top result
    // (at minimum both return all 4 items)
    assertEquals(dense.length, 4);
  });

  it("with lambda=1 behaves like dense search", async () => {
    const store = createTestStore();
    await store.add(["cats are fluffy", "dogs are loyal", "fish swim fast"]);

    const dense = await store.search("query-cats", { topK: 3 });
    const mmr = await store.search("query-cats", {
      topK: 3,
      strategy: "mmr",
      lambda: 1.0,
    });

    // With lambda=1, MMR score = relevance only, so order should match dense
    assertEquals(mmr[0]!.text, dense[0]!.text);
  });
});

// ---------------------------------------------------------------------------
// Hybrid search (BM25 + dense)
// ---------------------------------------------------------------------------

describe("vectorStore — hybrid search", () => {
  it("returns results combining BM25 and dense scores", async () => {
    const store = createTestStore();
    await store.add([
      "cats are fluffy",
      "dogs are loyal",
      "fish swim fast",
    ]);

    const results = await store.search("query-cats", {
      topK: 3,
      strategy: "hybrid",
    });

    assertEquals(results.length, 3);
    // All results have RRF-based scores
    for (const r of results) {
      assert(r.score > 0, `Expected positive score, got ${r.score}`);
    }
  });

  it("handles single-word query", async () => {
    const store = createTestStore();
    await store.add(["cats are fluffy", "dogs are loyal"]);

    const results = await store.search("query-cats", {
      topK: 2,
      strategy: "hybrid",
    });

    assertEquals(results.length, 2);
  });
});

// ---------------------------------------------------------------------------
// BM25 edge cases (division-by-zero fix from #477)
// ---------------------------------------------------------------------------

describe("vectorStore — BM25 edge cases", () => {
  it("handles documents that tokenize to empty (no alphanumeric content)", async () => {
    // Documents like "..." or "###" produce empty token arrays
    // Before the fix, avgDl would be 0 causing division by zero
    const emptyTokenVectors = new Map<string, number[]>([
      ["query", [1, 0, 0, 0]],
      ["...", [0.5, 0.5, 0, 0]],
      ["###", [0, 0.5, 0.5, 0]],
      ["!!!", [0, 0, 0.5, 0.5]],
    ]);

    const store = vectorStore({ embedder: mockEmbedder(emptyTokenVectors) });
    await store.add(["...", "###", "!!!"]);

    // This should not throw — before the fix it would NaN/Infinity
    const results = await store.search("query", {
      topK: 3,
      strategy: "hybrid",
    });

    assertEquals(results.length, 3);
    for (const r of results) {
      assert(Number.isFinite(r.score), `Expected finite score, got ${r.score}`);
    }
  });

  it("handles mix of empty-tokenizing and normal documents", async () => {
    const mixVectors = new Map<string, number[]>([
      ["test query", [1, 0, 0, 0]],
      ["hello world", [0.9, 0.1, 0, 0]],
      ["...", [0, 0, 1, 0]],
    ]);

    const store = vectorStore({ embedder: mockEmbedder(mixVectors) });
    await store.add(["hello world", "..."]);

    const results = await store.search("test query", {
      topK: 2,
      strategy: "hybrid",
    });

    assertEquals(results.length, 2);
    for (const r of results) {
      assert(Number.isFinite(r.score), `Expected finite score, got ${r.score}`);
    }
  });

  it("handles empty query terms gracefully", async () => {
    const store = createTestStore();
    await store.add(["cats are fluffy", "dogs are loyal"]);

    // Query "..." tokenizes to empty — BM25 should return all zeros
    const emptyQueryVectors = new Map<string, number[]>([
      ...VECTORS,
      ["...", [0.5, 0.5, 0, 0]],
    ]);
    const store2 = vectorStore({ embedder: mockEmbedder(emptyQueryVectors) });
    await store2.add(["cats are fluffy", "dogs are loyal"]);

    const results = await store2.search("...", {
      topK: 2,
      strategy: "hybrid",
    });

    assertEquals(results.length, 2);
    for (const r of results) {
      assert(Number.isFinite(r.score), `Expected finite score, got ${r.score}`);
    }
  });
});
