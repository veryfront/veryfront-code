import type { AgentResponse } from "../types.ts";

/** Event emitted for AG-UI runtime stream. */
export type AgUiRuntimeStreamEvent = Record<string, unknown> & { type: string };

/** Public API contract for AG-UI run finished metadata. */
export interface AgUiRunFinishedMetadata {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
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
  finishReason?: string;
  usageCaptureStatus?: "complete" | "partial" | "missing";
}

/** State for AG-UI encoder. */
export interface AgUiEncoderState {
  messageId: string | null;
  textOpen: boolean;
  activeTextContentId: string | null;
  textContentIndex: number;
  reasoningMessageId: string | null;
  /**
   * How many reasoning spans have opened in this run. Optional so a state
   * object built before this counter existed stays valid; absent reads as 0.
   */
  reasoningSpanIndex?: number;
  activeStepName: string | null;
  stepCount: number;
  streamedToolInputIds: Set<string>;
  /**
   * Tool calls whose `ToolCallStart` has been emitted but not yet closed with
   * a `ToolCallEnd`. Distinct from `streamedToolInputIds`, which tracks
   * whether any args were streamed, not whether the call is still open.
   *
   * Optional, and populated lazily, so a state object built against the shape
   * this type had before the tracker existed stays valid — the same reason
   * `reasoningSpanIndex` above is optional. This type is re-exported from
   * `veryfront/agent`, so a required field would crash existing callers on the
   * first `tool-input-start`.
   */
  openToolCallIds?: Set<string>;
  sawVisibleOutput: boolean;
  sawTerminalError: boolean;
  metadata: AgUiRunFinishedMetadata;
  /**
   * Clock for `elapsedMs`, and the run-relative anchor it measures from. Absent
   * only when a caller opts out; see `createAgUiEncoderState`.
   */
  nowMs?: () => number;
  startedMs?: number;
  /**
   * Wall clock for `emittedAt`, in epoch milliseconds. Separate from `nowMs`
   * because the two answer different questions and fail differently:
   * `elapsedMs` is monotonic and safe for durations inside one run, while
   * `emittedAt` is comparable across events, runs and services but can move
   * backwards if the host clock is adjusted.
   */
  epochMs?: () => number;
}

/** Options for create AG-UI encoder state. */
export interface AgUiEncoderStateOptions {
  /**
   * Clock used to stamp `elapsedMs`. Defaults to `performance.now`. Pass null
   * to omit the stamp, which keeps exact-payload assertions deterministic.
   */
  nowMs?: (() => number) | null;
  /**
   * Wall clock used to stamp `emittedAt`, in epoch milliseconds. Defaults to
   * `Date.now`. Pass null to omit the stamp.
   */
  epochMs?: (() => number) | null;
  startedMs?: number;
}

/** Event emitted for AG-UI encoded. */
export interface AgUiEncodedEvent {
  event: string;
  payload: Record<string, unknown>;
}

/** State for create AG-UI encoder. */
export function createAgUiEncoderState(
  options: AgUiEncoderStateOptions = {},
): AgUiEncoderState {
  // Clocked by default. This state is built at three separate composition
  // roots, so an opt-in clock only has to be forgotten once to lose elapsedMs
  // for every run -- which is exactly what happened twice before.
  const nowMs = options.nowMs === null ? undefined : options.nowMs ?? (() => performance.now());
  const epochMs = options.epochMs === null ? undefined : options.epochMs ?? (() => Date.now());
  return {
    ...(nowMs ? { nowMs, startedMs: options.startedMs ?? nowMs() } : {}),
    ...(epochMs ? { epochMs } : {}),
    messageId: null,
    textOpen: false,
    activeTextContentId: null,
    textContentIndex: 0,
    reasoningMessageId: null,
    reasoningSpanIndex: 0,
    activeStepName: null,
    stepCount: 0,
    streamedToolInputIds: new Set<string>(),
    openToolCallIds: new Set<string>(),
    sawVisibleOutput: false,
    sawTerminalError: false,
    metadata: {},
  };
}

function serializeToolInput(input: unknown): string {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "{}";
  }
}

function getMessageId(state: AgUiEncoderState, event: AgUiRuntimeStreamEvent): string {
  if (typeof event.messageId === "string") {
    state.messageId = event.messageId;
    return event.messageId;
  }

  if (!state.messageId && typeof event.id === "string") {
    state.messageId = event.id;
  }

  if (!state.messageId) {
    state.messageId = crypto.randomUUID();
  }

  return state.messageId;
}

// A reasoning span is identified by its position in the run, not by the
// provider's part id. Providers restart part ids at `reasoning-0` on every step,
// so a part-id-derived id collides across every span of a multi-step run.
// Ordinals also match the scheme veryfront-api uses when it rebuilds these
// events for snapshots and terminal replay, so one span keeps one id whichever
// path renders it.
function openReasoningMessageId(state: AgUiEncoderState): string {
  const index = state.reasoningSpanIndex ?? 0;
  state.reasoningSpanIndex = index + 1;
  state.reasoningMessageId = state.messageId
    ? `${state.messageId}:reasoning:${index}`
    : `reasoning:${index}`;
  return state.reasoningMessageId;
}

function getReasoningMessageId(
  state: AgUiEncoderState,
  intent: "open" | "continue",
): string {
  // Deltas and ends belong to the span that is already open, whatever part id
  // they carry. Only a start — or a delta with nothing open — begins a new one.
  if (intent === "continue" && state.reasoningMessageId !== null) {
    return state.reasoningMessageId;
  }

  return openReasoningMessageId(state);
}

function getTextMessageIdentity(
  state: AgUiEncoderState,
  event: AgUiRuntimeStreamEvent,
): { messageId: string; contentId: string } {
  const previousMessageId = state.messageId;
  const explicitMessageId = typeof event.messageId === "string" && event.messageId.length > 0
    ? event.messageId
    : null;
  const messageId = getMessageId(state, event);
  const explicitContentId = typeof event.contentId === "string" && event.contentId.length > 0
    ? event.contentId
    : null;
  const eventId = typeof event.id === "string" && event.id.length > 0 ? event.id : null;
  const contentId = explicitContentId ??
    (eventId && eventId !== messageId && (explicitMessageId || previousMessageId)
      ? eventId
      : null) ??
    (state.textOpen && state.activeTextContentId ? state.activeTextContentId : null) ??
    `text:${state.textContentIndex++}`;

  return {
    messageId,
    contentId,
  };
}

function getCandidateTextMessageIdentity(
  state: AgUiEncoderState,
  event: AgUiRuntimeStreamEvent,
): { messageId: string | null; contentId: string | null } {
  const explicitMessageId = typeof event.messageId === "string" && event.messageId.length > 0
    ? event.messageId
    : null;
  const messageId = explicitMessageId ?? state.messageId ??
    (typeof event.id === "string" && event.id.length > 0 ? event.id : null);
  const explicitContentId = typeof event.contentId === "string" && event.contentId.length > 0
    ? event.contentId
    : null;
  const eventId = typeof event.id === "string" && event.id.length > 0 ? event.id : null;
  const contentId = explicitContentId ??
    (eventId && messageId && eventId !== messageId && (explicitMessageId || state.messageId)
      ? eventId
      : null) ??
    state.activeTextContentId;

  return { messageId, contentId };
}

function isActiveTextIdentity(
  state: AgUiEncoderState,
  event: AgUiRuntimeStreamEvent,
): boolean {
  const identity = getCandidateTextMessageIdentity(state, event);
  return identity.messageId === state.messageId && identity.contentId === state.activeTextContentId;
}

function nextStepName(state: AgUiEncoderState): string {
  state.stepCount += 1;
  state.activeStepName = `step-${state.stepCount}`;
  return state.activeStepName;
}

function finishStepName(state: AgUiEncoderState): string {
  const stepName = state.activeStepName ?? `step-${Math.max(state.stepCount, 1)}`;
  state.activeStepName = null;
  return stepName;
}

function applyDataMetadata(state: AgUiEncoderState, event: AgUiRuntimeStreamEvent): void {
  const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : event;

  if (typeof data.model === "string") {
    state.metadata.model = data.model;
    const provider = data.model.split("/")[0];
    if (provider) {
      state.metadata.provider = provider;
    }
  }
}

function applyResponseMetadata(
  state: AgUiEncoderState,
  response: AgentResponse | null,
): void {
  if (!response) return;

  if (response.usage) {
    state.metadata.inputTokens = response.usage.promptTokens;
    state.metadata.outputTokens = response.usage.completionTokens;
    state.metadata.totalTokens = response.usage.totalTokens;
    const usage = response.usage as typeof response.usage & AgUiRunFinishedMetadata;
    if (typeof response.usage.cachedInputTokens === "number") {
      state.metadata.cachedInputTokens = response.usage.cachedInputTokens;
    } else if (typeof response.usage.cacheReadInputTokens === "number") {
      state.metadata.cachedInputTokens = response.usage.cacheReadInputTokens;
    }
    if (typeof response.usage.cacheCreationInputTokens === "number") {
      state.metadata.cacheCreationInputTokens = response.usage.cacheCreationInputTokens;
    }
    if (typeof response.usage.cacheReadInputTokens === "number") {
      state.metadata.cacheReadInputTokens = response.usage.cacheReadInputTokens;
    }
    if (typeof response.usage.reasoningTokens === "number") {
      state.metadata.reasoningTokens = response.usage.reasoningTokens;
    }
    if (typeof usage.billableInputTokens === "number") {
      state.metadata.billableInputTokens = usage.billableInputTokens;
    }
    if (typeof usage.billableOutputTokens === "number") {
      state.metadata.billableOutputTokens = usage.billableOutputTokens;
    }
    if (typeof usage.costUsd === "number") {
      state.metadata.costUsd = usage.costUsd;
    }
    if (typeof usage.providerInputCostUsd === "number") {
      state.metadata.providerInputCostUsd = usage.providerInputCostUsd;
    }
    if (typeof usage.providerOutputCostUsd === "number") {
      state.metadata.providerOutputCostUsd = usage.providerOutputCostUsd;
    }
    if (typeof usage.providerCostUsd === "number") {
      state.metadata.providerCostUsd = usage.providerCostUsd;
    }
    if (typeof usage.veryfrontInputChargeUsd === "number") {
      state.metadata.veryfrontInputChargeUsd = usage.veryfrontInputChargeUsd;
    }
    if (typeof usage.veryfrontOutputChargeUsd === "number") {
      state.metadata.veryfrontOutputChargeUsd = usage.veryfrontOutputChargeUsd;
    }
    if (typeof usage.veryfrontChargeUsd === "number") {
      state.metadata.veryfrontChargeUsd = usage.veryfrontChargeUsd;
    }
    if (typeof usage.veryfrontBilledUsd === "number") {
      state.metadata.veryfrontBilledUsd = usage.veryfrontBilledUsd;
    }
    if (typeof usage.costCredits === "number") {
      state.metadata.costCredits = usage.costCredits;
    }
    if (usage.costSource) {
      state.metadata.costSource = usage.costSource;
    }
    if (usage.billingMode) {
      state.metadata.billingMode = usage.billingMode;
    }
    if (usage.usageCaptureStatus) {
      state.metadata.usageCaptureStatus = usage.usageCaptureStatus;
    }
  }

  const metadata = response.metadata && typeof response.metadata === "object"
    ? response.metadata
    : undefined;
  const finishReason = metadata?.finishReason;
  if (typeof finishReason === "string") {
    state.metadata.finishReason = finishReason;
  }
  const costUsd = metadata?.costUsd;
  if (typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd >= 0) {
    state.metadata.costUsd = costUsd;
  }
  const providerCostUsd = metadata?.providerCostUsd;
  if (
    typeof providerCostUsd === "number" && Number.isFinite(providerCostUsd) && providerCostUsd >= 0
  ) {
    state.metadata.providerCostUsd = providerCostUsd;
  }
  const providerInputCostUsd = metadata?.providerInputCostUsd;
  if (
    typeof providerInputCostUsd === "number" && Number.isFinite(providerInputCostUsd) &&
    providerInputCostUsd >= 0
  ) {
    state.metadata.providerInputCostUsd = providerInputCostUsd;
  }
  const providerOutputCostUsd = metadata?.providerOutputCostUsd;
  if (
    typeof providerOutputCostUsd === "number" && Number.isFinite(providerOutputCostUsd) &&
    providerOutputCostUsd >= 0
  ) {
    state.metadata.providerOutputCostUsd = providerOutputCostUsd;
  }
  const veryfrontChargeUsd = metadata?.veryfrontChargeUsd;
  if (
    typeof veryfrontChargeUsd === "number" && Number.isFinite(veryfrontChargeUsd) &&
    veryfrontChargeUsd >= 0
  ) {
    state.metadata.veryfrontChargeUsd = veryfrontChargeUsd;
  }
  const veryfrontInputChargeUsd = metadata?.veryfrontInputChargeUsd;
  if (
    typeof veryfrontInputChargeUsd === "number" && Number.isFinite(veryfrontInputChargeUsd) &&
    veryfrontInputChargeUsd >= 0
  ) {
    state.metadata.veryfrontInputChargeUsd = veryfrontInputChargeUsd;
  }
  const veryfrontOutputChargeUsd = metadata?.veryfrontOutputChargeUsd;
  if (
    typeof veryfrontOutputChargeUsd === "number" && Number.isFinite(veryfrontOutputChargeUsd) &&
    veryfrontOutputChargeUsd >= 0
  ) {
    state.metadata.veryfrontOutputChargeUsd = veryfrontOutputChargeUsd;
  }
  const veryfrontBilledUsd = metadata?.veryfrontBilledUsd;
  if (
    typeof veryfrontBilledUsd === "number" && Number.isFinite(veryfrontBilledUsd) &&
    veryfrontBilledUsd >= 0
  ) {
    state.metadata.veryfrontBilledUsd = veryfrontBilledUsd;
  }
  const costCredits = metadata?.costCredits;
  if (typeof costCredits === "number" && Number.isFinite(costCredits) && costCredits >= 0) {
    state.metadata.costCredits = costCredits;
  }
  const billableInputTokens = metadata?.billableInputTokens;
  if (
    typeof billableInputTokens === "number" && Number.isFinite(billableInputTokens) &&
    billableInputTokens >= 0
  ) {
    state.metadata.billableInputTokens = billableInputTokens;
  }
  const billableOutputTokens = metadata?.billableOutputTokens;
  if (
    typeof billableOutputTokens === "number" && Number.isFinite(billableOutputTokens) &&
    billableOutputTokens >= 0
  ) {
    state.metadata.billableOutputTokens = billableOutputTokens;
  }
  const costSource = metadata?.costSource;
  if (costSource === "gateway" || costSource === "missing" || costSource === "partial") {
    state.metadata.costSource = costSource;
  }
  const billingMode = metadata?.billingMode;
  if (billingMode === "direct" || billingMode === "deferred") {
    state.metadata.billingMode = billingMode;
  }
  const usageCaptureStatus = metadata?.usageCaptureStatus;
  if (
    usageCaptureStatus === "complete" ||
    usageCaptureStatus === "partial" ||
    usageCaptureStatus === "missing"
  ) {
    state.metadata.usageCaptureStatus = usageCaptureStatus;
  }
}

/** Response payload for build AG-UI finalize. */
export function buildAgUiFinalizeResponse(
  metadata: AgUiRunFinishedMetadata,
): AgentResponse | null {
  const responseMetadata: Record<string, unknown> = {};
  if (typeof metadata.finishReason === "string" && metadata.finishReason.length > 0) {
    responseMetadata.finishReason = metadata.finishReason;
  }
  if (typeof metadata.cachedInputTokens === "number") {
    responseMetadata.cachedInputTokens = metadata.cachedInputTokens;
  }
  if (typeof metadata.cacheCreationInputTokens === "number") {
    responseMetadata.cacheCreationInputTokens = metadata.cacheCreationInputTokens;
  }
  if (typeof metadata.cacheReadInputTokens === "number") {
    responseMetadata.cacheReadInputTokens = metadata.cacheReadInputTokens;
  }
  if (typeof metadata.reasoningTokens === "number") {
    responseMetadata.reasoningTokens = metadata.reasoningTokens;
  }
  if (typeof metadata.billableInputTokens === "number") {
    responseMetadata.billableInputTokens = metadata.billableInputTokens;
  }
  if (typeof metadata.billableOutputTokens === "number") {
    responseMetadata.billableOutputTokens = metadata.billableOutputTokens;
  }
  if (typeof metadata.costUsd === "number") {
    responseMetadata.costUsd = metadata.costUsd;
  }
  if (typeof metadata.providerCostUsd === "number") {
    responseMetadata.providerCostUsd = metadata.providerCostUsd;
  }
  if (typeof metadata.providerInputCostUsd === "number") {
    responseMetadata.providerInputCostUsd = metadata.providerInputCostUsd;
  }
  if (typeof metadata.providerOutputCostUsd === "number") {
    responseMetadata.providerOutputCostUsd = metadata.providerOutputCostUsd;
  }
  if (typeof metadata.veryfrontChargeUsd === "number") {
    responseMetadata.veryfrontChargeUsd = metadata.veryfrontChargeUsd;
  }
  if (typeof metadata.veryfrontInputChargeUsd === "number") {
    responseMetadata.veryfrontInputChargeUsd = metadata.veryfrontInputChargeUsd;
  }
  if (typeof metadata.veryfrontOutputChargeUsd === "number") {
    responseMetadata.veryfrontOutputChargeUsd = metadata.veryfrontOutputChargeUsd;
  }
  if (typeof metadata.veryfrontBilledUsd === "number") {
    responseMetadata.veryfrontBilledUsd = metadata.veryfrontBilledUsd;
  }
  if (typeof metadata.costCredits === "number") {
    responseMetadata.costCredits = metadata.costCredits;
  }
  if (metadata.costSource) {
    responseMetadata.costSource = metadata.costSource;
  }
  if (metadata.billingMode) {
    responseMetadata.billingMode = metadata.billingMode;
  }
  if (metadata.usageCaptureStatus) {
    responseMetadata.usageCaptureStatus = metadata.usageCaptureStatus;
  }

  const usage = typeof metadata.inputTokens === "number" ||
      typeof metadata.outputTokens === "number" ||
      typeof metadata.totalTokens === "number"
    ? {
      promptTokens: metadata.inputTokens ?? 0,
      completionTokens: metadata.outputTokens ?? 0,
      totalTokens: metadata.totalTokens ??
        ((metadata.inputTokens ?? 0) + (metadata.outputTokens ?? 0)),
      ...(typeof metadata.cachedInputTokens === "number"
        ? { cachedInputTokens: metadata.cachedInputTokens }
        : {}),
      ...(typeof metadata.cacheCreationInputTokens === "number"
        ? { cacheCreationInputTokens: metadata.cacheCreationInputTokens }
        : {}),
      ...(typeof metadata.cacheReadInputTokens === "number"
        ? { cacheReadInputTokens: metadata.cacheReadInputTokens }
        : {}),
      ...(typeof metadata.reasoningTokens === "number"
        ? { reasoningTokens: metadata.reasoningTokens }
        : {}),
      ...(typeof metadata.billableInputTokens === "number"
        ? { billableInputTokens: metadata.billableInputTokens }
        : {}),
      ...(typeof metadata.billableOutputTokens === "number"
        ? { billableOutputTokens: metadata.billableOutputTokens }
        : {}),
      ...(typeof metadata.costUsd === "number" ? { costUsd: metadata.costUsd } : {}),
      ...(typeof metadata.providerInputCostUsd === "number"
        ? { providerInputCostUsd: metadata.providerInputCostUsd }
        : {}),
      ...(typeof metadata.providerOutputCostUsd === "number"
        ? { providerOutputCostUsd: metadata.providerOutputCostUsd }
        : {}),
      ...(typeof metadata.providerCostUsd === "number"
        ? { providerCostUsd: metadata.providerCostUsd }
        : {}),
      ...(typeof metadata.veryfrontInputChargeUsd === "number"
        ? { veryfrontInputChargeUsd: metadata.veryfrontInputChargeUsd }
        : {}),
      ...(typeof metadata.veryfrontOutputChargeUsd === "number"
        ? { veryfrontOutputChargeUsd: metadata.veryfrontOutputChargeUsd }
        : {}),
      ...(typeof metadata.veryfrontChargeUsd === "number"
        ? { veryfrontChargeUsd: metadata.veryfrontChargeUsd }
        : {}),
      ...(typeof metadata.veryfrontBilledUsd === "number"
        ? { veryfrontBilledUsd: metadata.veryfrontBilledUsd }
        : {}),
      ...(typeof metadata.costCredits === "number" ? { costCredits: metadata.costCredits } : {}),
      ...(metadata.costSource ? { costSource: metadata.costSource } : {}),
      ...(metadata.billingMode ? { billingMode: metadata.billingMode } : {}),
      ...(metadata.usageCaptureStatus ? { usageCaptureStatus: metadata.usageCaptureStatus } : {}),
    }
    : undefined;

  if (!usage && Object.keys(responseMetadata).length === 0) {
    return null;
  }

  return {
    text: "",
    messages: [],
    toolCalls: [],
    status: "completed",
    ...(usage ? { usage } : {}),
    ...(Object.keys(responseMetadata).length > 0 ? { metadata: responseMetadata } : {}),
  };
}

/**
 * Emit the `ToolCallEnd` for a call whose input never reached a terminal
 * input event. Returns nothing when the call was already closed, so a normal
 * tool failure does not produce a second end.
 */
function closeOpenToolInput(
  state: AgUiEncoderState,
  toolCallId: unknown,
): AgUiEncodedEvent[] {
  if (typeof toolCallId !== "string" || toolCallId.length === 0) return [];
  if (state.openToolCallIds?.delete(toolCallId) !== true) return [];
  state.streamedToolInputIds.delete(toolCallId);
  return [{ event: "ToolCallEnd", payload: { toolCallId } }];
}

function completeToolInput(
  state: AgUiEncoderState,
  event: AgUiRuntimeStreamEvent,
): AgUiEncodedEvent[] {
  const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
  const events: AgUiEncodedEvent[] = [];

  if (toolCallId.length > 0 && !state.streamedToolInputIds.has(toolCallId)) {
    events.push({
      event: "ToolCallArgs",
      payload: {
        toolCallId,
        delta: serializeToolInput("input" in event ? event.input : {}),
      },
    });
  }

  if (toolCallId.length > 0) {
    state.streamedToolInputIds.delete(toolCallId);
    state.openToolCallIds?.delete(toolCallId);
  }

  events.push({
    event: "ToolCallEnd",
    payload: { toolCallId: event.toolCallId },
  });

  return events;
}

function createToolResultEvent(
  toolCallId: unknown,
  result: Record<string, unknown> | unknown,
  isError = false,
): AgUiEncodedEvent {
  return {
    event: "ToolCallResult",
    payload: {
      toolCallId,
      result,
      ...(isError ? { isError: true } : {}),
    },
  };
}

function createCustomDataEvent(
  name: string,
  value: unknown,
): AgUiEncodedEvent {
  return {
    event: "Custom",
    payload: { name, value },
  };
}

function createStepEvent(
  state: AgUiEncoderState,
  type: "StepStarted" | "StepFinished",
): AgUiEncodedEvent {
  return {
    event: type,
    payload: {
      stepName: type === "StepStarted" ? nextStepName(state) : finishStepName(state),
    },
  };
}

function createReasoningEvent(
  state: AgUiEncoderState,
  event: AgUiRuntimeStreamEvent,
  type: "ReasoningMessageStart" | "ReasoningMessageContent" | "ReasoningMessageEnd",
): AgUiEncodedEvent {
  const messageId = getReasoningMessageId(
    state,
    type === "ReasoningMessageStart" ? "open" : "continue",
  );
  return {
    event: type,
    payload: type === "ReasoningMessageStart"
      ? { messageId, role: "reasoning" }
      : type === "ReasoningMessageContent"
      ? {
        messageId,
        delta: typeof event.delta === "string" ? event.delta : "",
      }
      : { messageId },
  };
}

function createTextEvent(
  messageId: string,
  type: "TextMessageStart" | "TextMessageContent" | "TextMessageEnd",
  delta = "",
  contentId: string,
): AgUiEncodedEvent {
  return {
    event: type,
    payload: type === "TextMessageStart"
      ? { messageId, contentId, role: "assistant" }
      : type === "TextMessageContent"
      ? { messageId, contentId, delta }
      : { messageId, contentId },
  };
}

function closeOpenTextEvent(state: AgUiEncoderState): AgUiEncodedEvent[] {
  if (!state.textOpen) {
    return [];
  }

  state.textOpen = false;
  const event = createTextEvent(
    getMessageId(state, { type: "text-end" }),
    "TextMessageEnd",
    "",
    state.activeTextContentId ?? `text:${state.textContentIndex++}`,
  );
  state.activeTextContentId = null;
  return [event];
}

function closeOpenReasoningEvent(state: AgUiEncoderState): AgUiEncodedEvent[] {
  if (state.reasoningMessageId === null) {
    return [];
  }

  const messageId = state.reasoningMessageId;
  state.reasoningMessageId = null;
  return [{
    event: "ReasoningMessageEnd",
    payload: { messageId },
  }];
}

/** Map runtime stream event to AG-UI events. */
export function mapRuntimeStreamEventToAgUiEvents(
  state: AgUiEncoderState,
  event: AgUiRuntimeStreamEvent,
): AgUiEncodedEvent[] {
  return stampAgUiEventTiming(
    state,
    mapRuntimeStreamEventToAgUiEventsUnstamped(state, event),
  );
}

export function stampAgUiEventTiming(
  state: AgUiEncoderState,
  events: AgUiEncodedEvent[],
): AgUiEncodedEvent[] {
  if (events.length === 0) {
    return events;
  }

  // `elapsedMs` is anchored to this encoder's construction, so reading it
  // correctly requires knowing which encoder produced it. `emittedAt` carries
  // no anchor and means the same thing everywhere, which is what makes it the
  // durable one: it supports durations between any two events, lines up with
  // wall-clock traces and logs, and turns ingest lag into `created_at -
  // emittedAt`. Both are stamped because wall clocks can step backwards and
  // the monotonic reading cannot.
  for (const { payload } of events) {
    if (Object.hasOwn(payload, "elapsedMs")) assertValidElapsedMs(payload.elapsedMs);
    if (Object.hasOwn(payload, "emittedAt")) assertValidEmittedAt(payload.emittedAt);
  }

  const needsElapsedMs = events.some(({ payload }) => !Object.hasOwn(payload, "elapsedMs"));
  const needsEmittedAt = events.some(({ payload }) => !Object.hasOwn(payload, "emittedAt"));
  const elapsedMs = needsElapsedMs && state.nowMs && state.startedMs !== undefined
    ? Math.max(0, Math.round(state.nowMs() - state.startedMs))
    : undefined;
  const emittedAt = needsEmittedAt && state.epochMs ? Math.round(state.epochMs()) : undefined;
  if (elapsedMs !== undefined) assertValidElapsedMs(elapsedMs);
  if (emittedAt !== undefined) assertValidEmittedAt(emittedAt);
  if (elapsedMs === undefined && emittedAt === undefined) {
    return events;
  }

  return events.map((entry) => ({
    ...entry,
    payload: {
      ...entry.payload,
      ...(elapsedMs !== undefined && !Object.hasOwn(entry.payload, "elapsedMs")
        ? { elapsedMs }
        : {}),
      ...(emittedAt !== undefined && !Object.hasOwn(entry.payload, "emittedAt")
        ? { emittedAt }
        : {}),
    },
  }));
}

function assertValidElapsedMs(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError("elapsedMs must be a finite non-negative number");
  }
}

function assertValidEmittedAt(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError("emittedAt must be a non-negative integer");
  }
}

function mapRuntimeStreamEventToAgUiEventsUnstamped(
  state: AgUiEncoderState,
  event: AgUiRuntimeStreamEvent,
): AgUiEncodedEvent[] {
  if (event.type.startsWith("data-")) {
    const name = event.type.slice("data-".length);
    if (name.length === 0) {
      return [];
    }

    state.sawVisibleOutput = true;
    return [createCustomDataEvent(name, "data" in event ? event.data : null)];
  }

  switch (event.type) {
    case "source-document":
    case "source-url":
    case "file":
      state.sawVisibleOutput = true;
      return [createCustomDataEvent(event.type, event)];

    case "message-start":
      getMessageId(state, event);
      return [];

    case "text-start": {
      const events = closeOpenReasoningEvent(state);
      if (state.textOpen) {
        if (isActiveTextIdentity(state, event)) return events;
        events.push(...closeOpenTextEvent(state));
      }
      const { messageId, contentId } = getTextMessageIdentity(state, event);
      state.textOpen = true;
      state.activeTextContentId = contentId;
      state.sawVisibleOutput = true;
      events.push(createTextEvent(messageId, "TextMessageStart", "", contentId));
      return events;
    }

    case "text-delta": {
      const events = closeOpenReasoningEvent(state);
      if (state.textOpen && !isActiveTextIdentity(state, event)) {
        events.push(...closeOpenTextEvent(state));
      }
      const { messageId, contentId } = getTextMessageIdentity(state, event);
      state.sawVisibleOutput = true;
      if (!state.textOpen) {
        state.textOpen = true;
        state.activeTextContentId = contentId;
        events.push(
          createTextEvent(messageId, "TextMessageStart", "", contentId),
          createTextEvent(
            messageId,
            "TextMessageContent",
            typeof event.delta === "string" ? event.delta : "",
            contentId,
          ),
        );
        return events;
      }

      events.push(createTextEvent(
        messageId,
        "TextMessageContent",
        typeof event.delta === "string" ? event.delta : "",
        state.activeTextContentId ?? contentId,
      ));
      return events;
    }

    case "text-end": {
      if (!state.textOpen) return [];
      const { messageId, contentId } = getTextMessageIdentity(state, event);
      state.textOpen = false;
      const resolvedContentId = state.activeTextContentId ?? contentId;
      state.activeTextContentId = null;
      return [createTextEvent(messageId, "TextMessageEnd", "", resolvedContentId)];
    }

    case "reasoning-start": {
      const events = closeOpenTextEvent(state);
      events.push(...closeOpenReasoningEvent(state));
      state.sawVisibleOutput = true;
      events.push(createReasoningEvent(state, event, "ReasoningMessageStart"));
      return events;
    }

    case "reasoning-delta": {
      const events = closeOpenTextEvent(state);
      state.sawVisibleOutput = true;
      if (state.reasoningMessageId === null) {
        events.push(createReasoningEvent(state, event, "ReasoningMessageStart"));
      }
      events.push(createReasoningEvent(state, event, "ReasoningMessageContent"));
      return events;
    }

    case "reasoning-end":
      // An end with no span open has nothing to close. Emitting one anyway
      // would send a ReasoningMessageEnd with no matching start and burn a
      // span ordinal, shifting every later span's id.
      return closeOpenReasoningEvent(state);

    case "tool-input-start": {
      const events = [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
      ];
      state.sawVisibleOutput = true;
      if (typeof event.toolCallId === "string" && event.toolCallId.length > 0) {
        (state.openToolCallIds ??= new Set<string>()).add(event.toolCallId);
      }
      events.push({
        event: "ToolCallStart",
        payload: {
          toolCallId: event.toolCallId,
          toolCallName: event.toolName,
        },
      });
      return events;
    }

    case "tool-input-delta":
      state.sawVisibleOutput = true;
      if (typeof event.toolCallId === "string") {
        state.streamedToolInputIds.add(event.toolCallId);
      }
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        {
          event: "ToolCallArgs",
          payload: {
            toolCallId: event.toolCallId,
            delta: typeof event.inputTextDelta === "string" ? event.inputTextDelta : "",
          },
        },
      ];

    case "tool-input-available": {
      state.sawVisibleOutput = true;
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        ...completeToolInput(state, event),
      ];
    }

    case "tool-input-error": {
      state.sawVisibleOutput = true;
      const events = [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        ...completeToolInput(state, event),
      ];
      events.push({
        event: "ToolCallResult",
        payload: {
          toolCallId: event.toolCallId,
          result: {
            error: typeof event.errorText === "string" ? event.errorText : "Tool input failed",
          },
          isError: true,
        },
      });
      return events;
    }

    case "tool-output-available":
      if (event.preliminary === true) return [];
      state.sawVisibleOutput = true;
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        createToolResultEvent(event.toolCallId, event.output),
      ];

    case "tool-output-error":
      state.sawVisibleOutput = true;
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        // A truncated local tool call terminalizes as `tool-input-start`
        // (plus any partial deltas) and then straight to this event, so the
        // input is still open. `tool-input-available` and `tool-input-error`
        // close it via `completeToolInput`; this branch has to close it too,
        // or the client is left with ToolCallStart and ToolCallResult and no
        // ToolCallEnd. No synthetic args are emitted: the model never
        // committed any, and inventing `{}` would claim it did.
        ...closeOpenToolInput(state, event.toolCallId),
        createToolResultEvent(event.toolCallId, { error: event.errorText }, true),
      ];

    case "tool-output-denied":
      state.sawVisibleOutput = true;
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        createToolResultEvent(event.toolCallId, { error: "Tool output denied" }, true),
      ];

    case "step-start":
    case "start-step":
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        createStepEvent(state, "StepStarted"),
      ];

    case "step-end":
    case "finish-step":
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        createStepEvent(state, "StepFinished"),
      ];

    case "data":
      applyDataMetadata(state, event);
      return [];

    case "error":
      state.sawTerminalError = true;
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        {
          event: "RunError",
          payload: {
            ...(typeof event.code === "string" && event.code.length > 0
              ? { code: event.code }
              : {}),
            message: typeof event.error === "string" ? event.error : "Agent run failed",
          },
        },
      ];

    default:
      if (typeof event.type === "string" && event.type.startsWith("data-")) {
        return [createCustomDataEvent(event.type.slice(5), event.data)];
      }
      return [];
  }
}

/** Finalize AG-UI events helper. */
export function finalizeAgUiEvents(
  state: AgUiEncoderState,
  response: AgentResponse | null,
): AgUiEncodedEvent[] {
  return stampAgUiEventTiming(state, finalizeAgUiEventsUnstamped(state, response));
}

function finalizeAgUiEventsUnstamped(
  state: AgUiEncoderState,
  response: AgentResponse | null,
): AgUiEncodedEvent[] {
  applyResponseMetadata(state, response);

  if (state.sawTerminalError) {
    return [];
  }

  if (!state.sawVisibleOutput) {
    state.sawTerminalError = true;
    return [{
      event: "RunError",
      payload: {
        code: "EMPTY_ASSISTANT_OUTPUT",
        message: "Agent run produced no assistant-visible output",
      },
    }];
  }

  const events: AgUiEncodedEvent[] = [];
  events.push(...closeOpenTextEvent(state));
  events.push(...closeOpenReasoningEvent(state));

  events.push({
    event: "RunFinished",
    payload: {
      metadata: state.metadata,
    },
  });

  return events;
}
