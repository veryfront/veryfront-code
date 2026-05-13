import { assertEquals } from "#veryfront/testing/assert.ts";
import { createDetachedRunTracker } from "./detached-run-tracker.ts";
import { createHostedAgentServiceRouteSet } from "./agent-service-routes.ts";
import type { HostedServiceAuthenticatedRequest } from "./agent-service-auth.ts";
import type { ParsedHostedChatRequest } from "./hosted-chat-request-parser.ts";

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
  };
}

function createRouteSet(input: {
  prepareExecution?: (req: ParsedHostedChatRequest) => Promise<{ executionId: string }>;
  streamResponse?: Response;
} = {}) {
  const tracker = createDetachedRunTracker();
  const preparedRequests: ParsedHostedChatRequest[] = [];
  const streamInputs: Array<{ executionId: string; agUiRunId: string }> = [];

  const routeSet = createHostedAgentServiceRouteSet({
    tracker,
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
    "POST /api/ag-ui/messages/stream",
    "POST /api/ag-ui",
    "DELETE /api/runs/:runId",
    "POST /api/runs",
    "POST /api/control-plane/agents/stream",
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

Deno.test("agent service routes preserve control-plane target agent ids", async () => {
  const { routeSet, preparedRequests } = createRouteSet();
  const response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
    request: createAuthenticatedRequest(
      "/api/control-plane/agents/stream",
      createRuntimeAgentInvocationBody(),
    ),
  });

  assertEquals(response.status, 202);
  assertEquals(preparedRequests.length, 1);
  assertEquals(preparedRequests[0]?.agentId, "builder");
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
