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
import {
  parseRuntimeAgentRunInvocationValue,
  RuntimeAgentRunInvocationSchema,
} from "#veryfront/agent/runtime/agent-invocation-contract.ts";
import { parseAgUiJsonBody } from "#veryfront/agent/ag-ui/request-shared.ts";
import { readBodyWithLimit } from "#veryfront/security/input-validation/limits.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  installMockFetch,
  restoreMockFetch,
  withMockFetch,
} from "#veryfront/testing/mock-fetch.ts";
import { createRunScopedVeryfrontCloudContextSummaryGenerator } from "#veryfront/agent/hosted/context-summary-generator.ts";
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

  it("keeps trusted invocation parsing off the public schema facade", () => {
    const inferenceAuthToken = "run-scoped-inference-token";
    const originalParse = RuntimeAgentRunInvocationSchema.parse;
    let publicParserCalled = false;
    RuntimeAgentRunInvocationSchema.parse = (value: unknown) => {
      publicParserCalled = true;
      throw new Error(`public parser received ${String(value)}`);
    };

    try {
      const parsed = parseRuntimeAgentRunInvocationValue(
        runtimeAgentInvocation(inferenceAuthToken),
      );
      assertEquals(parsed.credentials?.inferenceAuthToken, inferenceAuthToken);
    } finally {
      RuntimeAgentRunInvocationSchema.parse = originalParse;
    }

    assertEquals(publicParserCalled, false);
  });

  it("keeps ingress JSON and body reads on captured primitives", async () => {
    const inferenceAuthToken = "run-scoped-inference-token";
    const originalJsonParse = JSON.parse;
    const originalBody = Object.getOwnPropertyDescriptor(Request.prototype, "body")!;
    const originalGetReader = ReadableStream.prototype.getReader;
    let observedToken = false;
    JSON.parse = ((value: string) => {
      if (value.includes(inferenceAuthToken)) observedToken = true;
      return Reflect.apply(originalJsonParse, JSON, [value]);
    }) as typeof JSON.parse;
    Object.defineProperty(Request.prototype, "body", {
      ...originalBody,
      get() {
        observedToken = true;
        return Reflect.apply(originalBody.get!, this, []);
      },
    });
    ReadableStream.prototype.getReader = function (
      this: ReadableStream<Uint8Array>,
      ...args: Parameters<typeof originalGetReader>
    ): ReturnType<typeof originalGetReader> {
      observedToken = true;
      return Reflect.apply(originalGetReader, this, args);
    } as typeof originalGetReader;

    try {
      const body = JSON.stringify(runtimeAgentInvocation(inferenceAuthToken));
      const parsed = await parseAgUiJsonBody(
        new Request("http://localhost/", {
          method: "POST",
          body,
        }),
      );
      assertEquals(typeof parsed, "object");
      await readBodyWithLimit(new Request("http://localhost/", { method: "POST", body }));
    } finally {
      JSON.parse = originalJsonParse;
      Object.defineProperty(Request.prototype, "body", originalBody);
      ReadableStream.prototype.getReader = originalGetReader;
    }

    assertEquals(observedToken, false);
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
    const originalRuntimeStream = AgentRuntime.prototype.stream;
    let publicRuntimeStreamCalled = false;
    AgentRuntime.prototype.stream = (async function (
      this: AgentRuntime,
      ...args: Parameters<typeof originalRuntimeStream>
    ): ReturnType<typeof originalRuntimeStream> {
      publicRuntimeStreamCalled = true;
      return await Reflect.apply(originalRuntimeStream, this, args);
    }) as typeof originalRuntimeStream;
    try {
      const response = await createRuntimeAgentStreamResponse(
        runtimeInput,
        runtimeAgent,
        {
          sessionManager: new AgentRunSessionManager(),
        },
      );
      await response.text();
    } finally {
      AgentRuntime.prototype.stream = originalRuntimeStream;
    }

    assertEquals(capturedAuthorizations, [
      "Bearer broader-project-runtime-token",
      "Bearer run-scoped-inference-token",
    ]);
    assertEquals(publicRuntimeStreamCalled, false);
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

  it("does not dispatch internal credentialed runs through mutable AgentRuntime methods", async () => {
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

    const originalPublicStream = AgentRuntime.prototype.stream;
    let publicStreamCalls = 0;

    AgentRuntime.prototype.stream = function (
      ...args: Parameters<AgentRuntime["stream"]>
    ): ReturnType<AgentRuntime["stream"]> {
      publicStreamCalls += 1;
      return Reflect.apply(originalPublicStream, this, args) as ReturnType<
        AgentRuntime["stream"]
      >;
    };

    try {
      const runtimeAgent = createAgent({
        id: "internal-private-dispatch-agent",
        model: "veryfront-cloud/openai/gpt-test",
        system: "Answer concisely.",
        skills: false,
      });
      const runtimeInput = {
        agentId: runtimeAgent.id,
        threadId: crypto.randomUUID(),
        runId: "run_internal_private_dispatch",
        messages: [{ id: "user-1", role: "user", content: "Hello" }],
        tools: [],
        context: [],
      } as Parameters<typeof createRuntimeAgentStreamResponse>[0];
      registerRuntimeInferenceCredential(runtimeInput, "run-scoped-inference-token");

      const response = await createRuntimeAgentStreamResponse(runtimeInput, runtimeAgent, {
        sessionManager: new AgentRunSessionManager(),
      });
      await response.text();
    } finally {
      AgentRuntime.prototype.stream = originalPublicStream;
    }

    assertEquals(publicStreamCalls, 0);
  });

  it("revokes retained run-scoped stream model capability after stream completion", async () => {
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
    const resolver = createVeryfrontCloudInferenceModelResolver("run-scoped-inference-token");
    const retainedModel = resolver("veryfront-cloud/openai/gpt-test");
    if (!retainedModel) throw new TypeError("Expected retained model");
    const runtime = new AgentRuntime(
      "leased-stream-runtime",
      {
        model: "veryfront-cloud/openai/gpt-test",
        system: "Answer concisely.",
        skills: false,
      },
      {
        resolveModelRuntime: resolver,
      },
    );

    const stream = await runtime.stream([{
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    }]);
    await drainStream(stream);

    await assertRejects(
      async () => {
        const result = await retainedModel.doStream({ prompt: [] });
        await drainStream(result.stream);
      },
      TypeError,
      "Run-scoped inference credential is no longer active",
    );
  });

  it("rejects signed runtime replay while keeping ordinary runtimes reusable", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-runtime-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    const encoder = new TextEncoder();
    const capturedAuthorizations: Array<string | null> = [];
    installMockFetch(
      ((input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedAuthorizations.push(request.headers.get("Authorization"));
        return Promise.resolve(
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
        );
      }) as typeof fetch,
    );
    const resolver = createVeryfrontCloudInferenceModelResolver("run-scoped-inference-token");
    const originalStream = AgentRuntime.prototype.stream;
    const runtime = new AgentRuntime(
      "retained-original-stream-runtime",
      {
        model: "veryfront-cloud/openai/gpt-test",
        system: "Answer concisely.",
        skills: false,
      },
      {
        resolveModelRuntime: resolver,
      },
    );
    const messages = [{
      id: "user-1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Hello" }],
    }];

    const first = await runtime.stream(messages);
    await drainStream(first);
    await assertRejects(
      async () => {
        const second = await Reflect.apply(originalStream, runtime, [messages]);
        await drainStream(second);
      },
      TypeError,
      "AgentRuntime model resolver has already been consumed",
    );

    const ordinaryRuntime = new AgentRuntime(
      "reusable-ordinary-stream-runtime",
      {
        model: "veryfront-cloud/openai/gpt-test",
        system: "Answer concisely.",
        skills: false,
      },
    );
    const ordinaryFirst = await ordinaryRuntime.stream(messages);
    await drainStream(ordinaryFirst);
    const ordinarySecond = await ordinaryRuntime.stream(messages);
    await drainStream(ordinarySecond);

    assertEquals(capturedAuthorizations, [
      "Bearer run-scoped-inference-token",
      "Bearer broader-project-runtime-token",
      "Bearer broader-project-runtime-token",
    ]);
  });

  it("revokes run-scoped stream authority when the invocation is cancelled before start", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-runtime-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    const resolver = createVeryfrontCloudInferenceModelResolver("run-scoped-inference-token");
    const retainedModel = resolver("veryfront-cloud/openai/gpt-test");
    if (!retainedModel) throw new TypeError("Expected retained model");
    const runtime = new AgentRuntime(
      "cancelled-leased-stream-runtime",
      {
        model: "veryfront-cloud/openai/gpt-test",
        system: "Answer concisely.",
        skills: false,
      },
      {
        resolveModelRuntime: resolver,
      },
    );
    const abortController = new AbortController();
    abortController.abort("cancel before start");

    const stream = await runtime.stream(
      [{
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      }],
      undefined,
      undefined,
      undefined,
      undefined,
      abortController.signal,
    );
    await drainStream(stream);

    await assertRejects(
      async () => {
        const result = await retainedModel.doStream({ prompt: [] });
        await drainStream(result.stream);
      },
      TypeError,
      "Run-scoped inference credential is no longer active",
    );
  });

  it("revokes run-scoped stream authority when provider streaming errors", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-runtime-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    installMockFetch(
      (() => Promise.resolve(new Response("gateway failed", { status: 500 }))) as typeof fetch,
    );
    const resolver = createVeryfrontCloudInferenceModelResolver("run-scoped-inference-token");
    const retainedModel = resolver("veryfront-cloud/openai/gpt-test");
    if (!retainedModel) throw new TypeError("Expected retained model");
    const runtime = new AgentRuntime(
      "errored-leased-stream-runtime",
      {
        model: "veryfront-cloud/openai/gpt-test",
        system: "Answer concisely.",
        skills: false,
      },
      {
        resolveModelRuntime: resolver,
      },
    );

    const stream = await runtime.stream([{
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    }]);
    await drainStream(stream);

    await assertRejects(
      async () => {
        const result = await retainedModel.doStream({ prompt: [] });
        await drainStream(result.stream);
      },
      TypeError,
      "Run-scoped inference credential is no longer active",
    );
  });

  it("revokes retained run-scoped generate model capability after generate completion", async () => {
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
          ),
        )) as typeof fetch,
    );
    const resolver = createVeryfrontCloudInferenceModelResolver("run-scoped-inference-token");
    const retainedModel = resolver("veryfront-cloud/openai/gpt-test");
    if (!retainedModel) throw new TypeError("Expected retained model");
    const runtime = new AgentRuntime(
      "leased-generate-runtime",
      {
        model: "veryfront-cloud/openai/gpt-test",
        system: "Answer concisely.",
        skills: false,
      },
      {
        resolveModelRuntime: resolver,
      },
    );

    const response = await runtime.generate("Hello");

    assertEquals(response.text, "Hello");
    await assertRejects(
      async () => {
        const result = await retainedModel.doStream({ prompt: [] });
        await drainStream(result.stream);
      },
      TypeError,
      "Run-scoped inference credential is no longer active",
    );
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
    const originalJsonParse = JSON.parse;
    const originalObjectEntries = Object.entries;
    const inferenceToken = "run-scoped-inference-token";
    const observedJsonCredentials: unknown[] = [];
    const observedEntriesCredentials: unknown[] = [];
    let exposedToSharedRealmJson = false;
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
    const observedJsonParse: typeof JSON.parse = (text, reviver) => {
      if (text.includes(inferenceToken)) exposedToSharedRealmJson = true;
      return Reflect.apply(originalJsonParse, JSON, [text, reviver]);
    };
    JSON.parse = observedJsonParse;
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
      JSON.parse = originalJsonParse;
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
    assertEquals(exposedToSharedRealmJson, false);
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
      const retainedModel = privateModelResolver("veryfront-cloud/openai/gpt-test");
      if (!retainedModel) throw new TypeError("Expected retained compaction model");
      const generator = createRunScopedVeryfrontCloudContextSummaryGenerator(
        {
          apiUrl: "https://api.veryfront.com",
          authToken: "broader-project-token",
          model: "openai/gpt-test",
          maxOutputTokens: 500,
          maxInputTokens: 1_000,
        },
        () => privateModelResolver,
      );
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
      await assertRejects(
        async () => {
          const replay = await retainedModel.doStream({ prompt: [] });
          await drainStream(replay.stream);
        },
        TypeError,
        "Run-scoped inference credential is no longer active",
      );
    } finally {
      unregister();
    }
  });

  it("rejects retained context compaction generator replay", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    const capturedAuthorizations: string[] = [];
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedAuthorizations.push(request.headers.get("Authorization") ?? "");
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
    let resolverCreations = 0;
    const generator = createRunScopedVeryfrontCloudContextSummaryGenerator(
      {
        apiUrl: "https://api.veryfront.com",
        authToken: "broader-project-token",
        model: "openai/gpt-test",
        maxOutputTokens: 500,
        maxInputTokens: 1_000,
      },
      () => {
        resolverCreations += 1;
        return createVeryfrontCloudInferenceModelResolver(
          `run-scoped-inference-token-${resolverCreations}`,
        );
      },
    );
    const input = {
      messagesToSummarize: [{
        id: "message-1",
        role: "user" as const,
        timestamp: 1,
        parts: [{ type: "text" as const, text: "Summarize this context." }],
      }],
      retainedMessages: [],
    };

    const result = await generator(input);
    assertEquals(result, { text: "summary" });
    await assertRejects(
      async () => await generator(input),
      TypeError,
      "Context compaction inference authority has already been used",
    );

    assertEquals(resolverCreations, 1);
    assertEquals(capturedAuthorizations, ["Bearer run-scoped-inference-token-1"]);
  });

  it("revokes context compaction authority when summary generation fails", async () => {
    let retainedModel: Awaited<ReturnType<typeof resolveModel>> | undefined;
    const resolver = createVeryfrontCloudInferenceModelResolver(
      "run-scoped-inference-token",
    );
    const generator = createRunScopedVeryfrontCloudContextSummaryGenerator(
      {
        apiUrl: "https://api.veryfront.com",
        authToken: "broader-project-token",
        model: "openai/gpt-test",
        maxOutputTokens: 500,
        maxInputTokens: 1_000,
        generateText: (input) => {
          retainedModel = input.model;
          throw new Error("context compaction failed");
        },
      },
      () => resolver,
    );

    await assertRejects(
      async () =>
        await generator({
          messagesToSummarize: [{
            id: "message-1",
            role: "user",
            timestamp: 1,
            parts: [{ type: "text", text: "Summarize this context." }],
          }],
          retainedMessages: [],
        }),
      Error,
      "context compaction failed",
    );
    const capturedModel = retainedModel;
    if (!capturedModel) throw new TypeError("Expected retained compaction model");

    await assertRejects(
      async () => {
        const result = await capturedModel.doStream({ prompt: [] });
        await drainStream(result.stream);
      },
      TypeError,
      "Run-scoped inference credential is no longer active",
    );
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
    const originalStartsWith = String.prototype.startsWith;
    const observedValidationTokens: string[] = [];

    String.prototype.trim = function (): string {
      if (typeof this === "string" && this.includes(inferenceToken)) {
        observedValidationTokens.push("trim");
      }
      return Reflect.apply(originalTrim, this, []);
    };
    String.prototype.startsWith = function (): boolean {
      throw new Error("live String.startsWith used");
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
      String.prototype.startsWith = originalStartsWith;
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
