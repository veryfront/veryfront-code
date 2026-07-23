import {
  buildFallbackUiMessageChunks,
  extractFinalStepFinishReason,
  extractFinalStepText,
  extractFinalStepToolCalls,
  extractFinalStepToolResults,
  getStreamSteps,
} from "../../chat/final-step-fallback.ts";
import { mapHostedStreamPartToChatUiChunks } from "#veryfront/chat/hosted-ui-chunk-mapping.ts";
import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import {
  appendMissingChildRunToolCalls,
  appendMissingChildRunToolResults,
  buildChildRunExhaustedStepBudgetErrorMessage,
} from "../child-run/final-step-support.ts";
import {
  buildChildRunFailureResult,
  buildChildRunFailureSnapshot,
  buildChildRunResultCommon,
  buildChildRunSuccessResult,
  buildChildRunSuccessSnapshot,
  type ChildRunExecutionResult,
  type ChildRunExecutionSnapshot,
  type ChildRunExecutionUsage,
} from "../child-run/execution-snapshot.ts";
import {
  formatChildRunStreamPartError,
  throwIfChildRunAborted,
  toChildRunToolInputRecord,
} from "../child-run/execution-support.ts";
import {
  buildChildRunResultSummary,
  type ChildRunResultMode,
  summarizeChildRunResultValue,
} from "../child-run/result-summary.ts";
import {
  buildHostedChildCompletedLog,
  buildHostedChildErrorLog,
  buildHostedChildExhaustedStepBudgetLog,
  type HostedChildExecutionLogEntry,
} from "./child-execution-logging.ts";
import { isAlreadyMirroredHostedChunk, toMirroredHostedStreamPart } from "./child-mirror.ts";
import type {
  HostedChildPendingToolCallState,
  HostedChildPendingToolLifecycleCloseReason,
} from "./child-pending-tool-lifecycle.ts";
import {
  HOSTED_CHILD_STREAM_TIMEOUT_TOKEN,
  type HostedChildStreamWatchdogState,
  resolveHostedChildPromiseWithTimeout,
  resolveHostedChildStreamWatchdogState,
  withHostedChildStreamIdleTimeout,
} from "./child-stream-watchdog.ts";
import type { ForkPart, ForkRuntimeStreamResult } from "../streaming/fork-runtime-stream.ts";

const SOFT_IDLE_HEARTBEAT_PHASE = "post_tool_idle";
const MAX_SOFT_IDLE_HEARTBEATS = 2;

/** State for hosted child fork stream handling. */
export interface HostedChildForkStreamHandlingState {
  /** Active tool call ID value. */
  activeToolCallId: string | null;
  /** Final text value. */
  finalText: string;
  /** Whether separate next text block. */
  shouldSeparateNextTextBlock: boolean;
}

/** Public API contract for hosted child fork stream logger. */
export interface HostedChildForkStreamLogger {
  /** Callback that handles debug. */
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  /** Callback that handles info. */
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  /** Writes a warning log entry. */
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
}

/** Public API contract for hosted child fork pending tool lifecycle. */
export interface HostedChildForkPendingToolLifecycle {
  /** Callback that handles emit tool input start if needed. */
  emitToolInputStartIfNeeded: (toolCallId: string, toolName: string) => Promise<void> | void;
  /** Callback that handles upsert pending tool call. */
  upsertPendingToolCall: (toolCallId: string, state: HostedChildPendingToolCallState) => void;
  /** Callback that handles delete pending tool call. */
  deletePendingToolCall: (toolCallId: string) => void;
  /** Close pending tool calls value. */
  closePendingToolCalls: (
    reason: HostedChildPendingToolLifecycleCloseReason,
  ) => Promise<void> | void;
}

/** Input payload for hosted child fork stream trace. */
export interface HostedChildForkStreamTraceInput {
  /** Conversation ID value. */
  conversationId?: string;
  /** Parent run ID value. */
  parentRunId?: string;
  /** Part type value. */
  partType: ForkPart["type"];
}

/** Input payload for execute hosted child fork stream. */
export interface ExecuteHostedChildForkStreamInput {
  /** Stream result value. */
  streamResult: ForkRuntimeStreamResult;
  /** Abort signal value. */
  abortSignal?: AbortSignal;
  /** Callback that handles abort fork stream. */
  abortForkStream: (error: Error) => void;
  /** Conversation ID value. */
  conversationId?: string;
  /** Parent run ID value. */
  parentRunId?: string;
  /** Description value. */
  description: string;
  /** Kind value. */
  kind: string;
  /** Whether durable run mirror. */
  durableRunMirror: boolean;
  /** Durable message ID value. */
  durableMessageId: string | null;
  /** Durable reasoning message ID value. */
  durableReasoningMessageId: string | null;
  /** Whether durable mirror state. */
  durableMirrorState: { reasoningStarted: boolean; textStarted: boolean };
  /** Callback that handles append durable mirror chunk. */
  appendDurableMirrorChunk: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => Promise<void>;
  /** Callback that handles close durable mirror reasoning. */
  closeDurableMirrorReasoning: () => Promise<void>;
  /** Callback that handles close durable mirror text. */
  closeDurableMirrorText: () => Promise<void>;
  /** Callback that handles mark durable step started. */
  markDurableStepStarted: () => void;
  /** Callback that handles durable mirror has emitted progress. */
  durableMirrorHasEmittedProgress: () => boolean;
  /** Pending tool lifecycle value. */
  pendingToolLifecycle: HostedChildForkPendingToolLifecycle;
  /** Tool calls value. */
  toolCalls: Array<{ toolName: string; toolCallId: string; input?: unknown }>;
  /** Tool results value. */
  toolResults: Array<{ toolName: string; toolCallId: string; input: unknown; output: unknown }>;
  /** Stream state value. */
  streamState: { finalText: string };
  /** Usage value. */
  usage?: ChildRunExecutionUsage;
  /** Max steps value. */
  maxSteps: number;
  /** Result mode value. */
  resultMode?: ChildRunResultMode;
  /** Start time value. */
  startTime: number;
  /** Finalization timeout ms value. */
  finalizationTimeoutMs: number;
  /** Callback invoked when settled. */
  onSettled?: (snapshot: ChildRunExecutionSnapshot) => void | Promise<void>;
  /** Idle timeout ms value. */
  idleTimeoutMs: number;
  /** Active tool timeout ms value. */
  activeToolTimeoutMs: number;
  /** Post tool idle timeout ms value. */
  postToolIdleTimeoutMs: number;
  /** Logger value. */
  logger?: HostedChildForkStreamLogger;
  /** Callback that handles write log. */
  writeLog?: (entry: HostedChildExecutionLogEntry) => void;
  /** Callback that handles trace part. */
  tracePart?: (input: HostedChildForkStreamTraceInput) => void | Promise<void>;
}

/** Input payload for handle hosted child fork failure. */
export interface HandleHostedChildForkFailureInput {
  /** Error associated with the operation. */
  error: unknown;
  /** Description value. */
  description: string;
  /** Kind value. */
  kind: string;
  /** Final text value. */
  finalText: string;
  /** Tool calls value. */
  toolCalls: Array<{ toolName: string; toolCallId: string; input?: unknown }>;
  /** Tool results value. */
  toolResults: Array<{ toolName: string; toolCallId: string; input: unknown; output: unknown }>;
  /** Usage value. */
  usage?: ChildRunExecutionUsage;
  /** Start time value. */
  startTime: number;
  /** Callback invoked when settled. */
  onSettled?: (snapshot: ChildRunExecutionSnapshot) => void | Promise<void>;
  /** Callback that handles should rethrow error. */
  shouldRethrowError?: (error: unknown) => boolean;
  /** Callback that handles write log. */
  writeLog?: (entry: HostedChildExecutionLogEntry) => void;
}

function isSoftIdleHeartbeatPhase(phase: HostedChildStreamWatchdogState["phase"]): boolean {
  return phase === SOFT_IDLE_HEARTBEAT_PHASE;
}

function getStructuredContent(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  if (!("structuredContent" in value)) {
    return value;
  }
  return value.structuredContent;
}

/** Finalize hosted child fork completion helper. */
export async function finalizeHostedChildForkCompletion(input: {
  streamResult: ForkRuntimeStreamResult;
  finalText: string;
  description: string;
  kind: string;
  maxSteps: number;
  toolCalls: Array<{ toolName: string; toolCallId: string; input?: unknown }>;
  toolResults: Array<{ toolName: string; toolCallId: string; input: unknown; output: unknown }>;
  usage?: ChildRunExecutionUsage;
  resultMode?: ChildRunResultMode;
  startTime: number;
  durableMessageId: string | null;
  durableMirrorHasEmittedProgress: boolean;
  appendDurableMirrorChunk: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => Promise<void>;
  finalizationTimeoutMs: number;
  onSettled?: (snapshot: ChildRunExecutionSnapshot) => void | Promise<void>;
  logger?: HostedChildForkStreamLogger;
  writeLog?: (entry: HostedChildExecutionLogEntry) => void;
}): Promise<ChildRunExecutionResult> {
  const { steps: resolvedSteps, lastStep: finalStep } = await getStreamSteps(
    input.streamResult,
    input.finalizationTimeoutMs,
  );
  const stepCount = resolvedSteps.length;
  let finalText = input.finalText;
  let usage = input.usage;

  if (finalText.trim().length === 0) {
    finalText = extractFinalStepText(finalStep);
  }

  const fallbackToolCalls = extractFinalStepToolCalls(finalStep);
  appendMissingChildRunToolCalls(input.toolCalls, fallbackToolCalls);

  const fallbackToolResults = extractFinalStepToolResults(finalStep);
  appendMissingChildRunToolResults(input.toolResults, fallbackToolResults);

  if (!input.durableMirrorHasEmittedProgress && input.durableMessageId) {
    const fallbackChunks = buildFallbackUiMessageChunks(finalStep, input.durableMessageId);
    for (const chunk of fallbackChunks) {
      await input.appendDurableMirrorChunk(chunk);
    }
  }

  const totalUsage = await resolveHostedChildPromiseWithTimeout(
    input.streamResult.totalUsage,
    input.finalizationTimeoutMs,
  ).catch((error) => {
    input.logger?.warn?.("Child fork total usage failed after stream completion", {
      description: input.description,
      kind: input.kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (totalUsage === HOSTED_CHILD_STREAM_TIMEOUT_TOKEN) {
    input.logger?.warn?.("Child fork total usage timed out after stream completion", {
      description: input.description,
      kind: input.kind,
      timeoutMs: input.finalizationTimeoutMs,
    });
  } else if (totalUsage) {
    usage = {
      inputTokens: totalUsage.inputTokens ?? 0,
      outputTokens: totalUsage.outputTokens ?? 0,
      totalTokens: (totalUsage.inputTokens ?? 0) + (totalUsage.outputTokens ?? 0),
    };
  }

  const finalStepFinishReason = extractFinalStepFinishReason(finalStep);
  const agentWantedToContinue = finalStepFinishReason === "tool-calls";
  const exhaustedStepBudget = stepCount >= input.maxSteps && agentWantedToContinue;
  if (exhaustedStepBudget) {
    const errorMessage = buildChildRunExhaustedStepBudgetErrorMessage(stepCount, input.toolCalls);

    input.writeLog?.(
      buildHostedChildExhaustedStepBudgetLog({
        description: input.description,
        kind: input.kind,
        stepCount,
        maxSteps: input.maxSteps,
        toolCallsLength: input.toolCalls.length,
      }),
    );

    const common = buildChildRunResultCommon({
      description: input.description,
      steps: stepCount,
      toolCalls: input.toolCalls,
      toolResults: input.toolResults,
      usage,
      durationMs: Date.now() - input.startTime,
    });
    const snapshot = buildChildRunFailureSnapshot(common, errorMessage, finalText || null);
    await input.onSettled?.(snapshot);
    return buildChildRunFailureResult(common, errorMessage);
  }

  input.writeLog?.(
    buildHostedChildCompletedLog({
      description: input.description,
      kind: input.kind,
      toolCallsLength: input.toolCalls.length,
      finalText,
    }),
  );

  const common = buildChildRunResultCommon({
    description: input.description,
    steps: stepCount,
    toolCalls: input.toolCalls,
    toolResults: input.toolResults,
    usage,
    durationMs: Date.now() - input.startTime,
  });
  const snapshot = buildChildRunSuccessSnapshot(common, finalText);
  await input.onSettled?.(snapshot);
  return buildChildRunSuccessResult(
    common,
    buildChildRunResultSummary(finalText, { mode: input.resultMode }),
  );
}

/** Process a hosted child fork failure. */
export async function handleHostedChildForkFailure(
  input: HandleHostedChildForkFailureInput,
): Promise<ChildRunExecutionResult> {
  input.writeLog?.(
    buildHostedChildErrorLog({
      description: input.description,
      kind: input.kind,
      error: input.error,
      finalText: input.finalText,
      toolCallsLength: input.toolCalls.length,
      toolResultsLength: input.toolResults.length,
    }),
  );

  if (input.shouldRethrowError?.(input.error)) {
    throw input.error;
  }

  const errorText = input.error instanceof Error ? input.error.message : "Unknown error";
  // A step is one LLM turn, not one tool call, so tool-call count overcounts
  // steps (a single turn can emit several parallel calls). The failed stream
  // never resolves its step list, so the exact count is unavailable here; use
  // completed tool-result rounds as the closest lower-bound proxy that never
  // exceeds the real step count.
  const common = buildChildRunResultCommon({
    description: input.description,
    steps: input.toolResults.length,
    toolCalls: input.toolCalls,
    toolResults: input.toolResults,
    usage: input.usage,
    durationMs: Date.now() - input.startTime,
  });
  const snapshot = buildChildRunFailureSnapshot(common, errorText, input.finalText || null);
  await input.onSettled?.(snapshot);
  return buildChildRunFailureResult(common, errorText);
}

/** Process a hosted child fork stream part. */
export async function handleHostedChildForkStreamPart(input: {
  part: ForkPart;
  conversationId?: string;
  description: string;
  durableMessageId: string | null;
  durableReasoningMessageId: string | null;
  durableMirrorState: { reasoningStarted: boolean; textStarted: boolean };
  appendDurableMirrorChunk: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => Promise<void>;
  closeDurableMirrorReasoning: () => Promise<void>;
  closeDurableMirrorText: () => Promise<void>;
  pendingToolLifecycle: HostedChildForkPendingToolLifecycle;
  toolCalls: Array<{ toolName: string; toolCallId: string; input?: unknown }>;
  toolResults: Array<{ toolName: string; toolCallId: string; input: unknown; output: unknown }>;
  state: HostedChildForkStreamHandlingState;
  logger?: HostedChildForkStreamLogger;
}): Promise<HostedChildForkStreamHandlingState> {
  let { activeToolCallId, finalText, shouldSeparateNextTextBlock } = input.state;
  const part = input.part;

  if (part.type === "reasoning-delta") {
    if (input.durableReasoningMessageId) {
      if (!input.durableMirrorState.reasoningStarted) {
        input.durableMirrorState.reasoningStarted = true;
        await input.appendDurableMirrorChunk({
          type: "reasoning-start",
          id: input.durableReasoningMessageId,
        });
      }
      await input.appendDurableMirrorChunk({
        type: "reasoning-delta",
        id: input.durableReasoningMessageId,
        delta: part.text,
      });
    }
    return { activeToolCallId, finalText, shouldSeparateNextTextBlock };
  }

  if (part.type === "text-delta") {
    await input.closeDurableMirrorReasoning();
    const nextText = shouldSeparateNextTextBlock && finalText.length > 0
      ? `\n\n${part.text}`
      : part.text;
    finalText += nextText;
    shouldSeparateNextTextBlock = false;
    if (input.durableMessageId) {
      if (!input.durableMirrorState.textStarted) {
        input.durableMirrorState.textStarted = true;
        await input.appendDurableMirrorChunk({
          type: "text-start",
          id: input.durableMessageId,
        });
      }
      await input.appendDurableMirrorChunk({
        type: "text-delta",
        id: input.durableMessageId,
        delta: part.text,
      });
    }
    return { activeToolCallId, finalText, shouldSeparateNextTextBlock };
  }

  if (part.type === "tool-input-start") {
    await input.closeDurableMirrorReasoning();
    await input.closeDurableMirrorText();
    activeToolCallId = part.toolCallId;
    shouldSeparateNextTextBlock = finalText.length > 0;
    await input.pendingToolLifecycle.emitToolInputStartIfNeeded(part.toolCallId, part.toolName);
    input.pendingToolLifecycle.upsertPendingToolCall(part.toolCallId, {
      phase: "input_streaming",
      toolName: part.toolName,
    });
    return { activeToolCallId, finalText, shouldSeparateNextTextBlock };
  }

  if (part.type === "tool-input-delta") {
    input.pendingToolLifecycle.upsertPendingToolCall(part.toolCallId, {
      phase: "input_streaming",
    });
    return { activeToolCallId, finalText, shouldSeparateNextTextBlock };
  }

  if (part.type === "tool-call") {
    await input.closeDurableMirrorReasoning();
    await input.closeDurableMirrorText();
    activeToolCallId = part.toolCallId;
    shouldSeparateNextTextBlock = finalText.length > 0;
    const summarizedInput = summarizeChildRunResultValue(part.input);
    input.toolCalls.push({
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      input: summarizedInput,
    });
    input.logger?.debug?.("Child fork tool call", {
      conversationId: input.conversationId,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      description: input.description,
    });
    input.pendingToolLifecycle.upsertPendingToolCall(part.toolCallId, {
      phase: "awaiting_result",
      toolName: part.toolName,
      input: summarizedInput,
    });
    await input.pendingToolLifecycle.emitToolInputStartIfNeeded(part.toolCallId, part.toolName);
    await input.appendDurableMirrorChunk({
      type: "tool-input-available",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: toChildRunToolInputRecord(summarizedInput),
    });
    return { activeToolCallId, finalText, shouldSeparateNextTextBlock };
  }

  if (part.type === "tool-result") {
    await input.closeDurableMirrorReasoning();
    await input.closeDurableMirrorText();
    activeToolCallId = null;
    shouldSeparateNextTextBlock = finalText.length > 0;
    const rawOutput = getStructuredContent(part.output);
    const summarizedInput = summarizeChildRunResultValue(part.input);
    const summarizedOutput = summarizeChildRunResultValue(rawOutput);
    input.logger?.debug?.("Child fork tool result", {
      conversationId: input.conversationId,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      description: input.description,
    });
    input.toolResults.push({
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      input: summarizedInput,
      output: summarizedOutput,
    });
    await input.appendDurableMirrorChunk({
      type: "tool-output-available",
      toolCallId: part.toolCallId,
      output: summarizedOutput,
    });
    input.pendingToolLifecycle.deletePendingToolCall(part.toolCallId);
    return { activeToolCallId, finalText, shouldSeparateNextTextBlock };
  }

  if (part.type === "tool-error") {
    await input.closeDurableMirrorReasoning();
    await input.closeDurableMirrorText();
    shouldSeparateNextTextBlock = finalText.length > 0;
    input.logger?.warn?.("Child fork tool error", {
      conversationId: input.conversationId,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      description: input.description,
    });
    await input.pendingToolLifecycle.emitToolInputStartIfNeeded(part.toolCallId, part.toolName);
    await input.appendDurableMirrorChunk({
      type: "tool-input-error",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: toChildRunToolInputRecord(part.input),
      errorText: part.error.message,
    });
    input.pendingToolLifecycle.deletePendingToolCall(part.toolCallId);
    activeToolCallId = null;
    return { activeToolCallId, finalText, shouldSeparateNextTextBlock };
  }

  return { activeToolCallId, finalText, shouldSeparateNextTextBlock };
}

/** Execute hosted child fork stream. */
export async function executeHostedChildForkStream(
  input: ExecuteHostedChildForkStreamInput,
): Promise<ChildRunExecutionResult> {
  let activeToolCallId: string | null = null;
  let finalText = input.streamState.finalText;
  let shouldSeparateNextTextBlock = false;
  let softIdleHeartbeatCount = 0;

  if (input.durableRunMirror) {
    input.markDurableStepStarted();
    await input.appendDurableMirrorChunk({
      type: "start-step",
    });
  }

  let lastWatchdogPhase: string | null = null;
  for await (
    const part of withHostedChildStreamIdleTimeout({
      stream: input.streamResult.fullStream,
      getWatchdogState: () => {
        const state = resolveHostedChildStreamWatchdogState({
          activeToolCallId,
          completedToolResults: input.toolResults.length,
          idleTimeoutMs: input.idleTimeoutMs,
          activeToolTimeoutMs: input.activeToolTimeoutMs,
          postToolIdleTimeoutMs: input.postToolIdleTimeoutMs,
        });
        if (state.phase !== lastWatchdogPhase) {
          input.logger?.debug?.("Fork watchdog phase changed", {
            conversationId: input.conversationId,
            description: input.description,
            phase: state.phase,
            previousPhase: lastWatchdogPhase,
            timeoutMs: state.timeoutMs,
          });
          lastWatchdogPhase = state.phase;
        }
        return state;
      },
      abortSignal: input.abortSignal,
      onIdleTimeout: async (watchdogState) => {
        if (
          isSoftIdleHeartbeatPhase(watchdogState.phase) &&
          softIdleHeartbeatCount < MAX_SOFT_IDLE_HEARTBEATS
        ) {
          softIdleHeartbeatCount += 1;
          input.logger?.info?.("Fork stream soft-idle heartbeat", {
            conversationId: input.conversationId,
            description: input.description,
            watchdogPhase: watchdogState.phase,
            heartbeatCount: softIdleHeartbeatCount,
            timeoutMs: watchdogState.timeoutMs,
            toolCallsCompleted: input.toolResults.length,
          });
          await input.appendDurableMirrorChunk({
            type: "message-metadata",
            messageMetadata: {
              createdAt: new Date().toISOString(),
            },
          });
          return "continue";
        }

        input.logger?.warn?.("Fork stream idle timeout triggered", {
          conversationId: input.conversationId,
          description: input.description,
          watchdogPhase: watchdogState.phase ?? lastWatchdogPhase,
          softIdleHeartbeatCount,
          timeoutMs: watchdogState.timeoutMs,
          toolCallsCompleted: input.toolResults.length,
        });
        input.abortForkStream(new DOMException("Child fork stream idle timeout", "AbortError"));
        return undefined;
      },
    })
  ) {
    softIdleHeartbeatCount = 0;
    throwIfChildRunAborted(input.abortSignal);

    await input.tracePart?.({
      conversationId: input.conversationId,
      parentRunId: input.parentRunId,
      partType: part.type,
    });
    input.logger?.debug?.("Child fork stream part received", {
      conversationId: input.conversationId,
      runId: input.parentRunId,
      partType: part.type,
    });

    ({ activeToolCallId, finalText, shouldSeparateNextTextBlock } =
      await handleHostedChildForkStreamPart({
        part,
        conversationId: input.conversationId,
        description: input.description,
        durableMessageId: input.durableMessageId,
        durableReasoningMessageId: input.durableReasoningMessageId,
        durableMirrorState: input.durableMirrorState,
        appendDurableMirrorChunk: input.appendDurableMirrorChunk,
        closeDurableMirrorReasoning: input.closeDurableMirrorReasoning,
        closeDurableMirrorText: input.closeDurableMirrorText,
        pendingToolLifecycle: input.pendingToolLifecycle,
        toolCalls: input.toolCalls,
        toolResults: input.toolResults,
        state: {
          activeToolCallId,
          finalText,
          shouldSeparateNextTextBlock,
        },
        logger: input.logger,
      }));
    input.streamState.finalText = finalText;

    if (input.durableRunMirror) {
      const mirroredChunks = mapHostedStreamPartToChatUiChunks(
        toMirroredHostedStreamPart(part, {
          messageId: input.durableMessageId,
          reasoningMessageId: input.durableReasoningMessageId,
        }),
        {
          messageId: input.durableMessageId,
          reasoningMessageId: input.durableReasoningMessageId,
          onError: formatChildRunStreamPartError,
        },
      );

      for (const mirroredChunk of mirroredChunks) {
        if (isAlreadyMirroredHostedChunk(part.type, mirroredChunk.type)) {
          continue;
        }

        await input.appendDurableMirrorChunk(mirroredChunk);
      }
    }
  }

  await input.closeDurableMirrorReasoning();
  await input.closeDurableMirrorText();
  await input.pendingToolLifecycle.closePendingToolCalls({ kind: "ended" });
  throwIfChildRunAborted(input.abortSignal);
  input.streamState.finalText = finalText;

  return finalizeHostedChildForkCompletion({
    streamResult: input.streamResult,
    finalText,
    description: input.description,
    kind: input.kind,
    maxSteps: input.maxSteps,
    resultMode: input.resultMode,
    toolCalls: input.toolCalls,
    toolResults: input.toolResults,
    usage: input.usage,
    startTime: input.startTime,
    durableMessageId: input.durableMessageId,
    durableMirrorHasEmittedProgress: input.durableMirrorHasEmittedProgress(),
    appendDurableMirrorChunk: input.appendDurableMirrorChunk,
    finalizationTimeoutMs: input.finalizationTimeoutMs,
    onSettled: input.onSettled,
    logger: input.logger,
    writeLog: input.writeLog,
  });
}
