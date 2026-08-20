import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import type { ModelRuntime } from "./types.ts";
import {
  clearModelProviders,
  ensureModelReady,
  getRegisteredModelProviders,
  hasModelProvider,
  registerModelProvider,
  resolveModel,
} from "./model-registry.ts";

const MODEL_REGISTRY_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_GEMINI_BASE_URL",
  "MISTRAL_API_KEY",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
] as const;

const PROJECT_A = {
  projectId: "provider-registry-project-a",
  mode: "preview" as const,
  versionId: "main",
};
const PROJECT_B = {
  projectId: "provider-registry-project-b",
  mode: "preview" as const,
  versionId: "main",
};

function clearModelRegistryEnv(): void {
  for (const key of MODEL_REGISTRY_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

function testRuntime(provider: string, modelId: string): ModelRuntime {
  return {
    specificationVersion: "v2",
    provider,
    modelId,
    async doGenerate() {
      return {};
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
}

describe("provider/model-registry", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearModelRegistryEnv();
    clearModelProviders();
  });

  it("initializes shared built-ins even when the first project shadows one", () => {
    setEnv("OPENAI_API_KEY", "sk-test-openai");
    runWithCacheKeyContext(PROJECT_A, () => {
      registerModelProvider("openai", (id) => testRuntime("project-a", id));
      assertEquals(resolveModel("openai/project-model").provider, "project-a");
    });

    const shared = runWithCacheKeyContext(
      PROJECT_B,
      () => resolveModel("openai/gpt-5.4-nano"),
    );
    assertEquals(shared.provider, "openai");
  });

  describe("missing credential diagnostics", () => {
    it("names the unservable model and the credentials that are configured", () => {
      const secret = "sk-ant-do-not-leak-me";
      setEnv("ANTHROPIC_API_KEY", secret);

      const error = assertThrows(() => resolveModel("openai/gpt-5.4-nano")) as Error;

      assertEquals(error.message.includes("OPENAI_API_KEY is not set"), true);
      // The model that could not be served, so the reader does not have to
      // guess which of several providers failed.
      assertEquals(error.message.includes('"openai/gpt-5.4-nano"'), true);
      // What *is* configured -- names only.
      assertEquals(
        error.message.includes("Configured provider credentials: ANTHROPIC_API_KEY"),
        true,
      );
      assertEquals(error.message.includes(secret), false);
    });

    it("reports the configured Google credential alias without exposing its value", () => {
      const secret = "AIza-do-not-leak-me";
      setEnv("GOOGLE_API_KEY", secret);

      const error = assertThrows(() => resolveModel("openai/gpt-5.4-nano")) as Error;

      assertEquals(error.message.includes("OPENAI_API_KEY is not set"), true);
      assertEquals(
        error.message.includes("Configured provider credentials: GOOGLE_API_KEY"),
        true,
      );
      assertEquals(error.message.includes("GOOGLE_GENERATIVE_AI_API_KEY"), false);
      assertEquals(error.message.includes(secret), false);
    });

    it("says so plainly when nothing is configured", () => {
      const error = assertThrows(() => resolveModel("anthropic/claude-haiku-4-5")) as Error;

      assertEquals(error.message.includes("ANTHROPIC_API_KEY is not set"), true);
      assertEquals(
        error.message.includes("No built-in provider credentials are configured"),
        true,
      );
    });
  });

  it("resolves local models without credentials or an explicit registration", () => {
    assertEquals(hasModelProvider("local"), true);

    const model = resolveModel("local/qwen3.5-0.8b");
    assertEquals(model.provider, "local");
    assertEquals(model.modelId, "local/qwen3.5-0.8b");
    // The runtime is only prepared, never invoked: the local engine loads its
    // ONNX pipeline lazily and is not available in CI.
    assertEquals(typeof model.prepare, "function");

    assertEquals(
      runWithCacheKeyContext(PROJECT_A, () => resolveModel("local/demo").provider),
      "local",
    );
  });

  it("uses bootstrap providers as project defaults and preserves scoped overrides", () => {
    registerModelProvider("bootstrap", (id) => testRuntime("bootstrap", id));

    assertEquals(
      runWithCacheKeyContext(
        PROJECT_A,
        () => resolveModel("bootstrap/family/model").provider,
      ),
      "bootstrap",
    );

    const disposeProjectOverride = runWithCacheKeyContext(PROJECT_A, () => {
      const dispose = registerModelProvider("bootstrap", (id) => testRuntime("project-a", id));
      assertEquals(resolveModel("bootstrap/model").provider, "project-a");
      return dispose;
    });
    assertEquals(
      runWithCacheKeyContext(
        PROJECT_B,
        () => resolveModel("bootstrap/model").provider,
      ),
      "bootstrap",
    );

    disposeProjectOverride();
    assertEquals(
      runWithCacheKeyContext(
        PROJECT_A,
        () => resolveModel("bootstrap/model").provider,
      ),
      "bootstrap",
    );
  });

  it("scoped registration disposers preserve other projects and built-ins", () => {
    const disposeProjectA = runWithCacheKeyContext(PROJECT_A, () => {
      return registerModelProvider("tenant", (id) => testRuntime("project-a", id));
    });
    runWithCacheKeyContext(PROJECT_B, () => {
      registerModelProvider("tenant", (id) => testRuntime("project-b", id));
    });

    disposeProjectA();
    assertThrows(
      () =>
        runWithCacheKeyContext(
          PROJECT_A,
          () => resolveModel("tenant/model"),
        ),
      Error,
      'provider "tenant" not registered',
    );
    assertEquals(
      runWithCacheKeyContext(
        PROJECT_B,
        () => resolveModel("tenant/model").provider,
      ),
      "project-b",
    );
    assertEquals(
      runWithCacheKeyContext(PROJECT_A, () => hasModelProvider("local")),
      true,
    );
  });

  it("clearModelProviders resets bootstrap, shared, and every project scope", () => {
    registerModelProvider("bootstrap-reset", (id) => testRuntime("bootstrap", id));
    runWithCacheKeyContext(PROJECT_A, () => {
      registerModelProvider("tenant-reset", (id) => testRuntime("project-a", id));
    });
    runWithCacheKeyContext(PROJECT_B, () => {
      registerModelProvider("tenant-reset", (id) => testRuntime("project-b", id));
    });
    assertEquals(hasModelProvider("local"), true);

    clearModelProviders();

    assertEquals(hasModelProvider("bootstrap-reset"), false);
    assertEquals(
      runWithCacheKeyContext(PROJECT_A, () => hasModelProvider("tenant-reset")),
      false,
    );
    assertEquals(
      runWithCacheKeyContext(PROJECT_B, () => hasModelProvider("tenant-reset")),
      false,
    );
    assertEquals(hasModelProvider("local"), true);
  });

  it("reports bootstrap, project, and shared providers without duplicates", () => {
    registerModelProvider("bootstrap-list", (id) => testRuntime("bootstrap", id));
    const providers = runWithCacheKeyContext(PROJECT_A, () => {
      registerModelProvider("project-list", (id) => testRuntime("project", id));
      return getRegisteredModelProviders();
    });

    assertEquals(providers.includes("bootstrap-list"), true);
    assertEquals(providers.includes("project-list"), true);
    assertEquals(providers.includes("local"), true);
    assertEquals(new Set(providers).size, providers.length);
  });

  it("rejects malformed registrations, model strings, and runtime results", () => {
    assertThrows(
      () => registerModelProvider(null as never, () => testRuntime("test", "model")),
      TypeError,
      "non-empty string",
    );
    assertThrows(
      () => registerModelProvider(" ", () => testRuntime("test", "model")),
      TypeError,
      "non-empty string",
    );
    assertThrows(
      () => registerModelProvider("bad/name", () => testRuntime("test", "model")),
      TypeError,
      "without slashes",
    );
    assertThrows(
      () => registerModelProvider("invalid-factory", null as never),
      TypeError,
      "factory must be a function",
    );
    assertThrows(
      () => resolveModel(null as never),
      TypeError,
      "provider/model",
    );
    assertThrows(
      () => resolveModel(" missing/model"),
      Error,
      "Both provider and model name are required",
    );
    assertThrows(
      () => resolveModel("missing/model "),
      Error,
      "Both provider and model name are required",
    );

    registerModelProvider("null-runtime", () => null as never);
    assertThrows(
      () => resolveModel("null-runtime/model"),
      TypeError,
      "expected an object",
    );
    registerModelProvider(
      "partial-runtime",
      () => ({ doGenerate() {} }) as never,
    );
    assertThrows(
      () => resolveModel("partial-runtime/model"),
      TypeError,
      "doGenerate and doStream must be functions",
    );
    registerModelProvider(
      "unreadable-runtime",
      () =>
        Object.defineProperty({}, "doGenerate", {
          get() {
            throw new Error("private getter failure");
          },
        }) as never,
    );
    assertThrows(
      () => resolveModel("unreadable-runtime/model"),
      TypeError,
      "unreadable runtime",
    );
  });

  it("preserves nested model identifiers when invoking custom factories", () => {
    let receivedModelId = "";
    registerModelProvider("custom", (id) => {
      receivedModelId = id;
      return testRuntime("custom", id);
    });

    const runtime = resolveModel("custom/family/model");
    assertEquals(receivedModelId, "family/model");
    assertEquals(runtime.modelId, "family/model");
  });

  it("fails actionably when an explicit provider has not been composed", () => {
    assertThrows(
      () => resolveModel("never-composed/example"),
      Error,
      "Register it during application composition with registerModelProvider()",
    );
  });

  it("disposes only the exact registration generation it owns", () => {
    const disposeFirst = registerModelProvider(
      "owned",
      (id) => testRuntime("first", id),
    );
    const disposeSecond = registerModelProvider(
      "owned",
      (id) => testRuntime("second", id),
    );

    disposeFirst();
    assertEquals(resolveModel("owned/model").provider, "second");
    disposeSecond();
    disposeSecond();
    assertThrows(() => resolveModel("owned/model"), Error, "not registered");
  });

  it("disposes a scoped registration outside its original request context", () => {
    let dispose = () => {};
    runWithCacheKeyContext(PROJECT_A, () => {
      dispose = registerModelProvider(
        "scoped-owned",
        (id) => testRuntime("project-a", id),
      );
    });

    dispose();
    assertThrows(
      () =>
        runWithCacheKeyContext(
          PROJECT_A,
          () => resolveModel("scoped-owned/model"),
        ),
      Error,
      "not registered",
    );
  });

  it("runs a provider-neutral preparation hook before use", async () => {
    const expected = new Error("runtime unavailable");
    let prepareThis: unknown;
    let prepareSignal: AbortSignal | undefined;
    const abortController = new AbortController();
    const runtime: ModelRuntime = {
      ...testRuntime("prepared", "model"),
      prepare(abortSignal) {
        prepareThis = this;
        prepareSignal = abortSignal;
        return Promise.reject(expected);
      },
    };

    const error = await ensureModelReady(runtime, abortController.signal).then(
      () => undefined,
      (caught) => caught,
    );
    assertStrictEquals(error, expected);
    assertStrictEquals(prepareThis, runtime);
    assertStrictEquals(prepareSignal, abortController.signal);
    await ensureModelReady(testRuntime("plain", "model"));
  });

  it("routes env-backed Google models through GOOGLE_GEMINI_BASE_URL", async () => {
    // The outbound fetch is origin-bound. If it stayed pinned to the default
    // Google origin while the request builders used the custom one, every call
    // to a proxy or regional endpoint would be rejected before it was sent.
    setEnv("GOOGLE_API_KEY", "AIza-test");
    setEnv("GOOGLE_GEMINI_BASE_URL", "https://example.com/gemini/v1beta");
    let requestedUrl = "";

    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      const request = new Request(input, init);
      requestedUrl = request.url;
      return new Response(
        JSON.stringify({
          candidates: [{
            content: { role: "model", parts: [{ text: "ok" }] },
            finishReason: "STOP",
          }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const runtime = resolveModel("google/gemini-3.5-flash");
    await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });

    assertEquals(
      requestedUrl.startsWith("https://example.com/gemini/v1beta/"),
      true,
      requestedUrl,
    );
  });

  it("routes env-backed OpenAI reasoning models with tools through Responses", async () => {
    setEnv("OPENAI_API_KEY", "sk-test-openai");
    let requestedUrl = "";
    let requestedBody: Record<string, unknown> | undefined;

    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      const request = new Request(input, init);
      requestedUrl = request.url;
      requestedBody = JSON.parse(await request.text()) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          id: "resp_lookup",
          object: "response",
          status: "completed",
          output: [{
            id: "msg_lookup",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "Found order." }],
          }],
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const runtime = resolveModel("openai/gpt-5.4-nano");
    const result = await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Find order #4587" }],
      }],
      tools: [{
        type: "function",
        name: "lookup_order",
        description: "Lookup an order by id",
        inputSchema: {
          type: "object",
          properties: { orderId: { type: "string" } },
          required: ["orderId"],
          additionalProperties: false,
        },
      }],
      toolChoice: "auto",
    });

    assertEquals(requestedUrl, "https://api.openai.com/v1/responses");
    assertEquals(requestedBody?.model, "gpt-5.4-nano");
    assertEquals(requestedBody?.store, false);
    assertEquals(requestedBody?.reasoning, { effort: "medium" });
    const requestedTool = (requestedBody?.tools as
      | Array<Record<string, unknown>>
      | undefined)?.[0];
    assertEquals(requestedTool?.name, "lookup_order");
    assertEquals(requestedTool?.strict, false);
    assertEquals(result.content, [{ type: "text", text: "Found order." }]);
  });

  it("keeps reasoning summaries for explicit reasoning on env-backed OpenAI Responses models", async () => {
    setEnv("OPENAI_API_KEY", "sk-test-openai");
    let requestedBody: Record<string, unknown> | undefined;

    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      const request = new Request(input, init);
      requestedBody = JSON.parse(await request.text()) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          id: "resp_reasoning",
          object: "response",
          status: "completed",
          output: [{
            id: "msg_reasoning",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "Done." }],
          }],
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const runtime = resolveModel("openai/gpt-5.4-nano");
    await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Think hard." }],
      }],
      reasoning: { enabled: true, effort: "high" },
    });

    assertEquals(requestedBody?.store, false);
    assertEquals(requestedBody?.reasoning, { effort: "high", summary: "auto" });
  });

  it("merges legacy openai-compatible provider options into env-backed OpenAI request bodies", async () => {
    setEnv("OPENAI_API_KEY", "sk-test-openai");
    let requestedBody: Record<string, unknown> | undefined;

    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      const request = new Request(input, init);
      requestedBody = JSON.parse(await request.text()) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          id: "resp_options",
          object: "response",
          status: "completed",
          output: [{
            id: "msg_options",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "Done." }],
          }],
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const runtime = resolveModel("openai/gpt-5.4-nano");
    await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Hi" }],
      }],
      providerOptions: {
        "openai-compatible": {
          custom_compat: true,
          service_tier: "flex",
        },
        openai: {
          service_tier: "default",
        },
      },
    });

    assertEquals(requestedBody?.custom_compat, true);
    assertEquals(requestedBody?.service_tier, "default");
  });
});
