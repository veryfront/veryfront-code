import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createConversationChildLifecycleAdapter,
  createConversationHostedLifecycleAdapter,
} from "./conversation-hosted-lifecycle.ts";

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
        runtimeTargetKind: "production",
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
            runtimeTargetKind: "production",
            targetBranchId: null,
          },
        },
      ],
    });
    assertEquals(String(fetchCalls[0]?.[0]), `${API_URL}/runs/run_child_1/complete`);
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
