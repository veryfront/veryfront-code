import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { embedding } from "./embedding.ts";
import { clearEmbeddingProviders, registerEmbeddingProvider } from "./resolve.ts";

describe("embedding", () => {
  afterEach(() => {
    clearEmbeddingProviders();
  });

  it("rejects whitespace-only input even when queryPrefix is configured", async () => {
    registerEmbeddingProvider("test", () =>
      ({
        specificationVersion: "v2",
        provider: "test",
        modelId: "test/demo",
        maxEmbeddingsPerCall: undefined,
        supportsParallelCalls: true,
        async doEmbed() {
          throw new Error("doEmbed should not run for empty input");
        },
      }) as never);

    const embedder = embedding({
      model: "test/demo",
      queryPrefix: "search_query: ",
    });

    await assertRejects(
      () => embedder.embed("   "),
      Error,
      "Cannot embed an empty string",
    );
  });

  it("applies queryPrefix to non-empty embed input", async () => {
    const values: string[] = [];
    registerEmbeddingProvider("test", () =>
      ({
        specificationVersion: "v2",
        provider: "test",
        modelId: "test/demo",
        maxEmbeddingsPerCall: undefined,
        supportsParallelCalls: true,
        async doEmbed({ values: inputValues }: { values: string[] }) {
          values.push(...inputValues);
          return {
            embeddings: inputValues.map(() => [1, 2, 3]),
            usage: { tokens: 0 },
            rawResponse: undefined,
            warnings: [],
          };
        },
      }) as never);

    const embedder = embedding({
      model: "test/demo",
      queryPrefix: "search_query: ",
    });

    const result = await embedder.embed("cats");

    assertEquals(result, [1, 2, 3]);
    assertEquals(values, ["search_query: cats"]);
  });
});
