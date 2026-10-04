import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import {
  bindHostedAgentPauseLifetime,
  createRunBoundAgentManualPause,
  inheritHostedAgentPauseCapability,
} from "#veryfront/agent/hosted/manual-pause-credential.ts";
import { runPreparedHostedChatExecutionDetached } from "#veryfront/agent/hosted/prepared-chat-execution.ts";
import {
  type AgUiResumeValue,
  createDetachedRunTracker,
  type ParsedHostedChatRequest,
} from "#veryfront/agent/index.ts";
import { executeHostedDurableChatRun } from "#veryfront/agent/hosted/durable-chat-run-start.ts";

const userMessage: ChatUiMessage = {
  id: "message-1",
  role: "user",
  parts: [{ type: "text", text: "Hello" }],
};

function createParsedRequest(
  overrides: Partial<ParsedHostedChatRequest> = {},
): ParsedHostedChatRequest {
  const conversationId = crypto.randomUUID();
  return {
    agentId: undefined,
    userId: "user-1",
    authToken: "token-1",
    messages: [userMessage],
    validatedContext: {
      conversationId,
      projectId: "project-1",
      branchId: "branch-1",
    },
    projectId: "project-1",
    conversationId,
    parentRunId: "run-1",
    upstreamParentConversationId: undefined,
    upstreamParentRunId: undefined,
    spawnedFromToolCallId: undefined,
    model: "anthropic/claude-sonnet-4-6",
    allowDelegation: true,
    forwardedProps: { activeChatId: "chat-1" },
    runtimeOverrides: undefined,
    durableRootRun: {
      runId: "run-1",
      messageId: "message-1",
    },
    persistLatestUserMessageBeforeDurableRun: false,
    ...overrides,
  };
}

function createRequest(): Request {
  return new Request("https://agent.example.com/api/runs", { method: "POST" });
}

describe("detached native pause settlement", () => {
  for (
    const outcome of [
      "pause",
      "continue",
      "cancel",
      "error",
      "swallowed-error",
      "swallowed-after-finish-error",
      "cleanup-error",
      "flush-pending",
      "flush-disabled",
      "native-persistence-error",
      "native-persistence-missing",
    ] as const
  ) {
    it(`settles detached ${outcome} without confirming an active, cancelled or failed session`, async () => {
      const projectId = crypto.randomUUID();
      const req = createParsedRequest({ projectId, serverEnvelopeVerified: true });
      const runId = req.durableRootRun!.runId;
      const tracker = createDetachedRunTracker<AgUiResumeValue>();
      let executionSettled = false;
      let settlementCalls = 0;
      const cleanupStarted = Promise.withResolvers<void>();
      const cleanupReleased = Promise.withResolvers<void>();
      const settlement = Promise.withResolvers<void>();
      const settlementReply = Promise.withResolvers<Response>();
      const observations: { executionSettled: boolean; sessionStatus: string | null }[] = [];
      let resumedAfterSettlement = false;
      await withMockFetch((_url, init) => {
        if (init?.body === '{"settled":true}') {
          settlementCalls++;
          observations.push({
            executionSettled,
            sessionStatus: tracker.sessionManager.getRunStatus(runId),
          });
          settlement.resolve();
          // A resume accepted as soon as the API commits may reuse the same id.
          const resumed = tracker.sessionManager.startRun({ runId, threadId: req.conversationId! });
          resumedAfterSettlement = true;
          tracker.sessionManager.completeRun(runId, resumed);
          return outcome === "pause"
            ? settlementReply.promise
            : Promise.resolve(Response.json({ stop: true }));
        }
        return Promise.resolve(Response.json(
          outcome === "continue"
            ? { stop: false }
            : init?.body === "{}"
            ? { stop: false, checkpoint_required: true }
            : { stop: true },
        ));
      }, async () => {
        const capability = createRunBoundAgentManualPause({
          apiUrl: "https://api.example.test",
          runId,
          token: "pause-test-token",
          signal: undefined,
        });
        inheritHostedAgentPauseCapability(req, capability);
        const rootRunContext = {
          durableRootRun: null,
          durableRunMirror: null,
          privateDurableRunMirror: null,
        };
        const snapshot = () => ({
          latestEventId: 0,
          latestExternalEventSequence: 0,
          pendingEventCount: outcome === "flush-pending" ? 1 : 0,
          consecutiveFailures: 0,
          disabled: outcome === "flush-disabled",
          hasFlushTimer: false,
          hasRetryTimer: outcome === "flush-pending",
          inFlight: false,
        });
        const mirror = {
          handleChunk: async () => {},
          appendEvents: async () => {},
          flush: async () => snapshot(),
          getSnapshot: snapshot,
          dispose: () => {},
        };
        const executionRootRunContext = { ...rootRunContext, durableRunMirror: mirror };
        inheritHostedAgentPauseCapability(executionRootRunContext, capability);
        const response = await executeHostedDurableChatRun({
          req,
          rawRequest: createRequest(),
          tracker,
          prepareExecution: () => Promise.resolve({ id: "execution-1" }),
          startDetachedExecution: async ({ abortSignal }) => {
            if (outcome === "error" || outcome === "cancel" || outcome === "continue") {
              bindHostedAgentPauseLifetime(req, abortSignal);
              await capability.acknowledge({
                version: 1,
                nextStep: 1,
                messages: [],
                toolCalls: [],
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                latestAssistantText: "",
                completed: false,
                recoveredEmptyResponse: false,
                recoveredInterruptedLocalToolBatch: false,
              });
            }
            if (outcome === "cancel") tracker.cancelRun(runId);
            if (outcome === "error") {
              throw new Error("Execution failed after the acknowledged step");
            }
            if (
              outcome === "pause" || outcome === "swallowed-error" ||
              outcome === "swallowed-after-finish-error" || outcome === "cleanup-error" ||
              outcome === "flush-pending" || outcome === "flush-disabled" ||
              outcome === "native-persistence-error" || outcome === "native-persistence-missing"
            ) {
              await runPreparedHostedChatExecutionDetached({
                execution: {
                  authToken: "run-bound-test-token",
                  agent: {
                    stream: async () => {
                      await capability.acknowledge({
                        version: 1,
                        nextStep: 1,
                        messages: [],
                        toolCalls: [],
                        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                        latestAssistantText: "",
                        completed: false,
                        recoveredEmptyResponse: false,
                        recoveredInterruptedLocalToolBatch: false,
                      });
                      if (outcome !== "native-persistence-missing") {
                        capability.persisted?.(outcome !== "native-persistence-error");
                      }
                      return {
                        steps: Promise.resolve([]),
                        toUIMessageStream: (options) =>
                          (async function* () {
                            yield { type: "text-start" as const, id: "failed-stream" };
                            if (outcome === "swallowed-after-finish-error") {
                              await options?.onFinish?.({
                                messages: [],
                                isContinuation: false,
                                responseMessage: {
                                  id: "partial-message",
                                  role: "assistant",
                                  parts: [],
                                },
                                isAborted: false,
                                finishReason: "stop",
                              });
                              throw new Error("Execution failed after cleanup notification");
                            }
                            if (outcome === "swallowed-error") {
                              throw new Error("Execution failed after the acknowledged step");
                            }
                            yield { type: "text-end" as const, id: "failed-stream" };
                          })(),
                      };
                    },
                  },
                  agentId: "builder",
                  modelId: "test/pause",
                  cleanup: async () => {
                    if (outcome === "cleanup-error") throw new Error("Resource cleanup failed");
                    if (outcome === "pause") {
                      cleanupStarted.resolve();
                      await cleanupReleased.promise;
                    }
                  },
                  messages: [],
                  finalMessages: [],
                  projectId,
                  userId: req.userId,
                  rootRunContext: executionRootRunContext,
                  abortSignal,
                },
                runtime: {
                  apiUrl: "https://api.example.test",
                  resolveProvider: () => "test",
                  tracer: {
                    startSpan: () => ({
                      setAttributes: () => {},
                      finish: () => {},
                      withContext: (fn) => fn(),
                    }),
                  },
                  createRootStreamWatchdog: () => ({
                    signal: abortSignal,
                    lastTimeoutState: null,
                    keepAlive: () => {},
                    observe: () => {},
                    dispose: () => {},
                  }),
                },
              });
            }
            executionSettled = true;
          },
        });
        assertEquals(response.status, 202);
        if (outcome === "pause") {
          await cleanupStarted.promise;
          assertEquals(executionSettled, false);
          assertEquals(settlementCalls, 0);
          assertEquals(tracker.sessionManager.getRunStatus(runId), "running");
          cleanupReleased.resolve();
        }
        // The acceptance response does not await the detached completion callback.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        assertEquals(executionSettled, outcome !== "error");
        assertEquals(tracker.sessionManager.getRunStatus(runId), null);
        if (outcome !== "pause") {
          assertEquals(settlementCalls, 0);
          assertEquals(tracker.sessionManager.getRunStatus(runId), null);
          return;
        }
        let timer: number | undefined;
        try {
          await Promise.race([
            settlement.promise,
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, 1_000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        assertEquals(settlementCalls, 1);
        assertEquals(observations, [{ executionSettled: true, sessionStatus: null }]);
        assertEquals(resumedAfterSettlement, true);
        try {
          assertEquals(
            (await tracker.waitForDrain({ timeoutMs: 20, pollIntervalMs: 1 })).drained,
            false,
          );
        } finally {
          settlementReply.resolve(Response.json({ stop: true }));
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        assertEquals((await tracker.waitForDrain({ timeoutMs: 1_000 })).drained, true);
      });
    });
  }
});
