import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  clearModelProviders,
  ensureModelReady,
  hasModelProvider,
  registerModelProvider,
  resolveModel,
} from "./model-registry.ts";
import type { ModelRuntime } from "./types.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { fromError } from "#veryfront/errors";

const MODEL_REGISTRY_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_DISABLE_LOCAL_AI",
] as const;

function clearModelRegistryEnv(): void {
  for (const key of MODEL_REGISTRY_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

describe("provider/model-registry", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearModelRegistryEnv();
    clearModelProviders();
  });

  it("rejects invalid provider factories at registration", () => {
    assertThrows(
      () => registerModelProvider("invalid", undefined as unknown as (id: string) => ModelRuntime),
      Error,
      "factory",
    );
  });

  it("rejects malformed model strings without reflecting their contents", () => {
    const malformed = "openai/model\nBearer private-value";
    const error = assertThrows(
      () => resolveModel(malformed),
      Error,
      "Model string",
    );

    assertEquals(error.message.includes("private-value"), false);
    assertThrows(
      () => resolveModel(undefined as unknown as string),
      Error,
      "Model string",
    );
  });

  it("rejects provider factories that return an invalid runtime", () => {
    registerModelProvider(
      "invalid-runtime",
      () => ({ provider: "invalid-runtime" }) as unknown as ModelRuntime,
    );

    assertThrows(
      () => resolveModel("invalid-runtime/model"),
      Error,
      "runtime",
    );
  });

  it("treats unreadable local-runtime metadata as untrusted", async () => {
    const runtime = Object.defineProperty(
      {
        doGenerate: async () => ({}),
        doStream: async () => ({ stream: new ReadableStream() }),
      },
      "_isVfLocalModel",
      {
        get() {
          throw new Error("private runtime metadata");
        },
      },
    ) as ModelRuntime;

    await ensureModelReady(runtime);
  });

  it("rejects marked local runtimes without a valid local model ID", async () => {
    setEnv("VERYFRONT_DISABLE_LOCAL_AI", "1");
    const runtime = {
      _isVfLocalModel: true,
      doGenerate: async () => ({}),
      doStream: async () => ({ stream: new ReadableStream() }),
    } as ModelRuntime;

    const error = await assertRejects(
      () => ensureModelReady(runtime),
      Error,
      "local model runtime",
    );
    assertEquals(fromError(error)?.type, "config");
  });

  it("initializes shared providers even when the first project overrides one", () => {
    const projectA = { projectId: "project-a", mode: "preview" as const, versionId: "main" };
    const projectB = { projectId: "project-b", mode: "preview" as const, versionId: "main" };

    runWithCacheKeyContext(projectA, () => {
      registerModelProvider("openai", () => ({
        doGenerate: async () => ({}),
        doStream: async () => ({ stream: new ReadableStream() }),
      }));
      resolveModel("openai/custom-model");
    });

    assertEquals(
      runWithCacheKeyContext(
        projectB,
        () =>
          ["openai", "anthropic", "google", "mistral", "local", "veryfront-cloud"].every(
            (name) => hasModelProvider(name),
          ),
      ),
      true,
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
          status: "completed",
          output: [{
            type: "message",
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
    assertEquals(
      (requestedBody?.tools as Array<{ name?: string }> | undefined)?.[0]?.name,
      "lookup_order",
    );
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
          status: "completed",
          output: [{
            type: "message",
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
          status: "completed",
          output: [{
            type: "message",
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
