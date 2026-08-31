import "#veryfront/schemas/_test-setup.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearEmbeddingProviders, resolveEmbeddingModel } from "#veryfront/embedding/index.ts";
import { ensureBuiltinLLMProviders } from "#veryfront/extensions/builtin-extensions.ts";
import { clearModelProviders, resolveModel } from "#veryfront/provider";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { getVeryfrontCloudAuthToken } from "#veryfront/platform/cloud/resolver.ts";
import { runWithVeryfrontCloudInferenceCredential } from "./provider.ts";

const CLOUD_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_DEFAULT_MODEL",
  "VERYFRONT_SERVICE_LAYER",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "MISTRAL_API_KEY",
] as const;

function readableStreamFrom<T>(values: Iterable<T>): ReadableStream<T> {
  return new ReadableStream({
    start(controller) {
      for (const value of values) controller.enqueue(value);
      controller.close();
    },
  });
}

async function drainStream(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // drain: the assertions target the outgoing request, not the parsed chunks
  }
  reader.releaseLock();
}

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
  afterEach(() => {
    restoreMockFetch();
    clearCloudEnv();
    clearModelProviders();
    clearEmbeddingProviders();
  });

  it("resolves veryfront-cloud openai models without project ext-llm-openai installed", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/openai/gpt-5.4-nano") as Record<string, unknown>;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
    assertEquals(model._generateViaStream, true);
    assertEquals(model.modelProvider, "openai");
  });

  it("uses the private inference credential only for gateway model construction", async () => {
    setCloudBootstrap();
    let capturedAuthorization: string | null = null;
    let projectVisibleToken: string | undefined;

    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedAuthorization = request.headers.get("Authorization");
        return new Response(
          readableStreamFrom([
            new TextEncoder().encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
            new TextEncoder().encode("data: [DONE]\n\n"),
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }) as typeof fetch,
    );

    await runWithVeryfrontCloudInferenceCredential(
      "run-scoped-inference-token",
      async () => {
        projectVisibleToken = getVeryfrontCloudAuthToken();
        const model = resolveModel("veryfront-cloud/openai/gpt-test");
        const result = await model.doStream({ prompt: [] });
        await drainStream(result.stream);
      },
    );

    assertEquals(capturedAuthorization, "Bearer run-scoped-inference-token");
    assertEquals(projectVisibleToken, "vf_test_provider");
  });

  it("preserves class runtime method receivers while adding cloud metadata", async () => {
    setCloudBootstrap();

    class PrivateFieldRuntime implements ModelRuntime {
      [key: string]: unknown;
      readonly #calls: string[] = [];
      readonly #modelId = "private-field-runtime";
      readonly #provider = "private-provider";
      readonly #runtimeCapabilities = { toolCalling: true } as const;

      get modelId(): string {
        return this.#modelId;
      }

      get provider(): string {
        return this.#provider;
      }

      get runtimeCapabilities(): { readonly toolCalling: true } {
        return this.#runtimeCapabilities;
      }

      prepare(): Promise<void> {
        this.#calls.push("prepare");
        return Promise.resolve();
      }

      doGenerate(): Promise<{ content: unknown[] }> {
        this.#calls.push("generate");
        return Promise.resolve({ content: [] });
      }

      doStream(): Promise<{ stream: ReadableStream<unknown> }> {
        this.#calls.push("stream");
        return Promise.resolve({ stream: readableStreamFrom([]) });
      }

      calls(): string[] {
        return [...this.#calls];
      }
    }

    const runtime = new PrivateFieldRuntime();
    const registry = ensureBuiltinLLMProviders();
    const builtinOpenAI = registry.require("openai");
    registry.unregister("openai");
    registry.register({
      id: "openai",
      createModel: () => runtime,
    });

    try {
      const model = resolveModel("veryfront-cloud/openai/private-field-runtime");

      await model.prepare?.();
      await model.doGenerate({});
      await model.doStream({});

      assertEquals(runtime.calls(), ["prepare", "generate", "stream"]);
      assertEquals(model.modelId, "private-field-runtime");
      assertEquals(model.provider, "private-provider");
      assertEquals(model.runtimeCapabilities, { toolCalling: true });
      assertEquals(model._generateViaStream, true);
      assertEquals(model.modelProvider, "openai");
    } finally {
      registry.unregister("openai");
      registry.register(builtinOpenAI);
    }
  });

  it("routes agent.generate through the streaming Veryfront Cloud gateway path", async () => {
    setCloudBootstrap();
    const encoder = new TextEncoder();
    let capturedRequest: Request | undefined;
    let capturedBody: Record<string, unknown> | undefined;

    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
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
      }) as typeof fetch,
    );

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

  it("routes Azure-backed GPT models through Chat Completions", async () => {
    setCloudBootstrap();
    const encoder = new TextEncoder();
    const capturedRequests: Array<{ url: string; body: Record<string, unknown> }> = [];

    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedRequests.push({
          url: request.url,
          body: JSON.parse(await request.text()) as Record<string, unknown>,
        });

        return new Response(
          readableStreamFrom([
            encoder.encode(
              'data: {"prompt_filter_results":[{"prompt_index":0,"content_filter_results":{}}],"choices":[]}\n\n',
            ),
            encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
            encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
            encoder.encode("data: [DONE]\n\n"),
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }) as typeof fetch,
    );

    for (const modelId of ["gpt-5.4", "gpt-5.5"]) {
      const assistant = agent({
        model: `veryfront-cloud/openai/${modelId}`,
        system: "You are concise.",
      });

      const result = await assistant.generate({ input: "Hi", maxOutputTokens: 32 });
      assertEquals(result.text, "Hello");
    }

    assertEquals(
      capturedRequests.map(({ url }) => url),
      [
        "https://api.veryfront.com/ai/gateway/openai/v1/chat/completions",
        "https://api.veryfront.com/ai/gateway/openai/v1/chat/completions",
      ],
    );
    // gpt-5.4 and gpt-5.5 are reasoning-capable, so they carry the documented
    // default effort. This used to arrive as undefined, but only because the
    // agent was never genuinely tool-less: three skill tools were injected into
    // every agent, and a bare agent could not reach the tool-less path at all.
    assertEquals(
      capturedRequests.map(({ body }) => body.reasoning_effort),
      ["medium", "medium"],
    );
    // An agent that declares no skills, in a project with none, no longer
    // advertises a tool that could only answer "no such skill".
    assertEquals(
      capturedRequests.map(({ body }) =>
        (body.tools as Array<{ function?: { name?: string } }> | undefined)?.some(
          (tool) => tool.function?.name === "load_skill",
        )
      ),
      [undefined, undefined],
    );
    assertEquals(
      capturedRequests.map(({ body }) => ({
        maxTokens: body.max_tokens,
        maxCompletionTokens: body.max_completion_tokens,
      })),
      [
        { maxTokens: undefined, maxCompletionTokens: 32 },
        { maxTokens: undefined, maxCompletionTokens: 32 },
      ],
    );
  });

  it("routes reasoning-capable OpenAI models through Responses with default reasoning", async () => {
    setCloudBootstrap();
    const encoder = new TextEncoder();
    let capturedRequest: Request | undefined;
    let capturedBody: Record<string, unknown> | undefined;

    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedRequest = request;
        capturedBody = JSON.parse(await request.text()) as Record<string, unknown>;
        const requestUrl = request.url;

        if (requestUrl.endsWith("/responses")) {
          return new Response(
            readableStreamFrom([
              encoder.encode(
                'data: {"type":"response.output_item.added","item":{"id":"rs_1","type":"reasoning"}}\n\n',
              ),
              encoder.encode(
                'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","output_index":0,"summary_index":0,"delta":"Thinking."}\n\n',
              ),
              encoder.encode(
                'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"rs_1","type":"reasoning","status":"completed","summary":[{"type":"summary_text","text":"Thinking."}]}}\n\n',
              ),
              encoder.encode(
                'data: {"type":"response.output_item.added","output_index":1,"item":{"id":"msg_1","type":"message","role":"assistant","status":"in_progress","content":[]}}\n\n',
              ),
              encoder.encode(
                'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":1,"content_index":0,"delta":"Hello"}\n\n',
              ),
              encoder.encode(
                'data: {"type":"response.output_item.done","output_index":1,"item":{"id":"msg_1","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Hello"}]}}\n\n',
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
          readableStreamFrom([
            encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
            encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
            encoder.encode("data: [DONE]\n\n"),
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }) as typeof fetch,
    );

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
    assertEquals(model.modelProvider, "moonshotai");
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
    assertEquals(model.modelProvider, "mistral");
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
    assertEquals(model.modelProvider, "anthropic");
  });

  it("routes veryfront-cloud anthropic requests through the guarded gateway fetch", async () => {
    setCloudBootstrap();
    let capturedRequest: Request | undefined;

    installMockFetch(
      ((input: URL | Request | string, init?: RequestInit) => {
        capturedRequest = new Request(input, init);

        return Promise.resolve(
          new Response(
            [
              'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
              'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
              'event: message_stop\ndata: {"type":"message_stop"}\n\n',
            ].join(""),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        );
      }) as typeof fetch,
    );

    const model = resolveModel("veryfront-cloud/anthropic/claude-sonnet-4-6");
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });
    await drainStream(stream);

    assertEquals(
      capturedRequest?.url.startsWith("https://api.veryfront.com/ai/gateway/anthropic/v1"),
      true,
      "the anthropic runtime must be pointed at the Veryfront Cloud anthropic gateway",
    );
    assertEquals(
      capturedRequest?.headers.get("authorization"),
      "Bearer vf_test_provider",
      "the anthropic runtime must send the Veryfront token as Bearer auth, not native auth",
    );
    assertEquals(
      capturedRequest?.headers.get("x-veryfront-project-slug"),
      "provider-test-project",
      "the guarded gateway fetch must stamp the bootstrap project slug on anthropic requests",
    );
    assertEquals(
      capturedRequest?.headers.get("x-api-key"),
      null,
      "the Veryfront token must never leak through Anthropic's native x-api-key header",
    );
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
    assertEquals(model.modelProvider, "google");
  });

  it("routes veryfront-cloud google requests through the guarded gateway fetch", async () => {
    setCloudBootstrap();
    const encoder = new TextEncoder();
    let capturedRequest: Request | undefined;

    installMockFetch(
      ((input: URL | Request | string, init?: RequestInit) => {
        capturedRequest = new Request(input, init);

        return Promise.resolve(
          new Response(
            readableStreamFrom([
              encoder.encode(
                'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}\n\n',
              ),
              encoder.encode(
                'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}\n\n',
              ),
              encoder.encode("data: [DONE]\n\n"),
            ]),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        );
      }) as typeof fetch,
    );

    const model = resolveModel("veryfront-cloud/google-ai-studio/gemini-2.5-flash");
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });
    await drainStream(stream);

    assertEquals(
      capturedRequest?.url.startsWith("https://api.veryfront.com/ai/gateway/google/v1beta"),
      true,
      "the google runtime must be pointed at the Veryfront Cloud google gateway",
    );
    assertEquals(
      capturedRequest?.headers.get("authorization"),
      "Bearer vf_test_provider",
      "the google runtime must send the Veryfront token as Bearer auth, not native auth",
    );
    assertEquals(
      capturedRequest?.headers.get("x-veryfront-project-slug"),
      "provider-test-project",
      "the guarded gateway fetch must stamp the bootstrap project slug on google requests",
    );
    assertEquals(
      capturedRequest?.headers.get("x-goog-api-key"),
      null,
      "the Veryfront token must never leak through Google's native x-goog-api-key header",
    );
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
