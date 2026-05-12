import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createConversationRootRunContext,
  createConversationRootRunStartAdapter,
  prepareConversationRootRunContext,
  startConversationRootRun,
} from "./conversation-root-run-context.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const CONVERSATION_ID = "11111111-1111-4111-a111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-a222-222222222222";
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
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

describe("agent/conversation-root-run-context", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("starts a canonical conversation root run when a conversation exists", async () => {
    const calls = stubFetchSequence(
      jsonResponse({ accepted: true, run: { run_id: "run_root_1" } }, 202),
      jsonResponse({
        run_id: "run_root_1",
        conversation_id: CONVERSATION_ID,
        message_id: MESSAGE_ID,
        latest_event_id: 3,
        latest_external_event_sequence: 7,
        status: "running",
      }),
    );

    const run = await startConversationRootRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      projectId: "project-1",
      branchId: null,
      agentId: "veryfront",
    });

    assertEquals(run?.runId, "run_root_1");
    assertEquals(String(calls[0]?.[0]), `${API_URL}/runs`);
  });

  it("reuses a provided run descriptor without calling the API", async () => {
    const run = await startConversationRootRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      agentId: "veryfront",
      providedRun: {
        runId: "existing-run",
        messageId: MESSAGE_ID,
        latestEventId: 4,
        latestExternalEventSequence: 9,
      },
    });

    assertEquals(run, {
      runId: "existing-run",
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      latestEventId: 4,
      latestExternalEventSequence: 9,
      waitingToolCallId: null,
      waitingToolName: null,
      status: "running",
    });
  });

  it("rejects provided runs without a conversation id", async () => {
    await assertRejects(
      () =>
        startConversationRootRun({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          agentId: "veryfront",
          providedRun: {
            runId: "existing-run",
            messageId: MESSAGE_ID,
          },
        }),
      Error,
      "CONVERSATION_ROOT_RUN_REQUIRES_CONVERSATION",
    );
  });

  it("creates one canonical root-run context object for durable and parent lineage", async () => {
    const publishParentRunEvents = async (_events: unknown[]) => undefined;
    const context = createConversationRootRunContext({
      run: {
        runId: "run_root_2",
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        latestEventId: 1,
        latestExternalEventSequence: 2,
        status: "running",
      },
      parentRunId: "parent-run",
      parentMessageId: "parent-message",
      appendParentRunEvents: publishParentRunEvents,
    });

    assertEquals(context.run, {
      runId: "run_root_2",
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      latestEventId: 1,
      latestExternalEventSequence: 2,
      status: "running",
    });
    assertEquals(context.effectiveParentRunId, "run_root_2");
    assertEquals(context.effectiveParentMessageId, MESSAGE_ID);
    await context.publishParentRunEvents?.([{ type: "run-started" }]);
  });

  it("creates a reusable root-run start adapter over the canonical start helper", async () => {
    stubFetchSequence(
      jsonResponse({ accepted: true, run: { run_id: "run_root_adapter" } }, 202),
      jsonResponse({
        run_id: "run_root_adapter",
        conversation_id: CONVERSATION_ID,
        message_id: MESSAGE_ID,
        latest_event_id: 8,
        latest_external_event_sequence: 9,
        status: "running",
      }),
    );

    const startRun = createConversationRootRunStartAdapter({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      projectId: "project-1",
      agentId: "veryfront",
    });

    const result = await startRun({ abortSignal: new AbortController().signal });

    assertEquals(result.run?.runId, "run_root_adapter");
    assertEquals(result.run?.latestEventId, 8);
  });

  it("prepares one conversation root-run context object from start + parent lineage", async () => {
    const publishParentRunEvents = async (_events: unknown[]) => undefined;
    stubFetchSequence(
      jsonResponse({ accepted: true, run: { run_id: "run_root_prepare" } }, 202),
      jsonResponse({
        run_id: "run_root_prepare",
        conversation_id: CONVERSATION_ID,
        message_id: MESSAGE_ID,
        latest_event_id: 3,
        latest_external_event_sequence: 7,
        status: "running",
      }),
    );

    const context = await prepareConversationRootRunContext({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      projectId: "project-1",
      agentId: "veryfront",
      parentRunId: "parent-run",
      parentMessageId: "parent-message",
      appendParentRunEvents: publishParentRunEvents,
    });

    assertEquals(context.run?.runId, "run_root_prepare");
    assertEquals(context.effectiveParentRunId, "run_root_prepare");
    assertEquals(context.effectiveParentMessageId, MESSAGE_ID);
    await context.publishParentRunEvents?.([{ type: "run-started" }]);
  });
});
