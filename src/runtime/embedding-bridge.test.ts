import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { EmbeddingRuntime } from "#veryfront/provider/types.ts";
import { cosineSimilarity, embed, embedMany } from "./runtime-bridge.ts";

function embeddingModel(
  embeddings: number[][],
  capture?: (values: string[], signal: AbortSignal | undefined) => void,
): EmbeddingRuntime {
  return {
    provider: "test",
    modelId: "test/embedding",
    specificationVersion: "v2",
    doEmbed({ values, abortSignal }) {
      capture?.(values, abortSignal);
      return Promise.resolve({
        embeddings,
        usage: { tokens: 3 },
        rawResponse: { requestId: "request-1" },
      });
    },
  };
}

describe("runtime embedding bridge", () => {
  it("forwards single and batched requests while normalizing warnings", async () => {
    const controller = new AbortController();
    const calls: Array<{ values: string[]; signal: AbortSignal | undefined }> = [];
    const single = await embed({
      model: embeddingModel([[1, 2]], (values, signal) => calls.push({ values, signal })),
      value: "query",
      abortSignal: controller.signal,
    });
    const many = await embedMany({
      model: embeddingModel([[3, 4], [5, 6]], (values, signal) => calls.push({ values, signal })),
      values: ["first", "second"],
    });

    assertEquals(single, {
      embedding: [1, 2],
      embeddings: [[1, 2]],
      usage: { tokens: 3 },
      rawResponse: { requestId: "request-1" },
      warnings: [],
    });
    assertEquals(many.embeddings, [[3, 4], [5, 6]]);
    assertEquals(calls, [
      { values: ["query"], signal: controller.signal },
      { values: ["first", "second"], signal: undefined },
    ]);
  });

  it("rejects missing, non-finite, and inconsistent provider vectors", async () => {
    for (
      const [values, embeddings] of [
        [["query"], []],
        [["first", "second"], [[1, 2]]],
        [["first", "second"], [[1, 2], [3]]],
        [["query"], [[1, Number.NaN]]],
      ] as const
    ) {
      const mutableEmbeddings = embeddings.map((vector) => [...vector]);
      await assertRejects(
        async () =>
          await embedMany({
            model: embeddingModel(mutableEmbeddings),
            values: [...values],
          }),
        TypeError,
        "Embedding runtime returned invalid vectors",
      );
    }
  });

  it("validates against the request cardinality captured before provider dispatch", async () => {
    const gate = Promise.withResolvers<void>();
    const values = ["first", "second"];
    const model: EmbeddingRuntime = {
      provider: "test",
      modelId: "test/delayed-embedding",
      specificationVersion: "v2",
      async doEmbed({ values: submitted }) {
        await gate.promise;
        return { embeddings: submitted.map(() => [1, 2]) };
      },
    };

    const resultPromise = embedMany({ model, values });
    values.pop();
    gate.resolve();

    assertEquals((await resultPromise).embeddings, [[1, 2], [1, 2]]);
  });

  it("keeps cosine similarity finite for invalid numeric vectors", () => {
    assertEquals(cosineSimilarity([1, 0], [1, 0]), 1);
    assertEquals(cosineSimilarity([1, 0], [0, 1]), 0);
    assertEquals(cosineSimilarity([1, 0], [-1, 0]), -1);
    assertEquals(cosineSimilarity([0, 0], [1, 1]), 0);
    assertEquals(cosineSimilarity([1], [1, 2]), 0);
    assertEquals(cosineSimilarity([Number.NaN], [1]), 0);
    assertEquals(cosineSimilarity([Number.POSITIVE_INFINITY], [1]), 0);
    assert(
      Math.abs(cosineSimilarity([1e308, 1e308], [1e308, 1e308]) - 1) < 1e-12,
    );
  });
});
