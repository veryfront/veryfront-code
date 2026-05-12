import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentResponse } from "./schemas/index.ts";
import {
  startHostedChildForkRuntimeWithHostTools,
  type StartHostedChildForkRuntimeWithHostToolsInput,
} from "./hosted-child-fork-runtime-start.ts";
import {
  HostedChildTerminalStateError,
  type MonitorHostedChildRunStatusInput,
} from "./hosted-child-status.ts";

function createRuntimeEventStream(
  events: readonly Record<string, unknown>[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

function createResponse(): AgentResponse {
  return {
    text: "Done.",
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        timestamp: 2,
        parts: [{ type: "text", text: "Done." }],
      },
    ],
    toolCalls: [],
    status: "completed",
    metadata: { finishReason: "stop" },
  };
}

function createStartInput(
  overrides: Partial<StartHostedChildForkRuntimeWithHostToolsInput> = {},
): StartHostedChildForkRuntimeWithHostToolsInput {
  return {
    apiUrl: "https://api.example.com",
    authToken: "auth-token",
    projectId: "project-1",
    provider: "anthropic",
    forkModel: "anthropic/claude-sonnet-4",
    maxSteps: 1,
    prompt: "Do the work.",
    forkTools: {},
    buildInstructions: () => "Base instructions.",
    runStep: async () => ({
      stream: createRuntimeEventStream([{ type: "text-delta", delta: "Done." }]),
      responsePromise: Promise.resolve(createResponse()),
    }),
    ...overrides,
  };
}

describe("agent/hosted-child-fork-runtime-start", () => {
  it("starts a fork runtime without a durable child monitor", async () => {
    const started = startHostedChildForkRuntimeWithHostTools(createStartInput());

    assertEquals(started.childRunMonitorAbortController, null);
    await started.childRunMonitorPromise;

    const parts = [];
    for await (const part of started.streamResult.fullStream) {
      parts.push(part);
    }

    assertEquals(parts, [{ type: "text-delta", text: "Done." }]);
  });

  it("starts a durable child monitor that aborts the fork stream on terminal child state", async () => {
    const monitorCalls: MonitorHostedChildRunStatusInput[] = [];
    const started = startHostedChildForkRuntimeWithHostTools(
      createStartInput({
        durableChildRun: {
          childConversationId: "conversation-child",
          childRunId: "run-child",
          childMessageId: "message-child",
          latestEventId: 1,
          latestExternalEventSequence: 2,
        },
        childRunMonitorPollIntervalMs: 25,
        monitorChildRunStatus: async (input) => {
          monitorCalls.push(input);
          input.onTerminal(new HostedChildTerminalStateError("cancelled", input.identifiers));
        },
      }),
    );

    await started.childRunMonitorPromise;

    assertInstanceOf(started.childRunMonitorAbortController, AbortController);
    assertEquals(monitorCalls.length, 1);
    assertEquals(monitorCalls[0]?.abortSignal?.aborted, false);
    assertEquals(started.forkStreamAbortController.signal.aborted, true);
    assertEquals(started.forkStreamAbortController.signal.reason instanceof Error, true);
  });
});
