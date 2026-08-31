import "#veryfront/schemas/_test-setup.ts";
import { agent as createAgent } from "#veryfront/agent";
import { createDetachedRunTracker } from "#veryfront/agent/service/detached-run-tracker.ts";
import { createHostedAgentServiceRouteSet } from "#veryfront/agent/service/routes.ts";
import type { HostedServiceAuthenticatedRequest } from "#veryfront/agent/service/auth.ts";
import type { AgUiResumeValue } from "#veryfront/agent/ag-ui/tool-shared.ts";
import { createHostedInferenceModelResolver } from "#veryfront/agent/hosted/inference-credential.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearModelProviders, resolveModel } from "#veryfront/provider";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import {
  createRuntimeAgentStreamResponse,
  registerRuntimeInferenceCredential,
} from "#veryfront/internal-agents/run-stream.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";

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

  it("routes a serialized standalone AgentService invocation to gateway Authorization", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-runtime-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    const capturedAuthorizations: Array<string | null> = [];
    let serializedPreparedRequest = "";
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
      startDetachedExecution: async () => {
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
    const response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
      request: new Request("https://agent.example.test/api/control-plane/runs/run-1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Veryfront-Run-Event-Token": "run-event-token",
        },
        body: JSON.stringify(runtimeAgentInvocation("run-scoped-inference-token")),
      }),
      runId: "run-1",
    });

    assertEquals(response.status, 202, JSON.stringify(setupFailure));
    assertEquals(capturedAuthorizations, [
      "Bearer broader-project-runtime-token",
      "Bearer run-scoped-inference-token",
    ]);
    assertEquals(serializedPreparedRequest.includes("run-scoped-inference-token"), false);
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
});
