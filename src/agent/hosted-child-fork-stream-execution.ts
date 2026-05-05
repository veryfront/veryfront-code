import {
  buildFallbackUiMessageChunks,
  extractFinalStepFinishReason,
  extractFinalStepText,
  extractFinalStepToolCalls,
  extractFinalStepToolResults,
  getStreamSteps,
} from "../chat/final-step-fallback.ts";
import { mapHostedStreamPartToChatUiChunks } from "#veryfront/chat/hosted-ui-chunk-mapping.ts";
import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import {
  appendMissingChildRunToolCalls,
  appendMissingChildRunToolResults,
  buildChildRunExhaustedStepBudgetErrorMessage,
} from "./child-run-final-step-support.ts";
import {
  buildChildRunFailureResult,
  buildChildRunFailureSnapshot,
  buildChildRunResultCommon,
  buildChildRunSuccessResult,
  buildChildRunSuccessSnapshot,
  type ChildRunExecutionResult,
  type ChildRunExecutionSnapshot,
  type ChildRunExecutionUsage,
} from "./child-run-execution-snapshot.ts";
import {
  formatChildRunStreamPartError,
  throwIfChildRunAborted,
  toChildRunToolInputRecord,
} from "./child-run-execution-support.ts";
import {
  buildChildRunResultSummary,
  summarizeChildRunResultValue,
} from "./child-run-result-summary.ts";
import {
  buildHostedChildCompletedLog,
  buildHostedChildErrorLog,
  buildHostedChildExhaustedStepBudgetLog,
  type HostedChildExecutionLogEntry,
} from "./hosted-child-execution-logging.ts";
import { isAlreadyMirroredHostedChunk, toMirroredHostedStreamPart } from "./hosted-child-mirror.ts";
import type {
  HostedChildPendingToolCallState,
  HostedChildPendingToolLifecycleCloseReason,
} from "./hosted-child-pending-tool-lifecycle.ts";
import {
  HOSTED_CHILD_STREAM_TIMEOUT_TOKEN,
  type HostedChildStreamWatchdogState,
  resolveHostedChildPromiseWithTimeout,
  resolveHostedChildStreamWatchdogState,
  withHostedChildStreamIdleTimeout,
} from "./hosted-child-stream-watchdog.ts";
import type { ForkPart, ForkRuntimeStreamResult } from "./fork-runtime-stream.ts";

const SOFT_IDLE_HEARTBEAT_PHASE = "post_tool_idle";
const MAX_SOFT_IDLE_HEARTBEATS = 2;

export interface HostedChildForkStreamHandlingState {
  activeToolCallId: string | null;
  finalText: string;
  shouldSeparateNextTextBlock: boolean;
}

export interface HostedChildForkStreamLogger {
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
}

export interface HostedChildForkPendingToolLifecycle {
  emitToolInputStartIfNeeded: (toolCallId: string, toolName: string) => Promise<void> | void;
  upsertPendingToolCall: (toolCallId: string, state: HostedChildPendingToolCallState) => void;
  deletePendingToolCall: (toolCallId: string) => void;
  closePendingToolCalls: (
    reason: HostedChildPendingToolLifecycleCloseReason,
  ) => Promise<void> | void;
}

export interface HostedChildForkStreamTraceInput {
  conversationId?: string;
  parentRunId?: string;
  partType: ForkPart["type"];
}

export interface ExecuteHostedChildForkStreamInput {
  streamResult: ForkRuntimeStreamResult;
  abortSignal?: AbortSignal;
  abortForkStream: (error: Error) => void;
  conversationId?: string;
  parentRunId?: string;
  description: string;
  kind: string;
  durableRunMirror: boolean;
  durableMessageId: string | null;
  durableReasoningMessageId: string | null;
  durableMirrorState: { reasoningStarted: boolean; textStarted: boolean };
  appendDurableMirrorChunk: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => Promise<void>;
  closeDurableMirrorReasoning: () => Promise<void>;
  closeDurableMirrorText: () => Promise<void>;
  markDurableStepStarted: () => void;
  durableMirrorHasEmittedProgress: () => boolean;
  pendingToolLifecycle: HostedChildForkPendingToolLifecycle;
  toolCalls: Array<{ toolName: string; toolCallId: string; input?: unknown }>;
  toolResults: Array<{ toolName: string; toolCallId: string; input: unknown; output: unknown }>;
  streamState: { finalText: string };
  usage?: ChildRunExecutionUsage;
  maxSteps: number;
  startTime: number;
  finalizationTimeoutMs: number;
  onSettled?: (snapshot: ChildRunExecutionSnapshot) => void | Promise<void>;
  idleTimeoutMs: number;
  activeToolTimeoutMs: number;
  postToolIdleTimeoutMs: number;
  logger?: HostedChildForkStreamLogger;
  writeLog?: (entry: HostedChildExecutionLogEntry) => void;
  tracePart?: (input: HostedChildForkStreamTraceInput) => void | Promise<void>;
}

export interface HandleHostedChildForkFailureInput {
  error: unknown;
  description: string;
  kind: string;
  finalText: string;
  toolCalls: Array<{ toolName: string; toolCallId: string; input?: unknown }>;
  toolResults: Array<{ toolName: string; toolCallId: string; input: unknown; output: unknown }>;
  usage?: ChildRunExecutionUsage;
  startTime: number;
  onSettled?: (snapshot: ChildRunExecutionSnapshot) => void | Promise<void>;
  shouldRethrowError?: (error: unknown) => boolean;
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

export async function finalizeHostedChildForkCompletion(input: {
  streamResult: ForkRuntimeStreamResult;
  finalText: string;
  description: string;
  kind: string;
  maxSteps: number;
  toolCalls: Array<{ toolName: string; toolCallId: string; input?: unknown }>;
  toolResults: Array<{ toolName: string; toolCallId: string; input: unknown; output: unknown }>;
  usage?: ChildRunExecutionUsage;
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
  return buildChildRunSuccessResult(common, buildChildRunResultSummary(finalText));
}

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
  const common = buildChildRunResultCommon({
    description: input.description,
    steps: input.toolCalls.length,
    toolCalls: input.toolCalls,
    toolResults: input.toolResults,
    usage: input.usage,
    durationMs: Date.now() - input.startTime,
  });
  const snapshot = buildChildRunFailureSnapshot(common, errorText, input.finalText || null);
  await input.onSettled?.(snapshot);
  return buildChildRunFailureResult(common, errorText);
}

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
