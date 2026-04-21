import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createConversationAgentRun,
  finalizeConversationAgentRun,
  resolveConversationRunTargets,
} from "./durable.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const CONVERSATION_ID = "11111111-1111-4111-a111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-a222-222222222222";
const PROJECT_ID = "33333333-3333-4333-a333-333333333333";
const BRANCH_ID = "44444444-4444-4444-8444-444444444444";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function acceptedRunResponse(run: unknown): Response {
  return jsonResponse(
    {
      accepted: true,
      run,
    },
    202,
  );
}

function durableRunProjection(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "run_root_1",
    conversation_id: CONVERSATION_ID,
    message_id: MESSAGE_ID,
    latest_event_id: 1,
    latest_external_event_sequence: 1,
    status: "running",
    project_id: null,
    ...overrides,
  };
}

function camelCaseDurableRunProjection(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run_child_2",
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
    latestEventId: 0,
    latestExternalEventSequence: 0,
    status: "running",
    projectId: null,
    ...overrides,
  };
}

type FetchCall = [RequestInfo | URL, RequestInit | undefined];

function stubFetchSequence(...steps: Response[]): FetchCall[] {
  const queue = [...steps];
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([input, init]);
    const next = queue.shift();
    if (!next) {
      throw new Error("Unexpected fetch call");
    }

    return next;
  }) as typeof fetch;
  return calls;
}

describe("agent/durable", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves non-project run targets to nulls", () => {
    assertEquals(resolveConversationRunTargets({ projectId: null, branchId: null }), {
      sourceTargetKind: null,
      runtimeTargetKind: null,
      targetBranchId: null,
    });
  });

  it("resolves project preview targets when a branch is present", () => {
    assertEquals(resolveConversationRunTargets({ projectId: PROJECT_ID, branchId: BRANCH_ID }), {
      sourceTargetKind: "preview_branch",
      runtimeTargetKind: "preview_branch",
      targetBranchId: BRANCH_ID,
    });
  });

  it("creates a conversation-owned durable run without target metadata for non-project runs", async () => {
    const fetchCalls = stubFetchSequence(
      acceptedRunResponse({ run_id: "run_root_1" }),
      jsonResponse(durableRunProjection(), 200),
    );

    await createConversationAgentRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_root_1",
      agentId: "default-chat",
      projectId: null,
      branchId: null,
    });

    assertEquals(
      JSON.parse(String(fetchCalls[0]?.[1]?.body)),
      {
        kind: "agent",
        owner: {
          kind: "conversation",
          id: CONVERSATION_ID,
        },
        public_id: "run_root_1",
        request: {
          mode: "default_chat",
          agent_id: "default-chat",
          initial_status: "running",
        },
      },
    );
  });

  it("preserves preview target metadata for project-backed runs", async () => {
    const fetchCalls = stubFetchSequence(
      acceptedRunResponse({ run_id: "run_child_1" }),
      jsonResponse(
        durableRunProjection({
          run_id: "run_child_1",
          project_id: PROJECT_ID,
          source_target_kind: "preview_branch",
        }),
        200,
      ),
    );

    await createConversationAgentRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_child_1",
      agentId: "invoke-agent-child",
      projectId: PROJECT_ID,
      branchId: BRANCH_ID,
    });

    assertEquals(
      JSON.parse(String(fetchCalls[0]?.[1]?.body)),
      {
        kind: "agent",
        owner: {
          kind: "conversation",
          id: CONVERSATION_ID,
        },
        public_id: "run_child_1",
        request: {
          mode: "default_chat",
          agent_id: "invoke-agent-child",
          initial_status: "running",
          source_target_kind: "preview_branch",
          runtime_target_kind: "preview_branch",
          source_target_branch_id: BRANCH_ID,
          runtime_target_branch_id: BRANCH_ID,
        },
      },
    );
  });

  it("accepts camelCase durable run responses for backward compatibility", async () => {
    stubFetchSequence(
      acceptedRunResponse({ runId: "run_child_2" }),
      jsonResponse(camelCaseDurableRunProjection(), 200),
    );

    const result = await createConversationAgentRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_child_2",
      agentId: "invoke-agent-child",
    });

    assertEquals(result, {
      runId: "run_child_2",
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      latestEventId: 0,
      latestExternalEventSequence: 0,
      status: "running",
    });
  });

  it("rejects durable run projections that omit latestExternalEventSequence", async () => {
    stubFetchSequence(
      acceptedRunResponse({ runId: "run_child_3" }),
      jsonResponse(
        {
          runId: "run_child_3",
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          latestEventId: 0,
          status: "running",
        },
        200,
      ),
    );

    await assertRejects(
      () =>
        createConversationAgentRun({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          runId: "run_child_3",
          agentId: "invoke-agent-child",
        }),
      Error,
      "Missing latestExternalEventSequence in durable run response",
    );
  });

  it("finalizes durable runs through the canonical complete route", async () => {
    const fetchCalls = stubFetchSequence(
      jsonResponse(
        {
          completed: true,
          run: {
            runId: "run_root_1",
            status: "completed",
          },
        },
        200,
      ),
    );

    await finalizeConversationAgentRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_root_1",
      status: "completed",
      model: "gpt-5.4",
      provider: "openai",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
      terminalErrorCode: null,
      terminalErrorMessage: null,
    });

    assertEquals(
      JSON.parse(String(fetchCalls[0]?.[1]?.body)),
      {
        status: "completed",
        metadata: {
          provider: "openai",
          model: "gpt-5.4",
          inputTokens: 10,
          outputTokens: 20,
          finishReason: "stop",
        },
        terminal_error_code: null,
        terminal_error_message: null,
      },
    );
  });
});
