import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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
});
