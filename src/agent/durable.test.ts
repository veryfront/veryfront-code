import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendConversationRunEvents,
  AppendConversationRunEventsError,
  ConversationRunTerminalStateError,
  createConversationAgentRun,
  finalizeConversationAgentRun,
  getConversationRun,
  isActiveConversationRunStatus,
  isCursorMismatchConversationRunAppendError,
  isIgnorableConversationRunAppendError,
  monitorConversationRunStatus,
  parseAppendConversationRunEventsErrorBody,
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

function stubFetchImplementation(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([input, init]);
    return implementation(input, init);
  }) as typeof fetch;
  return calls;
}

function stubFetchSequence(...steps: Response[]): FetchCall[] {
  const queue = [...steps];
  return stubFetchImplementation(async () => {
    const next = queue.shift();
    if (!next) {
      throw new Error("Unexpected fetch call");
    }

    return next;
  });
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

  it("reads a conversation durable run projection directly", async () => {
    stubFetchSequence(jsonResponse(camelCaseDurableRunProjection({ runId: "run_lookup_1" }), 200));

    const result = await getConversationRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_lookup_1",
    });

    assertEquals(result, {
      runId: "run_lookup_1",
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      latestEventId: 0,
      latestExternalEventSequence: 0,
      status: "running",
    });
  });

  it("appends conversation run events and parses snake_case responses", async () => {
    const fetchCalls = stubFetchSequence(
      jsonResponse(
        {
          latest_event_id: 7,
          latest_external_event_sequence: 9,
          appended_count: 2,
          run: {
            run_id: "run_root_1",
            conversation_id: CONVERSATION_ID,
            latest_event_id: 7,
            latest_external_event_sequence: 9,
          },
        },
        200,
      ),
    );

    const result = await appendConversationRunEvents({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_root_1",
      expectedPreviousEventId: 3,
      expectedPreviousExternalEventSequence: 4,
      events: [{ type: "STATE_DELTA" }],
    });

    assertEquals(
      String(fetchCalls[0]?.[0]),
      `${API_URL}/conversations/${CONVERSATION_ID}/runs/run_root_1/events`,
    );
    assertEquals(
      JSON.parse(String(fetchCalls[0]?.[1]?.body)),
      {
        expected_previous_event_id: 3,
        expected_previous_external_event_sequence: 4,
        events: [{ type: "STATE_DELTA" }],
      },
    );
    assertEquals(result, {
      latestEventId: 7,
      latestExternalEventSequence: 9,
      appendedCount: 2,
      run: {
        run_id: "run_root_1",
        conversation_id: CONVERSATION_ID,
        latest_event_id: 7,
        latest_external_event_sequence: 9,
        runId: "run_root_1",
        conversationId: CONVERSATION_ID,
        latestEventId: 7,
        latestExternalEventSequence: 9,
      },
    });
  });

  it("parses append errors and exposes ignore/cursor helpers", () => {
    assertEquals(
      parseAppendConversationRunEventsErrorBody(
        JSON.stringify({ detail: "Cannot append external events to a terminal run" }),
      ),
      "Cannot append external events to a terminal run",
    );
    assertEquals(parseAppendConversationRunEventsErrorBody("plain text"), "plain text");

    const ignorable = new AppendConversationRunEventsError({
      status: 400,
      detail: "Cannot append external events to a terminal run",
    });
    const cursorMismatch = new AppendConversationRunEventsError({
      status: 400,
      detail: "External run event cursor mismatch",
    });

    assertEquals(isIgnorableConversationRunAppendError(ignorable), true);
    assertEquals(isIgnorableConversationRunAppendError(cursorMismatch), false);
    assertEquals(isCursorMismatchConversationRunAppendError(cursorMismatch), true);
    assertEquals(isActiveConversationRunStatus("running"), true);
    assertEquals(isActiveConversationRunStatus("completed"), false);
  });

  it("does not issue requests when the caller abort signal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called");
    }) as typeof fetch;

    await assertRejects(
      () =>
        getConversationRun({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          runId: "run_lookup_abort",
          abortSignal: abortController.signal,
        }),
      DOMException,
      "This operation was aborted",
    );

    assertEquals(fetchCalled, false);
  });

  it("reports terminal conversation runs during polling", async () => {
    const seen: ConversationRunTerminalStateError[] = [];
    stubFetchSequence(
      jsonResponse(
        {
          run_id: "run_terminal_1",
          conversation_id: CONVERSATION_ID,
          message_id: MESSAGE_ID,
          latest_event_id: 5,
          latest_external_event_sequence: 6,
          status: "failed",
        },
        200,
      ),
    );

    await monitorConversationRunStatus({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_terminal_1",
      pollIntervalMs: 0,
      onTerminal: (error) => {
        seen.push(error);
      },
    });

    assertEquals(seen.length, 1);
    assertEquals(seen[0]?.status, "failed");
    assertEquals(seen[0]?.run.runId, "run_terminal_1");
  });

  it("continues polling after transient errors and forwards them to onPollError", async () => {
    let callCount = 0;
    stubFetchImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error("temporary");
      }

      return jsonResponse(
        {
          run_id: "run_terminal_2",
          conversation_id: CONVERSATION_ID,
          message_id: MESSAGE_ID,
          latest_event_id: 5,
          latest_external_event_sequence: 6,
          status: "cancelled",
        },
        200,
      );
    });
    const pollErrors: string[] = [];
    const seen: string[] = [];

    await monitorConversationRunStatus({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_terminal_2",
      pollIntervalMs: 0,
      onPollError: (error) => {
        pollErrors.push(error instanceof Error ? error.message : String(error));
      },
      onTerminal: (error) => {
        seen.push(error.status);
      },
    });

    assertEquals(pollErrors, ["temporary"]);
    assertEquals(seen, ["cancelled"]);
  });
});
