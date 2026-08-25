import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentResponse } from "../schemas/index.ts";
import {
  startHostedChildForkRuntimeWithHostTools,
  type StartHostedChildForkRuntimeWithHostToolsInput,
} from "./child-fork-runtime-start.ts";
import {
  HostedChildTerminalStateError,
  type MonitorHostedChildRunStatusInput,
} from "./child-status.ts";

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
    let terminalError: HostedChildTerminalStateError | undefined;
    let capturedRunStepSignal: AbortSignal | undefined;
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
          terminalError = new HostedChildTerminalStateError("cancelled", input.identifiers);
          input.onTerminal(terminalError);
        },
        runStep: async (input) => {
          capturedRunStepSignal = input.abortSignal;
          return {
            stream: createRuntimeEventStream([{ type: "text-delta", delta: "Done." }]),
            responsePromise: Promise.resolve(createResponse()),
          };
        },
      }),
    );

    await started.childRunMonitorPromise;

    assertInstanceOf(started.childRunMonitorAbortController, AbortController);
    assertEquals(monitorCalls.length, 1);
    assertEquals(monitorCalls[0]?.abortSignal?.aborted, false);
    assertEquals(started.forkStreamAbortController.signal.aborted, true);
    assertStrictEquals(
      started.forkStreamAbortController.signal.reason,
      terminalError,
      "the abort reason must be the exact terminal error handed to onTerminal",
    );

    await (async () => {
      for await (const _part of started.streamResult.fullStream) {
        // Drain so the fork runtime invokes runStep with its composed signal.
      }
    })().catch(() => undefined);

    assertEquals(
      capturedRunStepSignal?.aborted,
      true,
      "the fork runtime must receive the composed abort signal",
    );
  });

  it("aborts the fork without fabricating a terminal state when monitoring is exhausted", async () => {
    const monitoringError = new Error("control plane unavailable");
    const started = startHostedChildForkRuntimeWithHostTools(
      createStartInput({
        durableChildRun: {
          childConversationId: "conversation-child",
          childRunId: "run-child",
          childMessageId: "message-child",
          latestEventId: 1,
          latestExternalEventSequence: 2,
        },
        monitorChildRunStatus: async (input) => {
          input.onMonitoringExhausted?.(monitoringError);
        },
      }),
    );

    await started.childRunMonitorPromise;

    assertEquals(started.forkStreamAbortController.signal.aborted, true);
    assertEquals(started.forkStreamAbortController.signal.reason, monitoringError);
    assertEquals(
      started.forkStreamAbortController.signal.reason instanceof HostedChildTerminalStateError,
      false,
    );
  });
});
