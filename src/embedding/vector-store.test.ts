import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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

  it("rewards negative similarity as diversity in MMR", async () => {
    const vectors = new Map<string, number[]>([
      ["query", [1, 0]],
      ["first", [1, 0]],
      ["orthogonal", [0, 1]],
      ["opposite", [-1, 0]],
    ]);
    const embedder: Embedding = {
      model: "test/mmr-negative-similarity",
      embed: (text) => Promise.resolve(vectors.get(text)!),
      embedMany: (texts) => Promise.resolve(texts.map((text) => vectors.get(text)!)),
    };
    const store = vectorStore({ embedder });

    await store.add(["first", "orthogonal", "opposite"]);
    const results = await store.search("query", {
      strategy: "mmr",
      topK: 2,
      lambda: 0,
    });

    assertEquals(results.map((result) => result.text), ["first", "opposite"]);
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

    const thresholded = await store.search("banana", {
      strategy: "hybrid",
      topK: 2,
      threshold: 0.034,
    });
    assertEquals(thresholded, []);
    assertEquals(results.every((result) => result.score > 0), true);
  });

  it("does not create lexical rank signals from zero BM25 scores", async () => {
    const vectors = new Map<string, number[]>([
      ["missing-term", [1, 0]],
      ["dense-third", [0.6, 0.8]],
      ["dense-first", [1, 0]],
      ["dense-second", [0.8, 0.6]],
    ]);
    const embedder: Embedding = {
      model: "test/hybrid-zero-bm25",
      embed: (text) => Promise.resolve(vectors.get(text)!),
      embedMany: (texts) => Promise.resolve(texts.map((text) => vectors.get(text)!)),
    };
    const store = vectorStore({ embedder });

    await store.add(["dense-third", "dense-first", "dense-second"]);
    const results = await store.search("missing-term", {
      strategy: "hybrid",
      topK: 3,
    });

    assertEquals(results.map((result) => result.text), [
      "dense-first",
      "dense-second",
      "dense-third",
    ]);
    assertEquals(results.map((result) => result.score), [
      1 / 60,
      1 / 61,
      1 / 62,
    ]);
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

  it("rejects invalid search controls before invoking the embedder", async () => {
    const { embedder, embedCalls } = createTestEmbedder();
    const store = vectorStore({ embedder });

    for (
      const options of [
        { topK: 0 },
        { topK: -1 },
        { topK: 1.5 },
        { threshold: Number.NaN },
        { threshold: -0.1 },
        { threshold: 1.1 },
        { lambda: -0.1 },
        { lambda: 1.1 },
      ]
    ) {
      await assertRejects(() => store.search("alpha", options), RangeError);
    }
    await assertRejects(
      () => store.search("alpha", { strategy: "unknown" as never }),
      TypeError,
      "strategy",
    );
    assertEquals(embedCalls, []);
  });

  it("keeps add atomic when metadata or embedding contracts are malformed", async () => {
    const malformed: Embedding = {
      model: "test/malformed",
      embed: () => Promise.resolve([1, 0]),
      embedMany: () => Promise.resolve([[1, 0]]),
    };
    const store = vectorStore({ embedder: malformed });

    await assertRejects(
      () => store.add(["one", "two"], [{ source: "only-one" }]),
      RangeError,
      "metadata length",
    );
    await assertRejects(
      () => store.add(["one", "two"]),
      RangeError,
      "returned 1 vectors",
    );
    assertEquals(store.size, 0);
  });

  it("rejects vector dimension drift without partially appending entries", async () => {
    let dimension = 2;
    const embedder: Embedding = {
      model: "test/drift",
      embed: () => Promise.resolve(Array.from({ length: dimension }, () => 1)),
      embedMany: (texts) =>
        Promise.resolve(
          texts.map(() => Array.from({ length: dimension }, () => 1)),
        ),
    };
    const store = vectorStore({ embedder });

    await store.add(["first"]);
    dimension = 3;
    await assertRejects(
      () => store.add(["second"]),
      RangeError,
      "expected dimension 2",
    );
    assertEquals(store.size, 1);
  });

  it("snapshots metadata on write and read", async () => {
    const { embedder } = createTestEmbedder();
    const store = vectorStore({ embedder });
    const metadata = { source: "docs" };

    await store.add(["alpha document"], [metadata]);
    metadata.source = "mutated";
    const first = await store.search("alpha");
    first[0]!.metadata!.source = "result-mutated";
    const second = await store.search("alpha");

    assertEquals(second[0]?.metadata, { source: "docs" });
  });
});
