import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildInvokeAgentChildRunProgressEvents,
  buildInvokeAgentChildRunStateDelta,
  publishInvokeAgentChildRunProgress,
} from "./invoke-agent-child-runs.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const CONVERSATION_ID = "11111111-1111-4111-a111-111111111111";
const CHILD_CONVERSATION_ID = "22222222-2222-4222-a222-222222222222";
const CHILD_MESSAGE_ID = "33333333-3333-4333-a333-333333333333";
const BRANCH_ID = "44444444-4444-4444-8444-444444444444";
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetchSequence(...steps: Response[]) {
  const queue = [...steps];
  const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
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

const BASE_INPUT = {
  toolCallId: "tool/call~1",
  childConversationId: CHILD_CONVERSATION_ID,
  childRunId: "run_child_1",
  childMessageId: CHILD_MESSAGE_ID,
  childAgentId: "researcher",
  description: "Inspect logs",
  status: "pending" as const,
  sourceTargetKind: "project" as const,
  runtimeTargetKind: "production" as const,
  targetBranchId: null,
};

describe("agent/invoke-agent-child-runs", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("builds escaped state delta paths and lifecycle events", () => {
    assertEquals(buildInvokeAgentChildRunStateDelta(BASE_INPUT), {
      type: "STATE_DELTA",
      delta: [
        {
          op: "add",
          path: "/invokeAgentChildRuns/tool~1call~01",
          value: {
            toolCallId: "tool/call~1",
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

    assertEquals(buildInvokeAgentChildRunProgressEvents(BASE_INPUT), [
      {
        type: "STATE_DELTA",
        delta: [
          {
            op: "add",
            path: "/invokeAgentChildRuns/tool~1call~01",
            value: {
              toolCallId: "tool/call~1",
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
      },
      {
        type: "CUSTOM",
        name: "veryfront.invoke_agent.lifecycle",
        value: {
          toolCallId: "tool/call~1",
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
    ]);
  });

  it("uses a shared publisher when provided", async () => {
    const publishParentRunEvents = async (_events: unknown[]) => undefined;
    const calls: unknown[][] = [];
    const publisher = async (events: unknown[]) => {
      calls.push(events);
      await publishParentRunEvents(events);
    };

    await publishInvokeAgentChildRunProgress({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_parent_1",
      ...BASE_INPUT,
      publishParentRunEvents: publisher,
    });

    assertEquals(calls.length, 1);
    assertEquals(calls[0], [...buildInvokeAgentChildRunProgressEvents(BASE_INPUT)]);
  });

  it("falls back to appending run events through the canonical conversation route", async () => {
    const calls = stubFetchSequence(
      jsonResponse(
        {
          latest_event_id: 7,
          latest_external_event_sequence: 9,
          appended_count: 2,
          run: {
            run_id: "run_parent_1",
            conversation_id: CONVERSATION_ID,
            latest_event_id: 7,
            latest_external_event_sequence: 9,
          },
        },
        200,
      ),
    );

    await publishInvokeAgentChildRunProgress({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_parent_1",
      expectedPreviousEventId: 3,
      expectedPreviousExternalEventSequence: 4,
      ...BASE_INPUT,
    });

    assertEquals(
      String(calls[0]?.[0]),
      `${API_URL}/conversations/${CONVERSATION_ID}/runs/run_parent_1/events`,
    );
    assertEquals(JSON.parse(String(calls[0]?.[1]?.body)), {
      expected_previous_event_id: 3,
      expected_previous_external_event_sequence: 4,
      events: [...buildInvokeAgentChildRunProgressEvents(BASE_INPUT)],
    });
  });

  it("ignores terminal-run append failures so hosts can continue local cleanup", async () => {
    stubFetchSequence(
      jsonResponse({ detail: "Cannot append external events to a terminal run" }, 400),
    );

    await publishInvokeAgentChildRunProgress({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: "run_parent_1",
      ...BASE_INPUT,
    });
  });

  it("rethrows non-ignorable append failures", async () => {
    stubFetchSequence(jsonResponse({ detail: "boom" }, 400));

    await assertRejects(
      () =>
        publishInvokeAgentChildRunProgress({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          runId: "run_parent_1",
          ...BASE_INPUT,
          status: "running",
          sourceTargetKind: "preview_branch",
          runtimeTargetKind: "preview_branch",
          targetBranchId: BRANCH_ID,
        }),
      Error,
      "Append conversation run events failed (400): boom",
    );
  });
});
