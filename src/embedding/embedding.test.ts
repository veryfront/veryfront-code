import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
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

    await assertRejects(
      () => embedder.embed("cats", null as never),
      Error,
      "Embedding call options must be an object",
    );
  });

  it("rejects invalid batch sizes before resolving work", () => {
    let factoryCalls = 0;
    registerEmbeddingProvider("test", () => {
      factoryCalls++;
      return ({
        async doEmbed() {
          return { embeddings: [] };
        },
      }) as never;
    });

    assertThrows(
      () => embedding({ model: "test/demo", batchSize: 0 }),
      Error,
      "batchSize must be a positive integer",
    );
    assertThrows(
      () => embedding({ model: "test/demo", batchSize: 1.5 }),
      Error,
      "batchSize must be a positive integer",
    );
    assertEquals(factoryCalls, 0);
  });

  it("rejects blank document inputs without calling the provider", async () => {
    let calls = 0;
    registerEmbeddingProvider("test", () =>
      ({
        async doEmbed() {
          calls++;
          return { embeddings: [] };
        },
      }) as never);

    const embedder = embedding({ model: "test/demo" });

    await assertRejects(
      () => embedder.embedMany(["document", "   "]),
      Error,
      "Embedding input 1 must not be empty",
    );
    assertEquals(calls, 0);
  });

  it("honors provider batch limits and forwards cancellation", async () => {
    const batches: string[][] = [];
    const signals: Array<AbortSignal | undefined> = [];
    registerEmbeddingProvider("test", () =>
      ({
        maxEmbeddingsPerCall: Promise.resolve(2),
        async doEmbed(
          { values, abortSignal }: { values: string[]; abortSignal?: AbortSignal },
        ) {
          batches.push([...values]);
          signals.push(abortSignal);
          return { embeddings: values.map(() => [1, 2]) };
        },
      }) as never);

    const controller = new AbortController();
    const embedder = embedding({ model: "test/demo", batchSize: 5 });
    const result = await embedder.embedMany(
      ["one", "two", "three", "four", "five"],
      { signal: controller.signal },
    );

    assertEquals(result.length, 5);
    assertEquals(batches.map((batch) => batch.length), [2, 2, 1]);
    assertEquals(signals.every((signal) => signal === controller.signal), true);
  });

  it("does not wait for provider limits after cancellation", async () => {
    registerEmbeddingProvider("test", () =>
      ({
        maxEmbeddingsPerCall: new Promise<number>(() => {}),
        async doEmbed() {
          throw new Error("doEmbed should not run after cancellation");
        },
      }) as never);
    const controller = new AbortController();
    controller.abort();
    const embedder = embedding({ model: "test/demo" });

    let timeoutId: number | undefined;
    const timeout = new Promise<string>((resolve) => {
      timeoutId = setTimeout(() => resolve("timeout"), 20);
    });
    const outcome = await Promise.race([
      embedder.embedMany(["document"], { signal: controller.signal }).then(
        () => "resolved",
        (error) => error instanceof DOMException ? error.name : "rejected",
      ),
      timeout,
    ]).finally(() => clearTimeout(timeoutId));

    assertEquals(outcome, "AbortError");
  });

  it("rejects empty or inconsistent embedding vectors", async () => {
    registerEmbeddingProvider("test", () =>
      ({
        async doEmbed({ values }: { values: string[] }) {
          return {
            embeddings: values.map((_, index) => index === 0 ? [1, 2] : [1, 2, 3]),
          };
        },
      }) as never);

    const embedder = embedding({ model: "test/demo" });
    await assertRejects(
      () => embedder.embedMany(["one", "two"]),
      Error,
      "Embedding vectors must use one consistent dimension",
    );

    clearEmbeddingProviders();
    registerEmbeddingProvider("test", () =>
      ({
        async doEmbed() {
          return { embeddings: [[]] };
        },
      }) as never);
    await assertRejects(
      () => embedding({ model: "test/demo" }).embed("one"),
      Error,
      "Embedding vectors must not be empty",
    );

    clearEmbeddingProviders();
    registerEmbeddingProvider("test", () =>
      ({
        async doEmbed() {
          return { embeddings: [[Number.MAX_VALUE, Number.MAX_VALUE]] };
        },
      }) as never);
    await assertRejects(
      () => embedding({ model: "test/demo" }).embed("one"),
      Error,
      "finite squared norm",
    );
  });
});
