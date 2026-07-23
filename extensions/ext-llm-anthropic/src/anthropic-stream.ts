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
  readonly #decoder = new TextDecoder();
  #eventContent: Uint8Array = new Uint8Array(0);
  #eventContentBytes = 0;
  #eventLineCount = 0;
  #eventBytes = 0;
  #line: Uint8Array = new Uint8Array(0);
  #lineBytes = 0;

  push(chunk: Uint8Array): Array<unknown | "[DONE]"> {
    const events: Array<unknown | "[DONE]"> = [];
    let offset = 0;
    while (offset < chunk.byteLength) {
      const newlineIndex = chunk.indexOf(10, offset);
      if (newlineIndex < 0) {
        this.#appendLineBytes(chunk.subarray(offset));
        this.#addEventBytes(chunk.byteLength - offset);
        break;
      }

      this.#appendLineBytes(chunk.subarray(offset, newlineIndex));
      this.#addEventBytes(newlineIndex - offset + 1);
      const blankLine = this.#lineBytes === 0 ||
        this.#lineBytes === 1 && this.#lastLineByte() === 13;
      if (blankLine) {
        events.push(...this.#completeEvent());
      } else {
        this.#appendEventLine();
      }
      this.#resetLine();
      offset = newlineIndex + 1;
    }
    return events;
  }

  flush(): Array<unknown | "[DONE]"> {
    if (this.#lineBytes > 0) {
      this.#appendEventLine();
      this.#resetLine();
    }
    return this.#eventBytes > 0 || this.#eventContentBytes > 0 ? this.#completeEvent() : [];
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

  #lastLineByte(): number | undefined {
    return this.#lineBytes > 0 ? this.#line[this.#lineBytes - 1] : undefined;
  }

  #appendEventLine(): void {
    const lineContentBytes = this.#lastLineByte() === 13 ? this.#lineBytes - 1 : this.#lineBytes;
    const separatorBytes = this.#eventLineCount > 0 ? 1 : 0;
    const requiredBytes = this.#eventContentBytes + separatorBytes + lineContentBytes;
    this.#eventContent = this.#growBuffer(
      this.#eventContent,
      requiredBytes,
      MAX_ANTHROPIC_SSE_EVENT_BYTES,
    );
    if (separatorBytes > 0) {
      this.#eventContent[this.#eventContentBytes++] = 10;
    }
    this.#eventContent.set(this.#line.subarray(0, lineContentBytes), this.#eventContentBytes);
    this.#eventContentBytes += lineContentBytes;
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
    const block = this.#decoder.decode(this.#eventContent.subarray(0, this.#eventContentBytes));
    this.#eventContentBytes = 0;
    this.#eventLineCount = 0;
    this.#eventBytes = 0;
    if (block.length === 0) return [];
    return parseSseChunk(`${block}\n\n`).events;
  }
}

function buildAnthropicSseError(record: Record<string, unknown>): Error {
  const error = readRecord(record.error) ?? record;
  const type = typeof error.type === "string" ? error.type : "unknown_error";
  const message = typeof error.message === "string"
    ? error.message
    : `Anthropic stream failed with ${type}`;

  if (type === "overloaded_error") {
    return new ProviderOverloadedError({
      provider: "anthropic",
      status: 529,
      message,
      retryable: true,
    });
  }
  if (type === "rate_limit_error") {
    return new ProviderRateLimitError({
      provider: "anthropic",
      status: 429,
      message,
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
    message,
    retryable: type === "api_error",
  });
}

export class AnthropicServerToolResultError extends Error {
  override readonly name = "AnthropicServerToolResultError";
  readonly provider = "anthropic";
  readonly code: string;
  readonly toolCallId: string;
  readonly toolName: "web_search" | "web_fetch";

  constructor(options: {
    code: string;
    toolCallId: string;
    toolName: "web_search" | "web_fetch";
  }) {
    super(
      `Anthropic ${options.toolName} failed with ${options.code} ` +
        `(tool call ${options.toolCallId})`,
    );
    this.code = options.code;
    this.toolCallId = options.toolCallId;
    this.toolName = options.toolName;
  }
}

export type AnthropicServerToolResult = {
  toolCallId: string;
  toolName: "web_search" | "web_fetch";
  result: unknown;
  isError?: true;
};

function firstDefined(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function setDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

function normalizeWebSearchResult(value: unknown): unknown {
  const record = readRecord(value);
  if (!record) return value;

  const normalized: Record<string, unknown> = {};
  setDefined(normalized, "type", record.type);
  setDefined(normalized, "url", record.url);
  setDefined(normalized, "title", record.title);
  setDefined(normalized, "pageAge", firstDefined(record, "page_age", "pageAge"));
  setDefined(
    normalized,
    "encryptedContent",
    firstDefined(record, "encrypted_content", "encryptedContent"),
  );
  return normalized;
}

function normalizeWebFetchResult(value: unknown): unknown {
  const record = readRecord(value);
  if (!record) return value;

  const rawContent = readRecord(record.content);
  const rawSource = readRecord(rawContent?.source);
  const source = rawSource
    ? {
      ...rawSource,
      ...(firstDefined(rawSource, "media_type", "mediaType") === undefined
        ? {}
        : { mediaType: firstDefined(rawSource, "media_type", "mediaType") }),
    }
    : rawContent?.source;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    delete (source as Record<string, unknown>).media_type;
  }
  const content = rawContent
    ? {
      ...rawContent,
      ...(source === undefined ? {} : { source }),
    }
    : record.content;

  const normalized: Record<string, unknown> = {};
  setDefined(normalized, "type", record.type);
  setDefined(normalized, "url", record.url);
  setDefined(normalized, "content", content);
  setDefined(normalized, "retrievedAt", firstDefined(record, "retrieved_at", "retrievedAt"));
  return normalized;
}

export function parseAnthropicServerToolResult(
  value: unknown,
): AnthropicServerToolResult | undefined {
  const block = readRecord(value);
  if (!block) return undefined;
  const blockType = typeof block?.type === "string" ? block.type : undefined;
  const toolCallId = typeof block?.tool_use_id === "string" ? block.tool_use_id : undefined;
  const toolName = blockType === "web_search_tool_result"
    ? "web_search"
    : blockType === "web_fetch_tool_result"
    ? "web_fetch"
    : undefined;
  if (!toolName || !toolCallId) return undefined;

  const error = readRecord(block.content);
  const expectedErrorType = `${toolName}_tool_result_error`;
  if (error?.type === expectedErrorType && typeof error.error_code === "string") {
    return {
      toolCallId,
      toolName,
      result: new AnthropicServerToolResultError({
        code: error.error_code,
        toolCallId,
        toolName,
      }),
      isError: true,
    };
  }

  if (toolName === "web_search" && Array.isArray(block.content)) {
    return {
      toolCallId,
      toolName,
      result: block.content.map(normalizeWebSearchResult),
    };
  }

  if (toolName === "web_fetch" && readRecord(block.content)) {
    return {
      toolCallId,
      toolName,
      result: normalizeWebFetchResult(block.content),
    };
  }

  return undefined;
}

function addOptionalNumber(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
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
  if (!current) return next;
  if (!next) return current;

  const costSource = combineCostSource(current.costSource, next.costSource);
  const usageCaptureStatus = combineCaptureStatus(
    current.usageCaptureStatus,
    next.usageCaptureStatus,
  );
  const billingMode = current.billingMode === "deferred" || next.billingMode === "deferred"
    ? "deferred"
    : current.billingMode ?? next.billingMode;
  const inputTokens = addOptionalNumber(current.inputTokens, next.inputTokens);
  const outputTokens = addOptionalNumber(current.outputTokens, next.outputTokens);
  const totalTokens = addOptionalNumber(current.totalTokens, next.totalTokens);
  const cacheCreationInputTokens = addOptionalNumber(
    current.cacheCreationInputTokens,
    next.cacheCreationInputTokens,
  );
  const cacheReadInputTokens = addOptionalNumber(
    current.cacheReadInputTokens,
    next.cacheReadInputTokens,
  );
  const reasoningTokens = addOptionalNumber(current.reasoningTokens, next.reasoningTokens);
  const billableInputTokens = addOptionalNumber(
    current.billableInputTokens,
    next.billableInputTokens,
  );
  const billableOutputTokens = addOptionalNumber(
    current.billableOutputTokens,
    next.billableOutputTokens,
  );
  const providerInputCostUsd = addOptionalNumber(
    current.providerInputCostUsd,
    next.providerInputCostUsd,
  );
  const providerOutputCostUsd = addOptionalNumber(
    current.providerOutputCostUsd,
    next.providerOutputCostUsd,
  );
  const providerCostUsd = addOptionalNumber(current.providerCostUsd, next.providerCostUsd);
  const veryfrontInputChargeUsd = addOptionalNumber(
    current.veryfrontInputChargeUsd,
    next.veryfrontInputChargeUsd,
  );
  const veryfrontOutputChargeUsd = addOptionalNumber(
    current.veryfrontOutputChargeUsd,
    next.veryfrontOutputChargeUsd,
  );
  const veryfrontChargeUsd = addOptionalNumber(
    current.veryfrontChargeUsd,
    next.veryfrontChargeUsd,
  );
  const veryfrontBilledUsd = addOptionalNumber(
    current.veryfrontBilledUsd,
    next.veryfrontBilledUsd,
  );
  const costCredits = addOptionalNumber(current.costCredits, next.costCredits);

  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
    ...(cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(billableInputTokens === undefined ? {} : { billableInputTokens }),
    ...(billableOutputTokens === undefined ? {} : { billableOutputTokens }),
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

  return {
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
  };
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
      Math.max(1, timeoutMs),
    );
  });

  try {
    const result = await Promise.race([readPromise, timeoutPromise]);
    if (result.kind === "timeout") {
      if (timeoutMode === "drain") {
        void drainStreamReaderAfterTimeout(reader, readPromise, drainTimeoutMs);
      } else {
        await cancelStreamReader(
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

async function cancelStreamReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: string,
): Promise<void> {
  try {
    await reader.cancel(reason);
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
  }, Math.max(1, timeoutMs));

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
  const sseParser = new BoundedAnthropicSseParser();
  const reader = stream.getReader();
  const trailingUsageGraceMs = options.clientToolUseTrailingUsageGraceMs ??
    DEFAULT_CLIENT_TOOL_USE_TRAILING_USAGE_GRACE_MS;
  const trailingUsageTimeoutMode = options.clientToolUseTrailingUsageTimeoutMode ?? "cancel";
  const trailingUsageDrainTimeoutMs = options.clientToolUseTrailingUsageDrainTimeoutMs ??
    DEFAULT_CLIENT_TOOL_USE_TRAILING_USAGE_DRAIN_TIMEOUT_MS;
  let readerReleased = false;
  let sourceSettled = false;
  const toolCalls = new Map<number, AnthropicStreamToolCallState>();
  const reasoningBlocks = new Map<number, AnthropicStreamReasoningState>();
  const rawContentBlocks = new Map<number, Record<string, unknown>>();
  let finishReason: string | { unified: string; raw: string } | null = null;
  let rawStopReason: string | undefined;
  let usage: RuntimeUsage | undefined;
  let completedClientToolUseStep = false;
  let clientToolUseIdleDeadlineMs: number | null = null;
  let clientToolUseTerminalDeadlineMs: number | null = null;

  const mergeTrailingBufferUsage = () => {
    for (const event of sseParser.flush()) {
      if (event === "[DONE]") {
        continue;
      }
      const record = readRecord(event);
      if (record?.type === "error") {
        throw buildAnthropicSseError(record);
      }
      usage = mergeUsage(usage, extractAnthropicUsage(record));
    }
  };

  const getClientToolUseReadTimeoutMs = () => {
    if (!completedClientToolUseStep || toolCalls.size > 0) {
      return undefined;
    }

    const deadline = isToolCallsFinishReason(finishReason)
      ? clientToolUseTerminalDeadlineMs
      : clientToolUseIdleDeadlineMs;
    return deadline === null ? undefined : Math.max(1, deadline - Date.now());
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
        finishReason ??= CLIENT_TOOL_USE_FINISH_REASON;
        notifyCompletion();
        yield buildFinishPart();
        return;
      }

      if (read.kind === "done") {
        sourceSettled = true;
        break;
      }

      for (const event of sseParser.push(read.chunk)) {
        if (event === "[DONE]") {
          continue;
        }

        const record = readRecord(event);
        const eventType = typeof record?.type === "string" ? record.type : undefined;
        usage = mergeUsage(usage, extractAnthropicUsage(record));

        if (eventType === "error" && record) {
          throw buildAnthropicSseError(record);
        }

        if (eventType === "message_start") {
          usage = mergeUsage(usage, extractAnthropicUsage(record?.message));
          continue;
        }

        if (eventType === "content_block_start") {
          const index = typeof record?.index === "number" ? record.index : 0;
          const contentBlock = readRecord(record?.content_block);
          const blockType = typeof contentBlock?.type === "string" ? contentBlock.type : undefined;
          if (contentBlock && blockType) {
            rawContentBlocks.set(index, { ...contentBlock });
          }

          if (
            blockType === "text" && typeof contentBlock?.text === "string" &&
            contentBlock.text.length > 0
          ) {
            yield { type: "text-delta", delta: contentBlock.text };
            continue;
          }

          if (blockType === "thinking") {
            const reasoningId = `thinking-${index}`;
            reasoningBlocks.set(index, { id: reasoningId, text: "" });
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
            const reasoningId = `thinking-${index}`;
            reasoningBlocks.set(index, {
              id: reasoningId,
              text: "",
              ...(typeof contentBlock?.data === "string"
                ? { redactedData: contentBlock.data }
                : {}),
            });
            yield {
              type: "reasoning-start",
              id: reasoningId,
            };
            continue;
          }

          if (
            (blockType === "tool_use" || blockType === "server_tool_use") &&
            typeof contentBlock?.id === "string" &&
            typeof contentBlock?.name === "string"
          ) {
            const providerExecuted = blockType === "server_tool_use" ? true : undefined;
            const current: AnthropicStreamToolCallState = {
              id: contentBlock.id,
              name: contentBlock.name,
              inputChunks: [],
              inputBytes: 0,
              partialJsonDeltaCount: 0,
              ...(providerExecuted ? { providerExecuted } : {}),
            };

            toolCalls.set(index, current);
            clientToolUseIdleDeadlineMs = null;
            clientToolUseTerminalDeadlineMs = null;
            yield {
              type: "tool-input-start",
              id: current.id,
              toolName: current.name,
              ...(providerExecuted ? { providerExecuted } : {}),
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

          if (
            blockType === "web_search_tool_result" &&
            typeof contentBlock?.tool_use_id === "string"
          ) {
            const parsedResult = parseAnthropicServerToolResult(contentBlock);
            if (parsedResult) {
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
            }
          }

          if (
            blockType === "web_fetch_tool_result" &&
            typeof contentBlock?.tool_use_id === "string"
          ) {
            const parsedResult = parseAnthropicServerToolResult(contentBlock);
            if (parsedResult) {
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
            }
          }

          continue;
        }

        if (eventType === "content_block_delta") {
          const index = typeof record?.index === "number" ? record.index : 0;
          const delta = readRecord(record?.delta);
          const deltaType = typeof delta?.type === "string" ? delta.type : undefined;

          if (
            deltaType === "text_delta" && typeof delta?.text === "string" && delta.text.length > 0
          ) {
            const rawBlock = rawContentBlocks.get(index);
            if (rawBlock) {
              rawBlock.text = `${
                typeof rawBlock.text === "string" ? rawBlock.text : ""
              }${delta.text}`;
            }
            yield { type: "text-delta", delta: delta.text };
            continue;
          }

          if (
            deltaType === "thinking_delta" && typeof delta?.thinking === "string" &&
            delta.thinking.length > 0
          ) {
            const current = reasoningBlocks.get(index);
            if (!current) {
              continue;
            }

            current.text += delta.thinking;
            const rawBlock = rawContentBlocks.get(index);
            if (rawBlock) {
              rawBlock.thinking = `${
                typeof rawBlock.thinking === "string" ? rawBlock.thinking : ""
              }${delta.thinking}`;
            }
            yield {
              type: "reasoning-delta",
              id: current.id,
              delta: delta.thinking,
            };
            continue;
          }

          if (deltaType === "signature_delta" && typeof delta?.signature === "string") {
            const current = reasoningBlocks.get(index);
            if (current) {
              current.signature = delta.signature;
            }
            const rawBlock = rawContentBlocks.get(index);
            if (rawBlock) rawBlock.signature = delta.signature;
            continue;
          }

          const citation = readRecord(delta?.citation);
          if (deltaType === "citations_delta" && citation) {
            const rawBlock = rawContentBlocks.get(index);
            if (rawBlock) {
              const citations = Array.isArray(rawBlock.citations) ? rawBlock.citations : [];
              citations.push(citation);
              rawBlock.citations = citations;
            }
            continue;
          }

          if (deltaType === "input_json_delta" && typeof delta?.partial_json === "string") {
            const current = toolCalls.get(index);
            if (!current) {
              continue;
            }

            appendAnthropicToolInput(current, delta.partial_json, true);
            yield {
              type: "tool-input-delta",
              id: current.id,
              delta: delta.partial_json,
            };
          }

          continue;
        }

        if (eventType === "content_block_stop") {
          const index = typeof record?.index === "number" ? record.index : 0;
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
          const input = joinAnthropicToolInput(current);

          const rawBlock = rawContentBlocks.get(index);
          if (rawBlock && input.length > 0) {
            try {
              rawBlock.input = JSON.parse(input);
            } catch {
              // Preserve the provider's initial raw input if a malformed stream
              // cannot be reconstructed into the assistant replay block.
            }
          }

          yield {
            type: "tool-call",
            toolCallId: current.id,
            toolName: current.name,
            input: input.length > 0 ? input : "{}",
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
          const delta = readRecord(record?.delta);
          if (typeof delta?.stop_reason === "string") {
            rawStopReason = delta.stop_reason;
          }
          const normalizedFinishReason = normalizeAnthropicFinishReason(delta?.stop_reason);
          if (normalizedFinishReason) {
            finishReason = normalizedFinishReason;
          }
        }
      }

      if (completedClientToolUseStep && toolCalls.size === 0) {
        if (isToolCallsFinishReason(finishReason)) {
          clientToolUseIdleDeadlineMs = null;
          clientToolUseTerminalDeadlineMs ??= Date.now() + trailingUsageGraceMs;
        } else {
          clientToolUseIdleDeadlineMs ??= Date.now() + trailingUsageGraceMs;
        }
      }
    }
  } finally {
    if (!readerReleased) {
      if (!sourceSettled) {
        await cancelStreamReader(reader, "Anthropic stream consumer returned before completion");
      }
      reader.releaseLock();
    }
  }

  mergeTrailingBufferUsage();

  notifyCompletion();
  yield buildFinishPart();
}
