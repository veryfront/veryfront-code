import {
  primordialArrayFilter,
  primordialArrayFlatMap,
  primordialArrayMap,
  primordialArrayPush,
  primordialArrayValues,
} from "#veryfront/platform/compat/primordials/array.ts";
import {
  encodePrivateText,
  privateTextSlice,
  privateTextSplit,
  privateTextStartsWith,
} from "#veryfront/security/private-text.ts";
import { privateByteLength } from "#veryfront/security/private-bytes.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import {
  MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
  MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
} from "../conversation/run-event-limits.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import type { AgentResponse } from "../types.ts";
import { buildNativeRunEventFrame, buildRuntimeEventRecordedEvent } from "./native-run-events.ts";
import { isToolResultErrorOutput } from "#veryfront/tool/result.ts";
import { getStepIdentity } from "../streaming/step-identity.ts";

// Project code can replace globals before runtime observations are stamped.
// Keep the timing path on load-time captures.
const objectHasOwn = Object.hasOwn;
const mathMax = Math.max;
const mathMin = Math.min;
const mathRound = Math.round;
const numberIsFinite = Number.isFinite;
const numberIsInteger = Number.isInteger;
const numberMaxValue = Number.MAX_VALUE;
const ArrayIsArray = Array.isArray;
const objectKeys = Object.keys;
const objectAssign = Object.assign;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const intrinsicCrypto = crypto;
const cryptoRandomUUID = intrinsicCrypto.randomUUID;
const intrinsicPerformance = performance;
const performanceNow = intrinsicPerformance.now;
const intrinsicDate = Date;
const dateNow = intrinsicDate.now;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const JSON_VALUE_MAX_STRING_BYTES = 1024 * 1024;
const MESSAGE_FINISH_OBJECT_STRING_TRUNCATED_SUFFIX = "… [truncated]";
const MESSAGE_FINISH_OBJECT_MAX_DEPTH = 32;
const MESSAGE_FINISH_OBJECT_MAX_ARRAY_ITEMS = 100;
const MESSAGE_FINISH_OBJECT_MAX_OBJECT_KEYS = 100;
const MESSAGE_FINISH_OBJECT_MAX_OUTPUT_BYTES = JSON_VALUE_MAX_STRING_BYTES;
const MESSAGE_FINISH_OBJECT_MAX_KEY_BYTES = 16 * 1024;
const MESSAGE_FINISH_OBJECT_MAX_NODES = 50_000;
const MESSAGE_FINISH_OBJECT_UNSUPPORTED_ACCESSOR = "[unsupported accessor]";
const MESSAGE_FINISH_OBJECT_TRUNCATED_BUDGET = "[truncated message-finish object budget]";

function randomUUID(): string {
  return reflectApply(cryptoRandomUUID, intrinsicCrypto, []) as string;
}

function defaultNowMs(): number {
  return reflectApply(performanceNow, intrinsicPerformance, []) as number;
}

function defaultEpochMs(): number {
  return reflectApply(dateNow, intrinsicDate, []) as number;
}

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
  cacheCreation1hInputTokens?: number;
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
   * Producer-owned reasoning segment id for the currently open reasoning span.
   * Optional so state objects built before this field existed stay valid.
   */
  activeReasoningContentId?: string | null;
  /**
   * How many reasoning spans have opened in this run. Optional so a state
   * object built before this counter existed stays valid; absent reads as 0.
   */
  reasoningSpanIndex?: number;
  activeStepName: string | null;
  activeStepId?: string | null;
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
  /** A manual pause closes the transport while execution waits for resume. */
  manuallyPaused?: boolean;
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
  const nowMs = options.nowMs === null ? undefined : options.nowMs ?? defaultNowMs;
  const epochMs = options.epochMs === null ? undefined : options.epochMs ?? defaultEpochMs;
  return {
    ...(nowMs ? { nowMs, startedMs: options.startedMs ?? nowMs() } : {}),
    ...(epochMs ? { epochMs } : {}),
    messageId: null,
    textOpen: false,
    activeTextContentId: null,
    textContentIndex: 0,
    reasoningMessageId: null,
    activeReasoningContentId: null,
    reasoningSpanIndex: 0,
    activeStepName: null,
    activeStepId: null,
    stepCount: 0,
    streamedToolInputIds: createPrivateSet<string>(),
    openToolCallIds: createPrivateSet<string>(),
    sawVisibleOutput: false,
    sawTerminalError: false,
    metadata: {},
  };
}

function serializeToolInput(input: unknown): string {
  const serialized = privateJsonStringify(
    input ?? {},
    null,
    undefined,
    MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
  );
  if (serialized === undefined) throw new TypeError("Observed tool input is not JSON data");
  return serialized;
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
    state.messageId = randomUUID();
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

function getReasoningContentId(event: AgUiRuntimeStreamEvent): string | null {
  if (typeof event.contentId === "string" && event.contentId.length > 0) return event.contentId;
  if (typeof event.id === "string" && event.id.length > 0) return event.id;
  return null;
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

function nextStep(
  state: AgUiEncoderState,
  event: AgUiRuntimeStreamEvent,
): { stepName: string; stepId: string } {
  state.stepCount += 1;
  state.activeStepName = `step-${state.stepCount}`;
  state.activeStepId = getStepIdentity(event) ?? randomUUID();
  return { stepName: state.activeStepName, stepId: state.activeStepId };
}

function finishStep(state: AgUiEncoderState): { stepName: string; stepId?: string } {
  const stepName = state.activeStepName ?? `step-${mathMax(state.stepCount, 1)}`;
  const stepId = state.activeStepId ?? undefined;
  state.activeStepName = null;
  state.activeStepId = null;
  return {
    stepName,
    ...(stepId !== undefined ? { stepId } : {}),
  };
}

function applyDataMetadata(state: AgUiEncoderState, event: AgUiRuntimeStreamEvent): void {
  const data = event.data && typeof event.data === "object" && !ArrayIsArray(event.data)
    ? event.data as Record<string, unknown>
    : event;

  if (typeof data.model === "string") {
    state.metadata.model = data.model;
    const provider = privateTextSplit(data.model, "/")[0];
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
    if (typeof response.usage.cacheCreation1hInputTokens === "number") {
      state.metadata.cacheCreation1hInputTokens = response.usage.cacheCreation1hInputTokens;
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
  if (typeof costUsd === "number" && numberIsFinite(costUsd) && costUsd >= 0) {
    state.metadata.costUsd = costUsd;
  }
  const providerCostUsd = metadata?.providerCostUsd;
  if (
    typeof providerCostUsd === "number" && numberIsFinite(providerCostUsd) && providerCostUsd >= 0
  ) {
    state.metadata.providerCostUsd = providerCostUsd;
  }
  const providerInputCostUsd = metadata?.providerInputCostUsd;
  if (
    typeof providerInputCostUsd === "number" && numberIsFinite(providerInputCostUsd) &&
    providerInputCostUsd >= 0
  ) {
    state.metadata.providerInputCostUsd = providerInputCostUsd;
  }
  const providerOutputCostUsd = metadata?.providerOutputCostUsd;
  if (
    typeof providerOutputCostUsd === "number" && numberIsFinite(providerOutputCostUsd) &&
    providerOutputCostUsd >= 0
  ) {
    state.metadata.providerOutputCostUsd = providerOutputCostUsd;
  }
  const veryfrontChargeUsd = metadata?.veryfrontChargeUsd;
  if (
    typeof veryfrontChargeUsd === "number" && numberIsFinite(veryfrontChargeUsd) &&
    veryfrontChargeUsd >= 0
  ) {
    state.metadata.veryfrontChargeUsd = veryfrontChargeUsd;
  }
  const veryfrontInputChargeUsd = metadata?.veryfrontInputChargeUsd;
  if (
    typeof veryfrontInputChargeUsd === "number" && numberIsFinite(veryfrontInputChargeUsd) &&
    veryfrontInputChargeUsd >= 0
  ) {
    state.metadata.veryfrontInputChargeUsd = veryfrontInputChargeUsd;
  }
  const veryfrontOutputChargeUsd = metadata?.veryfrontOutputChargeUsd;
  if (
    typeof veryfrontOutputChargeUsd === "number" && numberIsFinite(veryfrontOutputChargeUsd) &&
    veryfrontOutputChargeUsd >= 0
  ) {
    state.metadata.veryfrontOutputChargeUsd = veryfrontOutputChargeUsd;
  }
  const veryfrontBilledUsd = metadata?.veryfrontBilledUsd;
  if (
    typeof veryfrontBilledUsd === "number" && numberIsFinite(veryfrontBilledUsd) &&
    veryfrontBilledUsd >= 0
  ) {
    state.metadata.veryfrontBilledUsd = veryfrontBilledUsd;
  }
  const costCredits = metadata?.costCredits;
  if (typeof costCredits === "number" && numberIsFinite(costCredits) && costCredits >= 0) {
    state.metadata.costCredits = costCredits;
  }
  const billableInputTokens = metadata?.billableInputTokens;
  if (
    typeof billableInputTokens === "number" && numberIsFinite(billableInputTokens) &&
    billableInputTokens >= 0
  ) {
    state.metadata.billableInputTokens = billableInputTokens;
  }
  const billableOutputTokens = metadata?.billableOutputTokens;
  if (
    typeof billableOutputTokens === "number" && numberIsFinite(billableOutputTokens) &&
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

function readFiniteNonNegativeNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && numberIsFinite(value) && value >= 0 ? value : undefined;
}

function copyNumberMetadata(
  target: AgUiRunFinishedMetadata,
  usage: Record<string, unknown>,
  metadataKey: keyof Pick<
    AgUiRunFinishedMetadata,
    | "reasoningTokens"
    | "billableInputTokens"
    | "billableOutputTokens"
    | "costUsd"
    | "providerInputCostUsd"
    | "providerOutputCostUsd"
    | "providerCostUsd"
    | "veryfrontInputChargeUsd"
    | "veryfrontOutputChargeUsd"
    | "veryfrontChargeUsd"
    | "veryfrontBilledUsd"
    | "costCredits"
    | "cacheCreationInputTokens"
    | "cacheCreation1hInputTokens"
    | "cacheReadInputTokens"
  >,
): void {
  const value = readFiniteNonNegativeNumber(usage, metadataKey);
  if (value !== undefined) target[metadataKey] = value;
}

function readMessageFinishUsageMetadata(
  event: AgUiRuntimeStreamEvent,
): AgUiRunFinishedMetadata | null {
  const usage = event.totalUsage && typeof event.totalUsage === "object" &&
      !ArrayIsArray(event.totalUsage)
    ? event.totalUsage as Record<string, unknown>
    : event.usage && typeof event.usage === "object" && !ArrayIsArray(event.usage)
    ? event.usage as Record<string, unknown>
    : null;
  if (!usage) return null;

  const metadata: AgUiRunFinishedMetadata = {};
  const inputTokens = readFiniteNonNegativeNumber(usage, "inputTokens") ??
    readFiniteNonNegativeNumber(usage, "promptTokens");
  if (inputTokens !== undefined) metadata.inputTokens = inputTokens;

  const outputTokens = readFiniteNonNegativeNumber(usage, "outputTokens") ??
    readFiniteNonNegativeNumber(usage, "completionTokens");
  if (outputTokens !== undefined) metadata.outputTokens = outputTokens;

  const totalTokens = readFiniteNonNegativeNumber(usage, "totalTokens") ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  if (totalTokens !== undefined) metadata.totalTokens = totalTokens;

  const cachedInputTokens = readFiniteNonNegativeNumber(usage, "cachedInputTokens") ??
    readFiniteNonNegativeNumber(usage, "cacheReadInputTokens");
  if (cachedInputTokens !== undefined) metadata.cachedInputTokens = cachedInputTokens;

  copyNumberMetadata(metadata, usage, "cacheCreationInputTokens");
  copyNumberMetadata(metadata, usage, "cacheCreation1hInputTokens");
  copyNumberMetadata(metadata, usage, "cacheReadInputTokens");
  copyNumberMetadata(metadata, usage, "reasoningTokens");
  copyNumberMetadata(metadata, usage, "billableInputTokens");
  copyNumberMetadata(metadata, usage, "billableOutputTokens");
  copyNumberMetadata(metadata, usage, "costUsd");
  copyNumberMetadata(metadata, usage, "providerInputCostUsd");
  copyNumberMetadata(metadata, usage, "providerOutputCostUsd");
  copyNumberMetadata(metadata, usage, "providerCostUsd");
  copyNumberMetadata(metadata, usage, "veryfrontInputChargeUsd");
  copyNumberMetadata(metadata, usage, "veryfrontOutputChargeUsd");
  copyNumberMetadata(metadata, usage, "veryfrontChargeUsd");
  copyNumberMetadata(metadata, usage, "veryfrontBilledUsd");
  copyNumberMetadata(metadata, usage, "costCredits");

  const costSource = usage.costSource;
  if (costSource === "gateway" || costSource === "missing" || costSource === "partial") {
    metadata.costSource = costSource;
  }
  const billingMode = usage.billingMode;
  if (billingMode === "direct" || billingMode === "deferred") {
    metadata.billingMode = billingMode;
  }
  const usageCaptureStatus = usage.usageCaptureStatus;
  if (
    usageCaptureStatus === "complete" ||
    usageCaptureStatus === "partial" ||
    usageCaptureStatus === "missing"
  ) {
    metadata.usageCaptureStatus = usageCaptureStatus;
  }

  return objectKeys(metadata).length > 0 ? metadata : null;
}

type MessageFinishObjectCaptureStatus = "complete" | "partial" | "unsupported";

interface MessageFinishObjectSnapshot {
  value: unknown;
  status: MessageFinishObjectCaptureStatus;
  reasons: string[];
}

interface MessageFinishObjectSnapshotContext {
  remainingBytes: number;
  remainingNodes: number;
  seen: ReturnType<typeof createPrivateWeakStore<object, true>>;
}

function addCaptureReason(reasons: string[], reason: string): void {
  for (const existing of primordialArrayValues(reasons)) {
    if (existing === reason) return;
  }
  primordialArrayPush(reasons, reason);
}

function getUtf8ByteLength(value: string): number {
  return privateByteLength(encodePrivateText(value));
}

function createNullDataRecord(): Record<string, unknown> {
  return objectCreate(null) as Record<string, unknown>;
}

function defineDataProperty(
  target: Record<string, unknown> | unknown[],
  key: string,
  value: unknown,
): void {
  objectDefineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function consumeMessageFinishSnapshotBudget(
  context: MessageFinishObjectSnapshotContext,
  value: string,
): boolean {
  const bytes = getUtf8ByteLength(value);
  if (bytes > context.remainingBytes) return false;
  context.remainingBytes -= bytes;
  return true;
}

function truncateMessageFinishString(
  context: MessageFinishObjectSnapshotContext,
  value: string,
): { value: string; truncated: boolean } {
  if (
    getUtf8ByteLength(value) <= JSON_VALUE_MAX_STRING_BYTES &&
    consumeMessageFinishSnapshotBudget(context, value)
  ) {
    return { value, truncated: false };
  }

  if (context.remainingBytes <= getUtf8ByteLength(MESSAGE_FINISH_OBJECT_STRING_TRUNCATED_SUFFIX)) {
    return { value: MESSAGE_FINISH_OBJECT_TRUNCATED_BUDGET, truncated: true };
  }

  let end = value.length;
  while (end > 0) {
    const candidate = `${
      privateTextSlice(value, 0, end)
    }${MESSAGE_FINISH_OBJECT_STRING_TRUNCATED_SUFFIX}`;
    if (
      getUtf8ByteLength(candidate) <= JSON_VALUE_MAX_STRING_BYTES &&
      consumeMessageFinishSnapshotBudget(context, candidate)
    ) {
      return { value: candidate, truncated: true };
    }
    end = mathMin(end - 1, mathRound(end / 2));
  }

  return { value: MESSAGE_FINISH_OBJECT_TRUNCATED_BUDGET, truncated: true };
}

function isSupportedMessageFinishObjectKey(key: string): boolean {
  return getUtf8ByteLength(key) <= MESSAGE_FINISH_OBJECT_MAX_KEY_BYTES;
}

function getMessageFinishMetadataDurableByteLength(value: unknown): number {
  try {
    const durable = buildRuntimeEventRecordedEvent({
      runtime: "veryfront",
      kind: "message_finish_metadata",
      value,
    }).durable;
    const serialized = privateJsonStringify(
      {
        ...durable,
        // AG-UI timing is stamped after native payload construction. Reserve
        // the largest valid JSON representations so a payload accepted here
        // cannot become omitted by durable normalization after stamping.
        elapsedMs: numberMaxValue,
        emittedAt: numberMaxValue,
      },
      null,
      undefined,
      MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
    );
    return typeof serialized === "string"
      ? getUtf8ByteLength(serialized)
      : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isMessageFinishMetadataValueWithinDurableBudget(value: unknown): boolean {
  return getMessageFinishMetadataDurableByteLength(value) <=
    MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES;
}

function createTruncatedMessageFinishObjectObservation(reason: string): Record<string, unknown> {
  return {
    captureStatus: "partial",
    reasons: [reason],
    value: MESSAGE_FINISH_OBJECT_TRUNCATED_BUDGET,
  };
}

function createTruncatedMessageFinishScalarObservation(
  field: string,
  reason: string,
): Record<string, unknown> {
  return {
    captureStatus: "partial",
    field,
    reasons: [reason],
  };
}

function hasRemainingEligibleMessageFinishObjectProperty<TInput extends object>(
  input: TInput,
  keys: readonly (string | symbol)[],
  startIndex: number,
): boolean {
  for (let index = startIndex; index < keys.length; index++) {
    const key = keys[index];
    if (typeof key !== "string" || !isSupportedMessageFinishObjectKey(key)) continue;
    const property = objectGetOwnPropertyDescriptor(input, key);
    if (property?.enumerable) return true;
  }
  return false;
}

function snapshotMessageFinishObjectValue(
  input: unknown,
  context: MessageFinishObjectSnapshotContext = {
    remainingBytes: MESSAGE_FINISH_OBJECT_MAX_OUTPUT_BYTES,
    remainingNodes: MESSAGE_FINISH_OBJECT_MAX_NODES,
    seen: createPrivateWeakStore<object, true>(),
  },
  depth = 0,
): MessageFinishObjectSnapshot {
  const reasons: string[] = [];
  context.remainingNodes -= 1;
  if (context.remainingNodes < 0) {
    return {
      value: MESSAGE_FINISH_OBJECT_TRUNCATED_BUDGET,
      status: "partial",
      reasons: ["aggregate_budget_exhausted"],
    };
  }
  if (input === null || typeof input === "boolean") {
    return { value: input, status: "complete", reasons };
  }
  if (typeof input === "string") {
    const truncated = truncateMessageFinishString(context, input);
    if (truncated.truncated) {
      addCaptureReason(
        reasons,
        truncated.value === MESSAGE_FINISH_OBJECT_TRUNCATED_BUDGET
          ? "aggregate_budget_exhausted"
          : "string_truncated",
      );
    }
    return {
      value: truncated.value,
      status: truncated.truncated ? "partial" : "complete",
      reasons,
    };
  }
  if (typeof input === "number") {
    return numberIsFinite(input)
      ? { value: input, status: "complete", reasons }
      : { value: "[unsupported number]", status: "unsupported", reasons: ["unsupported_number"] };
  }
  if (typeof input !== "object") {
    return {
      value: `[unsupported ${typeof input}]`,
      status: "unsupported",
      reasons: [`unsupported_${typeof input}`],
    };
  }
  if (context.seen.get(input) === true) {
    return { value: "[circular]", status: "partial", reasons: ["circular"] };
  }
  if (depth >= MESSAGE_FINISH_OBJECT_MAX_DEPTH) {
    return { value: "[truncated nested data]", status: "partial", reasons: ["max_depth"] };
  }

  context.seen.set(input, true);
  try {
    if (ArrayIsArray(input)) {
      const output: unknown[] = [];
      const length = typeof input.length === "number" && numberIsFinite(input.length)
        ? mathMax(0, mathRound(input.length))
        : 0;
      const limit = mathMax(0, mathMin(length, MESSAGE_FINISH_OBJECT_MAX_ARRAY_ITEMS));
      for (let index = 0; index < limit; index++) {
        const property = objectGetOwnPropertyDescriptor(input, String(index));
        const item = !property || !property.enumerable
          ? { value: null, status: "complete", reasons: [] } satisfies MessageFinishObjectSnapshot
          : !objectHasOwn(property, "value")
          ? {
            value: MESSAGE_FINISH_OBJECT_UNSUPPORTED_ACCESSOR,
            status: "partial",
            reasons: ["accessor_property"],
          } satisfies MessageFinishObjectSnapshot
          : snapshotMessageFinishObjectValue(property.value, context, depth + 1);
        primordialArrayPush(output, item.value);
        for (const reason of primordialArrayValues(item.reasons)) addCaptureReason(reasons, reason);
        if (item.status === "unsupported") addCaptureReason(reasons, "unsupported_array_item");
      }
      if (length > limit) {
        primordialArrayPush(output, `[truncated ${length - limit} items]`);
        addCaptureReason(reasons, "array_truncated");
      }
      return {
        value: output,
        status: reasons.length > 0 ? "partial" : "complete",
        reasons,
      };
    }

    const output = createNullDataRecord();
    const keys = reflectOwnKeys(input);
    let copiedKeys = 0;
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      const key = keys[keyIndex];
      if (typeof key !== "string") continue;
      if (!isSupportedMessageFinishObjectKey(key)) {
        addCaptureReason(reasons, "object_key_unsupported");
        continue;
      }
      const property = objectGetOwnPropertyDescriptor(input, key);
      if (!property?.enumerable) continue;
      if (!objectHasOwn(property, "value")) {
        defineDataProperty(output, key, MESSAGE_FINISH_OBJECT_UNSUPPORTED_ACCESSOR);
        addCaptureReason(reasons, "accessor_property");
        copiedKeys += 1;
      } else {
        const item = snapshotMessageFinishObjectValue(property.value, context, depth + 1);
        defineDataProperty(output, key, item.value);
        for (const reason of primordialArrayValues(item.reasons)) addCaptureReason(reasons, reason);
        if (item.status === "unsupported") addCaptureReason(reasons, "unsupported_property");
        copiedKeys += 1;
      }
      if (copiedKeys >= MESSAGE_FINISH_OBJECT_MAX_OBJECT_KEYS) {
        if (hasRemainingEligibleMessageFinishObjectProperty(input, keys, keyIndex + 1)) {
          addCaptureReason(reasons, "object_keys_truncated");
        }
        break;
      }
    }
    return {
      value: output,
      status: reasons.length > 0 ? "partial" : "complete",
      reasons,
    };
  } finally {
    context.seen.set(input, undefined as never);
  }
}

function createMessageFinishObjectObservation(
  object: unknown,
  maxOutputBytes = MESSAGE_FINISH_OBJECT_MAX_OUTPUT_BYTES,
): unknown {
  const snapshot = snapshotMessageFinishObjectValue(object, {
    remainingBytes: maxOutputBytes,
    remainingNodes: MESSAGE_FINISH_OBJECT_MAX_NODES,
    seen: createPrivateWeakStore<object, true>(),
  });
  if (snapshot.status === "complete") return snapshot.value;
  return {
    captureStatus: snapshot.status,
    reasons: snapshot.reasons,
    value: snapshot.value,
  };
}

function createMessageFinishObjectObservationWithinDurableBudget(
  baseValue: Record<string, unknown>,
  object: unknown,
): unknown {
  const placeholder = createTruncatedMessageFinishObjectObservation("serialized_budget_exhausted");
  let best: unknown = placeholder;

  let low = 0;
  let high = mathMin(
    MESSAGE_FINISH_OBJECT_MAX_OUTPUT_BYTES,
    MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
  );
  while (low <= high) {
    const mid = mathRound((low + high) / 2);
    const candidate = createMessageFinishObjectObservation(object, mid);
    if (isMessageFinishMetadataValueWithinDurableBudget({ ...baseValue, object: candidate })) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function createMessageFinishMetadataEvent(
  state: AgUiEncoderState,
  event: AgUiRuntimeStreamEvent,
): AgUiEncodedEvent[] {
  const value: Record<string, unknown> = {};
  let finishReasonMetadata: string | null = null;
  if (typeof event.finishReason === "string" && event.finishReason.length > 0) {
    const snapshot = snapshotMessageFinishObjectValue(event.finishReason);
    if (
      snapshot.status === "complete" &&
      typeof snapshot.value === "string"
    ) {
      finishReasonMetadata = snapshot.value;
      value.finishReason = snapshot.value;
    } else {
      value.finishReason = createTruncatedMessageFinishScalarObservation(
        "finishReason",
        snapshot.reasons[0] ?? "serialized_budget_exhausted",
      );
    }
  }

  const usageMetadata = readMessageFinishUsageMetadata(event);
  if (usageMetadata) {
    objectAssign(state.metadata, usageMetadata);
    value.totalUsage = usageMetadata;
  }

  if (event.object !== undefined) {
    value.object = createMessageFinishObjectObservation(event.object);
    if (!isMessageFinishMetadataValueWithinDurableBudget(value)) {
      const { object: _object, ...baseValue } = value;
      value.object = createMessageFinishObjectObservationWithinDurableBudget(
        baseValue,
        event.object,
      );
    }
  }

  if (!isMessageFinishMetadataValueWithinDurableBudget(value)) {
    if (objectHasOwn(value, "finishReason")) {
      value.finishReason = createTruncatedMessageFinishScalarObservation(
        "finishReason",
        "serialized_budget_exhausted",
      );
    }
    if (!isMessageFinishMetadataValueWithinDurableBudget(value)) {
      value.object = createTruncatedMessageFinishObjectObservation("serialized_budget_exhausted");
    }
  }

  if (
    finishReasonMetadata !== null &&
    value.finishReason === finishReasonMetadata
  ) {
    state.metadata.finishReason = finishReasonMetadata;
  }

  if (objectKeys(value).length === 0) return [];
  return [
    buildRuntimeEventRecordedEvent({
      runtime: "veryfront",
      kind: "message_finish_metadata",
      value,
    }).live,
  ];
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
  if (typeof metadata.cacheCreation1hInputTokens === "number") {
    responseMetadata.cacheCreation1hInputTokens = metadata.cacheCreation1hInputTokens;
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
      ...(typeof metadata.cacheCreation1hInputTokens === "number"
        ? { cacheCreation1hInputTokens: metadata.cacheCreation1hInputTokens }
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

  if (!usage && objectKeys(responseMetadata).length === 0) {
    return null;
  }

  return {
    text: "",
    messages: [],
    toolCalls: [],
    status: "completed",
    ...(usage ? { usage } : {}),
    ...(objectKeys(responseMetadata).length > 0 ? { metadata: responseMetadata } : {}),
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
    appendEncodedEvents(events, [{
      event: "ToolCallArgs",
      payload: {
        toolCallId,
        delta: serializeToolInput("input" in event ? event.input : {}),
      },
    }]);
  }

  if (toolCallId.length > 0) {
    state.streamedToolInputIds.delete(toolCallId);
    state.openToolCallIds?.delete(toolCallId);
  }

  appendEncodedEvents(events, [{
    event: "ToolCallEnd",
    payload: { toolCallId: event.toolCallId },
  }]);

  return events;
}

/**
 * Tool results carry the canonical `content` field. The value is passed through
 * unchanged, which is exactly what the API stores for a legacy `result` field.
 * `isError` is always explicit: the API never defaults a missing flag to false,
 * so an unflagged success would be served with `isError` unrecoverable. The API
 * never overrules an explicit flag either, so callers judge error-shaped output.
 */
function createToolResultEvent(
  toolCallId: unknown,
  content: Record<string, unknown> | unknown,
  isError = false,
): AgUiEncodedEvent {
  return {
    event: "ToolCallResult",
    payload: {
      toolCallId,
      content,
      isError,
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
  event: AgUiRuntimeStreamEvent,
): AgUiEncodedEvent {
  return {
    event: type,
    payload: {
      ...(type === "StepStarted" ? nextStep(state, event) : finishStep(state)),
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
  const contentId = type === "ReasoningMessageStart"
    ? getReasoningContentId(event)
    : state.activeReasoningContentId ?? null;
  if (type === "ReasoningMessageStart") {
    state.activeReasoningContentId = contentId;
  }

  return {
    event: type,
    payload: type === "ReasoningMessageStart"
      ? { messageId, ...(contentId ? { contentId } : {}), role: "reasoning" }
      : type === "ReasoningMessageContent"
      ? {
        messageId,
        ...(contentId ? { contentId } : {}),
        delta: typeof event.delta === "string" ? event.delta : "",
      }
      : { messageId, ...(contentId ? { contentId } : {}) },
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
  const contentId = state.activeReasoningContentId ?? null;
  state.reasoningMessageId = null;
  state.activeReasoningContentId = null;
  return [{
    event: "ReasoningMessageEnd",
    payload: { messageId, ...(contentId ? { contentId } : {}) },
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

/**
 * The transport timing fields `stampAgUiEventTiming` writes onto a live
 * event's own flat payload. Exported only so a reader that reconstructs a
 * native frame's whole payload as legacy data -- e.g. the chat client's
 * `stripAgUiTimingStamps` in `ag-ui.ts` -- can assert its strip list still
 * covers every stamped field, instead of a third stamped field silently
 * leaking into legacy `data` the way `elapsedMs`/`emittedAt` already did
 * once on the durable-record read path (fixed in `legacy-run-read-adapter.ts`,
 * commit 3ee902fb12) before this export existed to catch it in a test.
 * `stampAgUiEventTiming` below keeps its own literals; this export adds no
 * dependency to the runtime stamping path.
 */
export const AG_UI_EVENT_TIMING_STAMP_FIELDS = ["elapsedMs", "emittedAt"] as const;

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
  for (const { payload } of primordialArrayValues(events)) {
    if (objectHasOwn(payload, "elapsedMs")) assertValidElapsedMs(payload.elapsedMs);
    if (objectHasOwn(payload, "emittedAt")) assertValidEmittedAt(payload.emittedAt);
  }

  const needsElapsedMs =
    primordialArrayFilter(events, ({ payload }) => !objectHasOwn(payload, "elapsedMs")).length > 0;
  const needsEmittedAt =
    primordialArrayFilter(events, ({ payload }) => !objectHasOwn(payload, "emittedAt")).length > 0;
  const elapsedMs = needsElapsedMs && state.nowMs && state.startedMs !== undefined
    ? mathMax(0, mathRound(state.nowMs() - state.startedMs))
    : undefined;
  const emittedAt = needsEmittedAt && state.epochMs ? mathRound(state.epochMs()) : undefined;
  if (elapsedMs !== undefined) assertValidElapsedMs(elapsedMs);
  if (emittedAt !== undefined) assertValidEmittedAt(emittedAt);
  if (elapsedMs === undefined && emittedAt === undefined) {
    return events;
  }

  return primordialArrayMap(events, (entry) => ({
    ...entry,
    payload: {
      ...entry.payload,
      ...(elapsedMs !== undefined && !objectHasOwn(entry.payload, "elapsedMs")
        ? { elapsedMs }
        : {}),
      ...(emittedAt !== undefined && !objectHasOwn(entry.payload, "emittedAt")
        ? { emittedAt }
        : {}),
    },
  }));
}

function assertValidElapsedMs(value: unknown): asserts value is number {
  if (typeof value !== "number" || !numberIsFinite(value) || value < 0) {
    throw new TypeError("elapsedMs must be a finite non-negative number");
  }
}

function assertValidEmittedAt(value: unknown): asserts value is number {
  if (typeof value !== "number" || !numberIsInteger(value) || value < 0) {
    throw new TypeError("emittedAt must be a non-negative integer");
  }
}

function mapRuntimeStreamEventToAgUiEventsUnstamped(
  state: AgUiEncoderState,
  event: AgUiRuntimeStreamEvent,
): AgUiEncodedEvent[] {
  if (event.type === "data-veryfront.manual_pause") {
    state.manuallyPaused = true;
    return [];
  }
  if (privateTextStartsWith(event.type, "data-")) {
    const name = privateTextSlice(event.type, "data-".length);
    if (name.length === 0) {
      return [];
    }

    if (name !== "veryfront.runtime_context") state.sawVisibleOutput = true;
    const value = "data" in event ? event.data : null;
    const native = buildNativeRunEventFrame({
      name,
      value,
      parentMessageId: state.messageId,
    });
    return [native ? native.live : createCustomDataEvent(name, value)];
  }

  switch (event.type) {
    case "source-document":
    case "source-url":
    case "file": {
      state.sawVisibleOutput = true;
      const native = buildNativeRunEventFrame({
        name: event.type,
        value: event,
        parentMessageId: state.messageId,
      });
      return [native ? native.live : createCustomDataEvent(event.type, event)];
    }

    case "message-start":
      getMessageId(state, event);
      return [];

    case "message-finish":
    case "finish":
      return createMessageFinishMetadataEvent(state, event);

    case "text-start": {
      const events = closeOpenReasoningEvent(state);
      if (state.textOpen) {
        if (isActiveTextIdentity(state, event)) return events;
        appendEncodedEvents(events, closeOpenTextEvent(state));
      }
      const { messageId, contentId } = getTextMessageIdentity(state, event);
      state.textOpen = true;
      state.activeTextContentId = contentId;
      state.sawVisibleOutput = true;
      appendEncodedEvents(events, [createTextEvent(messageId, "TextMessageStart", "", contentId)]);
      return events;
    }

    case "text-delta": {
      const events = closeOpenReasoningEvent(state);
      if (state.textOpen && !isActiveTextIdentity(state, event)) {
        appendEncodedEvents(events, closeOpenTextEvent(state));
      }
      const { messageId, contentId } = getTextMessageIdentity(state, event);
      state.sawVisibleOutput = true;
      if (!state.textOpen) {
        state.textOpen = true;
        state.activeTextContentId = contentId;
        appendEncodedEvents(events, [
          createTextEvent(messageId, "TextMessageStart", "", contentId),
          createTextEvent(
            messageId,
            "TextMessageContent",
            typeof event.delta === "string" ? event.delta : "",
            contentId,
          ),
        ]);
        return events;
      }

      appendEncodedEvents(events, [createTextEvent(
        messageId,
        "TextMessageContent",
        typeof event.delta === "string" ? event.delta : "",
        state.activeTextContentId ?? contentId,
      )]);
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
      appendEncodedEvents(events, closeOpenReasoningEvent(state));
      state.sawVisibleOutput = true;
      appendEncodedEvents(events, [createReasoningEvent(state, event, "ReasoningMessageStart")]);
      return events;
    }

    case "reasoning-delta": {
      const events = closeOpenTextEvent(state);
      state.sawVisibleOutput = true;
      if (state.reasoningMessageId === null) {
        appendEncodedEvents(events, [createReasoningEvent(state, event, "ReasoningMessageStart")]);
      }
      appendEncodedEvents(events, [createReasoningEvent(state, event, "ReasoningMessageContent")]);
      return events;
    }

    case "reasoning-end":
      // An end with no span open has nothing to close. Emitting one anyway
      // would send a ReasoningMessageEnd with no matching start and burn a
      // span ordinal, shifting every later span's id.
      return closeOpenReasoningEvent(state);

    case "tool-input-start": {
      const events = combineEncodedEvents([
        closeOpenTextEvent(state),
        closeOpenReasoningEvent(state),
      ]);
      state.sawVisibleOutput = true;
      if (typeof event.toolCallId === "string" && event.toolCallId.length > 0) {
        (state.openToolCallIds ??= createPrivateSet<string>()).add(event.toolCallId);
      }
      appendEncodedEvents(events, [{
        event: "ToolCallStart",
        payload: {
          toolCallId: event.toolCallId,
          toolCallName: event.toolName,
          ...(state.messageId ? { parentMessageId: state.messageId } : {}),
        },
      }]);
      return events;
    }

    case "tool-input-delta":
      state.sawVisibleOutput = true;
      if (typeof event.toolCallId === "string") {
        state.streamedToolInputIds.add(event.toolCallId);
      }
      return combineEncodedEvents([
        closeOpenTextEvent(state),
        closeOpenReasoningEvent(state),
        [
          {
            event: "ToolCallArgs",
            payload: {
              toolCallId: event.toolCallId,
              delta: typeof event.inputTextDelta === "string" ? event.inputTextDelta : "",
            },
          },
        ],
      ]);

    case "tool-input-available": {
      state.sawVisibleOutput = true;
      return combineEncodedEvents([
        closeOpenTextEvent(state),
        closeOpenReasoningEvent(state),
        completeToolInput(state, event),
      ]);
    }

    case "tool-input-error": {
      state.sawVisibleOutput = true;
      const events = combineEncodedEvents([
        closeOpenTextEvent(state),
        closeOpenReasoningEvent(state),
        completeToolInput(state, event),
      ]);
      appendEncodedEvents(events, [{
        event: "ToolCallResult",
        payload: {
          toolCallId: event.toolCallId,
          content: {
            error: typeof event.errorText === "string" ? event.errorText : "Tool input failed",
          },
          isError: true,
        },
      }]);
      return events;
    }

    case "tool-output-available":
      if (event.preliminary === true) return [];
      state.sawVisibleOutput = true;
      return combineEncodedEvents([
        closeOpenTextEvent(state),
        closeOpenReasoningEvent(state),
        [
          createToolResultEvent(
            event.toolCallId,
            event.output,
            // Producers send a provider result they judge failed as tool-output-error,
            // so only forwarded results without the marker are judged by content.
            event.providerExecuted !== true && isToolResultErrorOutput(event.output),
          ),
        ],
      ]);

    case "tool-output-error":
      state.sawVisibleOutput = true;
      return combineEncodedEvents([
        closeOpenTextEvent(state),
        closeOpenReasoningEvent(state),
        // A truncated local tool call terminalizes as `tool-input-start`
        // (plus any partial deltas) and then straight to this event, so the
        // input is still open. `tool-input-available` and `tool-input-error`
        // close it via `completeToolInput`; this branch has to close it too,
        // or the client is left with ToolCallStart and ToolCallResult and no
        // ToolCallEnd. No synthetic args are emitted: the model never
        // committed any, and inventing `{}` would claim it did.
        closeOpenToolInput(state, event.toolCallId),
        [
          createToolResultEvent(event.toolCallId, { error: event.errorText }, true),
        ],
      ]);

    case "tool-output-denied":
      state.sawVisibleOutput = true;
      return combineEncodedEvents([
        closeOpenTextEvent(state),
        closeOpenReasoningEvent(state),
        [
          createToolResultEvent(event.toolCallId, { error: "Tool output denied" }, true),
        ],
      ]);

    case "step-start":
    case "start-step":
      return combineEncodedEvents([
        closeOpenTextEvent(state),
        closeOpenReasoningEvent(state),
        [
          createStepEvent(state, "StepStarted", event),
        ],
      ]);

    case "step-end":
    case "finish-step":
      return combineEncodedEvents([
        closeOpenTextEvent(state),
        closeOpenReasoningEvent(state),
        [
          createStepEvent(state, "StepFinished", event),
        ],
      ]);

    case "data":
      applyDataMetadata(state, event);
      return [];

    case "error":
      state.sawTerminalError = true;
      return combineEncodedEvents([
        closeOpenTextEvent(state),
        closeOpenReasoningEvent(state),
        [
          {
            event: "RunError",
            payload: {
              ...(typeof event.code === "string" && event.code.length > 0
                ? { code: event.code }
                : {}),
              message: typeof event.error === "string" ? event.error : "Agent run failed",
            },
          },
        ],
      ]);

    default:
      // The `data-` guard at the top of this function already returns for
      // any event.type starting with "data-", so that case can never reach
      // here -- this was a second, unreachable copy of the native routing.
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

  if (state.sawTerminalError || state.manuallyPaused) {
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
  appendEncodedEvents(events, closeOpenTextEvent(state));
  appendEncodedEvents(events, closeOpenReasoningEvent(state));

  appendEncodedEvents(events, [{
    event: "RunFinished",
    payload: {
      metadata: state.metadata,
      // A schema-bound agent's parsed `outputSchema` value, which the API stores
      // as the run output. Absent when the agent declares no schema or the
      // output did not parse; a parsed `null` is still reported.
      ...(response?.object !== undefined ? { result: response.object } : {}),
    },
  }]);

  return events;
}

function appendEncodedEvents(
  target: AgUiEncodedEvent[],
  entries: readonly AgUiEncodedEvent[],
): void {
  for (const entry of primordialArrayValues(entries)) primordialArrayPush(target, entry);
}
function combineEncodedEvents(
  groups: readonly (readonly AgUiEncodedEvent[])[],
): AgUiEncodedEvent[] {
  return primordialArrayFlatMap(groups, (group) => group);
}
