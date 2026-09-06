import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  executeHostedChildForkStream,
  handleHostedChildForkFailure,
  type HostedChildForkPendingToolLifecycle,
} from "./child-fork-stream-execution.ts";
import type { ChildRunExecutionSnapshot } from "../child-run/execution-snapshot.ts";
import { buildChildRunExhaustedStepBudgetErrorMessage } from "../child-run/final-step-support.ts";
import type { ForkPart, ForkRuntimeStep } from "../streaming/fork-runtime-stream.ts";
import { ForkRuntimeStreamError } from "../streaming/fork-runtime-types.ts";

function createPendingToolLifecycle(chunks: unknown[]): HostedChildForkPendingToolLifecycle {
  const pendingToolCallIds = new Set<string>();
  return {
    emitToolInputStartIfNeeded: (toolCallId, toolName) => {
      chunks.push({ type: "tool-input-start", toolCallId, toolName });
    },
    upsertPendingToolCall: (toolCallId) => {
      pendingToolCallIds.add(toolCallId);
    },
    deletePendingToolCall: (toolCallId) => {
      pendingToolCallIds.delete(toolCallId);
    },
    closePendingToolCalls: () => {
      for (const toolCallId of pendingToolCallIds) {
        chunks.push({ type: "closed", toolCallId });
      }
      pendingToolCallIds.clear();
    },
  };
}

async function* partsStream(parts: ForkPart[]): AsyncGenerator<ForkPart, void, void> {
  for (const part of parts) {
    yield part;
  }
}

function createStep(input: { text: string; finishReason?: string | null }): ForkRuntimeStep {
  return {
    text: input.text,
    finishReason: input.finishReason ?? "stop",
    messages: [],
    toolCalls: [],
    toolResults: [],
  };
}

describe("hosted child fork stream execution", () => {
  it("forwards coded child errors through the durable mirror handleChunk boundary", async () => {
    const chunks: unknown[] = [];
    const mirror = {
      handleChunk(chunk: unknown) {
        chunks.push(chunk);
      },
    };

    await executeHostedChildForkStream({
      streamResult: {
        fullStream: partsStream([{
          type: "error",
          error: new ForkRuntimeStreamError(
            "Purchase additional credits.",
            "INSUFFICIENT_CREDITS",
          ),
        }]),
        steps: Promise.resolve([createStep({ text: "" })]),
        totalUsage: Promise.resolve(undefined),
      },
      abortForkStream: () => undefined,
      description: "Inspect repo",
      kind: "invoke_agent",
      durableRunMirror: true,
      durableMessageId: "msg-1",
      durableReasoningMessageId: "reasoning-1",
      durableMirrorState: { reasoningStarted: false, textStarted: false },
      appendDurableMirrorChunk: (chunk) => Promise.resolve(mirror.handleChunk(chunk)),
      closeDurableMirrorReasoning: () => Promise.resolve(),
      closeDurableMirrorText: () => Promise.resolve(),
      markDurableStepStarted: () => undefined,
      durableMirrorHasEmittedProgress: () => true,
      pendingToolLifecycle: createPendingToolLifecycle([]),
      toolCalls: [],
      toolResults: [],
      streamState: { finalText: "" },
      maxSteps: 10,
      startTime: Date.now(),
      finalizationTimeoutMs: 100,
      idleTimeoutMs: 1_000,
      activeToolTimeoutMs: 1_000,
      postToolIdleTimeoutMs: 1_000,
    });

    assertEquals(chunks, [
      { type: "start-step" },
      {
        type: "error",
        errorText: "Purchase additional credits.",
        code: "INSUFFICIENT_CREDITS",
      },
    ]);
  });

  it("streams text and tool lifecycle chunks through injected host hooks", async () => {
    const chunks: unknown[] = [];
    const writeLogs: unknown[] = [];
    const streamState = { finalText: "" };
    const toolCalls: Array<{ toolName: string; toolCallId: string; input?: unknown }> = [];
    const toolResults: Array<
      { toolName: string; toolCallId: string; input: unknown; output: unknown }
    > = [];

    const result = await executeHostedChildForkStream({
      streamResult: {
        fullStream: partsStream([
          { type: "text-delta", text: "Working" },
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "read_file",
            input: { path: "README.md" },
          },
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "read_file",
            input: { path: "README.md" },
            output: { structuredContent: { ok: true } },
          },
          { type: "text-delta", text: "Done" },
        ]),
        steps: Promise.resolve([createStep({ text: "Working\n\nDone" })]),
        totalUsage: Promise.resolve({ inputTokens: 3, outputTokens: 4 }),
      },
      abortForkStream: () => undefined,
      description: "Inspect repo",
      kind: "invoke_agent",
      durableRunMirror: true,
      durableMessageId: "msg-1",
      durableReasoningMessageId: "reasoning-1",
      durableMirrorState: { reasoningStarted: false, textStarted: false },
      appendDurableMirrorChunk: (chunk) => {
        chunks.push(chunk);
        return Promise.resolve();
      },
      closeDurableMirrorReasoning: () => Promise.resolve(),
      closeDurableMirrorText: () => Promise.resolve(),
      markDurableStepStarted: () => {
        chunks.push({ type: "marked-started" });
      },
      durableMirrorHasEmittedProgress: () => true,
      pendingToolLifecycle: createPendingToolLifecycle(chunks),
      toolCalls,
      toolResults,
      streamState,
      maxSteps: 10,
      startTime: Date.now(),
      finalizationTimeoutMs: 100,
      idleTimeoutMs: 1_000,
      activeToolTimeoutMs: 1_000,
      postToolIdleTimeoutMs: 1_000,
      writeLog: (entry) => {
        writeLogs.push(entry);
      },
    });

    assertEquals(result.success, true);
    assertEquals(streamState.finalText, "Working\n\nDone");
    assertEquals(toolCalls, [{
      toolName: "read_file",
      toolCallId: "tool-1",
      input: { path: "README.md" },
    }]);
    assertEquals(toolResults, [
      {
        toolName: "read_file",
        toolCallId: "tool-1",
        input: { path: "README.md" },
        output: { ok: true },
      },
    ]);
    assertExists(
      chunks.find((chunk) => typeof chunk === "object" && chunk !== null && "type" in chunk),
    );
    assertEquals(
      chunks,
      [
        { type: "marked-started" },
        { type: "start-step" },
        { type: "text-start", id: "msg-1" },
        { type: "text-delta", id: "msg-1", delta: "Working" },
        { type: "tool-input-start", toolCallId: "tool-1", toolName: "read_file" },
        {
          type: "tool-input-available",
          toolCallId: "tool-1",
          toolName: "read_file",
          input: { path: "README.md" },
        },
        { type: "tool-output-available", toolCallId: "tool-1", output: { ok: true } },
        { type: "text-delta", id: "msg-1", delta: "Done" },
      ],
      "every text and tool lifecycle part must be mirrored in order",
    );
    assertEquals(writeLogs.length, 1);
  });

  it("reports a failed result when the child exhausts its step budget", async () => {
    const writeLogs: Array<{ message: string; context: Record<string, unknown> }> = [];
    const toolCalls = [{ toolName: "read_file", toolCallId: "tool-1", input: {} }];
    let settledSnapshot: ChildRunExecutionSnapshot | undefined;

    const result = await executeHostedChildForkStream({
      streamResult: {
        fullStream: partsStream([{ type: "text-delta", text: "partial" }]),
        steps: Promise.resolve([createStep({ text: "partial", finishReason: "tool-calls" })]),
        totalUsage: Promise.resolve(undefined),
      },
      abortForkStream: () => undefined,
      description: "Inspect repo",
      kind: "invoke_agent",
      durableRunMirror: false,
      durableMessageId: null,
      durableReasoningMessageId: null,
      durableMirrorState: { reasoningStarted: false, textStarted: false },
      appendDurableMirrorChunk: () => Promise.resolve(),
      closeDurableMirrorReasoning: () => Promise.resolve(),
      closeDurableMirrorText: () => Promise.resolve(),
      markDurableStepStarted: () => {},
      durableMirrorHasEmittedProgress: () => false,
      pendingToolLifecycle: createPendingToolLifecycle([]),
      toolCalls,
      toolResults: [],
      streamState: { finalText: "" },
      maxSteps: 1,
      startTime: Date.now(),
      finalizationTimeoutMs: 100,
      idleTimeoutMs: 1_000,
      activeToolTimeoutMs: 1_000,
      postToolIdleTimeoutMs: 1_000,
      onSettled: (snapshot) => {
        settledSnapshot = snapshot;
      },
      writeLog: (entry) => {
        writeLogs.push(entry);
      },
    });

    assertEquals(result.success, false, "step-capped child must not be reported as success");
    if (result.success) {
      throw new Error("Expected a failed child fork result");
    }
    assertEquals(
      result.error,
      buildChildRunExhaustedStepBudgetErrorMessage(1, toolCalls),
      "the failure must carry the exhausted step budget message",
    );
    assertEquals(settledSnapshot?.fullResultText, "partial", "partial text must be kept");
    assertEquals(writeLogs[0]?.message, "Child fork exhausted step budget");
    assertEquals(writeLogs[0]?.context.stepCount, 1);
    assertEquals(writeLogs[0]?.context.maxSteps, 1);
  });

  it("emits bounded soft-idle heartbeats and then aborts a stalled fork stream", async () => {
    const appended: Array<{ type: string }> = [];
    const infoMessages: string[] = [];
    const warnMessages: string[] = [];
    const abortErrors: unknown[] = [];
    let rejectStall!: (error: unknown) => void;
    const stall = new Promise<never>((_resolve, reject) => {
      rejectStall = reject;
    });

    async function* stalledStream(): AsyncGenerator<ForkPart, void, void> {
      yield {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "read_file",
        input: { path: "README.md" },
      };
      yield {
        type: "tool-result",
        toolCallId: "tool-1",
        toolName: "read_file",
        input: { path: "README.md" },
        output: { ok: true },
      };
      await stall;
    }

    await assertRejects(() =>
      executeHostedChildForkStream({
        streamResult: {
          fullStream: stalledStream(),
          steps: Promise.resolve([createStep({ text: "" })]),
          totalUsage: Promise.resolve(undefined),
        },
        abortForkStream: (error) => {
          abortErrors.push(error);
          rejectStall(error);
        },
        description: "Inspect repo",
        kind: "invoke_agent",
        durableRunMirror: false,
        durableMessageId: null,
        durableReasoningMessageId: null,
        durableMirrorState: { reasoningStarted: false, textStarted: false },
        appendDurableMirrorChunk: (chunk) => {
          appended.push(chunk);
          if (appended.filter((entry) => entry.type === "message-metadata").length > 4) {
            // Unblock the stall so an unbounded heartbeat loop fails instead of hanging.
            rejectStall(new Error("heartbeat overflow"));
          }
          return Promise.resolve();
        },
        closeDurableMirrorReasoning: () => Promise.resolve(),
        closeDurableMirrorText: () => Promise.resolve(),
        markDurableStepStarted: () => {},
        durableMirrorHasEmittedProgress: () => false,
        pendingToolLifecycle: createPendingToolLifecycle([]),
        toolCalls: [],
        toolResults: [],
        streamState: { finalText: "" },
        maxSteps: 10,
        startTime: Date.now(),
        finalizationTimeoutMs: 100,
        idleTimeoutMs: 5,
        activeToolTimeoutMs: 1_000,
        postToolIdleTimeoutMs: 5,
        logger: {
          info: (message) => {
            infoMessages.push(message);
          },
          warn: (message) => {
            warnMessages.push(message);
          },
        },
      })
    );

    assertEquals(
      appended.filter((chunk) => chunk.type === "message-metadata").length,
      2,
      "exactly MAX_SOFT_IDLE_HEARTBEATS heartbeat chunks must be appended before aborting",
    );
    assertEquals(
      infoMessages,
      ["Fork stream soft-idle heartbeat", "Fork stream soft-idle heartbeat"],
      "each heartbeat must be logged",
    );
    assertEquals(
      warnMessages,
      ["Fork stream idle timeout triggered"],
      "the hard idle timeout must be logged once",
    );
    assertEquals(abortErrors.length, 1, "abortForkStream must be invoked once");
    assertInstanceOf(abortErrors[0], DOMException);
    assertEquals(abortErrors[0].name, "AbortError");
  });

  it("keeps the raw stream text in the settlement snapshot", async () => {
    const rawText =
      '  <function_calls><invoke name="run_bash">curl</invoke></function_calls><function_result>Title: Example</function_result>\n';
    const chunks: unknown[] = [];
    const streamState = { finalText: "" };
    const snapshots: ChildRunExecutionSnapshot[] = [];

    const result = await executeHostedChildForkStream({
      streamResult: {
        fullStream: partsStream([{ type: "text-delta", text: rawText }]),
        steps: Promise.resolve([createStep({ text: rawText })]),
        totalUsage: Promise.resolve({ inputTokens: 3, outputTokens: 4 }),
      },
      abortForkStream: () => undefined,
      description: "Inspect repo",
      kind: "invoke_agent",
      durableRunMirror: true,
      durableMessageId: "msg-1",
      durableReasoningMessageId: "reasoning-1",
      durableMirrorState: { reasoningStarted: false, textStarted: false },
      appendDurableMirrorChunk: (chunk) => {
        chunks.push(chunk);
        return Promise.resolve();
      },
      closeDurableMirrorReasoning: () => Promise.resolve(),
      closeDurableMirrorText: () => Promise.resolve(),
      markDurableStepStarted: () => {},
      durableMirrorHasEmittedProgress: () => true,
      pendingToolLifecycle: createPendingToolLifecycle(chunks),
      toolCalls: [],
      toolResults: [],
      streamState,
      maxSteps: 10,
      startTime: Date.now(),
      finalizationTimeoutMs: 100,
      idleTimeoutMs: 1_000,
      activeToolTimeoutMs: 1_000,
      postToolIdleTimeoutMs: 1_000,
      onSettled: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.summary.text, "Title: Example");
    }
    assertEquals(snapshots.length, 1);
    assertEquals(snapshots[0]?.fullResultText, rawText);
    assertStringIncludes(streamState.finalText, "<function_calls>");
  });

  it("deduplicates fallback sources and preserves richer upstream metadata", async () => {
    const chunks: unknown[] = [];
    const streamState = { finalText: "" };
    const knowledgePath = "knowledge/product/limits.md";

    const result = await executeHostedChildForkStream({
      streamResult: {
        fullStream: partsStream([
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "get_file",
            input: { path: knowledgePath },
            output: { path: knowledgePath, content: "# Limits" },
          },
          {
            type: "tool-result",
            toolCallId: "tool-2",
            toolName: "get_file",
            input: { path: knowledgePath },
            output: { path: knowledgePath, content: "# Limits" },
          },
          {
            type: "source",
            id: knowledgePath,
            sourceType: "document",
            mediaType: "text/x-markdown",
            title: "Curated product limits",
            filename: "limits.md",
          },
          {
            type: "tool-result",
            toolCallId: "tool-3",
            toolName: "get_file",
            input: { path: knowledgePath },
            output: { path: knowledgePath, content: "# Limits" },
          },
          {
            type: "source",
            id: knowledgePath,
            sourceType: "document",
            mediaType: "text/x-markdown",
            title: "Later duplicate metadata",
            filename: "limits.md",
          },
        ]),
        steps: Promise.resolve([createStep({ text: "" })]),
        totalUsage: Promise.resolve({ inputTokens: 3, outputTokens: 4 }),
      },
      abortForkStream: () => undefined,
      description: "Read knowledge",
      kind: "invoke_agent",
      durableRunMirror: true,
      durableMessageId: "msg-1",
      durableReasoningMessageId: "reasoning-1",
      durableMirrorState: { reasoningStarted: false, textStarted: false },
      appendDurableMirrorChunk: (chunk) => {
        chunks.push(chunk);
        return Promise.resolve();
      },
      closeDurableMirrorReasoning: () => Promise.resolve(),
      closeDurableMirrorText: () => Promise.resolve(),
      markDurableStepStarted: () => undefined,
      durableMirrorHasEmittedProgress: () => true,
      pendingToolLifecycle: createPendingToolLifecycle(chunks),
      toolCalls: [],
      toolResults: [],
      streamState,
      maxSteps: 10,
      startTime: Date.now(),
      finalizationTimeoutMs: 100,
      idleTimeoutMs: 1_000,
      activeToolTimeoutMs: 1_000,
      postToolIdleTimeoutMs: 1_000,
    });

    assertEquals(result.success, true);
    assertEquals(
      chunks.filter((chunk) =>
        typeof chunk === "object" &&
        chunk !== null &&
        "type" in chunk &&
        chunk.type === "source-document"
      ),
      [{
        type: "source-document",
        sourceId: knowledgePath,
        mediaType: "text/markdown",
        title: knowledgePath,
        filename: knowledgePath,
      }, {
        type: "source-document",
        sourceId: knowledgePath,
        mediaType: "text/x-markdown",
        title: "Curated product limits",
        filename: "limits.md",
      }],
    );
  });

  it("builds failure result and snapshot for child fork errors", async () => {
    const writeLogs: unknown[] = [];
    const snapshots: unknown[] = [];

    const result = await handleHostedChildForkFailure({
      error: new Error("Model failed"),
      description: "Inspect repo",
      kind: "invoke_agent",
      finalText: "partial",
      toolCalls: [{ toolName: "read_file", toolCallId: "tool-1", input: { path: "README.md" } }],
      toolResults: [{ toolName: "read_file", toolCallId: "tool-1", input: {}, output: {} }],
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      startTime: Date.now(),
      onSettled: (snapshot) => {
        snapshots.push(snapshot);
      },
      writeLog: (entry) => {
        writeLogs.push(entry);
      },
    });

    assertEquals(result.success, false);
    if (!result.success) {
      assertEquals(result.error, "Model failed");
    }
    assertEquals(result.steps, 1);
    assertEquals(result.toolCalls.length, 1);
    assertEquals(result.toolResults.length, 1);
    assertEquals(snapshots.length, 1);
    assertEquals(writeLogs.length, 1);
  });

  it("rethrows child fork errors when host policy requires it", async () => {
    await assertRejects(
      () =>
        handleHostedChildForkFailure({
          error: new Error("Insufficient credits"),
          description: "Inspect repo",
          kind: "invoke_agent",
          finalText: "",
          toolCalls: [],
          toolResults: [],
          startTime: Date.now(),
          shouldRethrowError: () => true,
        }),
      Error,
      "Insufficient credits",
    );
  });
});
