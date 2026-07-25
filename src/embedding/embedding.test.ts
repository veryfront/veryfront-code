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
  });

  it("rejects batch sizes that cannot make bounded progress", () => {
    for (const batchSize of [0, -1, 0.5, Number.POSITIVE_INFINITY, 10_001]) {
      assertThrows(
        () => embedding({ model: "test/demo", batchSize }),
        RangeError,
        "batchSize",
      );
    }
  });

  it("honors the provider batch cap when it is smaller than configuration", async () => {
    const calls: string[][] = [];
    registerEmbeddingProvider("test", () =>
      ({
        specificationVersion: "v2",
        provider: "test",
        modelId: "test/demo",
        maxEmbeddingsPerCall: Promise.resolve(2),
        supportsParallelCalls: true,
        async doEmbed({ values }: { values: string[] }) {
          calls.push([...values]);
          return {
            embeddings: values.map((value) => [value.length, 1]),
            usage: { tokens: 0 },
            warnings: [],
          };
        },
      }) as never);

    const embedder = embedding({
      model: "test/demo",
      batchSize: 100,
      documentPrefix: "doc:",
    });
    const result = await embedder.embedMany(["a", "b", "c", "d", "e"]);

    assertEquals(calls, [
      ["doc:a", "doc:b"],
      ["doc:c", "doc:d"],
      ["doc:e"],
    ]);
    assertEquals(result.length, 5);
  });

  it("rejects empty batch members before invoking the provider", async () => {
    let calls = 0;
    registerEmbeddingProvider("test", () =>
      ({
        specificationVersion: "v2",
        provider: "test",
        modelId: "test/demo",
        maxEmbeddingsPerCall: undefined,
        supportsParallelCalls: true,
        async doEmbed() {
          calls++;
          return {
            embeddings: [[1]],
            usage: { tokens: 0 },
            warnings: [],
          };
        },
      }) as never);

    const embedder = embedding({ model: "test/demo" });
    await assertRejects(
      () => embedder.embedMany(["valid", "   "]),
      Error,
      "index 1",
    );
    assertEquals(calls, 0);
  });

  it("forwards cancellation to embedding runtimes", async () => {
    let receivedSignal: AbortSignal | undefined;
    registerEmbeddingProvider("test", () =>
      ({
        specificationVersion: "v2",
        provider: "test",
        modelId: "test/demo",
        maxEmbeddingsPerCall: undefined,
        supportsParallelCalls: true,
        async doEmbed(
          { values, abortSignal }: { values: string[]; abortSignal?: AbortSignal },
        ) {
          receivedSignal = abortSignal;
          return {
            embeddings: values.map(() => [1]),
            usage: { tokens: 0 },
            warnings: [],
          };
        },
      }) as never);

    const controller = new AbortController();
    const embedder = embedding({ model: "test/demo" });
    await embedder.embed("cats", { abortSignal: controller.signal });

    assertEquals(receivedSignal, controller.signal);
  });

  it("rejects non-finite and dimensionally inconsistent provider vectors", async () => {
    registerEmbeddingProvider("nonfinite", () =>
      ({
        specificationVersion: "v2",
        provider: "nonfinite",
        modelId: "nonfinite/demo",
        async doEmbed() {
          return {
            embeddings: [[1, Number.NaN]],
            usage: { tokens: 0 },
            warnings: [],
          };
        },
      }) as never);
    registerEmbeddingProvider("inconsistent", () =>
      ({
        specificationVersion: "v2",
        provider: "inconsistent",
        modelId: "inconsistent/demo",
        async doEmbed() {
          return {
            embeddings: [[1], [1, 2]],
            usage: { tokens: 0 },
            warnings: [],
          };
        },
      }) as never);

    await assertRejects(
      () => embedding({ model: "nonfinite/demo" }).embed("text"),
      TypeError,
      "finite",
    );
    await assertRejects(
      () =>
        embedding({ model: "inconsistent/demo" }).embedMany([
          "first",
          "second",
        ]),
      RangeError,
      "dimension",
    );
  });

  it("serializes runtimes that do not support parallel calls", async () => {
    const firstGate = Promise.withResolvers<void>();
    const calls: string[] = [];
    registerEmbeddingProvider("serial", () =>
      ({
        specificationVersion: "v2",
        provider: "serial",
        modelId: "serial/demo",
        supportsParallelCalls: false,
        async doEmbed({ values }: { values: string[] }) {
          calls.push(values[0]!);
          if (values[0] === "first") await firstGate.promise;
          return {
            embeddings: [[1]],
            usage: { tokens: 0 },
            warnings: [],
          };
        },
      }) as never);

    const embedder = embedding({ model: "serial/demo" });
    const first = embedder.embed("first");
    const second = embedder.embed("second");
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(calls, ["first"]);

    firstGate.resolve();
    await Promise.all([first, second]);
    assertEquals(calls, ["first", "second"]);
  });

  it("removes an aborted serial waiter before it reaches the provider", async () => {
    const firstGate = Promise.withResolvers<void>();
    const firstStarted = Promise.withResolvers<void>();
    const calls: string[] = [];
    registerEmbeddingProvider("serial", () =>
      ({
        specificationVersion: "v2",
        provider: "serial",
        modelId: "serial/demo",
        supportsParallelCalls: false,
        async doEmbed({ values }: { values: string[] }) {
          calls.push(values[0]!);
          if (values[0] === "first") {
            firstStarted.resolve();
            await firstGate.promise;
          }
          return {
            embeddings: [[1]],
            usage: { tokens: 0 },
            warnings: [],
          };
        },
      }) as never);

    const embedder = embedding({ model: "serial/demo" });
    const first = embedder.embed("first");
    await firstStarted.promise;

    const controller = new AbortController();
    const second = embedder.embed("second", {
      abortSignal: controller.signal,
    });
    controller.abort();
    await assertRejects(() => second, DOMException, "aborted");

    firstGate.resolve();
    await first;
    assertEquals(calls, ["first"]);
  });
});
