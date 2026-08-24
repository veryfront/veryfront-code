import "#veryfront/schemas/_test-setup.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { ensureBuiltinLLMProviders } from "#veryfront/extensions/builtin-extensions.ts";
import { embedding } from "./embedding.ts";
import { clearEmbeddingProviders, registerEmbeddingProvider } from "./resolve.ts";

function recordingEmbeddingModel(calls: string[][]) {
  return {
    specificationVersion: "v2",
    provider: "test",
    modelId: "test/demo",
    maxEmbeddingsPerCall: undefined,
    supportsParallelCalls: true,
    async doEmbed({ values: inputValues }: { values: string[] }) {
      calls.push([...inputValues]);
      return {
        embeddings: inputValues.map((_value, index) => [index]),
        usage: { tokens: 0 },
        rawResponse: undefined,
        warnings: [],
      };
    },
  };
}

describe("embedding", () => {
  afterEach(() => {
    restoreMockFetch();
    deleteEnv("GOOGLE_API_KEY");
    deleteEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    deleteEnv("GOOGLE_GEMINI_BASE_URL");
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

  it("applies documentPrefix to every embedMany value", async () => {
    const calls: string[][] = [];
    registerEmbeddingProvider("test", () => recordingEmbeddingModel(calls) as never);

    const embedder = embedding({
      model: "test/demo",
      documentPrefix: "search_document: ",
    });

    await embedder.embedMany(["a", "b"]);

    assertEquals(
      calls,
      [["search_document: a", "search_document: b"]],
      "embedMany must apply documentPrefix to every value",
    );
  });

  it("chunks embedMany input at batchSize and concatenates in input order", async () => {
    const calls: string[][] = [];
    registerEmbeddingProvider("test", () => recordingEmbeddingModel(calls) as never);

    const embedder = embedding({ model: "test/demo", batchSize: 2 });

    const result = await embedder.embedMany(["a", "b", "c"]);

    assertEquals(
      calls.map((call) => call.length),
      [2, 1],
      "embedMany must chunk at batchSize",
    );
    assertEquals(result.length, 3, "chunked embeddings must be concatenated in input order");
    assertEquals(result, [[0], [1], [0]], "each chunk's embeddings must be appended in order");
  });

  it("returns an empty result for empty embedMany input without calling the provider", async () => {
    const calls: string[][] = [];
    registerEmbeddingProvider("test", () => recordingEmbeddingModel(calls) as never);

    const embedder = embedding({ model: "test/demo" });

    assertEquals(
      await embedder.embedMany([]),
      [],
      "empty input must return [] without calling the provider",
    );
    assertEquals(calls.length, 0, "empty input must not reach the provider");
  });

  it("keeps auto-initialized Google embeddings on the captured guarded transport", async () => {
    ensureBuiltinLLMProviders();
    setEnv("GOOGLE_API_KEY", "google-test-key");
    let guardedCalls = 0;
    let replacedGlobalCalls = 0;
    let requestedApiKey: string | null = null;
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        guardedCalls++;
        const request = new Request(input, init);
        requestedApiKey = request.headers.get("x-goog-api-key");
        return Response.json({
          embedding: { values: [0.25, 0.75] },
          usageMetadata: { promptTokenCount: 2 },
        });
      }) as typeof fetch,
    );

    const embedder = embedding({ model: "google/gemini-embedding-001" });
    // Deliberately a raw global assignment, not another install: the point of
    // this test is that the transport captured at construction wins over
    // whatever tenant code later does to globalThis.fetch.
    globalThis.fetch = (() => {
      replacedGlobalCalls++;
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    }) as typeof fetch;

    assertEquals(await embedder.embed("hello"), [0.25, 0.75]);
    assertEquals(guardedCalls, 1);
    assertEquals(replacedGlobalCalls, 0);
    assertEquals(requestedApiKey, "google-test-key");
  });

  it("sends Google embedding requests to GOOGLE_GEMINI_BASE_URL", async () => {
    // The chat path is covered in model-registry.test.ts. Embeddings resolve
    // through a separate registration in embedding/resolve.ts, which had the
    // same hardcoded endpoint, so it needs its own assertion.
    ensureBuiltinLLMProviders();
    setEnv("GOOGLE_API_KEY", "google-test-key");
    setEnv("GOOGLE_GEMINI_BASE_URL", "https://example.com/gemini/v1beta");
    let requestedUrl = "";

    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        requestedUrl = new Request(input, init).url;
        return Response.json({
          embedding: { values: [0.5] },
          usageMetadata: { promptTokenCount: 1 },
        });
      }) as typeof fetch,
    );

    const embedder = embedding({ model: "google/gemini-embedding-001" });
    assertEquals(await embedder.embed("hello"), [0.5]);
    assertEquals(
      requestedUrl.startsWith("https://example.com/gemini/v1beta/"),
      true,
      requestedUrl,
    );
  });
});
