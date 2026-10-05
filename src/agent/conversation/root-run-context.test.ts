import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createConversationRootRunContext,
  createConversationRootRunStartAdapter,
  prepareConversationRootRunContext,
  startConversationRootRun,
} from "./root-run-context.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const CONVERSATION_ID = "11111111-1111-4111-a111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-a222-222222222222";
const BRANCH_ID = "33333333-3333-4333-a333-333333333333";
const originalFetch = globalThis.fetch;

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

  it("rejects unsupported root self-admission before transport", async () => {
    const calls = stubFetchSequence();
    await assertRejects(
      () =>
        startConversationRootRun({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          projectId: "project-1",
          agentId: "veryfront",
        }),
      Error,
      "Standalone durable self-admission was removed",
    );
    assertEquals(calls, []);
  });

  it("rejects unsupported root self-admission with branch targeting before transport", async () => {
    const calls = stubFetchSequence();
    await assertRejects(
      () =>
        startConversationRootRun({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          projectId: "project-1",
          agentId: "veryfront",
          branchId: BRANCH_ID,
          implementationKind: "veryfront-codex",
        }),
      Error,
      "Standalone durable self-admission was removed",
    );
    assertEquals(calls, []);
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
      streamProtocolVersion: 1,
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
    const published: unknown[][] = [];
    const appendParentRunEvents = (events: unknown[]) => {
      published.push(events);
    };
    const context = createConversationRootRunContext({
      run: {
        runId: "run_root_2",
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        latestEventId: 1,
        latestExternalEventSequence: 2,
        waitingToolCallId: null,
        waitingToolName: null,
        streamProtocolVersion: 1,
        status: "running",
      },
      parentRunId: "parent-run",
      parentMessageId: "parent-message",
      appendParentRunEvents,
    });

    assertEquals(context.run, {
      runId: "run_root_2",
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      latestEventId: 1,
      latestExternalEventSequence: 2,
      waitingToolCallId: null,
      waitingToolName: null,
      streamProtocolVersion: 1,
      status: "running",
    });
    assertEquals(context.effectiveParentRunId, "run_root_2");
    assertEquals(context.effectiveParentMessageId, MESSAGE_ID);
    assertExists(
      context.publishParentRunEvents,
      "a publisher must exist when appendParentRunEvents is supplied",
    );
    await context.publishParentRunEvents([{ type: "run-started" }]);
    assertEquals(
      published,
      [[{ type: "run-started" }]],
      "events must be forwarded verbatim to appendParentRunEvents",
    );

    const withoutPublisher = createConversationRootRunContext({
      run: null,
      parentRunId: "parent-run",
      parentMessageId: "parent-message",
    });

    assertStrictEquals(
      withoutPublisher.publishParentRunEvents,
      undefined,
      "no publisher must be created without appendParentRunEvents",
    );
  });

  it("creates a reusable root-run start adapter over the canonical start helper", async () => {
    const calls = stubFetchSequence();

    const startRun = createConversationRootRunStartAdapter({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      providedRun: {
        runId: "run_root_adapter",
        messageId: MESSAGE_ID,
        latestEventId: 8,
        latestExternalEventSequence: 9,
      },
      projectId: "project-1",
      agentId: "veryfront",
    });

    const result = await startRun({ abortSignal: new AbortController().signal });

    assertEquals(calls, []);
    assertEquals(result.run?.runId, "run_root_adapter");
    assertEquals(result.run?.latestEventId, 8);
  });

  it("prepares one conversation root-run context object from start + parent lineage", async () => {
    const published: unknown[][] = [];
    const appendParentRunEvents = (events: unknown[]) => {
      published.push(events);
    };
    const calls = stubFetchSequence();

    const context = await prepareConversationRootRunContext({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      providedRun: {
        runId: "run_root_prepare",
        messageId: MESSAGE_ID,
        latestEventId: 3,
        latestExternalEventSequence: 9,
      },
      projectId: "project-1",
      agentId: "veryfront",
      parentRunId: "parent-run",
      parentMessageId: "parent-message",
      appendParentRunEvents,
    });

    assertEquals(calls, []);
    assertEquals(context.run?.runId, "run_root_prepare");
    assertEquals(context.effectiveParentRunId, "run_root_prepare");
    assertEquals(context.effectiveParentMessageId, MESSAGE_ID);
    assertExists(
      context.publishParentRunEvents,
      "a prepared context must carry the parent-run publisher",
    );
    await context.publishParentRunEvents([{ type: "run-started" }]);
    assertEquals(
      published,
      [[{ type: "run-started" }]],
      "events must be forwarded verbatim to appendParentRunEvents",
    );
  });
});
