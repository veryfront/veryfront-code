import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Embedding } from "./types.ts";
import { vectorStore } from "./vector-store.ts";

function createTestEmbedder() {
  const embedCalls: string[] = [];
  const embedManyCalls: string[][] = [];
  const vectors = new Map<string, number[]>([
    ["alpha", [1, 0, 0]],
    ["alpha document", [1, 0, 0]],
    ["alpha duplicate", [0.95, 0.05, 0]],
    ["mixed alpha beta", [0.7, 0.7, 0]],
    ["beta document", [0, 1, 0]],
    ["gamma document", [0, 0, 1]],
    ["banana", [0, 1, 0]],
    ["banana exact", [0, 0, 1]],
    ["semantic match", [0, 1, 0]],
    ["unrelated", [1, 0, 0]],
  ]);

  const embedder: Embedding = {
    model: "test/vector-store",
    async embed(text: string): Promise<number[]> {
      embedCalls.push(text);
      return vectorFor(text, vectors);
    },
    async embedMany(texts: string[]): Promise<number[][]> {
      embedManyCalls.push([...texts]);
      return texts.map((text) => vectorFor(text, vectors));
    },
  };

  return { embedder, embedCalls, embedManyCalls };
}

function vectorFor(text: string, vectors: Map<string, number[]>): number[] {
  const vector = vectors.get(text);
  if (vector) return vector;
  const normalized = text.toLowerCase();
  if (normalized.includes("alpha")) return [1, 0, 0];
  if (normalized.includes("beta") || normalized.includes("banana")) return [0, 1, 0];
  if (normalized.includes("gamma")) return [0, 0, 1];
  return [0.1, 0.1, 0.1];
}

describe("vectorStore", () => {
  it("returns empty results without embedding for empty stores and blank queries", async () => {
    const { embedder, embedCalls } = createTestEmbedder();
    const store = vectorStore({ embedder });

    assertEquals(await store.search("alpha"), []);
    assertEquals(embedCalls, []);

    await store.add(["alpha document"]);
    assertEquals(await store.search("   "), []);
    assertEquals(embedCalls, []);
  });

  it("stores embeddings and ranks dense results by cosine similarity", async () => {
    const { embedder, embedManyCalls } = createTestEmbedder();
    const store = vectorStore({ embedder });

    await store.add(["beta document", "mixed alpha beta", "alpha document"]);

    const results = await store.search("alpha", { topK: 2 });

    assertEquals(embedManyCalls, [["beta document", "mixed alpha beta", "alpha document"]]);
    assertEquals(results.map((result) => result.text), [
      "alpha document",
      "mixed alpha beta",
    ]);
    assertEquals(store.size, 3);
  });

  it("filters by exact metadata and applies score thresholds", async () => {
    const { embedder } = createTestEmbedder();
    const store = vectorStore({ embedder });

    await store.add(
      ["alpha document", "mixed alpha beta", "beta document"],
      [{ source: "docs" }, { source: "docs" }, { source: "other" }],
    );

    const filtered = await store.search("alpha", {
      filter: { source: "docs" },
      threshold: 0.8,
    });
    const missing = await store.search("alpha", {
      filter: { source: "missing" },
    });

    assertEquals(filtered.map((result) => result.text), ["alpha document"]);
    assertEquals(filtered[0]?.metadata, { source: "docs" });
    assertEquals(missing, []);
  });

  it("uses MMR search to diversify results when lambda favors diversity", async () => {
    const { embedder } = createTestEmbedder();
    const store = vectorStore({ embedder });

    await store.add(["alpha document", "alpha duplicate", "beta document"]);

    const results = await store.search("alpha", {
      strategy: "mmr",
      topK: 2,
      lambda: 0,
    });

    assertEquals(results.map((result) => result.text), [
      "alpha document",
      "beta document",
    ]);
  });

  it("combines lexical and dense matches in hybrid search", async () => {
    const { embedder } = createTestEmbedder();
    const store = vectorStore({ embedder });

    await store.add(["banana exact", "semantic match", "unrelated"]);

    const results = await store.search("banana", {
      strategy: "hybrid",
      topK: 2,
    });
    const texts = results.map((result) => result.text);

    assertEquals(texts.includes("banana exact"), true);
    assertEquals(texts.includes("semantic match"), true);
  });

  it("clears stored entries and size", async () => {
    const { embedder } = createTestEmbedder();
    const store = vectorStore({ embedder });

    await store.add(["alpha document", "beta document"]);
    assertEquals(store.size, 2);

    store.clear();

    assertEquals(store.size, 0);
    assertEquals(await store.search("alpha"), []);
  });

  it("validates add cardinality and embedding dimensions atomically", async () => {
    const { embedder } = createTestEmbedder();
    const store = vectorStore({ embedder, maxEntries: 1 });

    await assertRejects(
      () => store.add(["alpha document", "beta document"]),
      Error,
      "Vector store capacity exceeded",
    );
    assertEquals(store.size, 0);

    const malformed = vectorStore({
      embedder: {
        model: "test/malformed",
        async embed() {
          return [1, 2];
        },
        async embedMany() {
          return [[1, 2]];
        },
      },
    });
    await assertRejects(
      () => malformed.add(["one", "two"]),
      Error,
      "Embedding response count must match input count",
    );
    assertEquals(malformed.size, 0);
  });

  it("rejects invalid metadata and search options", async () => {
    const { embedder } = createTestEmbedder();
    const store = vectorStore({ embedder });

    await assertRejects(
      () => store.add(["alpha document", "beta document"], [{ source: "docs" }]),
      Error,
      "Metadata count must match text count",
    );
    await store.add(["alpha document"]);
    await assertRejects(
      () => store.search("alpha", { topK: 0 }),
      Error,
      "topK must be a positive integer",
    );
    await assertRejects(
      () => store.search("alpha", { strategy: "mmr", lambda: 2 }),
      Error,
      "lambda must be between 0 and 1",
    );
  });

  it("keeps clear authoritative over an add already in flight", async () => {
    let finishEmbedding!: (vectors: number[][]) => void;
    const pendingEmbedding = new Promise<number[][]>((resolve) => {
      finishEmbedding = resolve;
    });
    const store = vectorStore({
      embedder: {
        model: "test/deferred",
        async embed() {
          return [1, 0];
        },
        embedMany() {
          return pendingEmbedding;
        },
      },
    });

    const add = store.add(["alpha"]);
    store.clear();
    finishEmbedding([[1, 0]]);
    await add;

    assertEquals(store.size, 0);
  });

  it("discards stale add dimensions after clear starts a new generation", async () => {
    let finishOldEmbedding!: (vectors: number[][]) => void;
    const oldEmbedding = new Promise<number[][]>((resolve) => {
      finishOldEmbedding = resolve;
    });
    const store = vectorStore({
      embedder: {
        model: "test/generations",
        async embed() {
          return [1, 0, 0];
        },
        embedMany(texts) {
          return texts[0] === "old" ? oldEmbedding : Promise.resolve([[1, 0, 0]]);
        },
      },
    });

    const staleAdd = store.add(["old"]);
    store.clear();
    await store.add(["new"]);
    finishOldEmbedding([[1, 0]]);
    await staleAdd;

    assertEquals(store.size, 1);
  });

  it("selects the most relevant MMR result first even at maximum diversity", async () => {
    const { embedder } = createTestEmbedder();
    const store = vectorStore({ embedder });
    await store.add(["beta document", "alpha document", "gamma document"]);

    const results = await store.search("alpha", {
      strategy: "mmr",
      lambda: 0,
      topK: 2,
    });

    assertEquals(results[0]?.text, "alpha document");
  });

  it("uses negative cosine similarity when selecting diverse MMR results", async () => {
    const vectors = new Map<string, number[]>([
      ["query", [1, 0]],
      ["relevant", [1, 0]],
      ["orthogonal", [0, 1]],
      ["opposite", [-1, 0]],
    ]);
    const embedder: Embedding = {
      model: "test/mmr-negative",
      async embed(text) {
        return vectors.get(text)!;
      },
      async embedMany(texts) {
        return texts.map((text) => vectors.get(text)!);
      },
    };
    const store = vectorStore({ embedder });
    await store.add(["relevant", "orthogonal", "opposite"]);

    const results = await store.search("query", {
      strategy: "mmr",
      lambda: 0,
      topK: 3,
    });

    assertEquals(results.map((result) => result.text), [
      "relevant",
      "opposite",
      "orthogonal",
    ]);
  });

  it("snapshots metadata on input and output", async () => {
    const { embedder } = createTestEmbedder();
    const store = vectorStore({ embedder });
    const metadata = { source: "docs", nested: { category: "guide" } };
    await store.add(["alpha document"], [metadata]);
    metadata.source = "mutated";
    metadata.nested.category = "mutated";

    const first = await store.search("alpha", { filter: { source: "docs" } });
    assertEquals(first.length, 1);
    first[0]!.metadata!.source = "output-mutation";
    (first[0]!.metadata!.nested as { category: string }).category = "output-mutation";

    const second = await store.search("alpha", { filter: { source: "docs" } });
    assertEquals(second[0]?.metadata, {
      source: "docs",
      nested: { category: "guide" },
    });
  });

  it("snapshots add cancellation options before embedding", async () => {
    const first = new AbortController();
    const second = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const store = vectorStore({
      embedder: {
        model: "test/options-snapshot",
        async embed(): Promise<number[]> {
          return [1];
        },
        async embedMany(_texts, options): Promise<number[][]> {
          await Promise.resolve();
          receivedSignal = options?.signal;
          return [[1]];
        },
      },
    });
    const options = { signal: first.signal };

    const pendingAdd = store.add(["text"], undefined, options);
    options.signal = second.signal;
    await pendingAdd;

    assert(receivedSignal === first.signal);
  });

  it("searches a stable entry snapshot while query embedding is in flight", async () => {
    let resolveQuery!: (value: number[]) => void;
    const queryEmbedding = new Promise<number[]>((resolve) => {
      resolveQuery = resolve;
    });
    const store = vectorStore({
      embedder: {
        model: "test/concurrent-search",
        embed() {
          return queryEmbedding;
        },
        async embedMany(texts: string[]) {
          return texts.map((text) => text === "alpha" ? [1, 0] : [0, 1]);
        },
      },
    });
    await store.add(["alpha"]);

    const pendingSearch = store.search("query");
    store.clear();
    await store.add(["beta"]);
    resolveQuery([1, 0]);

    const results = await pendingSearch;
    assertEquals(results.map((result) => result.text), ["alpha"]);
  });

  it("rejects malformed search options", async () => {
    const { embedder } = createTestEmbedder();
    const store = vectorStore({ embedder });
    await store.add(["alpha document"]);

    await assertRejects(
      () => store.search("alpha", null as never),
      Error,
      "Vector search options must be an object",
    );
  });
});
