import "#veryfront/schemas/_test-setup.ts";
import { agent as createAgent } from "#veryfront/agent";
import { createDetachedRunTracker } from "#veryfront/agent/service/detached-run-tracker.ts";
import { createHostedAgentServiceRouteSet } from "#veryfront/agent/service/routes.ts";
import type { HostedServiceAuthenticatedRequest } from "#veryfront/agent/service/auth.ts";
import type { AgUiResumeValue } from "#veryfront/agent/ag-ui/tool-shared.ts";
import {
  createHostedInferenceModelResolver,
  createVeryfrontCloudInferenceModelResolver,
  registerHostedInferenceCredential,
} from "#veryfront/agent/hosted/inference-credential.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearModelProviders, registerModelProvider, resolveModel } from "#veryfront/provider";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import {
  createRuntimeAgentStreamResponse,
  registerRuntimeInferenceCredential,
} from "#veryfront/internal-agents/run-stream.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import { RuntimeAgentRunInvocationSchema } from "#veryfront/agent/runtime/agent-invocation-contract.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  installMockFetch,
  restoreMockFetch,
  withMockFetch,
} from "#veryfront/testing/mock-fetch.ts";
import { createVeryfrontCloudContextSummaryGenerator } from "#veryfront/agent/hosted/context-summary-generator.ts";
import { runWithVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import {
  createVeryfrontCloudFetch,
  requireVeryfrontCloudBootstrap,
} from "#veryfront/provider/veryfront-cloud/shared.ts";
import { VeryfrontError } from "#veryfront/errors";

async function drainStream(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // drain: the assertions target the outgoing request, not parsed chunks
  }
  reader.releaseLock();
}

function runtimeAgentInvocation(inferenceAuthToken: string): Record<string, unknown> {
  return {
    run: {
      agentServiceId: "test-agent-service",
      agentId: "builder",
      conversationId: "00000000-0000-4000-8000-000000000001",
      runId: "run-1",
      messageId: "00000000-0000-4000-8000-000000000002",
      inputAnchorMessageId: "00000000-0000-4000-8000-000000000003",
      requestedByUserId: "00000000-0000-4000-8000-000000000004",
      project: {
        projectId: "00000000-0000-4000-8000-000000000005",
        projectSlug: "demo",
      },
    },
    messages: [],
    tools: [],
    context: [],
    agentSource: { type: "release", releaseId: "release-42" },
    credentials: {
      authToken: "broader-runtime-token",
      inferenceAuthToken,
    },
  };
}

describe("run-scoped inference credential", () => {
  afterEach(() => {
    restoreMockFetch();
    clearModelProviders();
    deleteEnv("VERYFRONT_API_TOKEN");
    deleteEnv("VERYFRONT_PROJECT_SLUG");
  });

  it("keeps inference authority off the public AgentRuntime object", () => {
    const inferenceAuthToken = "run-scoped-inference-token";
    const runtime = new AgentRuntime(
      "private-inference-runtime",
      {
        model: "veryfront-cloud/openai/gpt-test",
        system: "Answer concisely.",
      },
      {
        resolveModelRuntime: () => {
          throw new Error(inferenceAuthToken);
        },
      },
    );

    assertEquals(Reflect.get(runtime, "resolveModelRuntime"), undefined);
    assertEquals(Reflect.get(runtime, "resolveModelTransport"), undefined);
    assertEquals(JSON.stringify(runtime).includes(inferenceAuthToken), false);
  });

  it("keeps the dedicated credential private through internal stream pulls", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-runtime-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    const capturedAuthorizations: Array<string | null> = [];
    const encoder = new TextEncoder();
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedAuthorizations.push(request.headers.get("Authorization"));
        return new Response(
          new ReadableStream({
            start(controller) {
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
    const runtimeAgent = createAgent({
      id: "run-scoped-inference-agent",
      model: "veryfront-cloud/openai/gpt-test",
      system: "Answer concisely.",
      skills: false,
      middleware: [async (_context, next) => {
        const projectModel = resolveModel("veryfront-cloud/openai/gpt-project-callback");
        const result = await projectModel.doStream({ prompt: [] });
        await drainStream(result.stream);
        return await next();
      }],
    });

    const runtimeInput = {
      agentId: runtimeAgent.id,
      threadId: crypto.randomUUID(),
      runId: "run_scoped_inference_1",
      messages: [{ id: "user-1", role: "user", content: "Hello" }],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];
    registerRuntimeInferenceCredential(runtimeInput, "run-scoped-inference-token");
    const response = await createRuntimeAgentStreamResponse(
      runtimeInput,
      runtimeAgent,
      {
        sessionManager: new AgentRunSessionManager(),
      },
    );
    await response.text();

    assertEquals(capturedAuthorizations, [
      "Bearer broader-project-runtime-token",
      "Bearer run-scoped-inference-token",
    ]);
  });

  it("bypasses project model overrides for credentialed Veryfront Cloud resolution", () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-runtime-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    const request = {} as Parameters<typeof registerHostedInferenceCredential>[0];
    registerHostedInferenceCredential(request, "run-scoped-inference-token");
    let projectResolverCalls = 0;
    const unregister = registerModelProvider("veryfront-cloud", () => {
      projectResolverCalls += 1;
      throw new Error("Project model override must not handle signed inference");
    });

    try {
      const resolver = createHostedInferenceModelResolver(request);
      const model = resolver?.("veryfront-cloud/openai/gpt-test");
      assertEquals(typeof model?.doStream, "function");
    } finally {
      unregister();
    }

    assertEquals(projectResolverCalls, 0);
  });

  it("bypasses project model overrides for internal credentialed runs", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-runtime-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    const encoder = new TextEncoder();
    installMockFetch(
      (() =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
                );
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              },
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        )) as typeof fetch,
    );
    let projectProviderResolverCalls = 0;
    let projectTransportResolverCalls = 0;
    const unregister = registerModelProvider("veryfront-cloud", () => {
      projectProviderResolverCalls += 1;
      throw new Error("Project model override must not handle signed inference");
    });
    const runtimeAgent = createAgent({
      id: "internal-trusted-inference-agent",
      model: "veryfront-cloud/openai/gpt-test",
      system: "Answer concisely.",
      skills: false,
      resolveModelTransport: () => {
        projectTransportResolverCalls += 1;
        throw new Error("Project transport override must not handle signed inference");
      },
    });
    const runtimeInput = {
      agentId: runtimeAgent.id,
      threadId: crypto.randomUUID(),
      runId: "run_internal_trusted_inference",
      messages: [{ id: "user-1", role: "user", content: "Hello" }],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];
    registerRuntimeInferenceCredential(runtimeInput, "run-scoped-inference-token");

    try {
      const response = await createRuntimeAgentStreamResponse(runtimeInput, runtimeAgent, {
        sessionManager: new AgentRunSessionManager(),
      });
      await response.text();
    } finally {
      unregister();
    }

    assertEquals(projectProviderResolverCalls, 0);
    assertEquals(projectTransportResolverCalls, 0);
  });

  it("does not resolve non-cloud models through the private resolver", () => {
    assertEquals(
      createVeryfrontCloudInferenceModelResolver("run-scoped-inference-token")(
        "project-test/model",
      ),
      undefined,
    );
  });

  it("accepts inference credentials through the full provider transport bound", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-runtime-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    const inferenceCredential = "x".repeat(16 * 1024);
    let capturedAuthorization: string | null = null;
    const encoder = new TextEncoder();
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedAuthorization = request.headers.get("Authorization");
        return new Response(
          new ReadableStream({
            start(controller) {
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
    const model = createVeryfrontCloudInferenceModelResolver(inferenceCredential)(
      "veryfront-cloud/openai/gpt-test",
    );
    if (!model) throw new TypeError("Expected Veryfront Cloud model");
    const result = await model.doStream({ prompt: [] });
    await drainStream(result.stream);

    assertEquals(capturedAuthorization, `Bearer ${inferenceCredential}`);
  });

  it("routes a serialized standalone AgentService invocation to gateway Authorization", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-runtime-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    const capturedAuthorizations: Array<string | null> = [];
    let serializedPreparedRequest = "";
    let detachedRequestBody = "";
    let setupFailure: unknown;
    let frameworkModel: ReturnType<typeof resolveModel> | undefined;
    const encoder = new TextEncoder();
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedAuthorizations.push(request.headers.get("Authorization"));
        return new Response(
          new ReadableStream({
            start(controller) {
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

    const routeSet = createHostedAgentServiceRouteSet({
      tracker: createDetachedRunTracker<AgUiResumeValue>(),
      runtimeSource: { type: "release", releaseId: "release-42" },
      authenticateRequest: async (): Promise<HostedServiceAuthenticatedRequest | Response> => ({
        authToken: "broader-control-plane-token",
        userId: "user-1",
      }),
      verifyProjectAccess: async () => ({ success: true }),
      verifyRunEventAppendToken: async () => ({ verified: true }),
      prepareExecution: async (request) => {
        serializedPreparedRequest = JSON.stringify(request);
        const projectModel = resolveModel("veryfront-cloud/openai/gpt-project-callback");
        const projectResult = await projectModel.doStream({ prompt: [] });
        await drainStream(projectResult.stream);
        frameworkModel = createHostedInferenceModelResolver(request)?.(
          "veryfront-cloud/openai/gpt-test",
        );
        return { executionId: "exec-1" };
      },
      streamExecutionToAgUiResponse: () => new Response("streamed"),
      startDetachedExecution: async ({ rawRequest }) => {
        detachedRequestBody = await rawRequest.text();
        if (!frameworkModel) throw new TypeError("Expected framework model");
        const result = await frameworkModel.doStream({ prompt: [] });
        await drainStream(result.stream);
      },
      logger: {
        error(message, metadata) {
          setupFailure = { message, metadata };
        },
      },
    });
    const invocationRequest = new Request(
      "https://agent.example.test/api/control-plane/runs/run-1/stream",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Veryfront-Run-Event-Token": "run-event-token",
        },
        body: JSON.stringify(runtimeAgentInvocation("run-scoped-inference-token")),
      },
    );
    const originalRequestJson = Request.prototype.json;
    const originalObjectEntries = Object.entries;
    const inferenceToken = "run-scoped-inference-token";
    const observedJsonCredentials: unknown[] = [];
    const observedEntriesCredentials: unknown[] = [];
    const containsInferenceToken = (value: unknown): boolean => {
      if (typeof value === "string") return value.includes("run-scoped-inference-token");
      if (typeof value !== "object" || value === null) return false;
      return originalObjectEntries(value).some(([, candidate]) =>
        containsInferenceToken(candidate)
      );
    };
    Request.prototype.json = function (): Promise<unknown> {
      return originalRequestJson.call(this).then((payload) => {
        observedJsonCredentials.push(
          (payload as { credentials?: { inferenceAuthToken?: unknown } })
            .credentials?.inferenceAuthToken,
        );
        return payload;
      });
    };
    Object.entries = ((value: object) => {
      const isCredentialsRecord = originalObjectEntries(value).some(([key]) =>
        key === "authToken" || key === "inferenceAuthToken"
      );
      if (isCredentialsRecord && containsInferenceToken(value)) {
        observedEntriesCredentials.push(inferenceToken);
      }
      return originalObjectEntries(value);
    }) as typeof Object.entries;
    let response: Response;
    try {
      response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
        request: invocationRequest,
        runId: "run-1",
      });
    } finally {
      Request.prototype.json = originalRequestJson;
      Object.entries = originalObjectEntries;
    }

    assertEquals(response.status, 202, JSON.stringify(setupFailure));
    assertEquals(capturedAuthorizations, [
      "Bearer broader-project-runtime-token",
      "Bearer run-scoped-inference-token",
    ]);
    assertEquals(serializedPreparedRequest.includes("run-scoped-inference-token"), false);
    assertEquals(detachedRequestBody.includes("run-scoped-inference-token"), false);
    assertEquals(observedJsonCredentials, []);
    assertEquals(observedEntriesCredentials.length, 0);
  });

  it("ignores an inference credential without a verified run-event token", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-runtime-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    let capturedAuthorization: string | null = null;
    const encoder = new TextEncoder();
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedAuthorization = request.headers.get("Authorization");
        return new Response(
          new ReadableStream({
            start(controller) {
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
    const routeSet = createHostedAgentServiceRouteSet({
      tracker: createDetachedRunTracker<AgUiResumeValue>(),
      runtimeSource: { type: "release", releaseId: "release-42" },
      authenticateRequest: async (): Promise<HostedServiceAuthenticatedRequest | Response> => ({
        authToken: "broader-control-plane-token",
        userId: "user-1",
      }),
      verifyProjectAccess: async () => ({ success: true }),
      prepareExecution: async () => {
        const model = resolveModel("veryfront-cloud/openai/gpt-test");
        const result = await model.doStream({ prompt: [] });
        await drainStream(result.stream);
        return { executionId: "exec-1" };
      },
      streamExecutionToAgUiResponse: () => new Response("streamed"),
      startDetachedExecution: async () => {},
    });
    const response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
      request: new Request("https://agent.example.test/api/control-plane/runs/run-1/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(runtimeAgentInvocation("unverified-inference-token")),
      }),
      runId: "run-1",
    });

    assertEquals(response.status, 202);
    assertEquals(capturedAuthorization, "Bearer broader-project-runtime-token");
  });

  it("uses private inference authority for context compaction", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    let capturedAuthorization: string | null = null;
    let projectProviderCalls = 0;
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedAuthorization = request.headers.get("Authorization");
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"summary"}}]}\n\n',
                ),
              );
              controller.enqueue(
                new TextEncoder().encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
              );
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }) as typeof fetch,
    );
    const unregister = registerModelProvider("veryfront-cloud", () => {
      projectProviderCalls += 1;
      throw new Error("Project provider must not handle compaction inference");
    });

    try {
      const privateModelResolver = createVeryfrontCloudInferenceModelResolver(
        "run-scoped-inference-token",
      );
      const generator = createVeryfrontCloudContextSummaryGenerator({
        apiUrl: "https://api.veryfront.com",
        model: "openai/gpt-test",
        maxOutputTokens: 500,
        maxInputTokens: 1_000,
        resolveModel: (modelId) => {
          const model = privateModelResolver(modelId);
          if (!model) throw new TypeError("Expected private Veryfront Cloud model");
          return model;
        },
      });
      const result = await generator({
        messagesToSummarize: [{
          id: "message-1",
          role: "user",
          timestamp: 1,
          parts: [{ type: "text", text: "Summarize this context." }],
        }],
        retainedMessages: [],
      });

      assertEquals(result, { text: "summary" });
      assertEquals(capturedAuthorization, "Bearer run-scoped-inference-token");
      assertEquals(projectProviderCalls, 0);
    } finally {
      unregister();
    }
  });

  it("requires HTTPS or loopback for run-scoped inference credentials", () => {
    const error = assertThrows(
      () =>
        runWithVeryfrontCloudContext(
          { apiBaseUrl: "http://api.example.test", apiToken: "broader-token" },
          () => requireVeryfrontCloudBootstrap("run-scoped-inference-token"),
        ),
      VeryfrontError,
      "Run-scoped inference credentials require HTTPS or a loopback API base URL",
    );
    if (!(error instanceof VeryfrontError)) {
      throw new Error("Expected a registered VeryfrontError");
    }
    assertEquals(error.slug, "config-invalid");
    for (const apiBaseUrl of ["http://localhost:4000", "http://[::1]:4000"]) {
      assertEquals(
        runWithVeryfrontCloudContext(
          { apiBaseUrl, apiToken: "broader-token" },
          () => requireVeryfrontCloudBootstrap("run-scoped-inference-token").apiToken,
        ),
        "run-scoped-inference-token",
      );
    }
  });

  it("keeps inference credentials out of mutable Headers prototype methods", async () => {
    const originalSet = Object.getOwnPropertyDescriptor(Headers.prototype, "set")!;
    const observedAuthorizationValues: string[] = [];
    Object.defineProperty(Headers.prototype, "set", {
      ...originalSet,
      value(this: Headers, name: string, value: string) {
        if (name.toLowerCase() === "authorization") {
          observedAuthorizationValues.push(value);
        }
        return Reflect.apply(originalSet.value, this, [name, value]);
      },
    });

    let capturedRequest: Request | undefined;
    try {
      const wrappedFetch = createVeryfrontCloudFetch(
        "run-scoped-inference-token",
        "https://93.184.216.34/ai/gateway/openai/v1",
        undefined,
        { inferenceCredential: true },
      );
      await withMockFetch(
        async (input: URL | Request | string, init?: RequestInit) => {
          capturedRequest = new Request(input, init);
          return new Response(null, { status: 204 });
        },
        () => wrappedFetch("https://93.184.216.34/ai/gateway/openai/v1/chat/completions"),
      );
    } finally {
      Object.defineProperty(Headers.prototype, "set", originalSet);
    }

    assertEquals(observedAuthorizationValues, []);
    assertEquals(
      capturedRequest?.headers.get("Authorization"),
      "Bearer run-scoped-inference-token",
    );
  });

  it("keeps inference credentials out of mutable URL, Request, and validation primitives", async () => {
    const inferenceToken = "run-scoped-inference-token";
    const NativeHeaders = globalThis.Headers;
    const NativeRequest = globalThis.Request;
    const NativeURL = globalThis.URL;
    const originalRequestHeaders = Object.getOwnPropertyDescriptor(
      NativeRequest.prototype,
      "headers",
    )!;
    const originalUrlOrigin = Object.getOwnPropertyDescriptor(NativeURL.prototype, "origin")!;
    const originalTrim = String.prototype.trim;
    const originalRegExpTest = RegExp.prototype.test;
    const originalTextEncoderEncode = TextEncoder.prototype.encode;
    const observedValidationTokens: string[] = [];

    String.prototype.trim = function (): string {
      if (typeof this === "string" && this.includes(inferenceToken)) {
        observedValidationTokens.push("trim");
      }
      return Reflect.apply(originalTrim, this, []);
    };
    RegExp.prototype.test = function (value: string): boolean {
      if (value.includes(inferenceToken)) observedValidationTokens.push("regexp");
      return Reflect.apply(originalRegExpTest, this, [value]);
    };
    TextEncoder.prototype.encode = function (
      value = "",
    ): ReturnType<TextEncoder["encode"]> {
      if (value.includes(inferenceToken)) observedValidationTokens.push("encode");
      return Reflect.apply(originalTextEncoderEncode, this, [value]) as ReturnType<
        TextEncoder["encode"]
      >;
    };
    Object.defineProperty(NativeRequest.prototype, "headers", {
      ...originalRequestHeaders,
      get() {
        throw new Error("live Request headers getter used");
      },
    });
    Object.defineProperty(NativeURL.prototype, "origin", {
      ...originalUrlOrigin,
      get() {
        throw new Error("live URL origin getter used");
      },
    });
    globalThis.URL = new Proxy(NativeURL, {
      construct() {
        throw new Error("live URL constructor used");
      },
    });

    let capturedAuthorization: string | null = null;
    try {
      RuntimeAgentRunInvocationSchema.parse(runtimeAgentInvocation(inferenceToken));
      const wrappedFetch = createVeryfrontCloudFetch(
        inferenceToken,
        "https://93.184.216.34/ai/gateway/openai/v1",
        undefined,
        { inferenceCredential: true },
      );
      await withMockFetch(
        async (input: URL | Request | string, init?: RequestInit) => {
          const request = new NativeRequest(input, init);
          const headers = Reflect.apply(originalRequestHeaders.get!, request, []) as Headers;
          capturedAuthorization = Reflect.apply(
            NativeHeaders.prototype.get,
            headers,
            ["authorization"],
          ) as string | null;
          return new Response(null, { status: 204 });
        },
        () => wrappedFetch("https://93.184.216.34/ai/gateway/openai/v1/chat/completions"),
      );
    } finally {
      globalThis.URL = NativeURL;
      Object.defineProperty(NativeURL.prototype, "origin", originalUrlOrigin);
      Object.defineProperty(NativeRequest.prototype, "headers", originalRequestHeaders);
      TextEncoder.prototype.encode = originalTextEncoderEncode;
      RegExp.prototype.test = originalRegExpTest;
      String.prototype.trim = originalTrim;
    }

    assertEquals(observedValidationTokens, []);
    assertEquals(capturedAuthorization, `Bearer ${inferenceToken}`);
  });

  it("keeps inference credentials out of replaced web constructors", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-runtime-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    const NativeHeaders = globalThis.Headers;
    const NativeRequest = globalThis.Request;
    const intrinsicReflectApply = Reflect.apply;
    const nativeHasInstance = Function.prototype[Symbol.hasInstance];
    const observedAuthorizations: Array<string | null> = [];
    const observeHeaders = (headers: Headers): void => {
      observedAuthorizations.push(headers.get("authorization"));
    };
    class ObservingHeaders extends NativeHeaders {
      constructor(init?: HeadersInit) {
        super(init);
        observeHeaders(this);
      }
    }
    class ObservingRequest extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, init);
        observeHeaders(this.headers);
      }

      static override [Symbol.hasInstance](value: unknown): boolean {
        if (intrinsicReflectApply(nativeHasInstance, NativeRequest, [value])) {
          observeHeaders((value as Request).headers);
        }
        return intrinsicReflectApply(nativeHasInstance, NativeRequest, [value]) as boolean;
      }
    }
    const model = createVeryfrontCloudInferenceModelResolver("run-scoped-inference-token")(
      "veryfront-cloud/openai/gpt-test",
    );
    if (!model) throw new TypeError("Expected Veryfront Cloud model");

    let capturedAuthorization: string | null = null;
    try {
      globalThis.Headers = ObservingHeaders as typeof Headers;
      globalThis.Request = ObservingRequest as typeof Request;
      await withMockFetch(
        async (input: URL | Request | string, init?: RequestInit) => {
          const request = new NativeRequest(input, init);
          capturedAuthorization = request.headers.get("authorization");
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
                );
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                controller.close();
              },
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        },
        async () => {
          const result = await model.doStream({ prompt: [] });
          await drainStream(result.stream);
        },
      );
    } finally {
      globalThis.Headers = NativeHeaders;
      globalThis.Request = NativeRequest;
    }

    assertEquals(capturedAuthorization, "Bearer run-scoped-inference-token");
    assertEquals(observedAuthorizations.includes("Bearer run-scoped-inference-token"), false);
  });
});
