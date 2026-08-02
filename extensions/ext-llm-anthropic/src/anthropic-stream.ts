import {
  mergeUsage,
  parseSseChunk,
  ProviderOverloadedError,
  ProviderRateLimitError,
  ProviderRequestError,
  readGatewayBillingMode,
  readRecord,
  stringifyJsonValue,
} from "veryfront/provider/shared";
import type { RuntimeUsage } from "veryfront/provider/shared";
import {
  type AnthropicProviderToolNameRegistry,
  isAnthropicProviderToolResultBlockType,
  parseAnthropicProviderToolUse,
  parseAnthropicServerToolResult,
} from "./anthropic-native-content.ts";
import { normalizeAnthropicCitation } from "./anthropic-citations.ts";

export {
  AnthropicServerToolResultError,
  parseAnthropicServerToolResult,
} from "./anthropic-native-content.ts";

// Web timers use a signed 32-bit millisecond delay across the supported
// runtimes. Validate here because this extension is published independently
// and cannot rely on a private core utility subpath.
const MAX_PORTABLE_TIMER_DELAY_MS = 2_147_483_647;

function normalizeAnthropicTimerDurationMs(
  durationMs: number,
  optionName: string,
): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError(
      `${optionName} must be finite and between 0 and ${MAX_PORTABLE_TIMER_DELAY_MS} milliseconds`,
    );
  }
  const normalized = Math.ceil(durationMs);
  if (normalized > MAX_PORTABLE_TIMER_DELAY_MS) {
    throw new RangeError(
      `${optionName} must be finite and between 0 and ${MAX_PORTABLE_TIMER_DELAY_MS} milliseconds`,
    );
  }
  return normalized === 0 ? 0 : normalized;
}

type AnthropicStreamToolCallState = {
  id: string;
  name: string;
  inputChunks: string[];
  inputBytes: number;
  partialJsonDeltaCount: number;
  providerExecuted?: boolean;
};

type AnthropicStreamReasoningState = {
  id: string;
  text: string;
  signature?: string;
  redactedData?: string;
};

export type AnthropicStreamCompletion = {
  finishReason: string | { unified: string; raw: string } | null;
  rawStopReason?: string;
  rawContent: unknown[];
  usage?: RuntimeUsage;
};

type AnthropicStreamOptions = {
  clientToolUseTrailingUsageGraceMs?: number;
  clientToolUseTrailingUsageTimeoutMode?: "cancel" | "drain";
  clientToolUseTrailingUsageDrainTimeoutMs?: number;
  allowPostTerminalUsage?: boolean;
  providerLabel?: string;
  providerToolNamesById?: AnthropicProviderToolNameRegistry;
  onCompletion?: (completion: AnthropicStreamCompletion) => void;
};

type AnthropicStreamReadResult =
  | { kind: "chunk"; chunk: Uint8Array }
  | { kind: "done" }
  | { kind: "timeout"; readerMode: "cancel" | "drain" };

const CLIENT_TOOL_USE_FINISH_REASON = { unified: "tool-calls", raw: "tool_use" } as const;
const DEFAULT_CLIENT_TOOL_USE_TRAILING_USAGE_GRACE_MS = 100;
const DEFAULT_CLIENT_TOOL_USE_TRAILING_USAGE_DRAIN_TIMEOUT_MS = 15_000;
const MAX_ANTHROPIC_PARTIAL_JSON_BYTES = 1_048_576;
const MAX_ANTHROPIC_PARTIAL_JSON_DELTAS = 4_096;
const MAX_ANTHROPIC_SSE_EVENT_BYTES = 8_388_608;
const MAX_ANTHROPIC_SSE_REMAINDER_BYTES = 8_388_608;
const ANTHROPIC_TOOL_INPUT_ENCODER = new TextEncoder();

function invalidAnthropicStream(
  providerLabel: string,
  issue: string,
): ProviderRequestError {
  return new ProviderRequestError({
    provider: "anthropic",
    status: 200,
    message: `${providerLabel} request failed: invalid successful stream (${issue})`,
    retryable: false,
  });
}

function readAnthropicStreamIndex(
  record: Record<string, unknown>,
  eventType: string,
  providerLabel: string,
): number {
  if (!Number.isSafeInteger(record.index) || (record.index as number) < 0) {
    throw invalidAnthropicStream(providerLabel, `${eventType} index was malformed`);
  }
  return record.index as number;
}

function appendAnthropicToolInput(
  toolCall: AnthropicStreamToolCallState,
  delta: string,
  countPartialJsonDelta = false,
): void {
  if (
    countPartialJsonDelta &&
    toolCall.partialJsonDeltaCount >= MAX_ANTHROPIC_PARTIAL_JSON_DELTAS
  ) {
    throw new RangeError(
      `Anthropic partial_json exceeded ${MAX_ANTHROPIC_PARTIAL_JSON_DELTAS} deltas`,
    );
  }
  const deltaBytes = ANTHROPIC_TOOL_INPUT_ENCODER.encode(delta).byteLength;
  if (deltaBytes > MAX_ANTHROPIC_PARTIAL_JSON_BYTES - toolCall.inputBytes) {
    throw new RangeError(
      `Anthropic partial_json exceeded ${MAX_ANTHROPIC_PARTIAL_JSON_BYTES} UTF-8 bytes`,
    );
  }
  if (countPartialJsonDelta) {
    toolCall.partialJsonDeltaCount++;
  }
  toolCall.inputBytes += deltaBytes;
  toolCall.inputChunks.push(delta);
}

function joinAnthropicToolInput(toolCall: AnthropicStreamToolCallState): string {
  return toolCall.inputChunks.join("");
}

class BoundedAnthropicSseParser {
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  readonly #providerLabel: string;
  #eventContent: Uint8Array = new Uint8Array(0);
  #eventContentBytes = 0;
  #eventLineCount = 0;
  #eventBytes = 0;
  #line: Uint8Array = new Uint8Array(0);
  #lineBytes = 0;
  #skipLineFeedAfterCarriageReturn = false;

  constructor(providerLabel: string) {
    this.#providerLabel = providerLabel;
  }

  push(chunk: Uint8Array): Array<unknown | "[DONE]"> {
    const events: Array<unknown | "[DONE]"> = [];
    let offset = 0;

    while (offset < chunk.byteLength) {
      if (this.#skipLineFeedAfterCarriageReturn) {
        this.#skipLineFeedAfterCarriageReturn = false;
        if (chunk[offset] === 10) {
          offset++;
          continue;
        }
      }

      let newlineIndex = -1;
      for (let index = offset; index < chunk.byteLength; index++) {
        if (chunk[index] === 10 || chunk[index] === 13) {
          newlineIndex = index;
          break;
        }
      }
      if (newlineIndex < 0) {
        this.#appendLineBytes(chunk.subarray(offset));
        this.#addEventBytes(chunk.byteLength - offset);
        break;
      }

      this.#appendLineBytes(chunk.subarray(offset, newlineIndex));
      this.#addEventBytes(newlineIndex - offset);
      const delimiter = chunk[newlineIndex];
      this.#addEventBytes(1);
      this.#skipLineFeedAfterCarriageReturn = delimiter === 13;
      offset = newlineIndex + 1;
      events.push(...this.#completeLine());
    }
    return events;
  }

  flush(): Array<unknown | "[DONE]"> {
    const events: Array<unknown | "[DONE]"> = [];
    this.#skipLineFeedAfterCarriageReturn = false;
    if (this.#lineBytes > 0) {
      this.#appendEventLine();
      this.#resetLine();
    }
    if (this.#eventBytes > 0 || this.#eventContentBytes > 0) {
      events.push(...this.#completeEvent());
    }
    return events;
  }

  #appendLineBytes(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return;
    if (bytes.byteLength > MAX_ANTHROPIC_SSE_REMAINDER_BYTES - this.#lineBytes) {
      throw new RangeError(
        `Anthropic SSE remainder exceeded ${MAX_ANTHROPIC_SSE_REMAINDER_BYTES} bytes`,
      );
    }
    const requiredBytes = this.#lineBytes + bytes.byteLength;
    this.#line = this.#growBuffer(
      this.#line,
      requiredBytes,
      MAX_ANTHROPIC_SSE_REMAINDER_BYTES,
    );
    this.#line.set(bytes, this.#lineBytes);
    this.#lineBytes += bytes.byteLength;
  }

  #addEventBytes(bytes: number): void {
    if (bytes > MAX_ANTHROPIC_SSE_EVENT_BYTES - this.#eventBytes) {
      throw new RangeError(
        `Anthropic SSE event exceeded ${MAX_ANTHROPIC_SSE_EVENT_BYTES} bytes`,
      );
    }
    this.#eventBytes += bytes;
  }

  #completeLine(): Array<unknown | "[DONE]"> {
    const events = this.#lineBytes === 0 ? this.#completeEvent() : [];
    if (this.#lineBytes > 0) {
      this.#appendEventLine();
    }
    this.#resetLine();
    return events;
  }

  #appendEventLine(): void {
    const separatorBytes = this.#eventLineCount > 0 ? 1 : 0;
    const requiredBytes = this.#eventContentBytes + separatorBytes + this.#lineBytes;
    this.#eventContent = this.#growBuffer(
      this.#eventContent,
      requiredBytes,
      MAX_ANTHROPIC_SSE_EVENT_BYTES,
    );
    if (separatorBytes > 0) {
      this.#eventContent[this.#eventContentBytes++] = 10;
    }
    this.#eventContent.set(this.#line.subarray(0, this.#lineBytes), this.#eventContentBytes);
    this.#eventContentBytes += this.#lineBytes;
    this.#eventLineCount++;
  }

  #growBuffer(buffer: Uint8Array, requiredBytes: number, maximumBytes: number): Uint8Array {
    if (buffer.byteLength >= requiredBytes) return buffer;
    let capacity = Math.min(maximumBytes, Math.max(1_024, buffer.byteLength * 2));
    while (capacity < requiredBytes) {
      capacity = Math.min(maximumBytes, capacity * 2);
    }
    const grown = new Uint8Array(capacity);
    grown.set(buffer);
    return grown;
  }

  #resetLine(): void {
    this.#lineBytes = 0;
  }

  #completeEvent(): Array<unknown | "[DONE]"> {
    let block: string;
    try {
      block = this.#decoder.decode(
        this.#eventContent.subarray(0, this.#eventContentBytes),
      );
    } catch {
      throw invalidAnthropicStream(
        this.#providerLabel,
        "SSE event was not valid UTF-8",
      );
    }
    this.#eventContentBytes = 0;
    this.#eventLineCount = 0;
    this.#eventBytes = 0;
    if (block.length === 0) return [];
    try {
      return parseSseChunk(`${block}\n\n`).events;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw invalidAnthropicStream(
          this.#providerLabel,
          "SSE event contained malformed JSON",
        );
      }
      throw error;
    }
  }
}

function buildAnthropicSseError(record: Record<string, unknown>): Error {
  const error = readRecord(record.error) ?? record;
  const type = typeof error.type === "string" ? error.type : "unknown_error";

  if (type === "overloaded_error") {
    return new ProviderOverloadedError({
      provider: "anthropic",
      status: 529,
      message: "Anthropic stream failed: provider overloaded",
      retryable: true,
    });
  }
  if (type === "rate_limit_error") {
    return new ProviderRateLimitError({
      provider: "anthropic",
      status: 429,
      message: "Anthropic stream failed: rate limit exceeded",
      retryable: true,
    });
  }

  const status = type === "authentication_error"
    ? 401
    : type === "billing_error"
    ? 402
    : type === "permission_error"
    ? 403
    : type === "not_found_error"
    ? 404
    : type === "request_too_large"
    ? 413
    : type === "api_error"
    ? 500
    : 400;
  return new ProviderRequestError({
    provider: "anthropic",
    status,
    message: `Anthropic stream failed with status ${status}`,
    retryable: type === "api_error",
  });
}

function addOptionalTokenCount(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined && right === undefined) {
    return undefined;
  }
  const sum = (left ?? 0) + (right ?? 0);
  return Number.isSafeInteger(sum) && sum >= 0 ? sum : undefined;
}

function addOptionalCost(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined && right === undefined) {
    return undefined;
  }
  const sum = (left ?? 0) + (right ?? 0);
  return Number.isFinite(sum) && sum >= 0 ? sum : undefined;
}

function sanitizeUsage(usage: RuntimeUsage | undefined): RuntimeUsage | undefined {
  const sanitized = mergeUsage(undefined, usage);
  return sanitized && Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function combineCostSource(
  left: RuntimeUsage["costSource"],
  right: RuntimeUsage["costSource"],
): RuntimeUsage["costSource"] {
  if (left === undefined) return right;
  if (right === undefined || left === right) return left;
  return "partial";
}

function combineCaptureStatus(
  left: RuntimeUsage["usageCaptureStatus"],
  right: RuntimeUsage["usageCaptureStatus"],
): RuntimeUsage["usageCaptureStatus"] {
  if (left === undefined) return right;
  if (right === undefined || left === right) return left;
  return "partial";
}

/** Add independently billed Anthropic attempts, such as pause_turn continuations. */
export function addAnthropicUsage(
  current: RuntimeUsage | undefined,
  next: RuntimeUsage | undefined,
): RuntimeUsage | undefined {
  const sanitizedCurrent = sanitizeUsage(current);
  const sanitizedNext = sanitizeUsage(next);
  if (!sanitizedCurrent) return sanitizedNext;
  if (!sanitizedNext) return sanitizedCurrent;

  const costSource = combineCostSource(sanitizedCurrent.costSource, sanitizedNext.costSource);
  const usageCaptureStatus = combineCaptureStatus(
    sanitizedCurrent.usageCaptureStatus,
    sanitizedNext.usageCaptureStatus,
  );
  const billingMode = sanitizedCurrent.billingMode === "deferred" ||
      sanitizedNext.billingMode === "deferred"
    ? "deferred"
    : sanitizedCurrent.billingMode ?? sanitizedNext.billingMode;
  const inputTokens = addOptionalTokenCount(
    sanitizedCurrent.inputTokens,
    sanitizedNext.inputTokens,
  );
  const outputTokens = addOptionalTokenCount(
    sanitizedCurrent.outputTokens,
    sanitizedNext.outputTokens,
  );
  const totalTokens = addOptionalTokenCount(
    sanitizedCurrent.totalTokens,
    sanitizedNext.totalTokens,
  );
  const cacheCreationInputTokens = addOptionalTokenCount(
    sanitizedCurrent.cacheCreationInputTokens,
    sanitizedNext.cacheCreationInputTokens,
  );
  const cacheReadInputTokens = addOptionalTokenCount(
    sanitizedCurrent.cacheReadInputTokens,
    sanitizedNext.cacheReadInputTokens,
  );
  const reasoningTokens = addOptionalTokenCount(
    sanitizedCurrent.reasoningTokens,
    sanitizedNext.reasoningTokens,
  );
  const billableInputTokens = addOptionalTokenCount(
    sanitizedCurrent.billableInputTokens,
    sanitizedNext.billableInputTokens,
  );
  const billableOutputTokens = addOptionalTokenCount(
    sanitizedCurrent.billableOutputTokens,
    sanitizedNext.billableOutputTokens,
  );
  const costUsd = addOptionalCost(
    sanitizedCurrent.costUsd,
    sanitizedNext.costUsd,
  );
  const providerInputCostUsd = addOptionalCost(
    sanitizedCurrent.providerInputCostUsd,
    sanitizedNext.providerInputCostUsd,
  );
  const providerOutputCostUsd = addOptionalCost(
    sanitizedCurrent.providerOutputCostUsd,
    sanitizedNext.providerOutputCostUsd,
  );
  const providerCostUsd = addOptionalCost(
    sanitizedCurrent.providerCostUsd,
    sanitizedNext.providerCostUsd,
  );
  const veryfrontInputChargeUsd = addOptionalCost(
    sanitizedCurrent.veryfrontInputChargeUsd,
    sanitizedNext.veryfrontInputChargeUsd,
  );
  const veryfrontOutputChargeUsd = addOptionalCost(
    sanitizedCurrent.veryfrontOutputChargeUsd,
    sanitizedNext.veryfrontOutputChargeUsd,
  );
  const veryfrontChargeUsd = addOptionalCost(
    sanitizedCurrent.veryfrontChargeUsd,
    sanitizedNext.veryfrontChargeUsd,
  );
  const veryfrontBilledUsd = addOptionalCost(
    sanitizedCurrent.veryfrontBilledUsd,
    sanitizedNext.veryfrontBilledUsd,
  );
  const costCredits = addOptionalCost(
    sanitizedCurrent.costCredits,
    sanitizedNext.costCredits,
  );

  const aggregate: RuntimeUsage = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
    ...(cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens }),
    ...(cacheReadInputTokens === undefined ? {} : { cachedInputTokens: cacheReadInputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(billableInputTokens === undefined ? {} : { billableInputTokens }),
    ...(billableOutputTokens === undefined ? {} : { billableOutputTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(providerInputCostUsd === undefined ? {} : { providerInputCostUsd }),
    ...(providerOutputCostUsd === undefined ? {} : { providerOutputCostUsd }),
    ...(providerCostUsd === undefined ? {} : { providerCostUsd }),
    ...(veryfrontInputChargeUsd === undefined ? {} : { veryfrontInputChargeUsd }),
    ...(veryfrontOutputChargeUsd === undefined ? {} : { veryfrontOutputChargeUsd }),
    ...(veryfrontChargeUsd === undefined ? {} : { veryfrontChargeUsd }),
    ...(veryfrontBilledUsd === undefined ? {} : { veryfrontBilledUsd }),
    ...(costCredits === undefined ? {} : { costCredits }),
    ...(costSource === undefined ? {} : { costSource }),
    ...(billingMode === undefined ? {} : { billingMode }),
    ...(usageCaptureStatus === undefined ? {} : { usageCaptureStatus }),
  };
  return Object.keys(aggregate).length > 0 ? aggregate : undefined;
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0,
  );
}

export function normalizeAnthropicFinishReason(
  raw: unknown,
): string | { unified: string; raw: string } | null {
  if (typeof raw !== "string") {
    return null;
  }

  switch (raw) {
    case "tool_use":
      return { unified: "tool-calls", raw };
    case "end_turn":
    case "stop_sequence":
      return { unified: "stop", raw };
    case "max_tokens":
      return { unified: "length", raw };
    default:
      return raw;
  }
}

export function extractAnthropicUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheCreationInputTokens = usage.cache_creation_input_tokens;
  const cacheReadInputTokens = usage.cache_read_input_tokens;
  const veryfront = readRecord(usage.veryfront);
  const costSource = veryfront?.cost_source;
  const billingMode = readGatewayBillingMode(veryfront?.billing_mode);
  const usageCaptureStatus = veryfront?.usage_capture_status;

  return sanitizeUsage({
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof inputTokens === "number" || typeof outputTokens === "number"
      ? (typeof inputTokens === "number" ? inputTokens : 0) +
        (typeof outputTokens === "number" ? outputTokens : 0)
      : undefined,
    ...(typeof cacheCreationInputTokens === "number" ? { cacheCreationInputTokens } : {}),
    ...(typeof cacheReadInputTokens === "number" ? { cacheReadInputTokens } : {}),
    ...(typeof veryfront?.billable_input_tokens === "number"
      ? { billableInputTokens: veryfront.billable_input_tokens }
      : {}),
    ...(typeof veryfront?.billable_output_tokens === "number"
      ? { billableOutputTokens: veryfront.billable_output_tokens }
      : {}),
    ...(typeof veryfront?.provider_input_cost_usd === "number"
      ? { providerInputCostUsd: veryfront.provider_input_cost_usd }
      : {}),
    ...(typeof veryfront?.provider_output_cost_usd === "number"
      ? { providerOutputCostUsd: veryfront.provider_output_cost_usd }
      : {}),
    ...(typeof veryfront?.provider_cost_usd === "number"
      ? { providerCostUsd: veryfront.provider_cost_usd }
      : {}),
    ...(typeof veryfront?.veryfront_input_charge_usd === "number"
      ? { veryfrontInputChargeUsd: veryfront.veryfront_input_charge_usd }
      : {}),
    ...(typeof veryfront?.veryfront_output_charge_usd === "number"
      ? { veryfrontOutputChargeUsd: veryfront.veryfront_output_charge_usd }
      : {}),
    ...(typeof veryfront?.veryfront_charge_usd === "number"
      ? { veryfrontChargeUsd: veryfront.veryfront_charge_usd }
      : {}),
    ...(typeof veryfront?.veryfront_billed_usd === "number"
      ? { veryfrontBilledUsd: veryfront.veryfront_billed_usd }
      : {}),
    ...(typeof veryfront?.cost_credits === "number" ? { costCredits: veryfront.cost_credits } : {}),
    ...(costSource === "gateway" || costSource === "missing" || costSource === "partial"
      ? { costSource }
      : {}),
    ...(billingMode !== undefined ? { billingMode } : {}),
    ...(usageCaptureStatus === "complete" ||
        usageCaptureStatus === "missing" ||
        usageCaptureStatus === "partial"
      ? { usageCaptureStatus }
      : {}),
  });
}

function isToolCallsFinishReason(
  finishReason: string | { unified: string; raw: string } | null,
): boolean {
  return finishReason === "tool-calls" ||
    (typeof finishReason === "object" && finishReason?.unified === "tool-calls");
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs?: number,
  timeoutMode: "cancel" | "drain" = "cancel",
  drainTimeoutMs = DEFAULT_CLIENT_TOOL_USE_TRAILING_USAGE_DRAIN_TIMEOUT_MS,
): Promise<AnthropicStreamReadResult> {
  if (timeoutMs === undefined) {
    const read = await reader.read();
    return read.done ? { kind: "done" } : { kind: "chunk", chunk: read.value };
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const readPromise = reader.read().then((read): AnthropicStreamReadResult =>
    read.done ? { kind: "done" } : { kind: "chunk", chunk: read.value }
  );
  const timeoutPromise = new Promise<AnthropicStreamReadResult>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({ kind: "timeout", readerMode: timeoutMode }),
      timeoutMs,
    );
  });

  try {
    const result = await Promise.race([readPromise, timeoutPromise]);
    if (result.kind === "timeout") {
      if (timeoutMode === "drain") {
        void drainStreamReaderAfterTimeout(reader, readPromise, drainTimeoutMs);
      } else {
        cancelStreamReader(
          reader,
          "Timed out waiting for trailing Anthropic tool-use usage metadata",
        );
      }
    }
    return result;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function cancelStreamReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: string,
): void {
  try {
    // Web Streams closes pending reads immediately, but a hostile underlying
    // source may return a never-settling cancellation promise. Cleanup must
    // not keep the consumer or timeout path waiting on that source.
    void reader.cancel(reason).catch(() => {
      // The upstream body may already be closed or canceled by the runtime.
    });
  } catch {
    // The upstream body may already be closed or canceled by the runtime.
  }
}

async function drainStreamReaderAfterTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  pendingRead: Promise<AnthropicStreamReadResult>,
  timeoutMs: number,
): Promise<void> {
  const timeoutId = setTimeout(() => {
    void cancelStreamReader(
      reader,
      "Timed out draining trailing Anthropic tool-use usage metadata",
    );
  }, timeoutMs);

  try {
    const firstRead = await pendingRead;
    if (firstRead.kind === "done") {
      return;
    }

    while (true) {
      const read = await reader.read();
      if (read.done) {
        return;
      }
    }
  } catch {
    // The caller has already emitted a finish event; late drain failures should
    // not fail the completed tool turn.
  } finally {
    clearTimeout(timeoutId);
    reader.releaseLock();
  }
}

export async function* streamAnthropicCompatibleParts(
  stream: ReadableStream<Uint8Array>,
  options: AnthropicStreamOptions = {},
): AsyncIterable<unknown> {
  const providerLabel = options.providerLabel ?? "anthropic";
  const sseParser = new BoundedAnthropicSseParser(providerLabel);
  const trailingUsageGraceMs = normalizeAnthropicTimerDurationMs(
    options.clientToolUseTrailingUsageGraceMs ??
      DEFAULT_CLIENT_TOOL_USE_TRAILING_USAGE_GRACE_MS,
    "clientToolUseTrailingUsageGraceMs",
  );
  const trailingUsageTimeoutMode = options.clientToolUseTrailingUsageTimeoutMode ?? "cancel";
  const trailingUsageDrainTimeoutMs = normalizeAnthropicTimerDurationMs(
    options.clientToolUseTrailingUsageDrainTimeoutMs ??
      DEFAULT_CLIENT_TOOL_USE_TRAILING_USAGE_DRAIN_TIMEOUT_MS,
    "clientToolUseTrailingUsageDrainTimeoutMs",
  );
  if (trailingUsageGraceMs === 0 || trailingUsageDrainTimeoutMs === 0) {
    throw new RangeError(
      "Anthropic trailing usage timeouts must be greater than zero",
    );
  }
  const reader = stream.getReader();
  const allowPostTerminalUsage = options.allowPostTerminalUsage === true;
  const providerToolNamesById = options.providerToolNamesById ?? new Map<string, string>();
  let readerReleased = false;
  let sourceSettled = false;
  const toolCalls = new Map<number, AnthropicStreamToolCallState>();
  const reasoningBlocks = new Map<number, AnthropicStreamReasoningState>();
  const rawContentBlocks = new Map<number, Record<string, unknown>>();
  const openContentBlocks = new Set<number>();
  const seenContentBlocks = new Set<number>();
  const supportedContentBlocks = new Set<number>();
  let finishReason: string | { unified: string; raw: string } | null = null;
  let rawStopReason: string | undefined;
  let usage: RuntimeUsage | undefined;
  let completedClientToolUseStep = false;
  let clientToolUseIdleDeadlineMs: number | null = null;
  let clientToolUseTerminalDeadlineMs: number | null = null;
  let sawMessageStart = false;
  let sawMessageStop = false;
  let sawDoneMarker = false;
  let sawStopReason = false;
  let completedSupportedContentBlocks = 0;

  const mergeRecordUsage = (record: Record<string, unknown>) => {
    usage = mergeUsage(usage, extractAnthropicUsage(record));
  };

  const applyTrailingLifecycleEvent = (event: unknown | "[DONE]") => {
    if (event === "[DONE]") {
      if (
        sawDoneMarker ||
        !sawMessageStart ||
        !sawStopReason ||
        openContentBlocks.size > 0 ||
        reasoningBlocks.size > 0 ||
        toolCalls.size > 0
      ) {
        throw invalidAnthropicStream(providerLabel, "terminal marker was out of sequence");
      }
      sawDoneMarker = true;
      return;
    }

    const record = readRecord(event);
    const eventType = typeof record?.type === "string" && record.type.length > 0
      ? record.type
      : undefined;
    if (!record || !eventType) {
      throw invalidAnthropicStream(providerLabel, "trailing event type was missing");
    }
    if (eventType === "error") {
      throw buildAnthropicSseError(record);
    }
    if (eventType === "ping") {
      return;
    }
    if (eventType === "message_stop") {
      if (
        sawDoneMarker ||
        sawMessageStop ||
        !sawMessageStart ||
        !sawStopReason ||
        openContentBlocks.size > 0 ||
        reasoningBlocks.size > 0 ||
        toolCalls.size > 0
      ) {
        throw invalidAnthropicStream(providerLabel, "message_stop was out of sequence");
      }
      sawMessageStop = true;
      return;
    }
    if (eventType !== "message_delta") {
      throw invalidAnthropicStream(
        providerLabel,
        "trailing event was not a usage-bearing lifecycle event",
      );
    }

    const delta = readRecord(record.delta);
    if (!delta) {
      throw invalidAnthropicStream(providerLabel, "message delta was malformed");
    }
    if (sawMessageStop || sawDoneMarker) {
      if (
        !allowPostTerminalUsage ||
        Object.keys(delta).length > 0 ||
        !readRecord(record.usage)
      ) {
        throw invalidAnthropicStream(
          providerLabel,
          "event followed the terminal message_stop",
        );
      }
      mergeRecordUsage(record);
      return;
    }
    if (
      !sawMessageStart ||
      openContentBlocks.size > 0 ||
      reasoningBlocks.size > 0 ||
      toolCalls.size > 0
    ) {
      throw invalidAnthropicStream(providerLabel, "message_delta was out of sequence");
    }
    if (
      delta.stop_reason !== undefined &&
      delta.stop_reason !== null &&
      (typeof delta.stop_reason !== "string" || delta.stop_reason.length === 0)
    ) {
      throw invalidAnthropicStream(providerLabel, "message stop reason was malformed");
    }
    if (typeof delta.stop_reason === "string") {
      if (sawStopReason) {
        throw invalidAnthropicStream(providerLabel, "message stop reason was repeated");
      }
      sawStopReason = true;
      rawStopReason = delta.stop_reason;
      finishReason = normalizeAnthropicFinishReason(delta.stop_reason);
    }
    mergeRecordUsage(record);
  };

  const mergeTrailingBufferUsage = () => {
    for (const event of sseParser.flush()) {
      applyTrailingLifecycleEvent(event);
    }
  };

  const getClientToolUseReadTimeoutMs = () => {
    if (
      !completedClientToolUseStep ||
      toolCalls.size > 0 ||
      reasoningBlocks.size > 0 ||
      openContentBlocks.size > 0
    ) {
      return undefined;
    }

    const deadline = isToolCallsFinishReason(finishReason)
      ? clientToolUseTerminalDeadlineMs
      : clientToolUseIdleDeadlineMs;
    return deadline === null ? undefined : Math.max(1, deadline - Date.now());
  };

  const validateCompletion = () => {
    if (!sawMessageStart) {
      throw invalidAnthropicStream(providerLabel, "stream contained no provider envelope");
    }
    if (
      openContentBlocks.size > 0 ||
      reasoningBlocks.size > 0 ||
      toolCalls.size > 0
    ) {
      throw invalidAnthropicStream(providerLabel, "stream ended with unfinished content blocks");
    }
    if (completedSupportedContentBlocks === 0 && seenContentBlocks.size > 0) {
      throw invalidAnthropicStream(providerLabel, "stream contained no supported content blocks");
    }
    if (!sawStopReason && !completedClientToolUseStep) {
      throw invalidAnthropicStream(providerLabel, "stream ended before a stop reason");
    }
    if (!sawMessageStop && !sawDoneMarker && !completedClientToolUseStep) {
      throw invalidAnthropicStream(providerLabel, "stream ended before a terminal marker");
    }
  };

  const buildFinishPart = () => ({
    type: "finish",
    finishReason: finishReason ??
      (completedClientToolUseStep ? CLIENT_TOOL_USE_FINISH_REASON : null),
    ...(usage ? { usage } : {}),
  });

  const notifyCompletion = () => {
    options.onCompletion?.({
      finishReason: finishReason ??
        (completedClientToolUseStep ? CLIENT_TOOL_USE_FINISH_REASON : null),
      ...(rawStopReason === undefined ? {} : { rawStopReason }),
      rawContent: [...rawContentBlocks.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, block]) => block),
      ...(usage ? { usage } : {}),
    });
  };

  try {
    while (true) {
      const read = await readStreamChunk(
        reader,
        getClientToolUseReadTimeoutMs(),
        trailingUsageTimeoutMode,
        trailingUsageDrainTimeoutMs,
      );
      if (read.kind === "timeout") {
        sourceSettled = true;
        readerReleased = read.readerMode === "drain";
        mergeTrailingBufferUsage();
        validateCompletion();
        finishReason ??= CLIENT_TOOL_USE_FINISH_REASON;
        notifyCompletion();
        yield buildFinishPart();
        return;
      }

      const reachedEndOfStream = read.kind === "done";
      if (reachedEndOfStream) {
        sourceSettled = true;
      }

      const events = reachedEndOfStream ? sseParser.flush() : sseParser.push(read.chunk);
      for (const event of events) {
        if (event === "[DONE]") {
          applyTrailingLifecycleEvent(event);
          continue;
        }

        const record = readRecord(event);
        if (!record) {
          throw invalidAnthropicStream(providerLabel, "event was not an object");
        }
        const eventType = typeof record.type === "string" && record.type.length > 0
          ? record.type
          : undefined;
        if (!eventType) {
          throw invalidAnthropicStream(providerLabel, "event type was missing");
        }

        if (sawMessageStop || sawDoneMarker) {
          applyTrailingLifecycleEvent(event);
          continue;
        }
        mergeRecordUsage(record);

        if (eventType === "error") {
          throw buildAnthropicSseError(record);
        }

        if (eventType === "message_start") {
          if (
            sawMessageStart ||
            seenContentBlocks.size > 0 ||
            sawStopReason
          ) {
            throw invalidAnthropicStream(providerLabel, "message_start was out of sequence");
          }
          const message = readRecord(record.message);
          if (!message) {
            throw invalidAnthropicStream(providerLabel, "message_start message was malformed");
          }
          sawMessageStart = true;
          mergeRecordUsage(message);
          continue;
        }

        if (eventType === "content_block_start") {
          if (!sawMessageStart || sawStopReason) {
            throw invalidAnthropicStream(
              providerLabel,
              "content_block_start was out of sequence",
            );
          }
          const index = readAnthropicStreamIndex(record, eventType, providerLabel);
          const contentBlock = readRecord(record.content_block);
          const blockType = typeof contentBlock?.type === "string" && contentBlock.type.length > 0
            ? contentBlock.type
            : undefined;
          if (!contentBlock || !blockType) {
            throw invalidAnthropicStream(
              providerLabel,
              "content_block_start content block was malformed",
            );
          }
          if (seenContentBlocks.has(index)) {
            throw invalidAnthropicStream(providerLabel, "content block index was reused");
          }
          seenContentBlocks.add(index);
          openContentBlocks.add(index);
          clientToolUseIdleDeadlineMs = null;
          clientToolUseTerminalDeadlineMs = null;
          rawContentBlocks.set(index, { ...contentBlock });

          if (blockType === "text") {
            if (typeof contentBlock.text !== "string") {
              throw invalidAnthropicStream(providerLabel, "text content block was malformed");
            }
            supportedContentBlocks.add(index);
            if (contentBlock.text.length > 0) {
              yield { type: "text-delta", delta: contentBlock.text };
            }
            continue;
          }

          if (blockType === "thinking") {
            if (
              (contentBlock.thinking !== undefined &&
                typeof contentBlock.thinking !== "string") ||
              (contentBlock.signature !== undefined &&
                typeof contentBlock.signature !== "string")
            ) {
              throw invalidAnthropicStream(providerLabel, "thinking content block was malformed");
            }
            supportedContentBlocks.add(index);
            const reasoningId = `thinking-${index}`;
            reasoningBlocks.set(index, {
              id: reasoningId,
              text: "",
              ...(typeof contentBlock.signature === "string"
                ? { signature: contentBlock.signature }
                : {}),
            });
            yield {
              type: "reasoning-start",
              id: reasoningId,
            };

            if (typeof contentBlock?.thinking === "string" && contentBlock.thinking.length > 0) {
              const current = reasoningBlocks.get(index);
              if (current) {
                current.text += contentBlock.thinking;
              }
              yield {
                type: "reasoning-delta",
                id: reasoningId,
                delta: contentBlock.thinking,
              };
            }
            continue;
          }

          // Redacted thinking blocks arrive as opaque encrypted payloads when
          // Claude's safety classifier flags the reasoning trace. Surface them
          // as a zero-length reasoning block so callers know thinking happened
          // without leaking the (legitimately hidden) contents.
          if (blockType === "redacted_thinking") {
            if (typeof contentBlock.data !== "string" || contentBlock.data.length === 0) {
              throw invalidAnthropicStream(
                providerLabel,
                "redacted thinking content block was malformed",
              );
            }
            supportedContentBlocks.add(index);
            const reasoningId = `thinking-${index}`;
            reasoningBlocks.set(index, {
              id: reasoningId,
              text: "",
              redactedData: contentBlock.data,
            });
            yield {
              type: "reasoning-start",
              id: reasoningId,
            };
            continue;
          }

          if (blockType === "tool_use") {
            if (
              typeof contentBlock.id !== "string" ||
              contentBlock.id.length === 0 ||
              typeof contentBlock.name !== "string" ||
              contentBlock.name.length === 0 ||
              (contentBlock.input !== undefined && !readRecord(contentBlock.input))
            ) {
              throw invalidAnthropicStream(providerLabel, "tool-use content block was malformed");
            }
            supportedContentBlocks.add(index);
            const current: AnthropicStreamToolCallState = {
              id: contentBlock.id,
              name: contentBlock.name,
              inputChunks: [],
              inputBytes: 0,
              partialJsonDeltaCount: 0,
            };

            toolCalls.set(index, current);
            clientToolUseIdleDeadlineMs = null;
            clientToolUseTerminalDeadlineMs = null;
            yield {
              type: "tool-input-start",
              id: current.id,
              toolName: current.name,
            };

            const initialInput = contentBlock.input;
            if (initialInput !== undefined && !isEmptyRecord(initialInput)) {
              const serializedInput = stringifyJsonValue(initialInput);
              appendAnthropicToolInput(current, serializedInput);
              yield {
                type: "tool-input-delta",
                id: current.id,
                delta: serializedInput,
              };
            }
            continue;
          }

          if (blockType === "server_tool_use" || blockType === "mcp_tool_use") {
            const providerToolUse = parseAnthropicProviderToolUse(contentBlock);
            if (
              !providerToolUse ||
              providerToolNamesById.has(providerToolUse.toolCallId)
            ) {
              throw invalidAnthropicStream(
                providerLabel,
                "provider tool-use content block was malformed",
              );
            }
            providerToolNamesById.set(
              providerToolUse.toolCallId,
              providerToolUse.toolName,
            );
            supportedContentBlocks.add(index);
            const current: AnthropicStreamToolCallState = {
              id: providerToolUse.toolCallId,
              name: providerToolUse.toolName,
              inputChunks: [],
              inputBytes: 0,
              partialJsonDeltaCount: 0,
              providerExecuted: true,
            };
            toolCalls.set(index, current);
            yield {
              type: "tool-input-start",
              id: current.id,
              toolName: current.name,
              providerExecuted: true,
            };

            if (!isEmptyRecord(providerToolUse.input)) {
              const serializedInput = stringifyJsonValue(providerToolUse.input);
              appendAnthropicToolInput(current, serializedInput);
              yield {
                type: "tool-input-delta",
                id: current.id,
                delta: serializedInput,
              };
            }
            continue;
          }

          if (isAnthropicProviderToolResultBlockType(blockType)) {
            const parsedResult = parseAnthropicServerToolResult(
              contentBlock,
              providerToolNamesById,
            );
            if (!parsedResult) {
              const issue = blockType === "web_search_tool_result"
                ? "web-search result block was malformed"
                : blockType === "web_fetch_tool_result"
                ? "web-fetch result block was malformed"
                : "provider tool-result content block was malformed";
              throw invalidAnthropicStream(
                providerLabel,
                issue,
              );
            }
            providerToolNamesById.delete(parsedResult.toolCallId);
            supportedContentBlocks.add(index);
            yield parsedResult.isError === true
              ? {
                type: "tool-error",
                toolCallId: parsedResult.toolCallId,
                toolName: parsedResult.toolName,
                error: parsedResult.result,
                isError: true,
                providerExecuted: true,
              }
              : {
                type: "tool-result",
                ...parsedResult,
                providerExecuted: true,
              };
            continue;
          }

          throw invalidAnthropicStream(
            providerLabel,
            "unsupported content block type",
          );
        }

        if (eventType === "content_block_delta") {
          const index = readAnthropicStreamIndex(record, eventType, providerLabel);
          if (!openContentBlocks.has(index)) {
            throw invalidAnthropicStream(
              providerLabel,
              "content block delta referenced an unopened block",
            );
          }
          const delta = readRecord(record.delta);
          const deltaType = typeof delta?.type === "string" && delta.type.length > 0
            ? delta.type
            : undefined;
          if (!delta || !deltaType) {
            throw invalidAnthropicStream(providerLabel, "content block delta was malformed");
          }
          if (deltaType === "text_delta") {
            if (typeof delta.text !== "string") {
              throw invalidAnthropicStream(providerLabel, "text delta was malformed");
            }
            const rawBlock = rawContentBlocks.get(index);
            if (!rawBlock || rawBlock.type !== "text") {
              throw invalidAnthropicStream(
                providerLabel,
                "text delta did not match its content block",
              );
            }
            rawBlock.text = `${
              typeof rawBlock.text === "string" ? rawBlock.text : ""
            }${delta.text}`;
            if (delta.text.length > 0) {
              yield { type: "text-delta", delta: delta.text };
            }
            continue;
          }

          if (deltaType === "thinking_delta") {
            if (typeof delta.thinking !== "string") {
              throw invalidAnthropicStream(providerLabel, "thinking delta was malformed");
            }
            const current = reasoningBlocks.get(index);
            if (!current) {
              throw invalidAnthropicStream(
                providerLabel,
                "thinking delta did not match its content block",
              );
            }

            current.text += delta.thinking;
            const rawBlock = rawContentBlocks.get(index);
            if (rawBlock) {
              rawBlock.thinking = `${
                typeof rawBlock.thinking === "string" ? rawBlock.thinking : ""
              }${delta.thinking}`;
            }
            if (delta.thinking.length > 0) {
              yield {
                type: "reasoning-delta",
                id: current.id,
                delta: delta.thinking,
              };
            }
            continue;
          }

          if (deltaType === "signature_delta") {
            if (typeof delta.signature !== "string") {
              throw invalidAnthropicStream(providerLabel, "signature delta was malformed");
            }
            const current = reasoningBlocks.get(index);
            if (!current) {
              throw invalidAnthropicStream(
                providerLabel,
                "signature delta did not match its content block",
              );
            }
            current.signature = delta.signature;
            const rawBlock = rawContentBlocks.get(index);
            if (rawBlock) rawBlock.signature = delta.signature;
            continue;
          }

          const citation = readRecord(delta?.citation);
          if (deltaType === "citations_delta") {
            if (!citation || !normalizeAnthropicCitation(citation)) {
              throw invalidAnthropicStream(providerLabel, "citation delta was malformed");
            }
            const rawBlock = rawContentBlocks.get(index);
            if (!rawBlock || rawBlock.type !== "text") {
              throw invalidAnthropicStream(
                providerLabel,
                "citation delta did not match its content block",
              );
            }
            const citations = Array.isArray(rawBlock.citations) ? rawBlock.citations : [];
            citations.push(citation);
            rawBlock.citations = citations;
            continue;
          }

          if (deltaType === "input_json_delta") {
            if (typeof delta.partial_json !== "string") {
              throw invalidAnthropicStream(providerLabel, "tool-input delta was malformed");
            }
            const current = toolCalls.get(index);
            if (!current) {
              throw invalidAnthropicStream(
                providerLabel,
                "tool-input delta did not match its content block",
              );
            }

            appendAnthropicToolInput(current, delta.partial_json, true);
            yield {
              type: "tool-input-delta",
              id: current.id,
              delta: delta.partial_json,
            };
            continue;
          }

          throw invalidAnthropicStream(
            providerLabel,
            "unsupported content block delta type",
          );
        }

        if (eventType === "content_block_stop") {
          const index = readAnthropicStreamIndex(record, eventType, providerLabel);
          if (!openContentBlocks.delete(index)) {
            throw invalidAnthropicStream(
              providerLabel,
              "content block stop referenced an unopened block",
            );
          }
          if (supportedContentBlocks.delete(index)) {
            completedSupportedContentBlocks++;
          }
          const reasoning = reasoningBlocks.get(index);
          if (reasoning) {
            yield {
              type: "reasoning-end",
              id: reasoning.id,
              ...(reasoning.signature ? { signature: reasoning.signature } : {}),
              ...(reasoning.redactedData ? { redactedData: reasoning.redactedData } : {}),
            };
            reasoningBlocks.delete(index);
            continue;
          }

          const current = toolCalls.get(index);
          if (!current) {
            continue;
          }
          const input = joinAnthropicToolInput(current) || "{}";
          let parsedInput: Record<string, unknown>;
          try {
            const parsed = JSON.parse(input) as unknown;
            const parsedRecord = readRecord(parsed);
            if (!parsedRecord) {
              throw new TypeError("tool input was not an object");
            }
            parsedInput = parsedRecord;
          } catch {
            throw invalidAnthropicStream(
              providerLabel,
              "tool call arguments were not valid JSON object text",
            );
          }

          const rawBlock = rawContentBlocks.get(index);
          if (rawBlock) rawBlock.input = parsedInput;

          yield {
            type: "tool-call",
            toolCallId: current.id,
            toolName: current.name,
            input,
            ...(current.providerExecuted ? { providerExecuted: true } : {}),
          };
          if (!current.providerExecuted) {
            completedClientToolUseStep = true;
            clientToolUseIdleDeadlineMs = null;
          }
          toolCalls.delete(index);
          continue;
        }

        if (eventType === "message_delta") {
          if (
            !sawMessageStart ||
            openContentBlocks.size > 0 ||
            reasoningBlocks.size > 0 ||
            toolCalls.size > 0
          ) {
            throw invalidAnthropicStream(providerLabel, "message_delta was out of sequence");
          }
          const delta = readRecord(record.delta);
          if (!delta) {
            throw invalidAnthropicStream(providerLabel, "message delta was malformed");
          }
          if (
            delta.stop_reason !== undefined &&
            delta.stop_reason !== null &&
            (typeof delta.stop_reason !== "string" || delta.stop_reason.length === 0)
          ) {
            throw invalidAnthropicStream(providerLabel, "message stop reason was malformed");
          }
          if (typeof delta.stop_reason === "string") {
            if (sawStopReason) {
              throw invalidAnthropicStream(providerLabel, "message stop reason was repeated");
            }
            rawStopReason = delta.stop_reason;
            sawStopReason = true;
          }
          const normalizedFinishReason = normalizeAnthropicFinishReason(delta.stop_reason);
          if (normalizedFinishReason) {
            finishReason = normalizedFinishReason;
          }
          continue;
        }

        if (eventType === "message_stop") {
          if (
            !sawMessageStart ||
            !sawStopReason ||
            openContentBlocks.size > 0 ||
            reasoningBlocks.size > 0 ||
            toolCalls.size > 0
          ) {
            throw invalidAnthropicStream(providerLabel, "message_stop was out of sequence");
          }
          sawMessageStop = true;
          continue;
        }

        if (eventType === "ping") {
          continue;
        }
        throw invalidAnthropicStream(
          providerLabel,
          "unsupported event type",
        );
      }

      if (
        completedClientToolUseStep &&
        toolCalls.size === 0 &&
        reasoningBlocks.size === 0 &&
        openContentBlocks.size === 0
      ) {
        if (isToolCallsFinishReason(finishReason)) {
          clientToolUseIdleDeadlineMs = null;
          clientToolUseTerminalDeadlineMs ??= Date.now() + trailingUsageGraceMs;
        } else {
          clientToolUseIdleDeadlineMs ??= Date.now() + trailingUsageGraceMs;
        }
      } else {
        clientToolUseIdleDeadlineMs = null;
        clientToolUseTerminalDeadlineMs = null;
      }
      if (reachedEndOfStream) {
        break;
      }
    }
  } finally {
    if (!readerReleased) {
      if (!sourceSettled) {
        cancelStreamReader(reader, "Anthropic stream consumer returned before completion");
      }
      reader.releaseLock();
    }
  }

  mergeTrailingBufferUsage();
  validateCompletion();

  notifyCompletion();
  yield buildFinishPart();
}
