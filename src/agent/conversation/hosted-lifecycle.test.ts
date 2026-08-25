import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createConversationChildLifecycleAdapter,
  createConversationHostedLifecycleAdapter,
  createConversationHostedStreamLifecycleAdapter,
} from "./hosted-lifecycle.ts";
import { ConversationRunEventEncoder } from "./run-events.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const CONVERSATION_ID = "11111111-1111-4111-a111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-a222-222222222222";
const CHILD_CONVERSATION_ID = "33333333-3333-4333-a333-333333333333";
const CHILD_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const BRANCH_ID = "55555555-5555-4555-8555-555555555555";
const originalFetch = globalThis.fetch;

type FetchCall = [RequestInfo | URL, RequestInit | undefined];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

describe("agent/conversation-hosted-lifecycle", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("appends conversation events and mutates the run cursor", async () => {
    const adapter = createConversationHostedLifecycleAdapter<string>({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      startRun: async () => ({
        runId: "run_root_1",
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        latestEventId: 1,
        latestExternalEventSequence: 2,
        status: "running",
      }),
      mapChunkToEvents: (chunk) => [{ type: "STATE_DELTA", chunk }],
      resolveFinalizeInput: () => ({ model: "gpt-5.4", provider: "openai" }),
    });
    const fetchCalls = stubFetchSequence(
      jsonResponse({
        latest_event_id: 3,
        latest_external_event_sequence: 4,
        appended_count: 1,
        run: {
          run_id: "run_root_1",
          conversation_id: CONVERSATION_ID,
          latest_event_id: 3,
          latest_external_event_sequence: 4,
        },
      }),
    );

    const run = await adapter.startRun({ abortSignal: new AbortController().signal });
    await adapter.appendEvents?.(run, "chunk-1");

    assertEquals(run.latestEventId, 3);
    assertEquals(run.latestExternalEventSequence, 4);
    assertEquals(JSON.parse(String(fetchCalls[0]?.[1]?.body)), {
      expected_previous_event_id: 1,
      expected_previous_external_event_sequence: 2,
      events: [{ type: "STATE_DELTA", chunk: "chunk-1" }],
    });
  });

  it("maps public chat stream events directly into conversation-run appends", async () => {
    const adapter = createConversationHostedStreamLifecycleAdapter({
      // Exact-payload assertion: an unclocked encoder keeps it free of elapsedMs.
      encoder: new ConversationRunEventEncoder(),
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      startRun: async () => ({
        runId: "run_root_stream_1",
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        latestEventId: 1,
        latestExternalEventSequence: 2,
        status: "running",
      }),
      resolveFinalizeInput: () => ({ model: "gpt-5.4", provider: "openai" }),
    });
    const fetchCalls = stubFetchSequence(
      jsonResponse({
        latest_event_id: 3,
        latest_external_event_sequence: 4,
        appended_count: 2,
        run: {
          run_id: "run_root_stream_1",
          conversation_id: CONVERSATION_ID,
          latest_event_id: 3,
          latest_external_event_sequence: 4,
        },
      }),
    );

    const run = await adapter.startRun({ abortSignal: new AbortController().signal });
    await adapter.appendEvents?.(run, {
      type: "tool-input-available",
      toolCallId: "tc-1",
      toolName: "bash",
      input: { command: "ls" },
    });

    assertEquals(run.latestEventId, 3);
    assertEquals(run.latestExternalEventSequence, 4);
    assertEquals(JSON.parse(String(fetchCalls[0]?.[1]?.body)), {
      expected_previous_event_id: 1,
      expected_previous_external_event_sequence: 2,
      events: [
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: "tc-1",
          delta: '{"command":"ls"}',
        },
        {
          type: "TOOL_CALL_END",
          toolCallId: "tc-1",
        },
      ],
    });
  });

  // One encoder must span the whole run. It carries stepCount and the active
  // message across chunks, and its creation is the anchor elapsedMs is measured
  // from. Building a fresh encoder per chunk resets both: every step collapses
  // to step-1 and no event can carry a meaningful elapsed. Observed in
  // production, where a multi-step scheduled run persisted step-1 four times.
  it("keeps one encoder across chunks so step names advance and elapsed accrues", async () => {
    const adapter = createConversationHostedStreamLifecycleAdapter({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      startRun: async () => ({
        runId: "run_root_stream_2",
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        latestEventId: 1,
        latestExternalEventSequence: 2,
        status: "running",
      }),
      resolveFinalizeInput: () => ({ model: "gpt-5.4", provider: "openai" }),
    });
    const fetchCalls = stubFetchSequence(
      jsonResponse({
        latest_event_id: 3,
        latest_external_event_sequence: 4,
        appended_count: 1,
        run: {
          run_id: "run_root_stream_2",
          conversation_id: CONVERSATION_ID,
          latest_event_id: 3,
          latest_external_event_sequence: 4,
        },
      }),
      jsonResponse({
        latest_event_id: 5,
        latest_external_event_sequence: 6,
        appended_count: 1,
        run: {
          run_id: "run_root_stream_2",
          conversation_id: CONVERSATION_ID,
          latest_event_id: 5,
          latest_external_event_sequence: 6,
        },
      }),
    );

    const run = await adapter.startRun({ abortSignal: new AbortController().signal });
    await adapter.appendEvents?.(run, { type: "start-step" });
    await adapter.appendEvents?.(run, { type: "start-step" });

    const stepNames = fetchCalls.map((call) =>
      JSON.parse(String(call[1]?.body)).events[0].stepName
    );
    assertEquals(
      stepNames,
      ["step-1", "step-2"],
      `a second chunk must continue the run's step count, got ${JSON.stringify(stepNames)}`,
    );

    const elapsed = fetchCalls.map((call) => JSON.parse(String(call[1]?.body)).events[0].elapsedMs);
    assertEquals(
      elapsed.every((value) => typeof value === "number"),
      true,
      `every persisted event must carry elapsedMs, got ${JSON.stringify(elapsed)}`,
    );
    const emittedAt = fetchCalls.map((call) =>
      JSON.parse(String(call[1]?.body)).events[0].emittedAt
    );
    assertEquals(
      emittedAt.every((value) => typeof value === "number" && Number.isInteger(value) && value > 0),
      true,
      `every persisted event must carry epoch emittedAt, got ${JSON.stringify(emittedAt)}`,
    );
  });

  it("serializes overlapping appends so each one sees the previous cursor", async () => {
    const adapter = createConversationHostedStreamLifecycleAdapter({
      encoder: new ConversationRunEventEncoder(),
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      startRun: async () => ({
        runId: "run_root_stream_3",
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        latestEventId: 1,
        latestExternalEventSequence: 2,
        status: "running",
      }),
      resolveFinalizeInput: () => ({ model: "gpt-5.4", provider: "openai" }),
    });
    const fetchCalls = stubFetchSequence(
      jsonResponse({
        latest_event_id: 3,
        latest_external_event_sequence: 4,
        appended_count: 1,
        run: {
          run_id: "run_root_stream_3",
          conversation_id: CONVERSATION_ID,
          latest_event_id: 3,
          latest_external_event_sequence: 4,
        },
      }),
      jsonResponse({
        latest_event_id: 5,
        latest_external_event_sequence: 6,
        appended_count: 1,
        run: {
          run_id: "run_root_stream_3",
          conversation_id: CONVERSATION_ID,
          latest_event_id: 5,
          latest_external_event_sequence: 6,
        },
      }),
    );

    const run = await adapter.startRun({ abortSignal: new AbortController().signal });
    const first = adapter.appendEvents?.(run, { type: "start-step" });
    const second = adapter.appendEvents?.(run, { type: "start-step" });
    await Promise.all([first, second]);

    assertEquals(
      JSON.parse(String(fetchCalls[0]?.[1]?.body)).expected_previous_event_id,
      1,
      "the first append uses the starting cursor",
    );
    assertEquals(
      JSON.parse(String(fetchCalls[1]?.[1]?.body)).expected_previous_event_id,
      3,
      "an overlapping append must wait for the previous cursor update",
    );
    assertEquals(run.latestEventId, 5, "the run cursor advances once per append");
  });

  it("finalizes and cancels conversation-backed root runs with host-supplied model metadata", async () => {
    const run = {
      runId: "run_root_2",
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      latestEventId: 0,
      latestExternalEventSequence: 0,
      status: "running" as const,
    };
    const adapter = createConversationHostedLifecycleAdapter<unknown>({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      startRun: async () => run,
      resolveFinalizeInput: ({ terminalState }) => ({
        model: terminalState.metadata?.modelId ?? "gpt-5.4",
        provider: "openai",
        usage: terminalState.metadata?.usage
          ? {
            inputTokens: terminalState.metadata.usage.inputTokens ?? 0,
            outputTokens: terminalState.metadata.usage.outputTokens ?? 0,
            totalTokens: (terminalState.metadata.usage.inputTokens ?? 0) +
              (terminalState.metadata.usage.outputTokens ?? 0),
          }
          : undefined,
        terminalErrorCode: terminalState.terminalErrorCode,
        terminalErrorMessage: terminalState.terminalErrorMessage,
      }),
    });
    const fetchCalls = stubFetchSequence(
      jsonResponse({ completed: true, run: { run_id: "run_root_2", status: "completed" } }),
      jsonResponse({ completed: true, run: { run_id: "run_root_2", status: "cancelled" } }),
      jsonResponse({ completed: true, run: { run_id: "run_root_2", status: "failed" } }),
    );

    await adapter.finalizeRun?.(run, {
      status: "completed",
      metadata: { modelId: "gpt-5.4", usage: { inputTokens: 2, outputTokens: 3 } },
      terminalErrorCode: null,
      terminalErrorMessage: null,
    });
    await adapter.cancelRun?.(run, {
      status: "cancelled",
      metadata: { modelId: "gpt-5.4-mini" },
      terminalErrorCode: "ABORTED",
      terminalErrorMessage: "Stopped",
    });

    assertEquals(JSON.parse(String(fetchCalls[0]?.[1]?.body)), {
      status: "completed",
      metadata: {
        provider: "openai",
        model: "gpt-5.4",
        inputTokens: 2,
        outputTokens: 3,
        finishReason: "stop",
      },
      terminal_error_code: null,
      terminal_error_message: null,
    });
    assertEquals(JSON.parse(String(fetchCalls[1]?.[1]?.body)), {
      status: "cancelled",
      metadata: null,
      terminal_error_code: "ABORTED",
      terminal_error_message: "Stopped",
    });

    await adapter.finalizeRun?.(run, {
      status: "failed",
      metadata: { modelId: "gpt-5.4" },
      terminalErrorCode: "FAILED",
      terminalErrorMessage: "boom",
    });

    assertEquals(
      JSON.parse(String(fetchCalls[2]?.[1]?.body)),
      {
        status: "failed",
        metadata: null,
        terminal_error_code: "FAILED",
        terminal_error_message: "boom",
      },
      "finalizeRun must forward the terminal status rather than always completing the run",
    );
  });

  it("publishes shared-parent child progress without falling back to HTTP append and finalizes child runs", async () => {
    const published: unknown[][] = [];
    const adapter = createConversationChildLifecycleAdapter({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      parentConversationId: CONVERSATION_ID,
      parentRunId: "run_parent_1",
      projectId: "project-1",
      publishParentRunEvents: async (events) => {
        published.push(events);
      },
      progress: {
        toolCallId: "tool-1",
        childAgentId: "researcher",
        childConversationId: CHILD_CONVERSATION_ID,
        childRunId: "run_child_1",
        childMessageId: CHILD_MESSAGE_ID,
        description: "Inspect logs",
        sourceTargetKind: "project",
        runtimeTargetKind: "main_branch",
        targetBranchId: null,
      },
      model: "gpt-5.4",
      provider: "openai",
    });
    const fetchCalls = stubFetchSequence(
      jsonResponse({ completed: true, run: { run_id: "run_child_1", status: "completed" } }),
    );

    await adapter.pending?.();
    await adapter.running?.();
    await adapter.completed?.({
      status: "completed",
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    });

    assertEquals(published.length, 3);
    assertEquals(published[0]?.[0], {
      type: "STATE_DELTA",
      delta: [
        {
          op: "add",
          path: "/invokeAgentChildRuns/tool-1",
          value: {
            toolCallId: "tool-1",
            childConversationId: CHILD_CONVERSATION_ID,
            childRunId: "run_child_1",
            childMessageId: CHILD_MESSAGE_ID,
            childAgentId: "researcher",
            description: "Inspect logs",
            status: "pending",
            sourceTargetKind: "project",
            runtimeTargetKind: "main_branch",
            targetBranchId: null,
          },
        },
      ],
    });
    assertEquals(String(fetchCalls[0]?.[0]), `${API_URL}/runs/run_child_1/complete`);
  });

  it("publishes the terminal child status even when finalization fails", async () => {
    const published: unknown[][] = [];
    const adapter = createConversationChildLifecycleAdapter({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      parentConversationId: CONVERSATION_ID,
      parentRunId: "run_parent_3",
      projectId: "project-1",
      publishParentRunEvents: async (events) => {
        published.push(events);
      },
      progress: {
        toolCallId: "tool-1",
        childAgentId: "researcher",
        childConversationId: CHILD_CONVERSATION_ID,
        childRunId: "run_child_1",
        childMessageId: CHILD_MESSAGE_ID,
        description: "Inspect logs",
        sourceTargetKind: "project",
        runtimeTargetKind: "main_branch",
        targetBranchId: null,
      },
      model: "gpt-5.4",
      provider: "openai",
    });
    stubFetchSequence(jsonResponse({ detail: "boom" }, 500));

    await adapter.pending?.();
    await assertRejects(
      () =>
        adapter.completed?.({
          status: "completed",
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        }) as Promise<void>,
      Error,
      undefined,
      "a failed child finalization must still reject",
    );

    assertEquals(
      published.at(-1)?.[0],
      {
        type: "STATE_DELTA",
        delta: [
          {
            op: "replace",
            path: "/invokeAgentChildRuns/tool-1",
            value: {
              toolCallId: "tool-1",
              childConversationId: CHILD_CONVERSATION_ID,
              childRunId: "run_child_1",
              childMessageId: CHILD_MESSAGE_ID,
              childAgentId: "researcher",
              description: "Inspect logs",
              status: "completed",
              sourceTargetKind: "project",
              runtimeTargetKind: "main_branch",
              targetBranchId: null,
            },
          },
        ],
      },
      "the parent must learn the terminal status even when finalization fails",
    );
  });

  it("falls back to canonical conversation-run event publishing when no shared parent publisher exists", async () => {
    const adapter = createConversationChildLifecycleAdapter({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      parentConversationId: CONVERSATION_ID,
      parentRunId: "run_parent_2",
      projectId: "project-1",
      progress: {
        toolCallId: "tool-2",
        childAgentId: "researcher",
        childConversationId: CHILD_CONVERSATION_ID,
        childRunId: "run_child_2",
        childMessageId: CHILD_MESSAGE_ID,
        description: "Inspect logs",
        sourceTargetKind: "preview_branch",
        runtimeTargetKind: "preview_branch",
        targetBranchId: BRANCH_ID,
      },
      model: "gpt-5.4-mini",
      provider: "openai",
    });
    const fetchCalls = stubFetchSequence(
      jsonResponse({
        latest_event_id: 7,
        latest_external_event_sequence: 8,
        appended_count: 2,
        run: {
          run_id: "run_parent_2",
          conversation_id: CONVERSATION_ID,
          latest_event_id: 7,
          latest_external_event_sequence: 8,
        },
      }),
      jsonResponse({ completed: true, run: { run_id: "run_child_2", status: "failed" } }),
      jsonResponse({
        latest_event_id: 9,
        latest_external_event_sequence: 10,
        appended_count: 2,
        run: {
          run_id: "run_parent_2",
          conversation_id: CONVERSATION_ID,
          latest_event_id: 9,
          latest_external_event_sequence: 10,
        },
      }),
    );

    await adapter.pending?.();
    await adapter.failed?.({
      status: "failed",
      terminalErrorCode: "FAILED",
      terminalErrorMessage: "boom",
    });

    assertEquals(
      String(fetchCalls[0]?.[0]),
      `${API_URL}/conversations/${CONVERSATION_ID}/runs/run_parent_2/events`,
    );
    assertEquals(String(fetchCalls[1]?.[0]), `${API_URL}/runs/run_child_2/complete`);
    assertEquals(
      String(fetchCalls[2]?.[0]),
      `${API_URL}/conversations/${CONVERSATION_ID}/runs/run_parent_2/events`,
    );
  });
});
