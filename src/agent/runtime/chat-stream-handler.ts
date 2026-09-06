/**
 * Model Runtime Stream Handler
 *
 * Processes model-runtime `streamText()` fullStream parts and emits SSE
 * events in the Data Stream Protocol format. Stream parts map 1:1 to the
 * framework SSE protocol with minimal field remapping.
 *
 * @module agent/runtime/chat-stream-handler
 */

import type { RuntimeStreamPart, RuntimeStreamResult } from "./runtime-tool-types.ts";
import { sendSSE } from "./sse-utils.ts";
import {
  mergeToolCallInput,
  mergeToolInputDelta,
  parseToolInputObject,
  stripLeadingEmptyObjectPlaceholder,
} from "../streaming/data-stream.ts";
import { isDynamicTool } from "./tool-helpers.ts";
import {
  getStreamErrorMessage,
  hasCompletedStepSignal,
  isLateProviderBodyReadError,
  resolveKnownProviderTerminalError,
} from "../streaming/stream-outcome.ts";
import { serverLogger } from "#veryfront/utils";
import { isAnyDebugEnabled } from "#veryfront/utils/constants/env.ts";
import { setActiveSpanAttributes, SpanKind } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { withToolInputStatusTransitions } from "#veryfront/provider/runtime-loader/tool-input-status.ts";
import { ProviderError } from "#veryfront/provider/runtime-loader/provider-http.ts";
import {
  applyLifecycleSnapshotToChatStreamState,
  createRuntimeStreamProviderAdapter,
  createStreamLifecycleLiveAdapter,
  createStreamLifecycleObserver,
  resolveStreamLifecyclePolicy,
  runStreamLifecycle,
  StreamLifecycleFailure,
  type StreamLifecyclePolicy,
  type StreamOutcome,
  toLegacyRuntimeUsage,
} from "#veryfront/agent/streaming/lifecycle/index.ts";
import type { StreamLifecycleMode } from "./stream-lifecycle-mode.ts";
import {
  createStreamLifecycleShadow,
  type StreamLifecycleShadowDivergence,
  type StreamLifecycleShadowReport,
} from "./stream-lifecycle-shadow.ts";
import { stringifyToolError, throwIfAborted } from "./error-utils.ts";
import {
  redactSensitive,
  sanitizeSerializedError,
  sanitizeUrlCredentials,
} from "#veryfront/utils/logger/redact.ts";
import { buildRuntimeUsageTraceAttributes } from "./trace-usage.ts";
import {
  getToolResultError,
  isIntegrationAuthenticationActionResult,
} from "#veryfront/tool/result.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { readOwnDataProperty } from "./data-property-descriptor.ts";

const logger = serverLogger.component("agent");
const LOCAL_TOOL_COMMIT_GRACE_MS = 250;
const LOCAL_TOOL_INPUT_IDLE_MS = 15_000;
const STREAM_START_IDLE_MS = 60_000;
const STREAM_OUTPUT_IDLE_MS = 15_000;

type TraceAttributePrimitive = string | number | boolean;
type TraceAttributeValue = TraceAttributePrimitive | readonly TraceAttributePrimitive[];

export interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
  inputDeltas?: string[];
  inputAnnounced?: boolean;
  inputAvailable?: boolean;
  providerExecuted?: boolean;
  dynamic?: boolean;
}

export interface StreamingToolResult {
  toolCallId: string;
  toolName: string;
  output?: unknown;
  error?: unknown;
  providerExecuted?: boolean;
  dynamic?: boolean;
  preliminary?: boolean;
}

export interface RuntimeStreamErrorEvent extends Record<string, unknown> {
  type: "error";
  error: string;
  code?: string;
}

function hasProviderStreamErrorEvidence(error: unknown): boolean {
  let current = error;
  try {
    for (let depth = 0; depth < 64; depth += 1) {
      if (current instanceof ProviderError) return true;
      if (
        typeof readOwnDataProperty(current, "responseBody", "provider stream error", false) ===
          "string"
      ) {
        return true;
      }
      current = readOwnDataProperty(current, "lastError", "provider stream error", false);
      if (current === undefined) return false;
    }
    return false;
  } catch {
    return false;
  }
}

/** Preserve only curated provider terminal details across the runtime stream boundary. */
export function resolveRuntimeStreamErrorEvent(error: unknown): RuntimeStreamErrorEvent {
  try {
    if (error instanceof StreamLifecycleFailure) {
      return {
        type: "error",
        error: error.lifecycleError.publicMessage,
        ...(error.lifecycleError.code === "PROVIDER_TERMINAL_ERROR" &&
            error.lifecycleError.providerCode
          ? { code: error.lifecycleError.providerCode }
          : {}),
      };
    }

    const knownProviderError = hasProviderStreamErrorEvidence(error)
      ? resolveKnownProviderTerminalError(error)
      : null;
    if (knownProviderError) {
      return {
        type: "error",
        error: knownProviderError.message,
        code: knownProviderError.code,
      };
    }

    return {
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  } catch {
    try {
      return { type: "error", error: stringifyToolError(error) };
    } catch {
      return { type: "error", error: "Unknown error" };
    }
  }
}

/**
 * Flush a tool call's buffered `tool-input-start` and input deltas to the
 * client.
 *
 * The start event is withheld until the call commits — `tool-input-end`,
 * `tool-input-available` or `tool-call`. `tool-call` rebuilds the entry from
 * its own `toolName` and announces from there, so a name that supersedes the
 * one seen at `tool-input-start` is the one the client is given, and the
 * superseded name never reaches the wire.
 *
 * Idempotent via `inputAnnounced`, which is also what gates the terminal
 * `tool-output-error`. A call whose stream ended before any commit event was
 * never announced, so it must be announced here before its failure can
 * render. Such a call has no superseding name to wait for: the event that
 * would carry one never arrived, and `inputAvailable` stays false, which is
 * what makes that terminal path reachable at all.
 */
export function announceStreamedToolCallInput(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  toolCall: StreamingToolCall,
): void {
  if (toolCall.inputAnnounced === true) {
    return;
  }

  const dynamic = toolCall.dynamic ?? isDynamicTool(toolCall.name);
  sendSSE(controller, encoder, {
    type: "tool-input-start",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    ...(dynamic ? { dynamic: true } : {}),
  });

  for (const delta of toolCall.inputDeltas ?? []) {
    sendSSE(controller, encoder, {
      type: "tool-input-delta",
      toolCallId: toolCall.id,
      inputTextDelta: delta,
    });
  }

  toolCall.inputAnnounced = true;
}

export interface StreamingReasoningPart {
  id: string;
  text: string;
  signature?: string;
  redactedData?: string;
}

export interface ChatStreamState {
  accumulatedText: string;
  reasoningParts: StreamingReasoningPart[];
  finishReason: string | null;
  providerMetadata?: Record<string, unknown>;
  toolCalls: Map<string, StreamingToolCall>;
  toolResults: StreamingToolResult[];
  suppressedToolCalls: { id: string; name: string }[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    reasoningTokens?: number;
    billableInputTokens?: number;
    billableOutputTokens?: number;
    costUsd?: number;
    providerInputCostUsd?: number;
    providerOutputCostUsd?: number;
    providerCostUsd?: number;
    veryfrontInputChargeUsd?: number;
    veryfrontOutputChargeUsd?: number;
    veryfrontChargeUsd?: number;
    veryfrontBilledUsd?: number;
    costCredits?: number;
    costSource?: "gateway" | "missing" | "partial";
    billingMode?: "direct" | "deferred";
    usageCaptureStatus?: "complete" | "partial" | "missing";
  };
  streamOutcome?: StreamOutcome;
}

export interface ChatStreamCallbacks {
  onChunk?: (chunk: string) => void;
  onUsage?: (usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    reasoningTokens?: number;
    billableInputTokens?: number;
    billableOutputTokens?: number;
    costUsd?: number;
    providerInputCostUsd?: number;
    providerOutputCostUsd?: number;
    providerCostUsd?: number;
    veryfrontInputChargeUsd?: number;
    veryfrontOutputChargeUsd?: number;
    veryfrontChargeUsd?: number;
    veryfrontBilledUsd?: number;
    costCredits?: number;
    costSource?: "gateway" | "missing" | "partial";
    billingMode?: "direct" | "deferred";
    usageCaptureStatus?: "complete" | "partial" | "missing";
  }) => void;
  providerExecutedToolNames?: readonly string[];
  availableToolNames?: readonly string[];
  localToolInputIdleTimeoutMs?: number;
  localToolCommitGraceMs?: number;
  streamIdleTimeoutMs?: number;
  streamLifecycleMode?: StreamLifecycleMode;
  streamLifecyclePolicy?: Partial<StreamLifecyclePolicy>;
  onLifecycleShadowReport?: (report: StreamLifecycleShadowReport) => void;
  /** @internal Host timer seam for deterministic stream-lifecycle tests. */
  setTimeoutFn?: typeof setTimeout;
  /** @internal Host timer seam for deterministic stream-lifecycle tests. */
  clearTimeoutFn?: typeof clearTimeout;
  traceSpanName?: string;
  traceAttributes?: Record<string, TraceAttributeValue>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolInputString(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  return JSON.stringify(input ?? null) ?? "null";
}

function tryParseToolInputObject(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stripLeadingEmptyObjectPlaceholder(input));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function summarizeProviderToolDebugValue(value: unknown): unknown {
  if (value instanceof Error) {
    return sanitizeSerializedError({
      name: value.name,
      message: value.message,
      stack: value.stack,
    });
  }

  if (typeof value === "string") {
    const safe = sanitizeUrlCredentials(value);
    return safe.length > 500 ? `${safe.slice(0, 500)}…` : safe;
  }

  return redactSensitive(value);
}

function resolveToolResultOutput(part: RuntimeStreamPart): unknown {
  if (!isRecord(part) || part.type !== "tool-result") {
    return undefined;
  }

  if ("output" in part) {
    return part.output;
  }

  if ("result" in part) {
    return part.result;
  }

  return undefined;
}

function logProviderToolPart(
  partType: "tool-result" | "tool-error",
  part: {
    toolCallId: string;
    toolName: string;
    providerExecuted?: boolean;
    dynamic?: boolean;
    output?: unknown;
    error?: unknown;
    input?: unknown;
    preliminary?: boolean;
    isError?: boolean;
  },
): void {
  if (!isAnyDebugEnabled({ get: getHostEnv })) {
    return;
  }

  if (part.providerExecuted !== true) {
    return;
  }

  if (part.toolName !== "web_search" && part.toolName !== "web_fetch") {
    return;
  }

  logger.debug("Provider tool stream part observed", {
    partType,
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    providerExecuted: part.providerExecuted,
    dynamic: part.dynamic,
    preliminary: part.preliminary,
    isError: part.isError,
    outputType: typeof part.output,
    errorType: typeof part.error,
    inputType: typeof part.input,
    output: summarizeProviderToolDebugValue(part.output),
    error: summarizeProviderToolDebugValue(part.error),
    input: summarizeProviderToolDebugValue(part.input),
  });
}

function hasStreamOutput(state: ChatStreamState): boolean {
  return state.accumulatedText.length > 0 || state.toolCalls.size > 0 ||
    state.toolResults.length > 0;
}

function shouldIgnoreLateProviderBodyReadError(state: ChatStreamState, error: unknown): boolean {
  return hasStreamOutput(state) && hasCompletedStepSignal(state.finishReason) &&
    isLateProviderBodyReadError(error);
}

async function readNextStreamPart(
  iterator: AsyncIterator<unknown>,
  state: ChatStreamState,
): Promise<IteratorResult<unknown>> {
  try {
    return await iterator.next();
  } catch (error) {
    if (!shouldIgnoreLateProviderBodyReadError(state, error)) {
      throw error;
    }

    logger.warn("Ignoring late provider body read error after completed stream step", {
      finishReason: state.finishReason,
      toolCallCount: state.toolCalls.size,
      toolResultCount: state.toolResults.length,
      textLength: state.accumulatedText.length,
      error: getStreamErrorMessage(error),
    });

    return { done: true, value: undefined };
  }
}

async function readNextStreamPartWithTimeout(
  iterator: AsyncIterator<unknown>,
  state: ChatStreamState,
  timeoutMs: number,
  setTimeoutFn: typeof setTimeout = setTimeout,
  clearTimeoutFn: typeof clearTimeout = clearTimeout,
): Promise<IteratorResult<unknown> | "timeout"> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readNextStreamPart(iterator, state),
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeoutFn(() => resolve("timeout"), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeoutFn(timeoutId);
    }
  }
}

function requestStreamIteratorReturn(iterator: AsyncIterator<unknown>): void {
  const returnResult = iterator.return?.();
  if (!returnResult) {
    return;
  }

  void Promise.resolve(returnResult).catch((error) => {
    logger.warn("Runtime stream iterator return failed after local tool-call handoff", {
      error: getStreamErrorMessage(error),
    });
  });
}

export function createStreamState(): ChatStreamState {
  return {
    accumulatedText: "",
    reasoningParts: [],
    finishReason: null,
    toolCalls: new Map(),
    toolResults: [],
    suppressedToolCalls: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

/**
 * Process the model-runtime fullStream and emit SSE events.
 *
 * Stream parts map directly to our Data Stream Protocol SSE events:
 * - text-delta → text-delta SSE (with id and delta)
 * - tool-input-start → tool-input-start SSE
 * - tool-input-delta → tool-input-delta SSE
 * - tool-call → tool-input-available SSE (accumulated input)
 * - finish → captures finishReason and usage
 */
export interface RuntimeStreamSource {
  open(signal: AbortSignal): RuntimeStreamResult;
}

export function createRuntimeStreamSource(
  open: (signal: AbortSignal) => RuntimeStreamResult,
): RuntimeStreamSource {
  return { open };
}

export function isRuntimeStreamSource(
  value: RuntimeStreamResult | RuntimeStreamSource,
): value is RuntimeStreamSource {
  return typeof value === "object" && value !== null &&
    "open" in value && typeof value.open === "function";
}

export function resolveRuntimeLifecyclePolicy(
  callbacks?: ChatStreamCallbacks,
): StreamLifecyclePolicy {
  const compatibility: Partial<StreamLifecyclePolicy> = {
    ...(callbacks?.streamIdleTimeoutMs === undefined ? {} : {
      firstProgressTimeoutMs: callbacks.streamIdleTimeoutMs,
      semanticIdleTimeoutMs: callbacks.streamIdleTimeoutMs,
    }),
    ...(callbacks?.localToolInputIdleTimeoutMs === undefined
      ? {}
      : { toolInputIdleTimeoutMs: callbacks.localToolInputIdleTimeoutMs }),
  };
  return resolveStreamLifecyclePolicy({
    ...compatibility,
    ...callbacks?.streamLifecyclePolicy,
  });
}

function wrapLegacyRuntimeStreamResult(
  result: RuntimeStreamResult,
): RuntimeStreamResult {
  return {
    ...result,
    fullStream: withToolInputStatusTransitions(result.fullStream),
  };
}

function readTraceAttributeString(
  attributes: Record<string, TraceAttributeValue> | undefined,
  key: string,
): string | undefined {
  const value = attributes?.[key];
  return typeof value === "string" ? value : undefined;
}

function finalizeActiveUnresolvedProviderToolCalls(
  state: ChatStreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
): void {
  const terminalToolCallIds = new Set(
    state.toolResults
      .filter((result) => result.preliminary !== true)
      .map((result) => result.toolCallId),
  );

  for (const toolCall of state.toolCalls.values()) {
    if (
      toolCall.providerExecuted !== true || toolCall.inputAvailable !== true ||
      terminalToolCallIds.has(toolCall.id)
    ) {
      continue;
    }
    sendSSE(controller, encoder, {
      type: "tool-output-error",
      toolCallId: toolCall.id,
      errorText:
        `Provider-executed tool "${toolCall.name}" returned no result before the model turn ended.`,
      providerExecuted: true,
      ...(toolCall.dynamic ? { dynamic: true } : {}),
    });
  }
}

async function processActiveStream(
  source: RuntimeStreamSource,
  state: ChatStreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  textPartId: string | undefined,
  callbacks: ChatStreamCallbacks | undefined,
  abortSignal: AbortSignal | undefined,
): Promise<void> {
  const adapter = createRuntimeStreamProviderAdapter({
    open: (signal) => source.open(signal).fullStream,
    options: {
      availableToolNames: callbacks?.availableToolNames
        ? new Set(callbacks.availableToolNames)
        : null,
      providerExecutedToolNames: new Set(
        callbacks?.providerExecutedToolNames ?? [],
      ),
    },
  });
  const run = runStreamLifecycle({
    provider: adapter,
    policy: resolveRuntimeLifecyclePolicy(callbacks),
    cancellations: abortSignal ? [{ source: "runtime", signal: abortSignal }] : [],
    observer: createStreamLifecycleObserver({
      provider: readTraceAttributeString(
        callbacks?.traceAttributes,
        "gen_ai.provider.name",
      ),
      model: readTraceAttributeString(callbacks?.traceAttributes, "gen_ai.response.model") ??
        readTraceAttributeString(callbacks?.traceAttributes, "gen_ai.request.model"),
      mode: "active",
    }),
  });
  const live = createStreamLifecycleLiveAdapter({ textPartId });
  let deliveryError: unknown;
  let streamOutcome!: StreamOutcome;
  try {
    for await (const frame of run.frames) {
      if (frame.class === "semantic" && frame.event.type === "text_content") {
        callbacks?.onChunk?.(frame.event.delta);
      }
      if (frame.class === "semantic" && frame.event.type === "usage") {
        callbacks?.onUsage?.(toLegacyRuntimeUsage(frame.event.usage));
      }
      for (const event of live.encode(frame)) {
        sendSSE(controller, encoder, event);
      }
    }
  } catch (error) {
    // A delivery failure is the primary run-finalization error. The
    // consumer_stopped Stream Outcome recorded below is secondary cleanup
    // evidence and must never replace it.
    deliveryError = error;
    throw error;
  } finally {
    streamOutcome = await run.outcome;
    state.streamOutcome = streamOutcome;
    if (deliveryError === undefined) {
      applyLifecycleSnapshotToChatStreamState(state, streamOutcome.snapshot);
      finalizeActiveUnresolvedProviderToolCalls(state, controller, encoder);
    }
  }
  if (streamOutcome.status === "failed") {
    throw new StreamLifecycleFailure(streamOutcome.error);
  }
  if (streamOutcome.status === "cancelled" && abortSignal?.aborted) {
    throw abortSignal.reason;
  }
}

interface ProcessStreamInternals {
  createShadow: typeof createStreamLifecycleShadow;
}

const defaultProcessStreamInternals: ProcessStreamInternals = {
  createShadow: createStreamLifecycleShadow,
};

export function processStream(
  result: RuntimeStreamResult | RuntimeStreamSource,
  state: ChatStreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  textPartId: string | undefined,
  callbacks?: ChatStreamCallbacks,
  abortSignal?: AbortSignal,
): Promise<void> {
  return processStreamInternal(
    result,
    state,
    controller,
    encoder,
    textPartId,
    callbacks,
    abortSignal,
    defaultProcessStreamInternals,
  );
}

export function processStreamInternal(
  resultOrSource: RuntimeStreamResult | RuntimeStreamSource,
  state: ChatStreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  textPartId: string | undefined,
  callbacks: ChatStreamCallbacks | undefined,
  abortSignal: AbortSignal | undefined,
  internals: ProcessStreamInternals,
): Promise<void> {
  const traceAttributes = {
    "gen_ai.operation.name": "chat",
    "gen_ai.request.stream": true,
    ...(callbacks?.traceAttributes ?? {}),
  };
  const traceSpanName = callbacks?.traceSpanName ?? "agent.runtime.processStream";

  if (callbacks?.streamLifecycleMode === "active") {
    if (!isRuntimeStreamSource(resultOrSource)) {
      return Promise.reject(
        new TypeError("Active stream lifecycle mode requires a RuntimeStreamSource"),
      );
    }
    return withSpan(
      traceSpanName,
      () =>
        processActiveStream(
          resultOrSource,
          state,
          controller,
          encoder,
          textPartId,
          callbacks,
          abortSignal,
        ),
      traceAttributes,
      { kind: SpanKind.CLIENT },
    );
  }

  // Production legacy streams previously received status parts from the
  // provider wrappers. After Gate 2 the extensions emit raw streams, so the
  // legacy compatibility boundary reinstates the wrapper for source-opened
  // streams only; pre-opened results keep their historical unwrapped shape.
  const result = isRuntimeStreamSource(resultOrSource)
    ? wrapLegacyRuntimeStreamResult(
      resultOrSource.open(abortSignal ?? new AbortController().signal),
    )
    : resultOrSource;

  const process = async () => {
    let eventCount = 0;
    let shadowLifecycle = callbacks?.streamLifecycleMode === "shadow"
      ? internals.createShadow({
        availableToolNames: callbacks?.availableToolNames ?? null,
        providerExecutedToolNames: callbacks?.providerExecutedToolNames ?? [],
      })
      : null;
    let shadowLifecycleFailed = false;
    let textOpen = false;
    let activeTextPartId: string | undefined;
    let nextTextSegmentIndex = 0;
    let activeReasoningId: string | null = null;
    const reasoningParts = new Map<string, StreamingReasoningPart>();
    let shouldStopForCommittedLocalToolCall = false;
    let hasActiveLocalToolInput = false;
    const providerExecutedToolNames = new Set(callbacks?.providerExecutedToolNames ?? []);
    const availableToolNames = callbacks?.availableToolNames
      ? new Set(callbacks.availableToolNames)
      : null;
    const suppressedToolCallIds = new Set<string>();
    // Provider-executed calls whose input completed but whose result has not
    // arrived yet. While any is outstanding the local-tool commit grace must not
    // truncate the stream: the provider result can arrive after a separate HTTP
    // continuation.
    const pendingProviderExecutedToolCallIds = new Set<string>();

    const isUnavailableTool = (toolName: string) =>
      availableToolNames !== null && !availableToolNames.has(toolName);

    const suppressToolCall = (toolCallId: string | undefined, toolName: string) => {
      if (!toolCallId || suppressedToolCallIds.has(toolCallId)) {
        return;
      }
      suppressedToolCallIds.add(toolCallId);
      pendingProviderExecutedToolCallIds.delete(toolCallId);
      state.suppressedToolCalls.push({ id: toolCallId, name: toolName });
    };

    /**
     * Record a provider-executed call as outstanding.
     *
     * Only call this where the tool call reaches `inputAvailable: true`. That
     * keeps the invariant `id ∈ pending ⟹ toolCalls.get(id).inputAvailable`, so
     * `finalizeUnresolvedProviderToolCalls` always drains the set. Tracking a
     * call whose input never completed (or one already suppressed, which no
     * later part will resolve) would leave an id nothing removes, disabling the
     * local-tool commit grace for the rest of the step.
     */
    const trackProviderExecutedToolCall = (
      toolCallId: string | undefined,
      providerExecuted?: boolean,
    ) => {
      if (
        !toolCallId || providerExecuted !== true || suppressedToolCallIds.has(toolCallId)
      ) {
        return;
      }
      pendingProviderExecutedToolCallIds.add(toolCallId);
    };

    /**
     * Close out provider-executed calls the provider never resolved.
     *
     * Without a terminal event the call stays `input-available` forever: the UI
     * card spins and persistence judges the part incomplete and drops it.
     * Emitting an error is honest: there genuinely is no content.
     *
     * The synthesized event is stream-only on purpose. Recording it in
     * `state.toolResults` would make the runtime believe the provider answered:
     * `shouldContinueAfterStreamStep()` would flip to true and bill another
     * model call per unresolved call, and the fabricated result would be
     * persisted into model history. The runtime keeps its unchanged view (no
     * result arrived) while the client still gets a terminal part.
     */
    const finalizeUnresolvedProviderToolCalls = () => {
      if (pendingProviderExecutedToolCallIds.size === 0) {
        return;
      }

      // Ignore any preliminary entries carried in from an older stream state.
      // They are progress, not proof that the provider answered.
      const terminalToolCallIds = new Set(
        state.toolResults
          .filter((result) => result.preliminary !== true)
          .map((result) => result.toolCallId),
      );

      for (const toolCall of state.toolCalls.values()) {
        if (!pendingProviderExecutedToolCallIds.has(toolCall.id)) continue;
        if (toolCall.providerExecuted !== true || toolCall.inputAvailable !== true) continue;
        if (terminalToolCallIds.has(toolCall.id)) continue;
        if (suppressedToolCallIds.has(toolCall.id)) continue;

        sendSSE(controller, encoder, {
          type: "tool-output-error",
          toolCallId: toolCall.id,
          errorText:
            `Provider-executed tool "${toolCall.name}" returned no result before the model turn ended.`,
          providerExecuted: true,
          ...(toolCall.dynamic ? { dynamic: true } : {}),
        });
      }

      pendingProviderExecutedToolCallIds.clear();
    };

    const resolveProviderExecuted = (toolName: string, providerExecuted?: boolean) =>
      providerExecuted ?? (providerExecutedToolNames.has(toolName) ? true : undefined);

    const normalizeReasoningId = (part: { id?: string }) =>
      typeof part.id === "string" && part.id.length > 0 ? part.id : "reasoning";

    const openTextSegment = () => {
      if (textOpen) {
        return;
      }

      textOpen = true;
      activeTextPartId = textPartId === undefined || nextTextSegmentIndex === 0
        ? textPartId
        : `${textPartId}:${nextTextSegmentIndex}`;
      nextTextSegmentIndex += 1;
      sendSSE(controller, encoder, {
        type: "text-start",
        id: activeTextPartId,
      });
    };

    const closeTextSegment = () => {
      if (!textOpen) {
        return;
      }

      textOpen = false;
      sendSSE(controller, encoder, {
        type: "text-end",
        id: activeTextPartId,
      });
      activeTextPartId = undefined;
    };

    const openReasoningSegment = (reasoningId: string) => {
      if (activeReasoningId === reasoningId) {
        return;
      }

      if (activeReasoningId !== null) {
        sendSSE(controller, encoder, {
          type: "reasoning-end",
          id: activeReasoningId,
        });
      }

      activeReasoningId = reasoningId;
      if (!reasoningParts.has(reasoningId)) {
        const part = { id: reasoningId, text: "" };
        reasoningParts.set(reasoningId, part);
        state.reasoningParts.push(part);
      }
      sendSSE(controller, encoder, {
        type: "reasoning-start",
        id: reasoningId,
      });
    };

    const closeReasoningSegment = () => {
      if (activeReasoningId === null) {
        return;
      }

      const reasoningPart = reasoningParts.get(activeReasoningId);
      sendSSE(controller, encoder, {
        type: "reasoning-end",
        id: activeReasoningId,
        ...(reasoningPart?.signature ? { signature: reasoningPart.signature } : {}),
        ...(reasoningPart?.redactedData ? { redactedData: reasoningPart.redactedData } : {}),
      });
      activeReasoningId = null;
    };

    const commitParseablePendingToolInputs = () => {
      for (const tc of state.toolCalls.values()) {
        if (tc.inputAvailable === true || tc.providerExecuted === true) {
          continue;
        }
        // A bare empty-object placeholder (`""` or `"{}"` after stripping
        // transient prefixes) is provisional streamed input that never
        // finalized into a real `tool-call`/`tool-input-end`. Committing it
        // would mark `inputAvailable: true` and execute the tool with empty
        // args. Leave it provisional so the runtime can recover by re-calling
        // the model instead of executing a placeholder.
        const stripped = stripLeadingEmptyObjectPlaceholder(tc.arguments);
        if (stripped === "" || stripped === "{}") {
          continue;
        }
        const parsedInput = tryParseToolInputObject(tc.arguments);
        if (!parsedInput) {
          continue;
        }
        tc.inputAvailable = true;
        const dynamic = tc.dynamic ?? isDynamicTool(tc.name);
        if (dynamic) {
          tc.dynamic = true;
        }
        announceToolInputStart(tc);
        sendSSE(controller, encoder, {
          type: "tool-input-available",
          toolCallId: tc.id,
          toolName: tc.name,
          input: parsedInput,
          ...(tc.providerExecuted !== undefined ? { providerExecuted: tc.providerExecuted } : {}),
          ...(dynamic ? { dynamic: true } : {}),
        });
        shouldStopForCommittedLocalToolCall = true;
      }
    };

    const announceToolInputStart = (toolCall: StreamingToolCall) => {
      announceStreamedToolCallInput(controller, encoder, toolCall);
    };

    const ensureToolLifecycle = (part: {
      toolCallId: string;
      toolName: string;
      input?: unknown;
      providerExecuted?: boolean;
      dynamic?: boolean;
    }) => {
      const dynamic = part.dynamic ?? isDynamicTool(part.toolName);
      const providerExecuted = resolveProviderExecuted(part.toolName, part.providerExecuted);
      const existing = state.toolCalls.get(part.toolCallId);

      if (!existing) {
        const normalizedInput = parseToolInputObject(part.input);
        state.toolCalls.set(part.toolCallId, {
          id: part.toolCallId,
          name: part.toolName,
          arguments: normalizeToolInputString(part.input),
          inputAvailable: true,
          ...(providerExecuted !== undefined ? { providerExecuted } : {}),
          ...(dynamic ? { dynamic: true } : {}),
          inputAnnounced: true,
        });
        sendSSE(controller, encoder, {
          type: "tool-input-start",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          ...(dynamic ? { dynamic: true } : {}),
        });
        sendSSE(controller, encoder, {
          type: "tool-input-available",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: normalizedInput,
          ...(providerExecuted !== undefined ? { providerExecuted } : {}),
          ...(dynamic ? { dynamic: true } : {}),
        });
        return;
      }

      if (existing.inputAvailable) {
        return;
      }

      const resolvedArguments = part.input !== undefined
        ? mergeToolCallInput(existing.arguments, normalizeToolInputString(part.input))
        : existing.arguments;
      const resolvedInput = parseToolInputObject(resolvedArguments);
      existing.arguments = resolvedArguments;
      existing.inputAvailable = true;
      if (providerExecuted !== undefined) {
        existing.providerExecuted = providerExecuted;
      }
      if (dynamic) {
        existing.dynamic = true;
      }

      announceToolInputStart(existing);
      sendSSE(controller, encoder, {
        type: "tool-input-available",
        toolCallId: part.toolCallId,
        toolName: existing.name,
        input: resolvedInput,
        ...(existing.providerExecuted !== undefined
          ? { providerExecuted: existing.providerExecuted }
          : {}),
        ...(existing.dynamic ? { dynamic: true } : {}),
      });
    };

    throwIfAborted(abortSignal);

    // Terminal events for unresolved provider-executed calls must reach the
    // client even when the stream aborts or throws, so the finalizer runs in a
    // `finally`. It runs after the shadow compare so a synthesized event can
    // never perturb the legacy-vs-reducer snapshot the rollout gate reads.
    const streamIterator = result.fullStream[Symbol.asyncIterator]();
    let streamIteratorReturned = false;
    /** Release the upstream iterator exactly once, whichever exit is taken. */
    const returnStreamIteratorOnce = () => {
      if (streamIteratorReturned) {
        return;
      }
      streamIteratorReturned = true;
      requestStreamIteratorReturn(streamIterator);
    };

    try {
      while (true) {
        // A pending provider-executed call outranks the local commit grace: its
        // result can arrive on a later provider continuation request. This picks
        // a longer timeout only. It must not change what a timeout *means*, so
        // the finish-reason classification below stays on the ungated flag.
        const shouldStopForCommittedLocalToolCallNow = shouldStopForCommittedLocalToolCall &&
          pendingProviderExecutedToolCallIds.size === 0;
        const shouldStopForIdleOutput = !hasActiveLocalToolInput &&
          !shouldStopForCommittedLocalToolCallNow && hasStreamOutput(state);
        const shouldStopForIdleStart = !hasActiveLocalToolInput &&
          !shouldStopForCommittedLocalToolCallNow && !hasStreamOutput(state);
        // A timeout means "the turn is over" only when nothing local is in flight
        // and nothing local was committed. Classifying a committed local tool call
        // as "stop" makes shouldContinueAfterStreamStep() bail, so the tool never
        // executes and its card is stranded at input-available.
        const wouldTimeOutIdle = !hasActiveLocalToolInput && !shouldStopForCommittedLocalToolCall;
        const next = hasActiveLocalToolInput
          ? await readNextStreamPartWithTimeout(
            streamIterator,
            state,
            callbacks?.localToolInputIdleTimeoutMs ?? LOCAL_TOOL_INPUT_IDLE_MS,
            callbacks?.setTimeoutFn,
            callbacks?.clearTimeoutFn,
          )
          : shouldStopForCommittedLocalToolCallNow
          ? await readNextStreamPartWithTimeout(
            streamIterator,
            state,
            callbacks?.localToolCommitGraceMs ?? LOCAL_TOOL_COMMIT_GRACE_MS,
            callbacks?.setTimeoutFn,
            callbacks?.clearTimeoutFn,
          )
          : shouldStopForIdleOutput
          ? await readNextStreamPartWithTimeout(
            streamIterator,
            state,
            callbacks?.streamIdleTimeoutMs ?? STREAM_OUTPUT_IDLE_MS,
            callbacks?.setTimeoutFn,
            callbacks?.clearTimeoutFn,
          )
          : shouldStopForIdleStart
          ? await readNextStreamPartWithTimeout(
            streamIterator,
            state,
            callbacks?.streamIdleTimeoutMs ?? STREAM_START_IDLE_MS,
            callbacks?.setTimeoutFn,
            callbacks?.clearTimeoutFn,
          )
          : await readNextStreamPart(streamIterator, state);
        if (next === "timeout") {
          state.finishReason ??= wouldTimeOutIdle ? "stop" : "tool-calls";
          returnStreamIteratorOnce();
          break;
        }
        if (next.done) {
          break;
        }

        const part = next.value;
        throwIfAborted(abortSignal);
        try {
          shadowLifecycle?.observePart(part);
        } catch {
          shadowLifecycleFailed = true;
          shadowLifecycle = null;
        }
        eventCount++;

        if (!isRecord(part) || typeof part.type !== "string") {
          continue;
        }

        const typedPart = part as RuntimeStreamPart;

        if (typedPart.type.startsWith("data-")) {
          sendSSE(controller, encoder, {
            type: typedPart.type,
            data: "data" in typedPart ? typedPart.data : undefined,
          });
          continue;
        }

        switch (typedPart.type) {
          case "text-delta": {
            closeReasoningSegment();
            openTextSegment();
            state.accumulatedText += typedPart.text;
            sendSSE(controller, encoder, {
              type: "text-delta",
              id: activeTextPartId,
              delta: typedPart.text,
            });
            callbacks?.onChunk?.(typedPart.text);
            break;
          }

          case "reasoning-start": {
            closeTextSegment();
            openReasoningSegment(normalizeReasoningId(typedPart));
            break;
          }

          case "reasoning-delta": {
            closeTextSegment();
            const reasoningId = normalizeReasoningId(typedPart);
            openReasoningSegment(reasoningId);
            const reasoningPart = reasoningParts.get(reasoningId);
            if (reasoningPart) {
              reasoningPart.text += typeof typedPart.delta === "string" ? typedPart.delta : "";
            }
            sendSSE(controller, encoder, {
              type: "reasoning-delta",
              id: reasoningId,
              delta: typeof typedPart.delta === "string" ? typedPart.delta : "",
            });
            break;
          }

          case "reasoning-end": {
            closeTextSegment();
            if (activeReasoningId === null) {
              activeReasoningId = normalizeReasoningId(typedPart);
            }
            const reasoningPart = reasoningParts.get(activeReasoningId);
            if (reasoningPart) {
              if (typeof typedPart.signature === "string") {
                reasoningPart.signature = typedPart.signature;
              }
              if (typeof typedPart.redactedData === "string") {
                reasoningPart.redactedData = typedPart.redactedData;
              }
            }
            closeReasoningSegment();
            break;
          }

          case "tool-input-start": {
            closeTextSegment();
            closeReasoningSegment();
            shouldStopForCommittedLocalToolCall = false;
            const toolId = typedPart.id;
            // A restart drops the call back to `inputAvailable: false`, so an
            // earlier tracking of the same id no longer holds. Leaving it pending
            // would disable the local commit grace for the rest of the step.
            pendingProviderExecutedToolCallIds.delete(toolId);
            if (isUnavailableTool(typedPart.toolName)) {
              suppressToolCall(toolId, typedPart.toolName);
              hasActiveLocalToolInput = false;
              break;
            }
            const providerExecuted = resolveProviderExecuted(
              typedPart.toolName,
              typedPart.providerExecuted,
            );
            hasActiveLocalToolInput = providerExecuted !== true;
            state.toolCalls.set(toolId, {
              id: toolId,
              name: typedPart.toolName,
              arguments: "",
              inputAvailable: false,
              providerExecuted,
              dynamic: typedPart.dynamic,
              inputDeltas: [],
              inputAnnounced: false,
            });
            break;
          }

          case "tool-input-delta": {
            closeReasoningSegment();
            const toolId = typedPart.id;
            if (suppressedToolCallIds.has(toolId)) break;
            const tc = state.toolCalls.get(toolId);
            if (!tc) break;

            tc.arguments = mergeToolInputDelta(tc.arguments, typedPart.delta);
            tc.inputDeltas ??= [];
            tc.inputDeltas.push(typedPart.delta);
            break;
          }

          case "tool-input-end": {
            closeTextSegment();
            closeReasoningSegment();
            const toolId = typedPart.id;
            if (suppressedToolCallIds.has(toolId)) {
              hasActiveLocalToolInput = false;
              break;
            }
            const tc = state.toolCalls.get(toolId);
            if (!tc) break;

            tc.inputAvailable = true;
            trackProviderExecutedToolCall(toolId, tc.providerExecuted);
            hasActiveLocalToolInput = false;
            const dynamic = tc.dynamic ?? isDynamicTool(tc.name);
            if (dynamic) {
              tc.dynamic = true;
            }
            announceToolInputStart(tc);
            sendSSE(controller, encoder, {
              type: "tool-input-available",
              toolCallId: toolId,
              toolName: tc.name,
              input: parseToolInputObject(tc.arguments),
              ...(tc.providerExecuted !== undefined
                ? { providerExecuted: tc.providerExecuted }
                : {}),
              ...(dynamic ? { dynamic: true } : {}),
            });
            if (tc.providerExecuted !== true) {
              shouldStopForCommittedLocalToolCall = true;
            }
            break;
          }

          case "tool-input-available": {
            closeTextSegment();
            closeReasoningSegment();
            const toolId = typedPart.toolCallId ?? typedPart.id;
            if (!toolId) {
              break;
            }
            if (isUnavailableTool(typedPart.toolName)) {
              suppressToolCall(toolId, typedPart.toolName);
              hasActiveLocalToolInput = false;
              break;
            }
            const providerExecuted = resolveProviderExecuted(
              typedPart.toolName,
              typedPart.providerExecuted,
            );
            hasActiveLocalToolInput = false;
            trackProviderExecutedToolCall(toolId, providerExecuted);
            const inputStr = normalizeToolInputString(typedPart.input);
            const previous = state.toolCalls.get(toolId);
            const previousArguments = previous?.arguments ?? "";
            const resolvedArguments = mergeToolCallInput(previousArguments, inputStr);
            const wasInputAvailable = previous?.inputAvailable === true;
            const dynamic = typedPart.dynamic ?? isDynamicTool(typedPart.toolName);
            state.toolCalls.set(toolId, {
              id: toolId,
              name: typedPart.toolName,
              arguments: resolvedArguments,
              inputAvailable: true,
              providerExecuted,
              dynamic,
            });

            if (!wasInputAvailable) {
              sendSSE(controller, encoder, {
                type: "tool-input-available",
                toolCallId: toolId,
                toolName: typedPart.toolName,
                input: parseToolInputObject(resolvedArguments),
                ...(providerExecuted !== undefined ? { providerExecuted } : {}),
                ...(dynamic ? { dynamic: true } : {}),
              });
            }
            if (providerExecuted !== true) {
              shouldStopForCommittedLocalToolCall = true;
            }
            break;
          }

          case "tool-call": {
            closeTextSegment();
            closeReasoningSegment();
            // tool-call fires when the full tool call is available
            const toolId = typedPart.toolCallId;
            if (isUnavailableTool(typedPart.toolName)) {
              suppressToolCall(toolId, typedPart.toolName);
              hasActiveLocalToolInput = false;
              break;
            }
            const providerExecuted = resolveProviderExecuted(
              typedPart.toolName,
              typedPart.providerExecuted,
            );
            hasActiveLocalToolInput = false;
            trackProviderExecutedToolCall(toolId, providerExecuted);
            const inputStr = normalizeToolInputString(typedPart.input);
            const previous = state.toolCalls.get(toolId);
            const previousArguments = previous?.arguments ?? "";
            const resolvedArguments = mergeToolCallInput(previousArguments, inputStr);
            const wasInputAvailable = previous?.inputAvailable === true;
            const toolCall: StreamingToolCall = {
              id: toolId,
              name: typedPart.toolName,
              arguments: resolvedArguments,
              inputDeltas: previous?.inputDeltas ?? [],
              inputAnnounced: previous?.inputAnnounced ?? false,
              inputAvailable: true,
              providerExecuted,
              dynamic: typedPart.dynamic,
            };
            state.toolCalls.set(toolId, toolCall);

            const dynamic = isDynamicTool(typedPart.toolName);
            const inputObj = parseToolInputObject(typedPart.input);
            announceToolInputStart(toolCall);
            if (!wasInputAvailable) {
              sendSSE(controller, encoder, {
                type: "tool-input-available",
                toolCallId: toolId,
                toolName: typedPart.toolName,
                input: inputObj,
                ...(providerExecuted !== undefined ? { providerExecuted } : {}),
                ...(dynamic ? { dynamic: true } : {}),
              });
            }
            if (providerExecuted !== true) {
              shouldStopForCommittedLocalToolCall = true;
            }
            break;
          }

          case "tool-result": {
            closeTextSegment();
            closeReasoningSegment();
            if (
              suppressedToolCallIds.has(typedPart.toolCallId) ||
              isUnavailableTool(typedPart.toolName)
            ) {
              suppressToolCall(typedPart.toolCallId, typedPart.toolName);
              break;
            }
            const providerExecuted = resolveProviderExecuted(
              typedPart.toolName,
              typedPart.providerExecuted,
            );
            if (
              typedPart.preliminary !== true && providerExecuted === true &&
              state.toolResults.some((result) =>
                result.toolCallId === typedPart.toolCallId && result.preliminary !== true
              )
            ) {
              break;
            }
            // A preliminary result is not terminal: the provider is still
            // working. Releasing the call here would re-arm the local commit
            // grace and truncate the stream before the final result arrives,
            // which is the failure this tracking exists to prevent.
            if (typedPart.preliminary !== true) {
              pendingProviderExecutedToolCallIds.delete(typedPart.toolCallId);
            }
            ensureToolLifecycle({
              toolCallId: typedPart.toolCallId,
              toolName: typedPart.toolName,
              input: typedPart.input,
              providerExecuted,
              dynamic: typedPart.dynamic,
            });
            const toolResultOutput = resolveToolResultOutput(typedPart);
            const inferredToolError = getToolResultError(toolResultOutput);
            const isExplicitError = typedPart.isError === true &&
              !isIntegrationAuthenticationActionResult(toolResultOutput);
            const isError = isExplicitError || inferredToolError !== undefined;
            const toolResultError = isExplicitError
              ? toolResultOutput
              : inferredToolError ?? toolResultOutput;
            logProviderToolPart("tool-result", {
              toolCallId: typedPart.toolCallId,
              toolName: typedPart.toolName,
              providerExecuted,
              dynamic: typedPart.dynamic,
              output: toolResultOutput,
              input: typedPart.input,
              preliminary: typedPart.preliminary,
              isError,
            });
            // Preliminary provider output is progress, not a terminal tool
            // result. Keep the call pending without exposing a success-shaped
            // result to live clients, durable history, or continuation input.
            if (typedPart.preliminary === true) break;
            if (isError) {
              state.toolResults.push({
                toolCallId: typedPart.toolCallId,
                toolName: typedPart.toolName,
                error: toolResultError,
                ...(providerExecuted !== undefined ? { providerExecuted } : {}),
                ...(typedPart.dynamic ? { dynamic: true } : {}),
              });
              sendSSE(controller, encoder, {
                type: "tool-output-error",
                toolCallId: typedPart.toolCallId,
                errorText: stringifyToolError(toolResultError),
                ...(providerExecuted !== undefined ? { providerExecuted } : {}),
                ...(typedPart.dynamic ? { dynamic: true } : {}),
              });
              break;
            }

            state.toolResults.push({
              toolCallId: typedPart.toolCallId,
              toolName: typedPart.toolName,
              output: toolResultOutput,
              ...(providerExecuted !== undefined ? { providerExecuted } : {}),
              ...(typedPart.dynamic ? { dynamic: true } : {}),
              ...(typedPart.preliminary !== undefined
                ? { preliminary: typedPart.preliminary }
                : {}),
            });
            sendSSE(controller, encoder, {
              type: "tool-output-available",
              toolCallId: typedPart.toolCallId,
              output: toolResultOutput,
              ...(providerExecuted !== undefined ? { providerExecuted } : {}),
              ...(typedPart.dynamic ? { dynamic: true } : {}),
              ...(typedPart.preliminary !== undefined
                ? { preliminary: typedPart.preliminary }
                : {}),
            });
            break;
          }

          case "tool-error": {
            closeTextSegment();
            closeReasoningSegment();
            const providerExecuted = resolveProviderExecuted(
              typedPart.toolName,
              typedPart.providerExecuted,
            );
            if (
              providerExecuted === true &&
              state.toolResults.some((result) =>
                result.toolCallId === typedPart.toolCallId && result.preliminary !== true
              )
            ) {
              break;
            }
            pendingProviderExecutedToolCallIds.delete(typedPart.toolCallId);
            ensureToolLifecycle({
              toolCallId: typedPart.toolCallId,
              toolName: typedPart.toolName,
              input: typedPart.input,
              providerExecuted,
              dynamic: typedPart.dynamic,
            });
            logProviderToolPart("tool-error", {
              toolCallId: typedPart.toolCallId,
              toolName: typedPart.toolName,
              providerExecuted,
              dynamic: typedPart.dynamic,
              error: typedPart.error,
              input: typedPart.input,
            });
            state.toolResults.push({
              toolCallId: typedPart.toolCallId,
              toolName: typedPart.toolName,
              error: typedPart.error,
              ...(providerExecuted !== undefined ? { providerExecuted } : {}),
              ...(typedPart.dynamic ? { dynamic: true } : {}),
            });
            sendSSE(controller, encoder, {
              type: "tool-output-error",
              toolCallId: typedPart.toolCallId,
              errorText: stringifyToolError(typedPart.error),
              ...(providerExecuted !== undefined ? { providerExecuted } : {}),
              ...(typedPart.dynamic ? { dynamic: true } : {}),
            });
            break;
          }

          case "finish": {
            closeTextSegment();
            closeReasoningSegment();
            state.finishReason = typedPart.finishReason ?? null;
            state.providerMetadata = typedPart.providerMetadata;
            if (state.finishReason) {
              setActiveSpanAttributes({
                "gen_ai.response.finish_reasons": [state.finishReason],
              });
            }
            if (state.finishReason === "tool-calls") {
              commitParseablePendingToolInputs();
            }
            if (typedPart.totalUsage) {
              const input = typedPart.totalUsage.inputTokens ?? 0;
              const output = typedPart.totalUsage.outputTokens ?? 0;
              const cacheReadInputTokens = typedPart.totalUsage.cacheReadInputTokens;
              const cacheCreationInputTokens = typedPart.totalUsage.cacheCreationInputTokens;
              const cachedInputTokens = typedPart.totalUsage.cachedInputTokens ??
                cacheReadInputTokens;
              state.usage = {
                promptTokens: input,
                completionTokens: output,
                totalTokens: typedPart.totalUsage.totalTokens ?? input + output,
                ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
                ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
                ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
                ...(typedPart.totalUsage.reasoningTokens !== undefined
                  ? { reasoningTokens: typedPart.totalUsage.reasoningTokens }
                  : {}),
                ...(typedPart.totalUsage.billableInputTokens !== undefined
                  ? { billableInputTokens: typedPart.totalUsage.billableInputTokens }
                  : {}),
                ...(typedPart.totalUsage.billableOutputTokens !== undefined
                  ? { billableOutputTokens: typedPart.totalUsage.billableOutputTokens }
                  : {}),
                ...(typedPart.totalUsage.costUsd !== undefined
                  ? { costUsd: typedPart.totalUsage.costUsd }
                  : {}),
                ...(typedPart.totalUsage.providerInputCostUsd !== undefined
                  ? { providerInputCostUsd: typedPart.totalUsage.providerInputCostUsd }
                  : {}),
                ...(typedPart.totalUsage.providerOutputCostUsd !== undefined
                  ? { providerOutputCostUsd: typedPart.totalUsage.providerOutputCostUsd }
                  : {}),
                ...(typedPart.totalUsage.providerCostUsd !== undefined
                  ? { providerCostUsd: typedPart.totalUsage.providerCostUsd }
                  : {}),
                ...(typedPart.totalUsage.veryfrontInputChargeUsd !== undefined
                  ? { veryfrontInputChargeUsd: typedPart.totalUsage.veryfrontInputChargeUsd }
                  : {}),
                ...(typedPart.totalUsage.veryfrontOutputChargeUsd !== undefined
                  ? { veryfrontOutputChargeUsd: typedPart.totalUsage.veryfrontOutputChargeUsd }
                  : {}),
                ...(typedPart.totalUsage.veryfrontChargeUsd !== undefined
                  ? { veryfrontChargeUsd: typedPart.totalUsage.veryfrontChargeUsd }
                  : {}),
                ...(typedPart.totalUsage.veryfrontBilledUsd !== undefined
                  ? { veryfrontBilledUsd: typedPart.totalUsage.veryfrontBilledUsd }
                  : {}),
                ...(typedPart.totalUsage.costCredits !== undefined
                  ? { costCredits: typedPart.totalUsage.costCredits }
                  : {}),
                ...(typedPart.totalUsage.costSource !== undefined
                  ? { costSource: typedPart.totalUsage.costSource }
                  : {}),
                ...(typedPart.totalUsage.billingMode !== undefined
                  ? { billingMode: typedPart.totalUsage.billingMode }
                  : {}),
                ...(typedPart.totalUsage.usageCaptureStatus !== undefined
                  ? { usageCaptureStatus: typedPart.totalUsage.usageCaptureStatus }
                  : {}),
              };
              callbacks?.onUsage?.(state.usage);
              setActiveSpanAttributes(buildRuntimeUsageTraceAttributes(state.usage));
            }
            break;
          }

          case "error": {
            closeTextSegment();
            closeReasoningSegment();
            logger.warn("Runtime stream error:", typedPart.error);
            sendSSE(controller, encoder, resolveRuntimeStreamErrorEvent(typedPart.error));
            break;
          }

          default:
            // Ignore other stream parts (source, file, reasoning-*, etc.)
            break;
        }

        throwIfAborted(abortSignal);
      }

      throwIfAborted(abortSignal);

      if (callbacks?.streamLifecycleMode === "shadow") {
        let observed: StreamLifecycleShadowReport = { count: 0, categories: [] };
        try {
          observed = shadowLifecycle?.compareLegacySnapshot(state) ?? observed;
        } catch {
          shadowLifecycleFailed = true;
        }
        const categories = new Set<StreamLifecycleShadowDivergence>(
          observed.categories,
        );
        if (shadowLifecycleFailed) categories.add("shadow_error");
        const report: StreamLifecycleShadowReport = {
          count: categories.size,
          categories: [...categories].sort(compareStrings),
        };
        callbacks.onLifecycleShadowReport?.(report);
        setActiveSpanAttributes({
          "stream.lifecycle_shadow.divergence_count": report.count,
          "stream.lifecycle_shadow.divergence_categories": [...report.categories],
        });
      }
    } finally {
      finalizeUnresolvedProviderToolCalls();
      // `throwIfAborted` and `streamIterator.next()` can both throw past the
      // loop, so the upstream iterator is released here rather than only on the
      // timeout path.
      returnStreamIteratorOnce();
    }

    setActiveSpanAttributes({
      "stream.event_count": eventCount,
      "stream.tool_calls": state.toolCalls.size,
      "stream.text_length": state.accumulatedText.length,
    });
  };

  return withSpan(traceSpanName, process, traceAttributes, { kind: SpanKind.CLIENT });
}
