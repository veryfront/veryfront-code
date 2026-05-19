import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendConversationRunEvents,
  AppendConversationRunEventsError,
  ConversationRunProjectionSchema,
  ConversationRunTerminalStateError,
  createConversationAgentRun,
  createConversationRunEventQueueController,
  finalizeConversationAgentRun,
  flushConversationRunEventBatches,
  flushConversationRunEventQueue,
  getConversationRun,
  isActiveConversationRunStatus,
  isAppendableConversationRunProjection,
  isCursorMismatchConversationRunAppendError,
  isIgnorableConversationRunAppendError,
  monitorConversationRunStatus,
  parseAppendConversationRunEventsErrorBody,
  recoverConversationRunAppendExecution,
  recoverConversationRunAppendFailure,
  recoverConversationRunCursorMismatch,
  resolveConversationRunTargets,
  resyncConversationRunAppendCursor,
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

  it("resolves project main branch targets with main_branch runtime metadata", () => {
    assertEquals(resolveConversationRunTargets({ projectId: PROJECT_ID, branchId: null }), {
      sourceTargetKind: "project",
      runtimeTargetKind: "main_branch",
      targetBranchId: null,
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
          mode: "agent",
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
          mode: "agent",
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

  it("creates queued generic agent runs when implementationKind is provided", async () => {
    const fetchCalls = stubFetchSequence(
      acceptedRunResponse({ run_id: "run_codex_1" }),
      jsonResponse(durableRunProjection({ run_id: "run_codex_1" }), 200),
    );

    await createConversationAgentRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_codex_1",
      agentId: "codex",
      implementationKind: "codex",
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
        public_id: "run_codex_1",
        request: {
          mode: "agent",
          agent_id: "codex",
          implementation_kind: "codex",
          initial_status: "pending",
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
      waitingToolCallId: null,
      waitingToolName: null,
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
      waitingToolCallId: null,
      waitingToolName: null,
      status: "running",
    });
  });

  it("preserves waiting-tool fields on conversation run projections", () => {
    const result = ConversationRunProjectionSchema.parse(
      durableRunProjection({
        run_id: "run_waiting_1",
        status: "waiting_for_tool",
        waiting_tool_call_id: "tool-call-1",
        waiting_tool_name: "form_input",
      }),
    );

    assertEquals(result, {
      runId: "run_waiting_1",
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      latestEventId: 1,
      latestExternalEventSequence: 1,
      waitingToolCallId: "tool-call-1",
      waitingToolName: "form_input",
      status: "waiting_for_tool",
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

  it("flushes conversation run event batches and returns the final cursors", async () => {
    stubFetchSequence(
      jsonResponse(
        {
          latest_event_id: 2,
          latest_external_event_sequence: 3,
          appended_count: 2,
          run: {
            run_id: "run_batch_1",
            conversation_id: CONVERSATION_ID,
            latest_event_id: 2,
            latest_external_event_sequence: 3,
          },
        },
        200,
      ),
      jsonResponse(
        {
          latest_event_id: 4,
          latest_external_event_sequence: 5,
          appended_count: 1,
          run: {
            run_id: "run_batch_1",
            conversation_id: CONVERSATION_ID,
            latest_event_id: 4,
            latest_external_event_sequence: 5,
          },
        },
        200,
      ),
    );

    const result = await flushConversationRunEventBatches({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_batch_1",
      latestEventId: 0,
      latestExternalEventSequence: 0,
      events: [{ type: "STATE_DELTA", id: 1 }, { type: "STATE_DELTA", id: 2 }, {
        type: "STATE_DELTA",
        id: 3,
      }],
      maxEventsPerBatch: 2,
      maxCursorResyncsPerFlush: 3,
    });

    assertEquals(result, {
      outcome: "flushed",
      latestEventId: 4,
      latestExternalEventSequence: 5,
    });
  });

  it("returns append-execution recovery outcomes when a batch append fails", async () => {
    stubFetchSequence(
      jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_batch_recover_1",
          latestExternalEventSequence: 4,
        }),
        200,
      ),
    );

    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).endsWith("/events")) {
        return jsonResponse({ detail: "External run event cursor mismatch" }, 400);
      }

      return jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_batch_recover_1",
          latestExternalEventSequence: 4,
        }),
        200,
      );
    }) as typeof fetch;

    const result = await flushConversationRunEventBatches({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_batch_recover_1",
      latestEventId: 0,
      latestExternalEventSequence: 0,
      events: [{ type: "STATE_DELTA", id: 1 }],
      pendingEvents: [{ type: "CUSTOM", id: 2 }],
      maxEventsPerBatch: 2,
      maxCursorResyncsPerFlush: 3,
    });

    assertEquals(result, {
      outcome: "resumed",
      latestEventId: 0,
      latestExternalEventSequence: 4,
      pendingEvents: [{ type: "STATE_DELTA", id: 1 }, { type: "CUSTOM", id: 2 }],
      consecutiveFailures: 0,
    });
  });

  it("flushes a host-owned event queue through resumed cursor recovery until the queue clears", async () => {
    let eventsRequestCount = 0;
    stubFetchSequence(
      jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_queue_flush_1",
          latestExternalEventSequence: 6,
        }),
        200,
      ),
      jsonResponse(
        {
          latest_event_id: 7,
          latest_external_event_sequence: 8,
          appended_count: 2,
          run: {
            run_id: "run_queue_flush_1",
            conversation_id: CONVERSATION_ID,
            latest_event_id: 7,
            latest_external_event_sequence: 8,
          },
        },
        200,
      ),
    );

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("/events")) {
        return jsonResponse(
          camelCaseDurableRunProjection({
            runId: "run_queue_flush_1",
            latestExternalEventSequence: 6,
          }),
          200,
        );
      }

      eventsRequestCount += 1;
      if (eventsRequestCount === 1) {
        return jsonResponse({ detail: "External run event cursor mismatch" }, 400);
      }

      const bodyText = typeof init?.body === "string" ? init.body : "";
      const body = JSON.parse(bodyText) as {
        expected_previous_external_event_sequence?: number;
        events?: unknown[];
      };

      assertEquals(body.expected_previous_external_event_sequence, 6);
      assertEquals(body.events, [{ type: "STATE_DELTA", id: 1 }, { type: "CUSTOM", id: 2 }]);

      return jsonResponse(
        {
          latest_event_id: 7,
          latest_external_event_sequence: 8,
          appended_count: 2,
          run: {
            run_id: "run_queue_flush_1",
            conversation_id: CONVERSATION_ID,
            latest_event_id: 7,
            latest_external_event_sequence: 8,
          },
        },
        200,
      );
    }) as typeof fetch;

    const result = await flushConversationRunEventQueue({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_queue_flush_1",
      latestEventId: 0,
      latestExternalEventSequence: 4,
      events: [{ type: "STATE_DELTA", id: 1 }, { type: "CUSTOM", id: 2 }],
      maxEventsPerBatch: 2,
      maxCursorResyncsPerFlush: 3,
    });

    assertEquals(result, {
      outcome: "flushed",
      latestEventId: 7,
      latestExternalEventSequence: 8,
    });
  });

  it("returns retry scheduling details when a host-owned queue still cannot append", async () => {
    globalThis.fetch =
      (async () => jsonResponse({ detail: "internal failure" }, 500)) as typeof fetch;

    const result = await flushConversationRunEventQueue({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_queue_flush_retry",
      latestEventId: 2,
      latestExternalEventSequence: 4,
      events: [{ type: "STATE_DELTA", id: 1 }, { type: "CUSTOM", id: 2 }],
      maxEventsPerBatch: 2,
      consecutiveFailures: 1,
      maxCursorResyncsPerFlush: 3,
    });

    assertEquals(result, {
      outcome: "retry_scheduled",
      latestEventId: 2,
      latestExternalEventSequence: 4,
      pendingEvents: [{ type: "STATE_DELTA", id: 1 }, { type: "CUSTOM", id: 2 }],
      consecutiveFailures: 2,
      errorMessage: "Append conversation run events failed (500): internal failure",
    });
  });

  it("tracks queue state and drains the queue through the controller", async () => {
    let eventsRequestCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("/events")) {
        return jsonResponse(
          camelCaseDurableRunProjection({
            runId: "run_queue_controller_1",
            latestExternalEventSequence: 6,
          }),
          200,
        );
      }

      eventsRequestCount += 1;
      if (eventsRequestCount === 1) {
        return jsonResponse({ detail: "External run event cursor mismatch" }, 400);
      }

      const bodyText = typeof init?.body === "string" ? init.body : "";
      const body = JSON.parse(bodyText) as {
        expected_previous_external_event_sequence?: number;
        events?: unknown[];
      };

      assertEquals(body.expected_previous_external_event_sequence, 6);
      assertEquals(body.events, [{ type: "STATE_DELTA", id: 1 }, { type: "CUSTOM", id: 2 }]);

      return jsonResponse(
        {
          latest_event_id: 7,
          latest_external_event_sequence: 8,
          appended_count: 2,
          run: {
            run_id: "run_queue_controller_1",
            conversation_id: CONVERSATION_ID,
            latest_event_id: 7,
            latest_external_event_sequence: 8,
          },
        },
        200,
      );
    }) as typeof fetch;

    const controller = createConversationRunEventQueueController({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_queue_controller_1",
      latestEventId: 0,
      latestExternalEventSequence: 4,
      maxEventsPerBatch: 2,
    });

    controller.enqueue([{ type: "STATE_DELTA", id: 1 }, { type: "CUSTOM", id: 2 }]);

    assertEquals(controller.getSnapshot(), {
      latestEventId: 0,
      latestExternalEventSequence: 4,
      pendingEventCount: 2,
      consecutiveFailures: 0,
      disabled: false,
    });

    const result = await controller.flush();

    assertEquals(result, {
      outcome: "flushed",
      latestEventId: 7,
      latestExternalEventSequence: 8,
      pendingEventCount: 0,
      consecutiveFailures: 0,
      disabled: false,
    });
    assertEquals(controller.getSnapshot(), {
      latestEventId: 7,
      latestExternalEventSequence: 8,
      pendingEventCount: 0,
      consecutiveFailures: 0,
      disabled: false,
    });
  });

  it("keeps failed queue state for host retry scheduling and disables on stopped outcomes", async () => {
    const retryController = createConversationRunEventQueueController({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_queue_controller_retry",
      latestEventId: 2,
      latestExternalEventSequence: 4,
      maxEventsPerBatch: 2,
    });

    retryController.enqueue([{ type: "STATE_DELTA", id: 1 }]);
    globalThis.fetch =
      (async () => jsonResponse({ detail: "internal failure" }, 500)) as typeof fetch;

    assertEquals(await retryController.flush(), {
      outcome: "retry_scheduled",
      latestEventId: 2,
      latestExternalEventSequence: 4,
      pendingEventCount: 1,
      consecutiveFailures: 1,
      disabled: false,
      errorMessage: "Append conversation run events failed (500): internal failure",
    });

    const stopController = createConversationRunEventQueueController({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_queue_controller_stop",
      latestEventId: 2,
      latestExternalEventSequence: 4,
      maxEventsPerBatch: 2,
    });

    stopController.enqueue([{ type: "STATE_DELTA", id: 1 }]);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/events")) {
        return jsonResponse({ detail: "External run event cursor mismatch" }, 400);
      }

      return jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_queue_controller_stop",
          latestExternalEventSequence: 4,
          status: "waiting_for_tool",
          waitingToolCallId: "tool-call-4",
          waitingToolName: "form_input",
        }),
        200,
      );
    }) as typeof fetch;

    assertEquals(await stopController.flush(), {
      outcome: "stopped",
      latestEventId: 0,
      latestExternalEventSequence: 4,
      pendingEventCount: 0,
      consecutiveFailures: 0,
      disabled: true,
      disableReason: "non_appendable",
    });
    assertEquals(stopController.getSnapshot(), {
      latestEventId: 0,
      latestExternalEventSequence: 4,
      pendingEventCount: 0,
      consecutiveFailures: 0,
      disabled: true,
    });
  });

  it("merges events enqueued during an in-flight retry flush", async () => {
    let resolveAppend: ((response: Response) => void) | null = null;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (String(input).endsWith("/events")) {
        return new Promise<Response>((resolve) => {
          resolveAppend = resolve;
        });
      }

      return Promise.resolve(jsonResponse(camelCaseDurableRunProjection(), 200));
    }) as typeof fetch;

    const controller = createConversationRunEventQueueController({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_queue_controller_merge",
      latestEventId: 2,
      latestExternalEventSequence: 4,
      maxEventsPerBatch: 2,
    });

    controller.enqueue([{ type: "STATE_DELTA", id: 1 }]);

    const flushPromise = controller.flush();
    controller.enqueue([{ type: "CUSTOM", id: 2 }]);
    resolveAppend?.(jsonResponse({ detail: "internal failure" }, 500));

    assertEquals(await flushPromise, {
      outcome: "retry_scheduled",
      latestEventId: 2,
      latestExternalEventSequence: 4,
      pendingEventCount: 2,
      consecutiveFailures: 1,
      disabled: false,
      errorMessage: "Append conversation run events failed (500): internal failure",
    });
    assertEquals(controller.getSnapshot(), {
      latestEventId: 2,
      latestExternalEventSequence: 4,
      pendingEventCount: 2,
      consecutiveFailures: 1,
      disabled: false,
    });
  });

  it("requeues buffered events when queue flushing throws before classification completes", async () => {
    let appendRequestCount = 0;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (String(input).endsWith("/events")) {
        appendRequestCount += 1;
        return Promise.resolve(jsonResponse({ detail: "External run event cursor mismatch" }, 400));
      }

      return Promise.reject(new Error("run lookup failed"));
    }) as typeof fetch;

    const controller = createConversationRunEventQueueController({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_queue_controller_throw",
      latestEventId: 2,
      latestExternalEventSequence: 4,
      maxEventsPerBatch: 2,
    });

    controller.enqueue([{ type: "STATE_DELTA", id: 1 }, { type: "CUSTOM", id: 2 }]);

    await assertRejects(
      () => controller.flush(),
      Error,
      "run lookup failed",
    );

    assertEquals(appendRequestCount, 1);
    assertEquals(controller.getSnapshot(), {
      latestEventId: 2,
      latestExternalEventSequence: 4,
      pendingEventCount: 2,
      consecutiveFailures: 0,
      disabled: false,
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
    assertEquals(
      isAppendableConversationRunProjection(
        ConversationRunProjectionSchema.parse(camelCaseDurableRunProjection()),
      ),
      true,
    );
    assertEquals(
      isAppendableConversationRunProjection(
        ConversationRunProjectionSchema.parse(
          camelCaseDurableRunProjection({
            status: "waiting_for_tool",
            waitingToolCallId: "tool-call-1",
            waitingToolName: "form_input",
          }),
        ),
      ),
      false,
    );
  });

  it("classifies append cursor resync results from the canonical run projection", async () => {
    stubFetchSequence(
      jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_resync_1",
          latestExternalEventSequence: 5,
        }),
        200,
      ),
      jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_resync_2",
          latestExternalEventSequence: 4,
        }),
        200,
      ),
      jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_resync_3",
          latestExternalEventSequence: 4,
          status: "waiting_for_tool",
          waitingToolCallId: "tool-call-1",
          waitingToolName: "form_input",
        }),
        200,
      ),
      jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_resync_4",
          latestExternalEventSequence: 6,
          status: "waiting_for_tool",
          waitingToolCallId: "tool-call-2",
          waitingToolName: "form_input",
        }),
        200,
      ),
    );

    assertEquals(
      await resyncConversationRunAppendCursor({
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_resync_1",
        previousLatestExternalEventSequence: 4,
      }),
      {
        result: "advanced",
        run: {
          runId: "run_resync_1",
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          latestEventId: 0,
          latestExternalEventSequence: 5,
          waitingToolCallId: null,
          waitingToolName: null,
          status: "running",
        },
      },
    );

    assertEquals(
      await resyncConversationRunAppendCursor({
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_resync_2",
        previousLatestExternalEventSequence: 4,
      }),
      {
        result: "unchanged",
        run: {
          runId: "run_resync_2",
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          latestEventId: 0,
          latestExternalEventSequence: 4,
          waitingToolCallId: null,
          waitingToolName: null,
          status: "running",
        },
      },
    );

    assertEquals(
      await resyncConversationRunAppendCursor({
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_resync_3",
        previousLatestExternalEventSequence: 4,
      }),
      {
        result: "non_appendable",
        run: {
          runId: "run_resync_3",
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          latestEventId: 0,
          latestExternalEventSequence: 4,
          waitingToolCallId: "tool-call-1",
          waitingToolName: "form_input",
          status: "waiting_for_tool",
        },
      },
    );

    assertEquals(
      await resyncConversationRunAppendCursor({
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_resync_4",
        previousLatestExternalEventSequence: 4,
      }),
      {
        result: "non_appendable",
        run: {
          runId: "run_resync_4",
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          latestEventId: 0,
          latestExternalEventSequence: 6,
          waitingToolCallId: "tool-call-2",
          waitingToolName: "form_input",
          status: "waiting_for_tool",
        },
      },
    );
  });

  it("recovers cursor mismatch outcomes with retry-limit gating", async () => {
    stubFetchSequence(
      jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_recover_1",
          latestExternalEventSequence: 6,
        }),
        200,
      ),
      jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_recover_2",
          latestExternalEventSequence: 4,
          status: "waiting_for_tool",
          waitingToolCallId: "tool-call-2",
          waitingToolName: "form_input",
        }),
        200,
      ),
    );

    assertEquals(
      await recoverConversationRunCursorMismatch({
        error: new AppendConversationRunEventsError({
          status: 400,
          detail: "External run event cursor mismatch",
        }),
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_recover_1",
        latestEventId: 0,
        latestExternalEventSequence: 4,
        cursorResyncsThisFlush: 0,
        maxCursorResyncsPerFlush: 3,
      }),
      {
        outcome: "resumed",
        latestEventId: 0,
        latestExternalEventSequence: 6,
        run: {
          runId: "run_recover_1",
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          latestEventId: 0,
          latestExternalEventSequence: 6,
          waitingToolCallId: null,
          waitingToolName: null,
          status: "running",
        },
      },
    );

    assertEquals(
      await recoverConversationRunCursorMismatch({
        error: new AppendConversationRunEventsError({
          status: 400,
          detail: "External run event cursor mismatch",
        }),
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_recover_2",
        latestEventId: 0,
        latestExternalEventSequence: 4,
        cursorResyncsThisFlush: 0,
        maxCursorResyncsPerFlush: 3,
      }),
      {
        outcome: "stopped",
        latestEventId: 0,
        latestExternalEventSequence: 4,
        disableReason: "non_appendable",
        run: {
          runId: "run_recover_2",
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          latestEventId: 0,
          latestExternalEventSequence: 4,
          waitingToolCallId: "tool-call-2",
          waitingToolName: "form_input",
          status: "waiting_for_tool",
        },
      },
    );

    assertEquals(
      await recoverConversationRunCursorMismatch({
        error: new AppendConversationRunEventsError({
          status: 400,
          detail: "External run event cursor mismatch",
        }),
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_recover_3",
        latestEventId: 2,
        latestExternalEventSequence: 4,
        cursorResyncsThisFlush: 3,
        maxCursorResyncsPerFlush: 3,
      }),
      {
        outcome: "stopped",
        latestEventId: 2,
        latestExternalEventSequence: 4,
        disableReason: "cursor_resyncs_exhausted",
      },
    );

    assertEquals(
      await recoverConversationRunCursorMismatch({
        error: new AppendConversationRunEventsError({
          status: 500,
          detail: "internal failure",
        }),
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_recover_4",
        latestEventId: 2,
        latestExternalEventSequence: 4,
        cursorResyncsThisFlush: 0,
        maxCursorResyncsPerFlush: 3,
      }),
      {
        outcome: "bubbled",
        latestEventId: 2,
        latestExternalEventSequence: 4,
      },
    );
  });

  it("classifies append failures into resume, stop, and retry outcomes", async () => {
    stubFetchSequence(
      jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_append_failure_1",
          latestExternalEventSequence: 6,
        }),
        200,
      ),
      jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_append_failure_2",
          latestExternalEventSequence: 4,
          status: "waiting_for_tool",
          waitingToolCallId: "tool-call-3",
          waitingToolName: "form_input",
        }),
        200,
      ),
    );

    assertEquals(
      await recoverConversationRunAppendFailure({
        error: new AppendConversationRunEventsError({
          status: 400,
          detail: "External run event cursor mismatch",
        }),
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_append_failure_1",
        latestEventId: 0,
        latestExternalEventSequence: 4,
        cursorResyncsThisFlush: 0,
        maxCursorResyncsPerFlush: 3,
      }),
      {
        outcome: "resumed",
        latestEventId: 0,
        latestExternalEventSequence: 6,
        run: {
          runId: "run_append_failure_1",
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          latestEventId: 0,
          latestExternalEventSequence: 6,
          waitingToolCallId: null,
          waitingToolName: null,
          status: "running",
        },
      },
    );

    assertEquals(
      await recoverConversationRunAppendFailure({
        error: new AppendConversationRunEventsError({
          status: 400,
          detail: "Cannot append external events to a terminal run",
        }),
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_append_failure_ignored",
        latestEventId: 2,
        latestExternalEventSequence: 4,
        cursorResyncsThisFlush: 0,
        maxCursorResyncsPerFlush: 3,
      }),
      {
        outcome: "stopped",
        latestEventId: 2,
        latestExternalEventSequence: 4,
        disableReason: "ignorable_append_rejection",
      },
    );

    assertEquals(
      await recoverConversationRunAppendFailure({
        error: new AppendConversationRunEventsError({
          status: 400,
          detail: "External run event cursor mismatch",
        }),
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_append_failure_2",
        latestEventId: 0,
        latestExternalEventSequence: 4,
        cursorResyncsThisFlush: 0,
        maxCursorResyncsPerFlush: 3,
      }),
      {
        outcome: "stopped",
        latestEventId: 0,
        latestExternalEventSequence: 4,
        disableReason: "non_appendable",
        run: {
          runId: "run_append_failure_2",
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          latestEventId: 0,
          latestExternalEventSequence: 4,
          waitingToolCallId: "tool-call-3",
          waitingToolName: "form_input",
          status: "waiting_for_tool",
        },
      },
    );

    assertEquals(
      await recoverConversationRunAppendFailure({
        error: new AppendConversationRunEventsError({
          status: 500,
          detail: "internal failure",
        }),
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_append_failure_retry",
        latestEventId: 2,
        latestExternalEventSequence: 4,
        cursorResyncsThisFlush: 0,
        maxCursorResyncsPerFlush: 3,
      }),
      {
        outcome: "retry_scheduled",
        latestEventId: 2,
        latestExternalEventSequence: 4,
        errorMessage: "Append conversation run events failed (500): internal failure",
      },
    );
  });

  it("recovers append execution queues with canonical resume/stop/retry outcomes", async () => {
    stubFetchSequence(
      jsonResponse(
        camelCaseDurableRunProjection({
          runId: "run_append_execution_1",
          latestExternalEventSequence: 6,
        }),
        200,
      ),
    );

    assertEquals(
      await recoverConversationRunAppendExecution({
        error: new AppendConversationRunEventsError({
          status: 400,
          detail: "External run event cursor mismatch",
        }),
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_append_execution_1",
        latestEventId: 0,
        latestExternalEventSequence: 4,
        remainingEvents: [{ type: "STATE_DELTA" }],
        pendingEvents: [{ type: "CUSTOM" }],
        cursorResyncsThisFlush: 0,
        consecutiveFailures: 1,
        maxCursorResyncsPerFlush: 3,
      }),
      {
        outcome: "resumed",
        latestEventId: 0,
        latestExternalEventSequence: 6,
        pendingEvents: [{ type: "STATE_DELTA" }, { type: "CUSTOM" }],
        consecutiveFailures: 0,
      },
    );

    assertEquals(
      await recoverConversationRunAppendExecution({
        error: new AppendConversationRunEventsError({
          status: 400,
          detail: "Cannot append external events to a terminal run",
        }),
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_append_execution_2",
        latestEventId: 2,
        latestExternalEventSequence: 4,
        remainingEvents: [{ type: "STATE_DELTA" }],
        pendingEvents: [{ type: "CUSTOM" }],
        cursorResyncsThisFlush: 0,
        consecutiveFailures: 1,
        maxCursorResyncsPerFlush: 3,
      }),
      {
        outcome: "stopped",
        latestEventId: 2,
        latestExternalEventSequence: 4,
        disableReason: "ignorable_append_rejection",
      },
    );

    assertEquals(
      await recoverConversationRunAppendExecution({
        error: new AppendConversationRunEventsError({
          status: 500,
          detail: "internal failure",
        }),
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        runId: "run_append_execution_3",
        latestEventId: 2,
        latestExternalEventSequence: 4,
        remainingEvents: [{ type: "STATE_DELTA" }],
        pendingEvents: [{ type: "CUSTOM" }],
        cursorResyncsThisFlush: 0,
        consecutiveFailures: 1,
        maxCursorResyncsPerFlush: 3,
      }),
      {
        outcome: "retry_scheduled",
        latestEventId: 2,
        latestExternalEventSequence: 4,
        pendingEvents: [{ type: "STATE_DELTA" }, { type: "CUSTOM" }],
        consecutiveFailures: 2,
        errorMessage: "Append conversation run events failed (500): internal failure",
      },
    );
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

  it("rethrows terminal callback errors instead of swallowing them as poll errors", async () => {
    let callCount = 0;
    stubFetchImplementation(async () => {
      callCount += 1;
      return jsonResponse(
        {
          run_id: "run_terminal_3",
          conversation_id: CONVERSATION_ID,
          message_id: MESSAGE_ID,
          latest_event_id: 5,
          latest_external_event_sequence: 6,
          status: "failed",
        },
        200,
      );
    });
    const pollErrors: string[] = [];

    await assertRejects(
      () =>
        monitorConversationRunStatus({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          runId: "run_terminal_3",
          pollIntervalMs: 0,
          onPollError: (error) => {
            pollErrors.push(error instanceof Error ? error.message : String(error));
          },
          onTerminal: () => {
            throw new Error("stop upstream");
          },
        }),
      Error,
      "stop upstream",
    );

    assertEquals(callCount, 1);
    assertEquals(pollErrors, []);
  });
});
