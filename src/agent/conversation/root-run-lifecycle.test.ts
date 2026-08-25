import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  prepareConversationRootRunLifecycle,
  prepareHostedConversationRootRunContext,
} from "./root-run-lifecycle.ts";
import {
  createHostedRunEventWriterCapability,
  runWithHostedRunEventWriterCapability,
} from "../hosted/child-run-event-writer-token.ts";

describe("agent/conversation-root-run-lifecycle", () => {
  it("starts a run and derives root-run lineage plus a mirror in one helper", async () => {
    const seen: Array<{ runId: string }> = [];
    const lifecycle = await prepareConversationRootRunLifecycle(
      {
        startRun: async () => ({
          run: {
            runId: "run-1",
            conversationId: "conv-1",
            messageId: "msg-1",
            latestEventId: 5,
            latestExternalEventSequence: 6,
            waitingToolCallId: null,
            waitingToolName: null,
            streamProtocolVersion: 2,
            status: "running",
          },
        }),
        parentRunId: "parent-run",
        parentMessageId: "parent-message",
        createMirror: (run) => {
          seen.push({ runId: run.runId });
          return { mirrorRunId: run.runId };
        },
      },
      { abortSignal: new AbortController().signal },
    );

    assertEquals(lifecycle.run?.runId, "run-1");
    assertEquals(lifecycle.effectiveParentRunId, "run-1");
    assertEquals(lifecycle.effectiveParentMessageId, "msg-1");
    assertEquals(lifecycle.mirror, { mirrorRunId: "run-1" });
    assertEquals(seen, [{ runId: "run-1" }]);
  });

  it("falls back to upstream lineage when no root run exists", async () => {
    const lifecycle = await prepareConversationRootRunLifecycle(
      {
        startRun: () => ({ run: null }),
        parentRunId: "parent-run",
        parentMessageId: "parent-message",
        createMirror: () => ({ mirrorRunId: "unused" }),
      },
      { abortSignal: new AbortController().signal },
    );

    assertEquals(lifecycle.run, null);
    assertEquals(lifecycle.effectiveParentRunId, "parent-run");
    assertEquals(lifecycle.effectiveParentMessageId, "parent-message");
    assertEquals(lifecycle.mirror, null);
  });

  it("preserves parent-run publishers for hosts that append lineage events", async () => {
    const recorded: unknown[][] = [];
    const publishParentRunEvents = async (events: unknown[]) => {
      recorded.push(events);
    };

    const lifecycle = await prepareConversationRootRunLifecycle(
      {
        startRun: () => ({
          run: {
            runId: "run-2",
            conversationId: "conv-2",
            messageId: "msg-2",
            latestEventId: 1,
            latestExternalEventSequence: 2,
            waitingToolCallId: null,
            waitingToolName: null,
            streamProtocolVersion: 2,
            status: "running",
          },
        }),
        appendParentRunEvents: publishParentRunEvents,
      },
      { abortSignal: new AbortController().signal },
    );

    await lifecycle.publishParentRunEvents?.([{ type: "child-started" }]);
    assertEquals(recorded, [[{ type: "child-started" }]]);
  });

  it("prepares a hosted root-run context with durable mirroring", async () => {
    const debugMessages: string[] = [];
    const authorizationHeaders: Array<string | null> = [];
    const conversationId = "11111111-1111-4111-a111-111111111111";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      authorizationHeaders.push(request.headers.get("Authorization"));
      return Promise.resolve(Response.json({
        latest_event_id: 6,
        latest_external_event_sequence: 7,
        appended_count: 1,
        run: {
          run_id: "run-1",
          conversation_id: conversationId,
          latest_event_id: 6,
          latest_external_event_sequence: 7,
        },
      }));
    }) as typeof fetch;

    try {
      const context = await runWithHostedRunEventWriterCapability(
        createHostedRunEventWriterCapability({
          apiUrl: "https://api.example.test",
          runId: "run-1",
          runEventAppendToken: "run-event-service-token",
          fetch: globalThis.fetch,
        }),
        () =>
          prepareHostedConversationRootRunContext(
            {
              authToken: "user-api-token",
              apiUrl: "https://api.example.test",
              conversationId,
              projectId: "project-1",
              branchId: "branch-1",
              agentId: "agent-1",
              messages: [],
              providedRun: {
                runId: "run-1",
                messageId: "msg-1",
                latestEventId: 5,
                latestExternalEventSequence: 6,
              },
              persistLatestUserMessageBeforeRun: true,
              parentRunId: "parent-run",
              parentMessageId: "parent-message",
              instrumentation: {
                debug: (message) => {
                  debugMessages.push(message);
                },
              },
            },
            { abortSignal: new AbortController().signal },
          ),
      );

      try {
        assertEquals(context.durableRootRun, {
          runId: "run-1",
          conversationId,
          messageId: "msg-1",
          latestEventId: 5,
          latestExternalEventSequence: 6,
        });
        assertEquals(context.effectiveParentRunId, "run-1");
        assertEquals(context.effectiveParentMessageId, "msg-1");

        await context.publishParentRunEvents?.([{
          type: "CUSTOM",
          name: "child-run",
          value: { runId: "child-run-1" },
        }]);
        await context.durableRunMirror?.flush();

        assertEquals(
          debugMessages.includes("Durable run mirror queued external events"),
          true,
        );
        assertEquals(context.durableRunMirror?.getSnapshot().pendingEventCount, 0);
        assertEquals(context.privateDurableRunMirror, context.durableRunMirror);
        assertEquals(authorizationHeaders, ["Bearer run-event-service-token"]);
      } finally {
        context.durableRunMirror?.dispose();
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves public mirroring without allowing private user-token fallback", async () => {
    const context = await prepareHostedConversationRootRunContext(
      {
        authToken: "user-api-token",
        apiUrl: "https://api.example.test",
        conversationId: "conv-1",
        projectId: "project-1",
        agentId: "agent-1",
        messages: [],
        providedRun: {
          runId: "run-1",
          messageId: "msg-1",
          latestEventId: 5,
          latestExternalEventSequence: 6,
        },
        persistLatestUserMessageBeforeRun: false,
      },
      { abortSignal: new AbortController().signal },
    );

    try {
      await context.publishParentRunEvents?.([{
        type: "CUSTOM",
        name: "child-run",
        value: { runId: "child-run-1" },
      }]);
      assertEquals(context.durableRunMirror?.getSnapshot().pendingEventCount, 1);
      assertEquals(context.privateDurableRunMirror, null);
    } finally {
      context.durableRunMirror?.dispose();
    }
  });

  it("rejects wrong-root writer authority without granting private fallback", async () => {
    const context = await runWithHostedRunEventWriterCapability(
      createHostedRunEventWriterCapability({
        apiUrl: "https://api.example.test",
        runId: "different-root-run",
        runEventAppendToken: "wrong-root-writer-token",
      }),
      () =>
        prepareHostedConversationRootRunContext(
          {
            authToken: "user-api-token",
            apiUrl: "https://api.example.test",
            conversationId: "conv-1",
            projectId: "project-1",
            agentId: "agent-1",
            messages: [],
            providedRun: {
              runId: "expected-root-run",
              messageId: "msg-1",
              latestEventId: 5,
              latestExternalEventSequence: 6,
            },
            persistLatestUserMessageBeforeRun: false,
          },
          { abortSignal: new AbortController().signal },
        ),
    );

    try {
      assertEquals(context.durableRunMirror !== null, true);
      assertEquals(context.privateDurableRunMirror, null);
    } finally {
      context.durableRunMirror?.dispose();
    }
  });
});
