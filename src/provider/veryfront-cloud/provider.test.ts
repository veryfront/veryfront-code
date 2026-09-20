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
import { createVeryfrontCloudInferenceModel } from "./provider.ts";
import { createVeryfrontCloudFetch } from "./shared.ts";
import {
  isVeryfrontGatewayResponse,
  markVeryfrontGatewayResponse,
  requestJson,
} from "#veryfront/provider/runtime-loader/provider-http.ts";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { withEnv } from "#veryfront/testing";
import {
  __resetOperatorVeryfrontApiOriginsForTests,
  __runWithOutboundFetchTransportForTests,
  OutboundRequestBlockedError,
  trustOperatorConfiguredVeryfrontApiOrigins,
} from "#veryfront/security/http/outbound-fetch.ts";
import { AnthropicProvider } from "@veryfront/ext-llm-anthropic";
import { GoogleProvider } from "@veryfront/ext-llm-google";
import { OpenAIProvider } from "@veryfront/ext-llm-openai";
import { deleteHostSecret, setHostSecret } from "#veryfront/platform/compat/process/env.ts";

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

/**
 * Records the request URL a model builds without asserting on the response
 * body: the wire route is decided before any chunk is parsed, so an empty
 * stream is enough and keeps the fixture free of per-provider payload shapes.
 */
async function captureGatewayRequestUrl(modelId: string): Promise<string | undefined> {
  let capturedUrl: string | undefined;
  installMockFetch(
    ((input: URL | Request | string, init?: RequestInit) => {
      capturedUrl ??= new Request(input, init).url;
      return Promise.resolve(
        new Response(new ReadableStream({ start: (controller) => controller.close() }), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }) as typeof fetch,
  );

  const model = resolveModel(`veryfront-cloud/${modelId}`) as ModelRuntime;
  try {
    const result = await model.doStream({ prompt: [] } as never);
    const stream = (result as { stream?: ReadableStream<unknown> }).stream;
    if (stream) {
      const reader = stream.getReader();
      while (!(await reader.read()).done) {
        // drain: the assertion targets the outgoing request, not the chunks
      }
      reader.releaseLock();
    }
  } catch {
    // expected: an empty gateway stream is not a valid provider response
  }
  return capturedUrl;
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
    deleteHostSecret("VERYFRONT_API_TOKEN");
  });

  it("keeps gateway provenance marks working when WeakSet methods are replaced", async () => {
    const wrappedFetch = createVeryfrontCloudFetch(
      "vf_test_provider",
      "https://93.184.216.34/ai/gateway/openai/v1",
    );
    const originalAdd = WeakSet.prototype.add;
    const originalHas = WeakSet.prototype.has;
    let response: Response | undefined;
    installMockFetch(async () => new Response(null, { status: 204 }));
    try {
      WeakSet.prototype.add = () => {
        throw new Error("poisoned add");
      };
      WeakSet.prototype.has = () => {
        throw new Error("poisoned has");
      };
      response = await wrappedFetch(
        "https://93.184.216.34/ai/gateway/openai/v1/chat/completions",
      );
      assertEquals(isVeryfrontGatewayResponse(response), true);
    } finally {
      WeakSet.prototype.add = originalAdd;
      WeakSet.prototype.has = originalHas;
      restoreMockFetch();
    }
    assertEquals(response?.status, 204);
  });

  it("keeps gateway rejection provenance when Object.defineProperty is replaced", async () => {
    const originalDefineProperty = Object.defineProperty;
    let rejection: unknown;
    const request = requestJson({
      url: "https://93.184.216.34/ai/gateway/openai/v1/chat/completions",
      fetchImpl: () =>
        Promise.resolve(
          markVeryfrontGatewayResponse(new Response('{"error":"Unauthorized"}', { status: 401 })),
        ),
      init: { method: "POST", body: "{}" },
      providerLabel: "veryfront-cloud",
      providerKind: "openai",
    });
    try {
      Object.defineProperty = (() => {
        throw new Error("poisoned defineProperty");
      }) as typeof Object.defineProperty;
      rejection = await request.then(() => undefined, (error: unknown) => error);
    } finally {
      Object.defineProperty = originalDefineProperty;
    }

    assertEquals((rejection as { status?: number }).status, 401);
    assertEquals((rejection as { viaVeryfrontGateway?: boolean }).viaVeryfrontGateway, true);
  });

  it("resolves veryfront-cloud openai models without project ext-llm-openai installed", () => {
    setCloudBootstrap();

    const model = resolveModel("veryfront-cloud/openai/gpt-5.4-nano") as Record<string, unknown>;

    assertEquals(typeof model.doGenerate, "function");
    assertEquals(typeof model.doStream, "function");
    assertEquals(model._generateViaStream, true);
    assertEquals(model.modelProvider, "openai");
  });

  it("keeps a stored login token out of replaceable provider registrations", () => {
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
    const registry = ensureBuiltinLLMProviders();
    const builtinOpenAI = registry.require("openai");
    let extensionCalled = false;
    registry.unregister("openai");
    registry.register({
      id: "openai",
      createModel() {
        extensionCalled = true;
        throw new Error("project provider must not receive stored auth");
      },
    });

    try {
      const model = resolveModel("veryfront-cloud/openai/gpt-5.4-nano");
      assertEquals(typeof model.doStream, "function");
      assertEquals(extensionCalled, false);
    } finally {
      registry.unregister("openai");
      registry.register(builtinOpenAI);
    }
  });

  it("keeps stored login tokens out of embedding provider extensions", () => {
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
    const registry = ensureBuiltinLLMProviders();
    const builtinGoogle = registry.require("google");
    let extensionCalled = false;
    registry.unregister("google");
    registry.register({
      id: "google",
      createModel() {
        throw new Error("Expected embedding path");
      },
      createEmbedding() {
        extensionCalled = true;
        throw new Error("project embedding extension must not receive stored auth");
      },
    });
    try {
      const model = resolveEmbeddingModel("veryfront-cloud/google/text-embedding-004");
      assertEquals(typeof model.doEmbed, "function");
      assertEquals(extensionCalled, false);
    } finally {
      registry.unregister("google");
      registry.register(builtinGoogle);
    }
  });

  it("uses the private inference credential only for gateway model construction", async () => {
    setCloudBootstrap();
    let capturedAuthorization: string | null = null;
    let projectVisibleToken: string | undefined;
    let extensionVisibleCredential: string | undefined;

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

    const registry = ensureBuiltinLLMProviders();
    const builtinOpenAI = registry.require("openai");
    registry.unregister("openai");
    registry.register({
      id: "openai",
      createModel(_modelId, config) {
        extensionVisibleCredential = config.credential;
        return {
          provider: "project-openai",
          modelId: "project-openai",
          specificationVersion: "v3",
          doGenerate: () => Promise.resolve({ content: [] }),
          doStream: () => Promise.resolve({ stream: readableStreamFrom([]) }),
        };
      },
    });

    try {
      projectVisibleToken = getVeryfrontCloudAuthToken();
      const model = createVeryfrontCloudInferenceModel(
        "openai/gpt-test",
        "run-scoped-inference-token",
      );
      const result = await model.doStream({ prompt: [] });
      await drainStream(result.stream);
    } finally {
      registry.unregister("openai");
      registry.register(builtinOpenAI);
    }

    assertEquals(capturedAuthorization, "Bearer run-scoped-inference-token");
    assertEquals(projectVisibleToken, "vf_test_provider");
    assertEquals(extensionVisibleCredential, undefined);
  });

  it("does not expose explicit inference authority to mutable runtime config hooks", async () => {
    setCloudBootstrap();
    const globalRecord = globalThis as Record<string, unknown>;
    const originalConfigGetter = globalRecord.__vfGetRuntimeConfig;
    const originalConfigChecker = globalRecord.__vfIsRuntimeConfigInitialized;
    let retainedNestedModel: ModelRuntime | undefined;
    let resolvingNestedModel = false;

    globalRecord.__vfIsRuntimeConfigInitialized = () => true;
    globalRecord.__vfGetRuntimeConfig = () => {
      if (!resolvingNestedModel) {
        resolvingNestedModel = true;
        try {
          retainedNestedModel = resolveModel("veryfront-cloud/openai/gpt-nested");
        } finally {
          resolvingNestedModel = false;
        }
      }
      return {};
    };

    let inferenceModel: ModelRuntime;
    try {
      inferenceModel = createVeryfrontCloudInferenceModel(
        "openai/gpt-protected",
        "run-scoped-inference-token",
      );
    } finally {
      if (originalConfigGetter === undefined) delete globalRecord.__vfGetRuntimeConfig;
      else globalRecord.__vfGetRuntimeConfig = originalConfigGetter;
      if (originalConfigChecker === undefined) delete globalRecord.__vfIsRuntimeConfigInitialized;
      else globalRecord.__vfIsRuntimeConfigInitialized = originalConfigChecker;
    }

    const capturedAuthorization: Array<string | null> = [];
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedAuthorization.push(request.headers.get("Authorization"));
        return new Response(
          readableStreamFrom([
            new TextEncoder().encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
            new TextEncoder().encode("data: [DONE]\n\n"),
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }) as typeof fetch,
    );

    const nestedResult = await retainedNestedModel!.doStream({ prompt: [] });
    await drainStream(nestedResult.stream);
    const inferenceResult = await inferenceModel.doStream({ prompt: [] });
    await drainStream(inferenceResult.stream);

    assertEquals(capturedAuthorization, [
      "Bearer vf_test_provider",
      "Bearer run-scoped-inference-token",
    ]);
  });

  it("keeps explicit inference authority out of provider-native headers", async () => {
    setCloudBootstrap();
    const inferenceCredential = "x".repeat(16 * 1024);
    let capturedAuthorization: string | null = null;
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
    const model = createVeryfrontCloudInferenceModel(
      "openai/gpt-test",
      inferenceCredential,
    );
    const originalSet = Object.getOwnPropertyDescriptor(Headers.prototype, "set")!;
    const observedNativeCredentials: string[] = [];
    Object.defineProperty(Headers.prototype, "set", {
      ...originalSet,
      value(this: Headers, name: string, value: string) {
        if (name.toLowerCase() === "authorization") {
          observedNativeCredentials.push(value);
        }
        return Reflect.apply(originalSet.value, this, [name, value]);
      },
    });

    try {
      const result = await model.doStream({ prompt: [] });
      await drainStream(result.stream);
    } finally {
      Object.defineProperty(Headers.prototype, "set", originalSet);
    }

    assertEquals(observedNativeCredentials.includes(`Bearer ${inferenceCredential}`), false);
    assertEquals(capturedAuthorization, `Bearer ${inferenceCredential}`);
  });

  it("does not expose credential-bearing models to mutable object intrinsics", () => {
    setCloudBootstrap();
    const originalCreate = Object.create;
    const originalDefineProperties = Object.defineProperties;
    const originalDefineProperty = Object.defineProperty;
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const originalGetPrototypeOf = Object.getPrototypeOf;
    const originalOwnKeys = Reflect.ownKeys;
    const originalRandomUuid = Crypto.prototype.randomUUID;
    let retainedModelCapability = false;
    let mutableRandomUuidCalled = false;
    const observe = (value: unknown): void => {
      if (
        value !== null && typeof value === "object" &&
        typeof (value as { doStream?: unknown }).doStream === "function"
      ) {
        retainedModelCapability = true;
      }
    };

    Object.create = ((prototype: object | null, properties?: PropertyDescriptorMap) => {
      observe(prototype);
      return properties === undefined
        ? originalCreate(prototype)
        : originalCreate(prototype, properties);
    }) as typeof Object.create;
    Object.defineProperties = ((object: object, properties: PropertyDescriptorMap) => {
      observe(object);
      return originalDefineProperties(object, properties);
    }) as typeof Object.defineProperties;
    Object.defineProperty = ((object: object, key: PropertyKey, descriptor: PropertyDescriptor) => {
      observe(object);
      return originalDefineProperty(object, key, descriptor);
    }) as typeof Object.defineProperty;
    Object.getOwnPropertyDescriptor = ((object: object, key: PropertyKey) => {
      observe(object);
      return originalGetOwnPropertyDescriptor(object, key);
    }) as typeof Object.getOwnPropertyDescriptor;
    Object.getPrototypeOf = ((object: object) => {
      observe(object);
      return originalGetPrototypeOf(object);
    }) as typeof Object.getPrototypeOf;
    Reflect.ownKeys = ((target: object) => {
      observe(target);
      return originalOwnKeys(target);
    }) as typeof Reflect.ownKeys;
    Crypto.prototype.randomUUID = function (): `${string}-${string}-${string}-${string}-${string}` {
      mutableRandomUuidCalled = true;
      return "00000000-0000-4000-8000-000000000000";
    };

    try {
      createVeryfrontCloudInferenceModel(
        "openai/gpt-test",
        "run-scoped-inference-token",
      );
    } finally {
      Object.create = originalCreate;
      Object.defineProperties = originalDefineProperties;
      Object.defineProperty = originalDefineProperty;
      Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
      Object.getPrototypeOf = originalGetPrototypeOf;
      Reflect.ownKeys = originalOwnKeys;
      Crypto.prototype.randomUUID = originalRandomUuid;
    }

    assertEquals(retainedModelCapability, false);
    assertEquals(mutableRandomUuidCalled, false);
  });

  it("does not make explicit inference authority ambient to ordinary model resolution", async () => {
    setCloudBootstrap();
    let capturedAuthorization: string | null = null;

    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedAuthorization = request.headers.get("Authorization");
        return new Response(
          readableStreamFrom([
            new TextEncoder().encode(
              'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
            ),
            new TextEncoder().encode("data: [DONE]\n\n"),
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }) as typeof fetch,
    );

    createVeryfrontCloudInferenceModel("openai/gpt-unused", "parent-run-inference-token");
    const model = resolveModel("veryfront-cloud/openai/gpt-test");
    const result = await model.doStream({ prompt: [] });
    await drainStream(result.stream);

    assertEquals(capturedAuthorization, "Bearer vf_test_provider");
  });

  it("uses the credential passed to each explicit inference model", async () => {
    setCloudBootstrap();
    let capturedAuthorization: string | null = null;

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

    createVeryfrontCloudInferenceModel("openai/gpt-unused", "parent-run-inference-token");
    const model = createVeryfrontCloudInferenceModel(
      "openai/gpt-test",
      "child-run-inference-token",
    );
    const result = await model.doStream({ prompt: [] });
    await drainStream(result.stream);

    assertEquals(capturedAuthorization, "Bearer child-run-inference-token");
  });

  it("does not dispatch signed inference through mutable provider prototypes", () => {
    setCloudBootstrap();
    const originalAnthropicCreateModel = AnthropicProvider.prototype.createModel;
    const originalGoogleCreateModel = GoogleProvider.prototype.createModel;
    const originalOpenAICreateModel = OpenAIProvider.prototype.createModel;
    const extensionVisibleCredentials: string[] = [];

    AnthropicProvider.prototype.createModel = function (_modelId, config) {
      extensionVisibleCredentials.push(config.credential);
      throw new Error("Mutated Anthropic provider called");
    };
    GoogleProvider.prototype.createModel = function (_modelId, config) {
      extensionVisibleCredentials.push(config.credential);
      throw new Error("Mutated Google provider called");
    };
    OpenAIProvider.prototype.createModel = function (_modelId, config) {
      extensionVisibleCredentials.push(config.credential);
      throw new Error("Mutated OpenAI provider called");
    };

    try {
      createVeryfrontCloudInferenceModel(
        "anthropic/claude-test",
        "run-scoped-inference-token",
      );
      createVeryfrontCloudInferenceModel(
        "google/gemini-test",
        "run-scoped-inference-token",
      );
      createVeryfrontCloudInferenceModel(
        "openai/gpt-test",
        "run-scoped-inference-token",
      );
    } finally {
      AnthropicProvider.prototype.createModel = originalAnthropicCreateModel;
      GoogleProvider.prototype.createModel = originalGoogleCreateModel;
      OpenAIProvider.prototype.createModel = originalOpenAICreateModel;
    }

    assertEquals(extensionVisibleCredentials, []);
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

  it("reaches an operator-exported API origin whose DNS answer is private", async () => {
    const apiBaseUrl = "https://api.staging.example";
    const seen: Request[] = [];
    const fetchStub = (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(input, init));
      return Promise.resolve(Response.json({ ok: true }));
    };
    // A pinned transport keeps Node and Bun off a real socket to the private address.
    const transport = {
      fetch: fetchStub,
      pinnedFetch: (url: URL, _addresses: readonly string[], init: RequestInit) =>
        fetchStub(url, init),
      resolveHost: () => Promise.resolve(["10.255.128.3"]),
    };
    const gatewayUrl = `${apiBaseUrl}/ai/gateway/openai/v1/chat/completions`;

    __resetOperatorVeryfrontApiOriginsForTests();
    try {
      await withEnv({ VERYFRONT_API_URL: apiBaseUrl, VERYFRONT_API_BASE_URL: "" }, async () => {
        const wrappedFetch = createVeryfrontCloudFetch("vf_test_provider", apiBaseUrl);
        await __runWithOutboundFetchTransportForTests(transport, async () => {
          await assertRejects(
            () => wrappedFetch(gatewayUrl),
            OutboundRequestBlockedError,
            "Outbound network egress blocked for host: api.staging.example",
          );
        });
        assertEquals(seen.length, 0);

        trustOperatorConfiguredVeryfrontApiOrigins();
        await __runWithOutboundFetchTransportForTests(transport, async () => {
          assertEquals((await wrappedFetch(gatewayUrl)).status, 200);
        });
      });
    } finally {
      __resetOperatorVeryfrontApiOriginsForTests();
    }
    assertEquals(seen.length, 1);
    assertEquals(seen[0]?.headers.get("authorization"), "Bearer vf_test_provider");
  });

  it("keeps the wire route and provider attribute of one model per provider", async () => {
    setCloudBootstrap();

    const routes: Array<[string, string | undefined, unknown]> = [];
    for (
      const modelId of [
        "anthropic/claude-sonnet-4-6",
        "openai/gpt-5.5",
        "openai/gpt-5.4-nano",
        "google-ai-studio/gemini-3.5-flash",
        "mistral/mistral-large-2512",
        "moonshotai/kimi-k2.6",
      ]
    ) {
      const url = await captureGatewayRequestUrl(modelId);
      const model = resolveModel(`veryfront-cloud/${modelId}`) as unknown as {
        modelProvider?: unknown;
      };
      routes.push([modelId, url, model.modelProvider]);
      restoreMockFetch();
    }

    assertEquals(routes, [
      [
        "anthropic/claude-sonnet-4-6",
        "https://api.veryfront.com/ai/gateway/anthropic/v1/messages",
        "anthropic",
      ],
      [
        "openai/gpt-5.5",
        "https://api.veryfront.com/ai/gateway/openai/v1/chat/completions",
        "openai",
      ],
      [
        "openai/gpt-5.4-nano",
        "https://api.veryfront.com/ai/gateway/openai/v1/responses",
        "openai",
      ],
      [
        "google-ai-studio/gemini-3.5-flash",
        "https://api.veryfront.com/ai/gateway/google/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse",
        "google",
      ],
      [
        "mistral/mistral-large-2512",
        "https://api.veryfront.com/ai/gateway/mistral/v1/chat/completions",
        "mistral",
      ],
      [
        "moonshotai/kimi-k2.6",
        "https://api.veryfront.com/ai/gateway/moonshotai/v1/chat/completions",
        "moonshotai",
      ],
    ]);
  });

  it("reaches a provider the package does not list, with no source change", async () => {
    setCloudBootstrap();
    const encoder = new TextEncoder();
    let capturedRequest: Request | undefined;

    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedRequest = request;
        await request.text();

        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
              );
              controller.enqueue(
                encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
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
      model: "veryfront-cloud/acme-labs/mystery-1",
      system: "You are concise.",
    });

    const result = await assistant.generate({ input: "Hi" });

    assertEquals(
      capturedRequest?.url,
      "https://api.veryfront.com/ai/gateway/acme-labs/v1/chat/completions",
    );
    assertEquals(result.text, "Hello");
  });

  it("keeps an unlisted provider on chat completions for a reasoning-style model id", async () => {
    // "gpt-5.4" is a reasoning-style ID. Only the provider that implements the
    // OpenAI surface natively serves /responses, so an unlisted provider must
    // stay on /chat/completions however its models are named.
    setCloudBootstrap();
    let capturedUrl: string | undefined;
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        capturedUrl ??= new Request(input, init).url;
        return new Response(
          readableStreamFrom([
            new TextEncoder().encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
            new TextEncoder().encode("data: [DONE]\n\n"),
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }) as typeof fetch,
    );

    const model = createVeryfrontCloudInferenceModel(
      "acme-labs/gpt-5.4",
      "run-scoped-inference-token",
    );
    const result = await model.doStream({ prompt: [] });
    await drainStream(result.stream);

    assertEquals(capturedUrl, "https://api.veryfront.com/ai/gateway/acme-labs/v1/chat/completions");
  });

  it("refuses hosted tools on a chat-surface provider instead of switching surface", async () => {
    // A hosted tool is the other way the OpenAI runtime reaches for
    // /responses. Neither a listed provider on the chat surface nor an unlisted
    // one serves that endpoint, so the request fails locally, names the
    // provider's surface as the reason, and sends nothing. Before the surface
    // was pinned, both built a request to /responses on the provider's gateway
    // path instead.
    setCloudBootstrap();

    for (const modelId of ["mistral/mistral-large-2512", "moonshotai/kimi-k2.6", "acme-labs/x"]) {
      let requestCount = 0;
      installMockFetch(
        (() => {
          requestCount += 1;
          return Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch,
      );

      const model = resolveModel(`veryfront-cloud/${modelId}`) as ModelRuntime;
      const provider = modelId.slice(0, modelId.indexOf("/"));

      // The reason names the provider's surface, not a limit of the OpenAI
      // runtime that happens to build the request.
      await assertRejects(
        async () =>
          await model.doStream({
            prompt: [],
            tools: [{ type: "provider", name: "web_search", id: "openai.web_search", args: {} }],
          } as never),
        TypeError,
        `Veryfront Cloud provider "${provider}" speaks the OpenAI chat completions surface, ` +
          "which carries no hosted tools.",
      );
      assertEquals(requestCount, 0);
      restoreMockFetch();
    }
  });
});
