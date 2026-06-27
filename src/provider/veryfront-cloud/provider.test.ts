import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearEmbeddingProviders, resolveEmbeddingModel } from "#veryfront/embedding/index.ts";
import { clearModelProviders, resolveModel } from "#veryfront/provider";

const CLOUD_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_DEFAULT_MODEL",
  "VERYFRONT_SERVICE_LAYER",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "MISTRAL_API_KEY",
] as const;

function clearCloudEnv(): void {
  for (const key of CLOUD_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

function setCloudBootstrap(): void {
  setEnv("VERYFRONT_API_TOKEN", "vf_test_provider");
  setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
}

describe("provider/veryfront-cloud", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearCloudEnv();
    clearModelProviders();
    clearEmbeddingProviders();
  });

  it("resolves veryfront-cloud openai models without project ext-llm-openai installed", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/openai/gpt-5.2") as Record<string, unknown>;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
    assertEquals(model._generateViaStream, true);
  });

  it("routes agent.generate through the streaming Veryfront Cloud gateway path", async () => {
    setCloudBootstrap();
    const encoder = new TextEncoder();
    let capturedRequest: Request | undefined;
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      const request = new Request(input, init);
      capturedRequest = request;
      capturedBody = JSON.parse(await request.text()) as Record<string, unknown>;

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
            );
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3,"veryfront":{"billable_input_tokens":2,"billable_output_tokens":1,"provider_cost_usd":0.001,"veryfront_charge_usd":0.0025,"veryfront_billed_usd":0.1,"cost_credits":1,"cost_source":"gateway","usage_capture_status":"complete"}}}\n\n',
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch;

    const assistant = agent({
      model: "veryfront-cloud/openai/gpt-test",
      system: "You are concise.",
    });

    const result = await assistant.generate({ input: "Hi" });

    assertEquals(
      capturedRequest?.url,
      "https://api.veryfront.com/ai/gateway/openai/v1/chat/completions",
    );
    assertEquals(capturedRequest?.headers.get("Authorization"), "Bearer vf_test_provider");
    assertEquals(capturedRequest?.headers.get("x-veryfront-project-slug"), "provider-test-project");
    assertEquals(capturedBody?.stream, true);
    assertEquals(capturedBody?.stream_options, { include_usage: true });
    assertEquals(result.text, "Hello");
    assertEquals(result.usage, {
      promptTokens: 2,
      completionTokens: 1,
      totalTokens: 3,
      billableInputTokens: 2,
      billableOutputTokens: 1,
      providerCostUsd: 0.001,
      veryfrontChargeUsd: 0.0025,
      veryfrontBilledUsd: 0.1,
      costCredits: 1,
      costSource: "gateway",
      usageCaptureStatus: "complete",
    });
  });

  it("resolves veryfront-cloud moonshotai models without project ext-llm-openai installed", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/moonshotai/kimi-k2") as Record<string, unknown>;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
    assertEquals(model._generateViaStream, true);
  });

  it("resolves veryfront-cloud mistral models without project ext-llm-openai installed", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/mistral/mistral-large-2512") as Record<
      string,
      unknown
    >;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
    assertEquals(model._generateViaStream, true);
  });

  it("rejects unsupported pre-prefixed veryfront-cloud Mistral models", () => {
    setCloudBootstrap();

    assertThrows(
      () => resolveModel("veryfront-cloud/mistral/mistral-small-2603"),
      Error,
      'Unsupported Mistral model "mistral/mistral-small-2603"',
    );
    assertThrows(
      () => resolveModel("veryfront-cloud/mistral/mistral-medium-3-5"),
      Error,
      'Unsupported Mistral model "mistral/mistral-medium-3-5"',
    );
  });

  it("resolves veryfront-cloud anthropic models without project ext-llm-anthropic installed", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/anthropic/claude-sonnet-4-6") as Record<
      string,
      unknown
    >;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
    assertEquals(model._generateViaStream, true);
  });

  it("resolves veryfront-cloud google models without project ext-llm-google installed", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/google-ai-studio/gemini-2.5-flash") as Record<
      string,
      unknown
    >;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
    assertEquals(model._generateViaStream, true);
  });

  it("resolves direct anthropic models through the built-in provider", () => {
    setEnv("ANTHROPIC_API_KEY", "anthropic_test_provider");

    const model = resolveModel("anthropic/claude-sonnet-4-6") as Record<string, unknown>;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
  });

  it("resolves direct google models through the built-in provider", () => {
    setEnv("GOOGLE_API_KEY", "google_test_provider");

    const model = resolveModel("google/gemini-2.5-flash") as Record<string, unknown>;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
  });

  it("resolves direct Mistral models through the OpenAI-compatible built-in provider", () => {
    setEnv("MISTRAL_API_KEY", "mistral_test_provider");

    const model = resolveModel("mistral/mistral-large-2512") as Record<string, unknown>;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
  });

  it("resolves veryfront-cloud openai embedding models without project ext-llm-openai installed", () => {
    setCloudBootstrap();

    const model = resolveEmbeddingModel("veryfront-cloud/openai/text-embedding-3-small") as Record<
      string,
      unknown
    >;

    assertEquals(typeof model.doEmbed, "function");
  });

  it("fails fast on malformed veryfront-cloud model IDs", () => {
    setCloudBootstrap();

    assertThrows(
      () => resolveModel("veryfront-cloud/openai"),
      Error,
      'Invalid veryfront-cloud model string: "openai"',
    );
  });

  it("rejects unsupported embedding providers for veryfront-cloud", () => {
    setCloudBootstrap();

    assertThrows(
      () => resolveEmbeddingModel("veryfront-cloud/anthropic/claude-sonnet-4-6"),
      Error,
      'Embedding provider "anthropic" is not supported',
    );
  });
});
