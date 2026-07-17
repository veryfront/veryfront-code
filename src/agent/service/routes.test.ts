import { assertEquals } from "#veryfront/testing/assert.ts";
import { createDetachedRunTracker } from "./detached-run-tracker.ts";
import { createHostedAgentServiceRouteSet } from "./routes.ts";
import type { HostedServiceAuthenticatedRequest } from "./auth.ts";
import type { ParsedHostedChatRequest } from "../hosted/chat-request-parser.ts";
import type { HostedRuntimeSourceIdentity } from "../hosted/runtime-source-binding.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";

const runtimeSource = { type: "release", releaseId: "release-42" } as const;

function createDevToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.unsigned`;
}

function createAuthenticatedRequest(path: string, body: unknown, method = "POST"): Request {
  return new Request(`https://agent.example.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${createDevToken({ userId: "user-1" })}`,
    },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
}

function createAgUiBody(): Record<string, unknown> {
  return {
    threadId: "00000000-0000-4000-8000-000000000001",
    runId: "run-1",
    state: {},
    messages: [],
    tools: [],
    context: [],
  };
}

function createRuntimeAgentInvocationBody(): Record<string, unknown> {
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
    agentSource: runtimeSource,
  };
}

function createRouteSet(input: {
  prepareExecution?: (req: ParsedHostedChatRequest) => Promise<{ executionId: string }>;
  streamResponse?: Response;
  runtimeSource?: HostedRuntimeSourceIdentity | null;
} = {}) {
  const tracker = createDetachedRunTracker<AgUiResumeValue>();
  const preparedRequests: ParsedHostedChatRequest[] = [];
  const streamInputs: Array<{ executionId: string; agUiRunId: string }> = [];

  const routeSet = createHostedAgentServiceRouteSet<{ executionId: string }>({
    tracker,
    runtimeSource: input.runtimeSource === null ? undefined : input.runtimeSource ?? runtimeSource,
    authenticateRequest: async (request): Promise<HostedServiceAuthenticatedRequest | Response> => {
      const authorization = request.headers.get("authorization");
      if (!authorization?.startsWith("Bearer ")) {
        return Response.json({ errorCode: "UNAUTHENTICATED" }, { status: 401 });
      }
      return { authToken: authorization.slice(7), userId: "user-1" };
    },
    verifyProjectAccess: async () => ({ success: true }),
    prepareExecution: async (req) => {
      preparedRequests.push(req);
      return input.prepareExecution?.(req) ?? { executionId: "exec-1" };
    },
    streamExecutionToAgUiResponse: (streamInput) => {
      streamInputs.push({
        executionId: streamInput.executionId,
        agUiRunId: streamInput.agUiInput.runId,
      });
      return input.streamResponse ?? new Response("streamed");
    },
    startDetachedExecution: async () => {},
  });

  return { routeSet, tracker, preparedRequests, streamInputs };
}

Deno.test("agent service routes expose the default paths", () => {
  const { routeSet } = createRouteSet();

  assertEquals(routeSet.routes.map((route) => `${route.method} ${route.path}`), [
    "POST /api/ag-ui",
    "DELETE /api/runs/:runId",
    "POST /api/runs",
    "POST /api/control-plane/runs/:runId/stream",
  ]);
});

Deno.test("agent service routes require auth for AG-UI streams", async () => {
  const { routeSet } = createRouteSet();
  const response = await routeSet.handleAgUiRequest(
    new Request("https://agent.example.test/api/ag-ui", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createAgUiBody()),
    }),
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { errorCode: "UNAUTHENTICATED" });
});

Deno.test("agent service routes stream prepared AG-UI execution", async () => {
  const streamResponse = new Response("ok", { status: 201 });
  const { routeSet, preparedRequests, streamInputs } = createRouteSet({ streamResponse });
  const response = await routeSet.handleAgUiRequest(
    createAuthenticatedRequest("/api/ag-ui", createAgUiBody()),
  );

  assertEquals(response, streamResponse);
  assertEquals(preparedRequests.length, 1);
  assertEquals(streamInputs, [{ executionId: "exec-1", agUiRunId: "run-1" }]);
});

Deno.test("agent service routes preserve forwarded AG-UI target agent ids", async () => {
  const { routeSet, preparedRequests } = createRouteSet();
  const response = await routeSet.handleAgUiRequest(
    createAuthenticatedRequest("/api/ag-ui", {
      ...createAgUiBody(),
      forwardedProps: {
        veryfront: {
          agentId: "researcher",
          projectId: "project_123",
        },
      },
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(preparedRequests.length, 1);
  assertEquals(preparedRequests[0]?.agentId, "researcher");
  assertEquals(preparedRequests[0]?.projectId, "project_123");
});

Deno.test("agent service routes preserve control-plane target agent ids", async () => {
  const { routeSet, preparedRequests } = createRouteSet();
  const response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
    request: createAuthenticatedRequest(
      "/api/control-plane/runs/run-1/stream",
      createRuntimeAgentInvocationBody(),
    ),
    runId: "run-1",
  });

  assertEquals(response.status, 202);
  assertEquals(preparedRequests.length, 1);
  assertEquals(preparedRequests[0]?.agentId, "builder");
});

Deno.test("agent service routes reject unbound control-plane source selection", async () => {
  const { routeSet, preparedRequests } = createRouteSet({ runtimeSource: null });
  const response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
    request: createAuthenticatedRequest(
      "/api/control-plane/runs/run-1/stream",
      createRuntimeAgentInvocationBody(),
    ),
    runId: "run-1",
  });

  assertEquals(response.status, 503);
  assertEquals(await response.json(), { errorCode: "CONTROL_PLANE_AGENT_SOURCE_UNBOUND" });
  assertEquals(preparedRequests.length, 0);
});

Deno.test("agent service routes reject control-plane source mismatches", async () => {
  const { routeSet, preparedRequests } = createRouteSet({
    runtimeSource: { type: "release", releaseId: "release-43" },
  });
  const response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
    request: createAuthenticatedRequest(
      "/api/control-plane/runs/run-1/stream",
      createRuntimeAgentInvocationBody(),
    ),
    runId: "run-1",
  });

  assertEquals(response.status, 409);
  assertEquals(await response.json(), { errorCode: "CONTROL_PLANE_AGENT_SOURCE_MISMATCH" });
  assertEquals(preparedRequests.length, 0);
});

Deno.test("agent service routes enforce durable root lineage", async () => {
  const { routeSet } = createRouteSet();
  const response = await routeSet.handleDurableChatRunExecuteRequest({
    request: createAuthenticatedRequest("/api/runs", {
      messages: [],
      context: { projectId: null, branchId: null },
    }),
  });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { errorCode: "DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION" });
});

Deno.test("agent service routes cancel AG-UI runs", async () => {
  const { routeSet } = createRouteSet();
  const response = await routeSet.handleDurableChatRunCancelRequest({
    request: createAuthenticatedRequest("/api/runs/run-1", {}, "DELETE"),
    runId: "run-1",
  });

  assertEquals(response.status, 204);
});
