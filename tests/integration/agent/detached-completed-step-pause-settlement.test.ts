import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import { RuntimeAgentRunInvocationSchema } from "#veryfront/agent/runtime/agent-invocation-contract.ts";
import {
  createHostedCompletedStepExecution,
  registerHostedCompletedStepRun,
} from "#veryfront/agent/hosted/completed-step-run.ts";
import { registerHostedTerminalCredential } from "#veryfront/agent/hosted/terminal-credential.ts";
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

describe("detached completed-step pause settlement", () => {
  for (
    const outcome of [
      "pause",
      "continue",
      "cancel",
      "error",
      "swallowed-error",
      "swallowed-after-finish-error",
      "cleanup-error",
    ] as const
  ) {
    it(`settles detached ${outcome} without confirming an active, cancelled or failed session`, async () => {
      const projectId = crypto.randomUUID();
      const req = createParsedRequest({ projectId, serverEnvelopeVerified: true });
      const runId = req.durableRootRun!.runId;
      const invocation = RuntimeAgentRunInvocationSchema.parse({
        run: {
          agentServiceId: "runtime-provider",
          agentId: "builder",
          conversationId: req.conversationId,
          runId,
          messageId: crypto.randomUUID(),
          inputAnchorMessageId: crypto.randomUUID(),
          requestedByUserId: crypto.randomUUID(),
          project: { projectId, projectSlug: "demo-project" },
        },
        messages: [userMessage],
        tools: [],
        context: [],
        agentSource: { type: "release", releaseId: "test-release" },
        credentials: { authToken: "run-bound-test-token" },
      });
      registerHostedTerminalCredential(req, "generation-test-token");
      assertEquals(registerHostedCompletedStepRun(req, invocation), true);
      const tracker = createDetachedRunTracker<AgUiResumeValue>();
      let executionSettled = false;
      let settlementCalls = 0;
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
        const completedStep = createHostedCompletedStepExecution(req, "https://api.example.test");
        assertExists(completedStep);
        const response = await executeHostedDurableChatRun({
          req,
          rawRequest: createRequest(),
          tracker,
          prepareExecution: () => Promise.resolve({ id: "execution-1" }),
          startDetachedExecution: async ({ abortSignal }) => {
            completedStep.bindAbortSignal(abortSignal);
            assertEquals(
              await completedStep.config.__vfCompletedStepBoundary!({
                completedSteps: 1,
                messages: [{
                  id: "user-1",
                  role: "user",
                  parts: [{ type: "text", text: "Hello" }],
                }],
                usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
              }),
              outcome !== "continue",
            );
            if (outcome === "cancel") tracker.cancelRun(runId);
            executionSettled = true;
            if (outcome === "error") {
              throw new Error("Execution failed after the acknowledged step");
            }
            if (
              outcome === "pause" || outcome === "swallowed-error" ||
              outcome === "swallowed-after-finish-error" || outcome === "cleanup-error"
            ) {
              await runPreparedHostedChatExecutionDetached({
                execution: {
                  authToken: "run-bound-test-token",
                  agent: {
                    stream: () =>
                      Promise.resolve({
                        steps: Promise.resolve([]),
                        isStoppedAtCompletedStep: completedStep.isStopped,
                        markCompletedStepSettled: completedStep.markSettled,
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
                      }),
                  },
                  agentId: "builder",
                  modelId: "test/pause",
                  cleanup: () =>
                    outcome === "cleanup-error"
                      ? Promise.reject(new Error("Resource cleanup failed"))
                      : Promise.resolve(),
                  messages: [],
                  finalMessages: [],
                  projectId,
                  userId: req.userId,
                  rootRunContext: {
                    durableRootRun: null,
                    durableRunMirror: null,
                    privateDurableRunMirror: null,
                  },
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
          },
        });
        assertEquals(response.status, 202);
        // The acceptance response does not await the detached completion callback.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        assertEquals(executionSettled, true);
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
