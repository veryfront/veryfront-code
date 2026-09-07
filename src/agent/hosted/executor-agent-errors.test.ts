import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { createDetachedRunTracker } from "../service/detached-run-tracker.ts";
import { createHostedAgentServiceRouteSet } from "../service/routes.ts";
import { executeHostedDurableChatRun } from "./durable-chat-run-start.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import { ExecutorAgentError } from "./executor-agent-schema.ts";

const cases: Array<{ code: ConstructorParameters<typeof ExecutorAgentError>[0]; status: number }> =
  [
    { code: "PERMISSION_DENIED", status: 403 },
    { code: "CONTEXT_LENGTH_EXCEEDED", status: 413 },
    { code: "RATE_LIMITED", status: 429 },
    { code: "INSUFFICIENT_CREDITS", status: 402 },
    { code: "RESOURCE_LIMIT_EXCEEDED", status: 402 },
    { code: "OVERLOADED_ERROR", status: 503 },
    { code: "AI_PROVIDER_SPEND_LIMIT_EXCEEDED", status: 402 },
    { code: "AI_PROVIDER_WORKSPACE_LIMIT_EXCEEDED", status: 502 },
    { code: "AI_PROVIDER_BILLING_ERROR", status: 502 },
    { code: "EXECUTOR_AGENT_INVALID_INPUT", status: 400 },
    { code: "EXECUTOR_AGENT_INPUT_TOO_LARGE", status: 413 },
    { code: "EXECUTOR_AGENT_ALREADY_STARTED", status: 409 },
    { code: "EXECUTOR_AGENT_SETUP_FAILED", status: 500 },
    { code: "EXECUTOR_AGENT_STREAM_FAILED", status: 502 },
    { code: "EXECUTOR_AGENT_INVALID_STREAM", status: 502 },
    { code: "PROJECT_SCHEMA_ERROR", status: 400 },
    { code: "MODEL_UNSUPPORTED_ASSISTANT_PREFILL", status: 400 },
    { code: "OUTPUT_SCHEMA_NOT_CLOSED", status: 400 },
    { code: "EXTERNAL_SERVICE_ERROR", status: 502 },
    { code: "DURABLE_RUN_EVENT_PERSISTENCE_FAILED", status: 500 },
    { code: "ABORTED", status: 499 },
  ];

function durableRequest(): ParsedHostedChatRequest {
  return {
    userId: "synthetic-user",
    authToken: "synthetic-application-token",
    agentId: undefined,
    messages: [],
    validatedContext: { projectId: "synthetic-project", branchId: null },
    projectId: "synthetic-project",
    conversationId: "00000000-0000-4000-8000-000000000001",
    parentRunId: "synthetic-run",
    upstreamParentConversationId: undefined,
    upstreamParentRunId: undefined,
    spawnedFromToolCallId: undefined,
    model: undefined,
    allowDelegation: undefined,
    forwardedProps: undefined,
    runtimeOverrides: undefined,
    durableRootRun: { runId: "synthetic-run", messageId: "synthetic-message" },
    persistLatestUserMessageBeforeDurableRun: false,
  };
}

describe("executor errors at hosted setup response boundaries", () => {
  for (const { code, status } of cases) {
    it(`preserves ${code} through durable setup`, async () => {
      const error = new ExecutorAgentError(code);
      const response = await executeHostedDurableChatRun({
        req: durableRequest(),
        rawRequest: new Request("https://agent.example.test/api/runs", { method: "POST" }),
        tracker: createDetachedRunTracker(),
        prepareExecution: () => Promise.reject(error),
        startDetachedExecution: () => Promise.reject(new Error("Unexpected detached execution")),
      });
      assertEquals(response.status, status);
      assertEquals(await response.json(), { errorCode: code });
      assert(error instanceof VeryfrontError);
      assertEquals(error.toRFC9457().title, code);
    });

    it(`preserves ${code} through direct AG-UI setup`, async () => {
      const routeSet = createHostedAgentServiceRouteSet({
        tracker: createDetachedRunTracker(),
        authenticateRequest: () =>
          Promise.resolve({ authToken: "synthetic-application-token", userId: "synthetic-user" }),
        verifyProjectAccess: () => Promise.resolve({ success: true }),
        prepareExecution: () => Promise.reject(new ExecutorAgentError(code)),
        streamExecutionToAgUiResponse: () =>
          Promise.reject(new Error("Unexpected streaming execution")),
        startDetachedExecution: () => Promise.reject(new Error("Unexpected detached execution")),
      });
      const response = await routeSet.handleAgUiRequest(
        new Request("https://agent.example.test/api/ag-ui", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            threadId: "00000000-0000-4000-8000-000000000001",
            runId: "synthetic-run",
            state: {},
            messages: [],
            tools: [],
            context: [],
          }),
        }),
      );
      assertEquals(response.status, status);
      const body = await response.text();
      const event = body.split("\n").find((line) => line.startsWith("data:"));
      assert(event);
      const data = JSON.parse(event.slice(5));
      assertEquals(data.code, code);
      assertEquals(data.message, code);
    });
  }
});
