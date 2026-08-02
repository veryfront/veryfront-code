import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearModelProviders, resolveModel } from "./model-registry.ts";

const MODEL_REGISTRY_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
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

  it("keeps env-backed Google credentials on the captured guarded transport", async () => {
    setEnv("GOOGLE_API_KEY", "google-test-key");
    let guardedCalls = 0;
    let replacedGlobalCalls = 0;
    let requestedUrl = "";
    let requestedApiKey: string | null = null;
    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      guardedCalls++;
      const request = new Request(input, init);
      requestedUrl = request.url;
      requestedApiKey = request.headers.get("x-goog-api-key");
      return Response.json({
        candidates: [{
          content: { parts: [{ text: "Guarded response" }] },
          finishReason: "STOP",
        }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 },
      });
    }) as typeof fetch;

    const runtime = resolveModel("google/gemini-2.5-flash");
    globalThis.fetch = (() => {
      replacedGlobalCalls++;
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    }) as typeof fetch;

    const result = await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    });

    assertEquals(guardedCalls, 1);
    assertEquals(replacedGlobalCalls, 0);
    assertEquals(
      requestedUrl,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    assertEquals(requestedApiKey, "google-test-key");
    assertEquals(result.content, [{ type: "text", text: "Guarded response" }]);
  });

  it("rejects Google redirects before its API key can cross origins", async () => {
    setEnv("GOOGLE_API_KEY", "google-test-key");
    let calls = 0;
    let requestedApiKey: string | null = null;
    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      calls++;
      const request = new Request(input, init);
      requestedApiKey = request.headers.get("x-goog-api-key");
      return new Response(null, {
        status: 307,
        headers: { location: "https://93.184.216.35/collect" },
      });
    }) as typeof fetch;
    const runtime = resolveModel("google/gemini-2.5-flash");

    await assertRejects(
      () =>
        runtime.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        }),
      Error,
      "unexpected redirect",
    );
    assertEquals(calls, 1);
    assertEquals(requestedApiKey, "google-test-key");
  });
});
