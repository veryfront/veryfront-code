import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearEmbeddingProviders, resolveEmbeddingModel } from "#veryfront/embedding/index.ts";
import { clearModelProviders, resolveModel } from "#veryfront/provider";
import type { ModelRuntime } from "../types.ts";
import { preferStreamedGenerate } from "./provider.ts";

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

  it("preserves class runtime receivers while enabling streamed generation", async () => {
    class PrivateRuntime {
      #calls = 0;

      doGenerate() {
        this.#calls++;
        return Promise.resolve({});
      }

      doStream() {
        this.#calls++;
        return Promise.resolve({ stream: new ReadableStream() });
      }

      get calls(): number {
        return this.#calls;
      }
    }

    const source = new PrivateRuntime();
    const preferred = preferStreamedGenerate(source as unknown as ModelRuntime);
    await preferred.doGenerate({ prompt: [] });

    assertEquals(preferred._generateViaStream, true);
    assertEquals(source.calls, 1);

    const nonExtensibleSource = Object.preventExtensions(new PrivateRuntime());
    const wrapped = preferStreamedGenerate(nonExtensibleSource as unknown as ModelRuntime);
    await wrapped.doStream({ prompt: [] });
    assertEquals(wrapped._generateViaStream, true);
    assertEquals(nonExtensibleSource.calls, 1);
  });

  it("resolves veryfront-cloud openai models without project ext-llm-openai installed", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/openai/gpt-5.4-nano") as Record<string, unknown>;

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
                'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3,"veryfront":{"billable_input_tokens":2,"billable_output_tokens":1,"provider_input_cost_usd":0.0004,"provider_output_cost_usd":0.0006,"provider_cost_usd":0.001,"veryfront_input_charge_usd":0.001,"veryfront_output_charge_usd":0.0015,"veryfront_charge_usd":0.0025,"cost_source":"gateway","billing_mode":"deferred","usage_capture_status":"complete"}}}\n\n',
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
      providerInputCostUsd: 0.0004,
      providerOutputCostUsd: 0.0006,
      providerCostUsd: 0.001,
      veryfrontInputChargeUsd: 0.001,
      veryfrontOutputChargeUsd: 0.0015,
      veryfrontChargeUsd: 0.0025,
      costSource: "gateway",
      billingMode: "deferred",
      usageCaptureStatus: "complete",
    });
  });

  it("routes reasoning-capable OpenAI models through Responses with default reasoning", async () => {
    setCloudBootstrap();
    const encoder = new TextEncoder();
    let capturedRequest: Request | undefined;
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      const request = new Request(input, init);
      capturedRequest = request;
      capturedBody = JSON.parse(await request.text()) as Record<string, unknown>;
      const requestUrl = request.url;

      if (requestUrl.endsWith("/responses")) {
        return new Response(
          ReadableStream.from([
            encoder.encode(
              'data: {"type":"response.output_item.added","item":{"id":"rs_1","type":"reasoning"}}\n\n',
            ),
            encoder.encode(
              'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","delta":"Thinking."}\n\n',
            ),
            encoder.encode(
              'data: {"type":"response.output_item.done","item":{"id":"rs_1","type":"reasoning"}}\n\n',
            ),
            encoder.encode(
              'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"Hello"}\n\n',
            ),
            encoder.encode(
              'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3}}}\n\n',
            ),
            encoder.encode("data: [DONE]\n\n"),
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }

      return new Response(
        ReadableStream.from([
          encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
          encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
          encoder.encode("data: [DONE]\n\n"),
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch;

    const assistant = agent({
      model: "veryfront-cloud/openai/gpt-5.4-nano",
      system: "You are concise.",
    });

    const result = await assistant.generate({ input: "Hi" });

    assertEquals(
      capturedRequest?.url,
      "https://api.veryfront.com/ai/gateway/openai/v1/responses",
    );
    assertEquals(capturedBody?.stream, true);
    assertEquals(capturedBody?.reasoning, { effort: "medium", summary: "auto" });
    assertEquals(result.text, "Hello");
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
      "Mistral model is not supported",
    );
    assertThrows(
      () => resolveModel("veryfront-cloud/mistral/mistral-medium-3-5"),
      Error,
      "Mistral model is not supported",
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
      "Invalid veryfront-cloud model string",
    );
  });

  it("rejects unsupported embedding providers for veryfront-cloud", () => {
    setCloudBootstrap();

    assertThrows(
      () => resolveEmbeddingModel("veryfront-cloud/anthropic/claude-sonnet-4-6"),
      Error,
      "Embedding provider is not supported",
    );
  });
});
