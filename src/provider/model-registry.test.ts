import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearModelProviders, resolveModel } from "./model-registry.ts";

const MODEL_REGISTRY_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
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
