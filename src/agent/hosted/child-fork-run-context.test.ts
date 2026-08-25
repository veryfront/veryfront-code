import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import {
  createHostedChildForkRunContext,
  createHostedDurableChildForkRunContext,
  executeHostedChildForkRunContextStream,
  finalizeHostedChildForkRunContextResources,
  handleHostedChildForkRunContextError,
} from "./child-fork-run-context.ts";
import { HostedChildTerminalStateError } from "./child-status.ts";
import type { ForkPart, ForkRuntimeStep } from "../streaming/fork-runtime-stream.ts";
import {
  createHostedRunEventWriterCapability,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";
import {
  createHostedDurableChildForkRunContext as createPublicHostedDurableChildForkRunContext,
  createHostedRunEventWriterCapability as createPublicHostedRunEventWriterCapability,
} from "../index.ts";

async function* forkParts(parts: ForkPart[]): AsyncGenerator<ForkPart, void, void> {
  for (const part of parts) {
    yield part;
  }
}

function createStep(text: string): ForkRuntimeStep {
  return {
    text,
    finishReason: "stop",
    messages: [],
    toolCalls: [],
    toolResults: [],
  };
}

Deno.test("createHostedChildForkRunContext wires stream mirror state and buffers", async () => {
  const chunks: ChatUiMessageChunk<ChatMessageMetadata>[] = [];
  const context = createHostedChildForkRunContext({
    mirror: {
      handleChunk: (chunk) => {
        chunks.push(chunk);
      },
    },
    messageId: "message-1",
    pendingToolLogContext: {
      conversationId: "conversation-1",
      parentRunId: "run-1",
      description: "Check the app",
    },
  });

  assertEquals(context.streamMirrorContext.durableRunMirror, true);
  assertEquals(context.streamMirrorContext.durableMessageId, "message-1");
  assertEquals(context.streamMirrorContext.durableReasoningMessageId, "message-1:reasoning");
  assertEquals(context.streamMirrorContext.hasStartedStep(), false);
  assertEquals(context.streamMirrorContext.hasEmittedProgress(), false);
  assertEquals(context.streamState.finalText, "");
  assertEquals(context.toolCalls, []);
  assertEquals(context.toolResults, []);

  context.streamMirrorContext.markDurableStepStarted();
  await context.streamMirrorContext.appendDurableMirrorChunk({ type: "start-step" });

  assertEquals(context.streamMirrorContext.hasStartedStep(), true);
  assertEquals(context.streamMirrorContext.hasEmittedProgress(), true);
  assertEquals(chunks, [{ type: "start-step" }]);
});

Deno.test("createHostedDurableChildForkRunContext wires conversation mirror and child identifiers", () => {
  const traces: string[] = [];
  const context = runWithHostedRunEventWriterCapability(
    createHostedRunEventWriterCapability({
      apiUrl: "https://api.example.com",
      runId: "child-run-1",
      runEventAppendToken: "child-writer-token",
    }),
    () =>
      createHostedDurableChildForkRunContext(
        {
          durableChildRun: {
            childConversationId: "child-conversation-1",
            childRunId: "child-run-1",
            childMessageId: "child-message-1",
            latestEventId: 5,
            latestExternalEventSequence: 7,
          },
          instrumentation: {
            trace: (operationName, operation) => {
              traces.push(operationName);
              return operation();
            },
          },
          pendingToolLogContext: {
            conversationId: "conversation-1",
            parentRunId: "run-1",
            description: "Check the app",
          },
        },
      ),
  );

  assertEquals(context.durableRunMirror?.getSnapshot(), {
    latestEventId: 5,
    latestExternalEventSequence: 7,
    consecutiveFailures: 0,
    disabled: false,
    pendingEventCount: 0,
    inFlight: false,
    hasFlushTimer: false,
    hasRetryTimer: false,
    appendRequestCount: 0,
  });
  assertEquals(context.streamMirrorContext.durableRunMirror, true);
  assertEquals(context.streamMirrorContext.durableMessageId, "child-message-1");
  assertEquals(
    context.streamMirrorContext.durableReasoningMessageId,
    "child-message-1:reasoning",
  );
  assertEquals(traces, []);
});

Deno.test("createHostedDurableChildForkRunContext authorizes its mirror with only the child writer token", async () => {
  const originalFetch = globalThis.fetch;
  let authorization: string | null = null;
  try {
    globalThis.fetch = (input, init) => {
      authorization = new Request(input, init).headers.get("Authorization");
      return Promise.resolve(Response.json({
        latestEventId: 1,
        latestExternalEventSequence: 1,
        appendedCount: 1,
        run: {
          runId: "child-run-1",
          conversationId: "11111111-1111-4111-a111-111111111111",
          latestEventId: 1,
          latestExternalEventSequence: 1,
        },
      }));
    };
    const context = runWithHostedRunEventWriterCapability(
      createHostedRunEventWriterCapability({
        apiUrl: "https://api.example.com",
        runId: "child-run-1",
        runEventAppendToken: "child-writer-token",
        fetch: globalThis.fetch,
      }),
      () =>
        createHostedDurableChildForkRunContext(
          {
            durableChildRun: {
              childConversationId: "11111111-1111-4111-a111-111111111111",
              childRunId: "child-run-1",
              childMessageId: "child-message-1",
              latestEventId: 0,
              latestExternalEventSequence: 0,
            },
            pendingToolLogContext: { description: "Check the app" },
          },
        ),
    );

    await context.durableRunMirror?.appendEvents([{
      type: "CUSTOM",
      name: "child-progress",
      value: { status: "running" },
    }]);
    await context.durableRunMirror?.flush();

    assertEquals(authorization, "Bearer child-writer-token");
    context.durableRunMirror?.dispose();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("public durable child context accepts an explicit opaque writer capability", () => {
  const context = createPublicHostedDurableChildForkRunContext({
    runEventWriterCapability: createPublicHostedRunEventWriterCapability({
      apiUrl: "https://api.example.com",
      runId: "child-run-public",
      runEventAppendToken: "child-writer-token",
    }),
    durableChildRun: {
      childConversationId: "11111111-1111-4111-a111-111111111111",
      childRunId: "child-run-public",
      childMessageId: "child-message-public",
      latestEventId: 0,
      latestExternalEventSequence: 0,
    },
    pendingToolLogContext: { description: "Check public API" },
  });

  assertEquals(context.durableRunMirror !== null, true);
  context.durableRunMirror?.dispose();
});

for (
  const [authorityKind, capabilityRunId] of [
    ["parent", "parent-run-public"],
    ["sibling", "sibling-run-public"],
  ] as const
) {
  Deno.test(`public durable child context rejects ${authorityKind} writer authority`, () => {
    const context = createPublicHostedDurableChildForkRunContext({
      runEventWriterCapability: createPublicHostedRunEventWriterCapability({
        apiUrl: "https://api.example.com",
        runId: capabilityRunId,
        runEventAppendToken: "wrong-run-writer-token",
      }),
      durableChildRun: {
        childConversationId: "11111111-1111-4111-a111-111111111111",
        childRunId: "target-child-run-public",
        childMessageId: "child-message-public",
        latestEventId: 0,
        latestExternalEventSequence: 0,
      },
      pendingToolLogContext: { description: "Check public API" },
    });

    assertEquals(context.durableRunMirror, null);
    assertEquals(context.streamMirrorContext.durableRunMirror, false);
  });
}

Deno.test("createHostedChildForkRunContext closes pending tool calls with host logger", async () => {
  const chunks: ChatUiMessageChunk<ChatMessageMetadata>[] = [];
  const warnings: Array<{ message: string; context: Record<string, unknown> }> = [];
  const context = createHostedChildForkRunContext({
    mirror: {
      handleChunk: (chunk) => {
        chunks.push(chunk);
      },
    },
    pendingToolLogContext: {
      conversationId: "conversation-1",
      parentRunId: "run-1",
      childRunId: "child-run-1",
      description: "Check the app",
    },
    pendingToolLogWriter: {
      warn: (message, logContext) => {
        warnings.push({ message, context: logContext });
      },
    },
  });

  context.pendingToolLifecycle.upsertPendingToolCall("tool-call-1", {
    phase: "awaiting_result",
    toolName: "read_file",
    input: { path: "README.md" },
  });

  await context.pendingToolLifecycle.closePendingToolCalls({ kind: "aborted" });

  assertEquals(chunks.map((chunk) => chunk.type), ["tool-input-start", "tool-output-error"]);
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0]?.message, "Closing incomplete child fork tool lifecycles");
  assertEquals(warnings[0]?.context, {
    conversationId: "conversation-1",
    runId: "run-1",
    parentRunId: "run-1",
    childRunId: "child-run-1",
    description: "Check the app",
    reason: "aborted",
    toolCallIds: ["tool-call-1"],
    errorMessage: null,
  });
});

Deno.test("executeHostedChildForkRunContextStream executes with run-context buffers", async () => {
  const chunks: ChatUiMessageChunk<ChatMessageMetadata>[] = [];
  const traces: string[] = [];
  const context = createHostedChildForkRunContext({
    mirror: {
      handleChunk: (chunk) => {
        chunks.push(chunk);
      },
    },
    messageId: "message-1",
    pendingToolLogContext: {
      conversationId: "conversation-1",
      parentRunId: "run-1",
      description: "Check the app",
    },
  });

  const result = await executeHostedChildForkRunContextStream({
    runContext: context,
    streamResult: {
      fullStream: forkParts([
        { type: "text-delta", text: "Done" },
      ]),
      steps: Promise.resolve([createStep("Done")]),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    },
    abortForkStream: () => undefined,
    conversationId: "conversation-1",
    parentRunId: "run-1",
    description: "Check the app",
    kind: "invoke_agent",
    maxSteps: 10,
    startTime: Date.now(),
    finalizationTimeoutMs: 100,
    idleTimeoutMs: 1_000,
    activeToolTimeoutMs: 1_000,
    postToolIdleTimeoutMs: 1_000,
    tracePart: ({ partType }) => {
      traces.push(partType);
    },
  });

  assertEquals(result.success, true);
  assertEquals(context.streamState.finalText, "Done");
  assertEquals(context.toolCalls, []);
  assertEquals(context.toolResults, []);
  assertEquals(context.streamMirrorContext.hasStartedStep(), true);
  assertEquals(chunks.map((chunk) => chunk.type), [
    "start-step",
    "text-start",
    "text-delta",
    "text-end",
  ]);
  assertEquals(traces, ["text-delta"]);
});

Deno.test("handleHostedChildForkRunContextError closes buffers and pending tool calls before returning failure", async () => {
  const chunks: ChatUiMessageChunk<ChatMessageMetadata>[] = [];
  const context = createHostedChildForkRunContext({
    mirror: {
      handleChunk: (chunk) => {
        chunks.push(chunk);
      },
    },
    pendingToolLogContext: {
      conversationId: "conversation-1",
      parentRunId: "run-1",
      description: "Check the app",
    },
  });
  context.streamState.finalText = "Partial answer";
  context.toolCalls.push({
    toolName: "read_file",
    toolCallId: "tool-call-1",
    input: { path: "README.md" },
  });
  context.pendingToolLifecycle.upsertPendingToolCall("tool-call-1", {
    phase: "awaiting_result",
    toolName: "read_file",
    input: { path: "README.md" },
  });

  const result = await handleHostedChildForkRunContextError({
    error: new Error("stream failed"),
    description: "Check the app",
    kind: "invoke_agent",
    runContext: context,
    startTime: Date.now(),
  });

  assertEquals(result.success, false);
  if (result.success) {
    throw new Error("Expected child fork failure");
  }
  assertEquals(result.error, "stream failed");
  assertEquals(chunks.map((chunk) => chunk.type), ["tool-input-start", "tool-output-error"]);
});

Deno.test("handleHostedChildForkRunContextError rethrows the original error when the run was aborted", async () => {
  const chunks: ChatUiMessageChunk<ChatMessageMetadata>[] = [];
  const context = createHostedChildForkRunContext({
    mirror: {
      handleChunk: (chunk) => {
        chunks.push(chunk);
      },
    },
    pendingToolLogContext: {
      conversationId: "conversation-1",
      parentRunId: "run-1",
      description: "Check the app",
    },
  });
  context.pendingToolLifecycle.upsertPendingToolCall("tool-call-1", {
    phase: "awaiting_result",
    toolName: "read_file",
    input: { path: "README.md" },
  });
  const controller = new AbortController();
  controller.abort();
  const error = new Error("stopped");

  const thrown = await assertRejects(() =>
    handleHostedChildForkRunContextError({
      error,
      description: "Check the app",
      kind: "invoke_agent",
      runContext: context,
      startTime: Date.now(),
      abortSignal: controller.signal,
    })
  );

  assertStrictEquals(thrown, error, "an aborted run must rethrow the original error");
  assertEquals(
    chunks.map((chunk) => chunk.type),
    ["tool-input-start", "tool-output-error"],
    "pending tool calls must still be closed before rethrowing",
  );
  const errorChunk = chunks[1];
  assertEquals(
    errorChunk?.type === "tool-output-error" ? errorChunk.errorText : undefined,
    "Child fork stream aborted before tool result completed",
    "pending tool calls must be closed with the aborted reason",
  );
});

Deno.test("handleHostedChildForkRunContextError rethrows remote terminal state errors unchanged", async () => {
  const context = createHostedChildForkRunContext({
    mirror: { handleChunk: () => {} },
    pendingToolLogContext: {
      conversationId: "conversation-1",
      parentRunId: "run-1",
      description: "Check the app",
    },
  });
  const terminal = new HostedChildTerminalStateError("cancelled", {
    childConversationId: "child-conversation-1",
    childRunId: "child-run-1",
    childMessageId: "child-message-1",
    latestEventId: 0,
    latestExternalEventSequence: 0,
  });

  const thrown = await assertRejects(() =>
    handleHostedChildForkRunContextError({
      error: terminal,
      description: "Check the app",
      kind: "invoke_agent",
      runContext: context,
      startTime: Date.now(),
    })
  );

  assertStrictEquals(
    thrown,
    terminal,
    "a remote terminal state must be rethrown unchanged, not converted to a soft failure",
  );
});

Deno.test("finalizeHostedChildForkRunContextResources closes buffers, aborts monitor, flushes mirror, and appends finish-step", async () => {
  const chunks: ChatUiMessageChunk<ChatMessageMetadata>[] = [];
  const calls: string[] = [];
  const monitorAbortController = new AbortController();
  const monitorPromise = new Promise<void>((resolve) => {
    monitorAbortController.signal.addEventListener("abort", () => {
      calls.push("monitor-aborted");
      resolve();
    });
  });
  const context = createHostedChildForkRunContext({
    mirror: {
      handleChunk: (chunk) => {
        chunks.push(chunk);
      },
    },
    pendingToolLogContext: {
      conversationId: "conversation-1",
      parentRunId: "run-1",
      description: "Check the app",
    },
  });
  context.streamMirrorContext.markDurableStepStarted();

  await finalizeHostedChildForkRunContextResources({
    runContext: context,
    monitorAbortController,
    monitorPromise,
    flushMirror: () => {
      calls.push("flush");
      return Promise.resolve();
    },
  });

  assertEquals(chunks, [{ type: "finish-step" }]);
  assertEquals(calls, ["monitor-aborted", "flush"]);
});
