import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  prepareConversationRootRunLifecycle,
  prepareHostedConversationRootRunContext,
} from "./root-run-lifecycle.ts";

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
    const context = await prepareHostedConversationRootRunContext(
      {
        authToken: "token",
        apiUrl: "https://api.example.test",
        conversationId: "conv-1",
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
    );

    try {
      assertEquals(context.durableRootRun, {
        runId: "run-1",
        conversationId: "conv-1",
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

      assertEquals(
        debugMessages.includes("Durable run mirror queued external events"),
        true,
      );
      assertEquals(context.durableRunMirror?.getSnapshot().pendingEventCount, 1);
    } finally {
      context.durableRunMirror?.dispose();
    }
  });
});
