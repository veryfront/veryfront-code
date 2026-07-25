import {
  mergeUsage,
  ProviderRequestError,
  readGatewayBillingMode,
  readRecord,
  stringifyJsonValue,
} from "veryfront/provider/shared";
import type { RuntimeUsage } from "veryfront/provider/shared";
import {
  appendOpenAIStreamToolArgument,
  isJsonObjectText,
  joinOpenAIStreamToolArguments,
  MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES,
  MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS,
  type OpenAIStreamToolArgumentBudget,
} from "./openai-tool-input.ts";
import {
  isBoundedOpenAIStreamString,
  MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
  MAX_OPENAI_STREAM_ITEM_TYPE_BYTES,
  MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
} from "./openai-stream-metadata.ts";
import {
  appendOpenAISseChunk,
  finishOpenAISseDecoding,
  parseOpenAISseBuffer,
} from "./openai-sse-buffer.ts";
import {
  createOpenAIRawResponseMetadata,
  MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES,
  normalizeOpenAIWebSearchCall,
  readOpenAIRawResponseOutputItems,
  validateOpenAIUrlCitation,
} from "./openai-web-search.ts";

type OpenAIResponsesStreamFunctionCallState = {
  id: string;
  toolCallId: string;
  name: string;
  argumentChunks: string[];
  sawNonEmptyArgumentDelta: boolean;
  argumentsDone: boolean;
  emittedStart: boolean;
};

type OpenAIResponsesStreamRetainedTextState = {
  deltaChunks: string[];
  pendingDeltaChunks: string[];
  pendingDeltaBytes: number;
  retainedValueBytes: number;
  sawDelta: boolean;
  emittedValue: boolean;
  snapshot?: string;
  valueDone: boolean;
  contentPartAdded: boolean;
  contentPartDone: boolean;
};

type OpenAIResponsesStreamMessagePartState = OpenAIResponsesStreamRetainedTextState & {
  kind: "output_text" | "refusal";
  annotations: Map<number, string>;
  annotationSnapshot?: string[];
};

type OpenAIResponsesStreamReasoningState = {
  id: string;
  emittedStart: boolean;
  summaryParts: Map<number, OpenAIResponsesStreamRetainedTextState>;
  contentParts: Map<number, OpenAIResponsesStreamRetainedTextState>;
};

type OpenAIResponsesStreamMessageState = {
  parts: Map<number, OpenAIResponsesStreamMessagePartState>;
};

type OpenAIResponsesStreamOutputItemState = {
  type: string;
  outputIndex?: number;
  order: number;
};

type OpenAIResponsesStreamWebSearchState = {
  phaseRank: number;
};

type OpenAIResponsesStreamContext = {
  providerKind?: "openai" | "mistral" | "moonshotai";
  providerLabel?: string;
  webSearchToolName?: string;
  preserveRawOutputItems?: boolean;
};

export const MAX_OPENAI_STREAM_MESSAGE_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_OPENAI_RESPONSES_RAW_METADATA_BYTES = MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES;
export const MAX_OPENAI_RESPONSES_STREAM_OUTPUT_ITEMS = 4_096;
export const MAX_OPENAI_RESPONSES_STREAM_CONTENT_PARTS = 4_096;
const MAX_OPENAI_STREAM_MESSAGE_DELTA_BATCH_BYTES = 64 * 1024;
const MAX_OPENAI_STREAM_MESSAGE_DELTA_BATCH_FRAGMENTS = 256;

function invalidOpenAIResponsesStream(
  context: OpenAIResponsesStreamContext,
  issue: string,
): ProviderRequestError {
  const providerKind = context.providerKind ?? "openai";
  return new ProviderRequestError({
    provider: providerKind,
    status: 200,
    message: `${
      context.providerLabel ?? providerKind
    } request failed: invalid successful stream (${issue})`,
    retryable: false,
  });
}

function mergeOpenAIResponsesUsage(
  current: RuntimeUsage | undefined,
  payload: unknown,
): RuntimeUsage | undefined {
  const merged = mergeUsage(current, extractOpenAIResponsesUsage(payload));
  return merged && Object.keys(merged).length > 0 ? merged : undefined;
}

function assertFunctionCallInput(
  state: OpenAIResponsesStreamFunctionCallState,
  context: OpenAIResponsesStreamContext,
): string {
  const argumentsText = joinOpenAIStreamToolArguments(state.argumentChunks);
  if (!state.toolCallId || !state.name || !argumentsText) {
    throw invalidOpenAIResponsesStream(context, "function call was incomplete");
  }
  if (!isJsonObjectText(argumentsText)) {
    throw invalidOpenAIResponsesStream(
      context,
      "function call arguments were not valid JSON object text",
    );
  }
  return argumentsText;
}

/**
 * The Responses API uses `input_tokens` / `output_tokens` field names
 * instead of Chat Completions' `prompt_tokens` / `completion_tokens`.
 */
export function extractOpenAIResponsesUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  // Streaming usage lives on response.completed inside `response.usage`;
  // non-streaming has it at the top level.
  const responseRecord = readRecord(record?.response);
  const usage = readRecord(responseRecord?.usage) ?? readRecord(record?.usage);
  if (!usage) return undefined;

  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  const totalTokens = typeof usage.total_tokens === "number"
    ? usage.total_tokens
    : (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  const inputDetails = readRecord(usage.input_tokens_details);
  const cachedTokens = inputDetails?.cached_tokens;
  const outputDetails = readRecord(usage.output_tokens_details);
  const reasoningTokens = outputDetails?.reasoning_tokens;
  const veryfront = readRecord(usage.veryfront);
  const costSource = veryfront?.cost_source;
  const billingMode = readGatewayBillingMode(veryfront?.billing_mode);
  const usageCaptureStatus = veryfront?.usage_capture_status;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(typeof cachedTokens === "number" ? { cacheReadInputTokens: cachedTokens } : {}),
    ...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
    ...(typeof veryfront?.billable_input_tokens === "number"
      ? { billableInputTokens: veryfront.billable_input_tokens }
      : {}),
    ...(typeof veryfront?.billable_output_tokens === "number"
      ? { billableOutputTokens: veryfront.billable_output_tokens }
      : {}),
    ...(typeof veryfront?.cost_usd === "number" ? { costUsd: veryfront.cost_usd } : {}),
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

export function normalizeOpenAIResponsesFinishReason(
  raw: unknown,
): string | { unified: string; raw: string } | null {
  if (typeof raw !== "string") return null;
  switch (raw) {
    case "completed":
      return { unified: "stop", raw };
    case "incomplete":
      return { unified: "length", raw };
    case "failed":
      return { unified: "error", raw };
    case "in_progress":
      return null;
    default:
      return null;
  }
}

/**
 * Parse the Responses API streaming event grammar into the same UI part
 * shapes the existing OpenAI / Anthropic / Google streams emit.
 */
export async function* streamOpenAIResponsesParts(
  stream: ReadableStream<Uint8Array>,
  context: OpenAIResponsesStreamContext = {},
): AsyncIterable<unknown> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  const reasoningBlocks = new Map<string, OpenAIResponsesStreamReasoningState>();
  const functionCalls = new Map<string, OpenAIResponsesStreamFunctionCallState>();
  const messageItems = new Map<string, OpenAIResponsesStreamMessageState>();
  const webSearchItems = new Map<string, OpenAIResponsesStreamWebSearchState>();
  const outputItems = new Map<string, OpenAIResponsesStreamOutputItemState>();
  const seenOutputItemIds = new Set<string>();
  const outputItemIdsByIndex = new Map<number, string>();
  const seenFunctionCallIds = new Set<string>();
  const rawOutputItemsByOrder: Array<
    | {
      item: Record<string, unknown>;
      order: number;
      outputIndex?: number;
    }
    | undefined
  > = [];
  const retainRawOutputItems = context.preserveRawOutputItems === true ||
    context.webSearchToolName !== undefined;
  const toolArgumentBudget: OpenAIStreamToolArgumentBudget = {
    bytes: 0,
    fragments: 0,
  };
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: RuntimeUsage | undefined;
  let reasoningCounter = 0;
  let sawTerminalEvent = false;
  let sawDone = false;
  let contentPartCount = 0;
  let retainedMessageSnapshotBytes = 0;
  let retainedRawOutputBytes = 0;
  let outputItemOrder = 0;
  const textEncoder = new TextEncoder();

  function readEventItem(
    record: Record<string, unknown>,
    issue: string,
  ): { item: Record<string, unknown>; itemType: string; itemId: string } {
    const item = readRecord(record.item);
    if (!item) {
      throw invalidOpenAIResponsesStream(context, `${issue} item was not an object`);
    }
    const itemType = isBoundedOpenAIStreamString(
        item.type,
        MAX_OPENAI_STREAM_ITEM_TYPE_BYTES,
      )
      ? item.type
      : undefined;
    const itemId = isBoundedOpenAIStreamString(
        item.id,
        MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
      )
      ? item.id
      : undefined;
    if (!itemType || !itemId) {
      throw invalidOpenAIResponsesStream(context, `${issue} item type or id was missing`);
    }
    return { item, itemType, itemId };
  }

  function readContentIndex(record: Record<string, unknown>): number {
    if (record.content_index === undefined) {
      // Some compatible endpoints omit the index for their single message
      // content part. Treat that shape as index zero while still validating
      // every explicit index.
      return 0;
    }
    if (!Number.isSafeInteger(record.content_index) || (record.content_index as number) < 0) {
      throw invalidOpenAIResponsesStream(context, "message content index was malformed");
    }
    return record.content_index as number;
  }

  function readSummaryIndex(record: Record<string, unknown>): number {
    if (record.summary_index === undefined) {
      return 0;
    }
    if (!Number.isSafeInteger(record.summary_index) || (record.summary_index as number) < 0) {
      throw invalidOpenAIResponsesStream(context, "reasoning summary index was malformed");
    }
    return record.summary_index as number;
  }

  function readOptionalOutputIndex(
    record: Record<string, unknown>,
    issue: string,
  ): number | undefined {
    if (record.output_index === undefined) return undefined;
    if (!Number.isSafeInteger(record.output_index) || (record.output_index as number) < 0) {
      throw invalidOpenAIResponsesStream(context, `${issue} output index was malformed`);
    }
    return record.output_index as number;
  }

  function assertOutputIndex(
    itemId: string,
    record: Record<string, unknown>,
    issue: string,
  ): void {
    const state = outputItems.get(itemId);
    if (!state) {
      throw invalidOpenAIResponsesStream(context, `${issue} referenced an unknown output item`);
    }
    const outputIndex = readOptionalOutputIndex(record, issue);
    if (outputIndex === undefined) return;
    const existingItemId = outputItemIdsByIndex.get(outputIndex);
    if (existingItemId !== undefined && existingItemId !== itemId) {
      throw invalidOpenAIResponsesStream(
        context,
        `${issue} output index was owned by another item`,
      );
    }
    if (state.outputIndex !== undefined && state.outputIndex !== outputIndex) {
      throw invalidOpenAIResponsesStream(context, `${issue} output index changed`);
    }
    outputItemIdsByIndex.set(outputIndex, itemId);
    state.outputIndex = outputIndex;
  }

  function readMessageItemId(record: Record<string, unknown>, issue: string): string {
    if (
      !isBoundedOpenAIStreamString(
        record.item_id,
        MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
      )
    ) {
      throw invalidOpenAIResponsesStream(context, `${issue} item id was missing`);
    }
    return record.item_id;
  }

  function readMessagePartKind(
    value: unknown,
    issue: string,
  ): "output_text" | "refusal" {
    if (value === "output_text" || value === "refusal") {
      return value;
    }
    throw invalidOpenAIResponsesStream(context, `${issue} type was unsupported`);
  }

  function getMessageState(
    itemId: string,
    issue: string,
  ): OpenAIResponsesStreamMessageState {
    const state = messageItems.get(itemId);
    if (!state) {
      throw invalidOpenAIResponsesStream(context, `${issue} referenced an unknown message item`);
    }
    return state;
  }

  function getOrCreateMessagePart(
    message: OpenAIResponsesStreamMessageState,
    contentIndex: number,
    kind: "output_text" | "refusal",
    issue: string,
  ): OpenAIResponsesStreamMessagePartState {
    const existing = message.parts.get(contentIndex);
    if (existing) {
      if (existing.kind !== kind) {
        throw invalidOpenAIResponsesStream(context, `${issue} changed content-part type`);
      }
      return existing;
    }
    if (contentPartCount >= MAX_OPENAI_RESPONSES_STREAM_CONTENT_PARTS) {
      throw invalidOpenAIResponsesStream(
        context,
        `stream exceeded ${MAX_OPENAI_RESPONSES_STREAM_CONTENT_PARTS} content parts`,
      );
    }
    contentPartCount++;
    const created = {
      kind,
      annotations: new Map(),
      ...createRetainedTextState(),
    };
    message.parts.set(contentIndex, created);
    return created;
  }

  function createRetainedTextState(): OpenAIResponsesStreamRetainedTextState {
    return {
      deltaChunks: [],
      pendingDeltaChunks: [],
      pendingDeltaBytes: 0,
      retainedValueBytes: 0,
      sawDelta: false,
      emittedValue: false,
      valueDone: false,
      contentPartAdded: false,
      contentPartDone: false,
    };
  }

  function getOrCreateReasoningPart(
    parts: Map<number, OpenAIResponsesStreamRetainedTextState>,
    index: number,
  ): OpenAIResponsesStreamRetainedTextState {
    const existing = parts.get(index);
    if (existing) return existing;
    if (contentPartCount >= MAX_OPENAI_RESPONSES_STREAM_CONTENT_PARTS) {
      throw invalidOpenAIResponsesStream(
        context,
        `stream exceeded ${MAX_OPENAI_RESPONSES_STREAM_CONTENT_PARTS} content parts`,
      );
    }
    contentPartCount++;
    const created = createRetainedTextState();
    parts.set(index, created);
    return created;
  }

  function reconcileRetainedTextValue(
    state: OpenAIResponsesStreamRetainedTextState,
    value: string,
    issue: string,
  ): string | undefined {
    if (state.snapshot !== undefined) {
      if (state.snapshot !== value) {
        throw invalidOpenAIResponsesStream(context, `${issue} changed its final value`);
      }
      return undefined;
    }
    if (state.sawDelta) {
      if (state.pendingDeltaChunks.length > 0) {
        state.deltaChunks.push(state.pendingDeltaChunks.join(""));
        state.pendingDeltaChunks.length = 0;
        state.pendingDeltaBytes = 0;
      }
      const streamedValue = state.deltaChunks.join("");
      if (streamedValue !== value) {
        throw invalidOpenAIResponsesStream(
          context,
          `${issue} disagreed with streamed deltas`,
        );
      }
    } else if (value.length > 0) {
      const valueBytes = textEncoder.encode(value).byteLength;
      if (
        valueBytes > MAX_OPENAI_STREAM_MESSAGE_SNAPSHOT_BYTES -
            retainedMessageSnapshotBytes
      ) {
        throw invalidOpenAIResponsesStream(
          context,
          `message snapshot exceeded ${MAX_OPENAI_STREAM_MESSAGE_SNAPSHOT_BYTES} UTF-8 bytes`,
        );
      }
      state.retainedValueBytes = valueBytes;
      retainedMessageSnapshotBytes += valueBytes;
    }
    state.snapshot = value;
    state.deltaChunks.length = 0;
    state.sawDelta = false;
    if (!state.emittedValue && value.length > 0) {
      state.emittedValue = true;
      return value;
    }
    return undefined;
  }

  function appendRetainedTextDelta(
    state: OpenAIResponsesStreamRetainedTextState,
    delta: string,
  ): void {
    if (delta.length === 0) return;
    const deltaBytes = textEncoder.encode(delta).byteLength;
    if (
      deltaBytes > MAX_OPENAI_STREAM_MESSAGE_SNAPSHOT_BYTES -
          retainedMessageSnapshotBytes
    ) {
      throw invalidOpenAIResponsesStream(
        context,
        `message snapshot exceeded ${MAX_OPENAI_STREAM_MESSAGE_SNAPSHOT_BYTES} UTF-8 bytes`,
      );
    }
    state.retainedValueBytes += deltaBytes;
    retainedMessageSnapshotBytes += deltaBytes;
    state.pendingDeltaChunks.push(delta);
    state.pendingDeltaBytes += deltaBytes;
    if (
      state.pendingDeltaBytes >= MAX_OPENAI_STREAM_MESSAGE_DELTA_BATCH_BYTES ||
      state.pendingDeltaChunks.length >= MAX_OPENAI_STREAM_MESSAGE_DELTA_BATCH_FRAGMENTS
    ) {
      state.deltaChunks.push(state.pendingDeltaChunks.join(""));
      state.pendingDeltaChunks.length = 0;
      state.pendingDeltaBytes = 0;
    }
  }

  function releaseMessageState(state: OpenAIResponsesStreamMessageState): void {
    for (const part of state.parts.values()) {
      releaseRetainedTextState(part);
    }
  }

  function releaseReasoningState(state: OpenAIResponsesStreamReasoningState): void {
    for (const part of state.summaryParts.values()) {
      releaseRetainedTextState(part);
    }
    for (const part of state.contentParts.values()) {
      releaseRetainedTextState(part);
    }
  }

  function releaseRetainedTextState(state: OpenAIResponsesStreamRetainedTextState): void {
    retainedMessageSnapshotBytes -= state.retainedValueBytes;
    state.retainedValueBytes = 0;
    state.deltaChunks.length = 0;
    state.pendingDeltaChunks.length = 0;
    state.pendingDeltaBytes = 0;
    state.snapshot = undefined;
  }

  function* emitReasoningText(
    state: OpenAIResponsesStreamReasoningState,
    text: string | undefined,
  ): Generator<unknown> {
    if (text === undefined || text.length === 0) return;
    if (!state.emittedStart) {
      yield { type: "reasoning-start", id: state.id };
      state.emittedStart = true;
    }
    yield { type: "reasoning-delta", id: state.id, delta: text };
  }

  function* reconcileFinalReasoningParts(
    reasoning: OpenAIResponsesStreamReasoningState,
    rawParts: unknown,
    states: Map<number, OpenAIResponsesStreamRetainedTextState>,
    expectedType: "summary_text" | "reasoning_text",
    issue: string,
  ): Generator<unknown> {
    if (rawParts === undefined) {
      if (states.size > 0) {
        throw invalidOpenAIResponsesStream(
          context,
          `completed reasoning omitted its ${issue} parts`,
        );
      }
      return;
    }
    if (!Array.isArray(rawParts)) {
      throw invalidOpenAIResponsesStream(
        context,
        `completed reasoning ${issue} was not an array`,
      );
    }
    const finalIndices = new Set<number>();
    for (const [index, rawPart] of rawParts.entries()) {
      const part = readRecord(rawPart);
      if (
        !part ||
        part.type !== expectedType ||
        typeof part.text !== "string"
      ) {
        throw invalidOpenAIResponsesStream(
          context,
          `completed reasoning ${issue} part was malformed`,
        );
      }
      const state = getOrCreateReasoningPart(states, index);
      if (state.contentPartAdded && (!state.valueDone || !state.contentPartDone)) {
        throw invalidOpenAIResponsesStream(
          context,
          `completed reasoning had an unfinished ${issue} part`,
        );
      }
      const missingDelta = reconcileRetainedTextValue(
        state,
        part.text,
        `completed reasoning ${issue} part`,
      );
      yield* emitReasoningText(reasoning, missingDelta);
      finalIndices.add(index);
    }
    for (const index of states.keys()) {
      if (!finalIndices.has(index)) {
        throw invalidOpenAIResponsesStream(
          context,
          `completed reasoning omitted a streamed ${issue} part`,
        );
      }
    }
  }

  function appendFunctionCallArgument(
    state: OpenAIResponsesStreamFunctionCallState,
    fragment: string,
  ): void {
    const limit = appendOpenAIStreamToolArgument(
      toolArgumentBudget,
      state.argumentChunks,
      fragment,
    );
    if (limit === "bytes") {
      throw invalidOpenAIResponsesStream(
        context,
        `function call arguments exceeded ${MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES} UTF-8 bytes`,
      );
    }
    if (limit === "fragments") {
      throw invalidOpenAIResponsesStream(
        context,
        `function call arguments exceeded ${MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS} fragments`,
      );
    }
  }

  function validateMessageContentPart(
    part: Record<string, unknown>,
    issue: string,
  ): "output_text" | "refusal" {
    const kind = readMessagePartKind(part.type, issue);
    const value = kind === "output_text" ? part.text : part.refusal;
    if (typeof value !== "string") {
      throw invalidOpenAIResponsesStream(context, `${issue} value was malformed`);
    }
    return kind;
  }

  function serializeUrlCitation(value: unknown, issue: string): string {
    const annotation = validateOpenAIUrlCitation(
      value,
      (detail) => invalidOpenAIResponsesStream(context, `${issue}: ${detail}`),
    );
    return stringifyJsonValue({
      type: annotation.type,
      start_index: annotation.start_index,
      end_index: annotation.end_index,
      url: annotation.url,
      title: annotation.title,
    });
  }

  function reconcileMessageAnnotations(
    state: OpenAIResponsesStreamMessagePartState,
    part: Record<string, unknown>,
    text: string,
    issue: string,
  ): void {
    if (state.kind !== "output_text") {
      if (part.annotations !== undefined) {
        throw invalidOpenAIResponsesStream(
          context,
          `${issue} attached annotations to a refusal`,
        );
      }
      return;
    }
    const rawAnnotations = part.annotations ?? [];
    if (
      !Array.isArray(rawAnnotations) ||
      rawAnnotations.length > MAX_OPENAI_RESPONSES_STREAM_CONTENT_PARTS
    ) {
      throw invalidOpenAIResponsesStream(context, `${issue} annotations were malformed`);
    }
    const annotations = rawAnnotations.map((annotation, index) => {
      const serialized = serializeUrlCitation(annotation, `${issue} annotation ${index}`);
      const parsed = readRecord(annotation);
      if (
        !parsed ||
        (parsed.end_index as number) > text.length
      ) {
        throw invalidOpenAIResponsesStream(
          context,
          `${issue} annotation range exceeded its text`,
        );
      }
      return serialized;
    });
    if (
      state.annotationSnapshot !== undefined &&
      (state.annotationSnapshot.length !== annotations.length ||
        state.annotationSnapshot.some((annotation, index) => annotation !== annotations[index]))
    ) {
      throw invalidOpenAIResponsesStream(context, `${issue} annotations changed`);
    }
    if (state.annotations.size > 0) {
      if (state.annotations.size !== annotations.length) {
        throw invalidOpenAIResponsesStream(
          context,
          `${issue} annotations disagreed with streamed annotations`,
        );
      }
      for (const [index, annotation] of state.annotations) {
        if (annotations[index] !== annotation) {
          throw invalidOpenAIResponsesStream(
            context,
            `${issue} annotations disagreed with streamed annotations`,
          );
        }
      }
    }
    state.annotationSnapshot = annotations;
  }

  function retainCompletedOutputItem(
    state: OpenAIResponsesStreamOutputItemState,
    item: Record<string, unknown>,
  ): void {
    if (!retainRawOutputItems) return;
    const itemBytes = textEncoder.encode(stringifyJsonValue(item)).byteLength;
    if (
      itemBytes > MAX_OPENAI_RESPONSES_RAW_METADATA_BYTES -
          retainedRawOutputBytes
    ) {
      throw invalidOpenAIResponsesStream(
        context,
        `raw response metadata exceeded ${MAX_OPENAI_RESPONSES_RAW_METADATA_BYTES} UTF-8 bytes`,
      );
    }
    retainedRawOutputBytes += itemBytes;
    rawOutputItemsByOrder[state.order] = {
      item,
      order: state.order,
      outputIndex: state.outputIndex,
    };
  }

  function* processEvent(event: unknown | "[DONE]"): Generator<unknown> {
    if (event === "[DONE]") {
      if (!sawTerminalEvent) {
        throw invalidOpenAIResponsesStream(
          context,
          "done marker arrived before a terminal response event",
        );
      }
      if (sawDone) {
        throw invalidOpenAIResponsesStream(context, "stream contained multiple done markers");
      }
      sawDone = true;
      return;
    }
    if (sawDone) {
      throw invalidOpenAIResponsesStream(context, "stream contained data after its done marker");
    }
    if (sawTerminalEvent) {
      throw invalidOpenAIResponsesStream(context, "stream contained data after its terminal event");
    }
    const record = readRecord(event);
    if (!record) {
      throw invalidOpenAIResponsesStream(context, "event was not an object");
    }
    const type = typeof record.type === "string" && record.type.length > 0
      ? record.type
      : undefined;
    if (!type) {
      throw invalidOpenAIResponsesStream(context, "event type was missing");
    }

    if (type === "error") {
      throw invalidOpenAIResponsesStream(context, "provider emitted an error event");
    }

    if (type === "response.output_item.added") {
      const { item, itemType, itemId } = readEventItem(record, "added output");
      if (seenOutputItemIds.has(itemId)) {
        throw invalidOpenAIResponsesStream(context, "output item was added twice");
      }
      if (seenOutputItemIds.size >= MAX_OPENAI_RESPONSES_STREAM_OUTPUT_ITEMS) {
        throw invalidOpenAIResponsesStream(
          context,
          `stream exceeded ${MAX_OPENAI_RESPONSES_STREAM_OUTPUT_ITEMS} output items`,
        );
      }
      const outputIndex = readOptionalOutputIndex(record, "added output item");
      if (outputIndex !== undefined) {
        const existingItemId = outputItemIdsByIndex.get(outputIndex);
        if (existingItemId !== undefined && existingItemId !== itemId) {
          throw invalidOpenAIResponsesStream(
            context,
            "output index was reused by another item",
          );
        }
        outputItemIdsByIndex.set(outputIndex, itemId);
      }
      seenOutputItemIds.add(itemId);
      outputItems.set(itemId, {
        type: itemType,
        outputIndex,
        order: outputItemOrder++,
      });
      if (itemType === "function_call") {
        const callId = isBoundedOpenAIStreamString(
            item.call_id,
            MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
          )
          ? item.call_id
          : undefined;
        const name = isBoundedOpenAIStreamString(
            item.name,
            MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
          )
          ? item.name
          : undefined;
        if (!callId || !name) {
          throw invalidOpenAIResponsesStream(
            context,
            "added function call id or name was missing",
          );
        }
        if (seenFunctionCallIds.has(callId)) {
          throw invalidOpenAIResponsesStream(context, "function call id was reused");
        }
        if (
          (item.arguments !== undefined && item.arguments !== "") ||
          (item.status !== undefined && item.status !== "in_progress")
        ) {
          throw invalidOpenAIResponsesStream(
            context,
            "added function call was not in its initial state",
          );
        }
        functionCalls.set(itemId, {
          id: itemId,
          toolCallId: callId,
          name,
          argumentChunks: [],
          sawNonEmptyArgumentDelta: false,
          argumentsDone: false,
          emittedStart: false,
        });
        seenFunctionCallIds.add(callId);
      } else if (itemType === "reasoning") {
        if (
          (item.summary !== undefined &&
            (!Array.isArray(item.summary) || item.summary.length > 0)) ||
          (item.content !== undefined &&
            (!Array.isArray(item.content) || item.content.length > 0)) ||
          (item.status !== undefined && item.status !== "in_progress")
        ) {
          throw invalidOpenAIResponsesStream(
            context,
            "added reasoning item was not in its initial state",
          );
        }
        reasoningBlocks.set(itemId, {
          id: `reasoning-${reasoningCounter++}`,
          emittedStart: false,
          summaryParts: new Map(),
          contentParts: new Map(),
        });
      } else if (itemType === "message") {
        if (item.role !== undefined && item.role !== "assistant") {
          throw invalidOpenAIResponsesStream(context, "added message role was not assistant");
        }
        if (item.content !== undefined && !Array.isArray(item.content)) {
          throw invalidOpenAIResponsesStream(context, "added message content was not an array");
        }
        if (
          (Array.isArray(item.content) && item.content.length > 0) ||
          (item.status !== undefined && item.status !== "in_progress")
        ) {
          throw invalidOpenAIResponsesStream(context, "added message was not in its initial state");
        }
        messageItems.set(itemId, { parts: new Map() });
      } else if (itemType === "web_search_call") {
        if (!context.webSearchToolName) {
          throw invalidOpenAIResponsesStream(
            context,
            "provider emitted web search without a configured web-search tool",
          );
        }
        if (
          item.action !== undefined ||
          (item.status !== undefined && item.status !== "in_progress")
        ) {
          throw invalidOpenAIResponsesStream(
            context,
            "added web-search call was not in its initial state",
          );
        }
        if (seenFunctionCallIds.has(itemId)) {
          throw invalidOpenAIResponsesStream(context, "tool call id was reused");
        }
        webSearchItems.set(itemId, { phaseRank: 0 });
        seenFunctionCallIds.add(itemId);
        yield {
          type: "tool-input-start",
          id: itemId,
          toolName: context.webSearchToolName,
          providerExecuted: true,
        };
      }
      return;
    }

    if (
      type === "response.web_search_call.in_progress" ||
      type === "response.web_search_call.searching" ||
      type === "response.web_search_call.completed"
    ) {
      const itemId = readMessageItemId(record, "web-search lifecycle event");
      const state = webSearchItems.get(itemId);
      if (!state) {
        throw invalidOpenAIResponsesStream(
          context,
          "web-search lifecycle event referenced an unknown item",
        );
      }
      assertOutputIndex(itemId, record, "web-search lifecycle event");
      const phaseRank = type === "response.web_search_call.in_progress"
        ? 1
        : type === "response.web_search_call.searching"
        ? 2
        : 3;
      if (phaseRank <= state.phaseRank) {
        throw invalidOpenAIResponsesStream(
          context,
          "web-search lifecycle moved backward or repeated a phase",
        );
      }
      state.phaseRank = phaseRank;
      return;
    }

    if (
      type === "response.content_part.added" ||
      type === "response.content_part.done"
    ) {
      const itemId = readMessageItemId(record, "message content-part event");
      const outputItem = outputItems.get(itemId);
      if (!outputItem) {
        throw invalidOpenAIResponsesStream(
          context,
          "content-part event referenced an unknown output item",
        );
      }
      assertOutputIndex(itemId, record, "message content-part event");
      const contentIndex = readContentIndex(record);
      const part = readRecord(record.part);
      if (!part) {
        throw invalidOpenAIResponsesStream(context, "message content part was not an object");
      }
      if (outputItem.type === "reasoning") {
        if (part.type !== "reasoning_text" || typeof part.text !== "string") {
          throw invalidOpenAIResponsesStream(
            context,
            "reasoning content part was malformed",
          );
        }
        const reasoning = reasoningBlocks.get(itemId);
        if (!reasoning) {
          throw invalidOpenAIResponsesStream(
            context,
            "reasoning content part referenced an unknown reasoning item",
          );
        }
        const existing = reasoning.contentParts.get(contentIndex);
        if (type === "response.content_part.added") {
          if (existing !== undefined) {
            throw invalidOpenAIResponsesStream(context, "reasoning content part was added twice");
          }
          if (part.text !== "") {
            throw invalidOpenAIResponsesStream(
              context,
              "added reasoning content part was not empty",
            );
          }
          const state = getOrCreateReasoningPart(reasoning.contentParts, contentIndex);
          state.contentPartAdded = true;
        } else {
          if (!existing?.contentPartAdded) {
            throw invalidOpenAIResponsesStream(
              context,
              "reasoning content part completed before it was added",
            );
          }
          if (existing.contentPartDone) {
            throw invalidOpenAIResponsesStream(
              context,
              "reasoning content part completed twice",
            );
          }
          const missingDelta = reconcileRetainedTextValue(
            existing,
            part.text,
            "completed reasoning content part",
          );
          yield* emitReasoningText(reasoning, missingDelta);
          existing.contentPartDone = true;
        }
        return;
      }
      if (outputItem.type !== "message") {
        throw invalidOpenAIResponsesStream(
          context,
          "content-part event referenced an unsupported output item",
        );
      }
      const message = getMessageState(itemId, "message content-part event");
      const kind = validateMessageContentPart(part, "message content part");
      if (
        type === "response.content_part.added" &&
        kind === "output_text" &&
        part.annotations !== undefined &&
        (!Array.isArray(part.annotations) || part.annotations.length > 0)
      ) {
        throw invalidOpenAIResponsesStream(
          context,
          "added message content part annotations were not empty",
        );
      }
      const existing = message.parts.get(contentIndex);
      if (type === "response.content_part.added" && existing) {
        throw invalidOpenAIResponsesStream(context, "message content part was added twice");
      }
      if (type === "response.content_part.done" && !existing?.contentPartAdded) {
        throw invalidOpenAIResponsesStream(
          context,
          "message content part completed before it was added",
        );
      }
      const state = getOrCreateMessagePart(
        message,
        contentIndex,
        kind,
        "message content part",
      );
      if (type === "response.content_part.added") {
        const initialValue = kind === "output_text" ? part.text : part.refusal;
        if (initialValue !== "") {
          throw invalidOpenAIResponsesStream(
            context,
            "added message content part was not empty",
          );
        }
        state.contentPartAdded = true;
      }
      if (type === "response.content_part.done") {
        if (state.contentPartDone) {
          throw invalidOpenAIResponsesStream(context, "message content part completed twice");
        }
        const value = kind === "output_text" ? part.text : part.refusal;
        const missingDelta = reconcileRetainedTextValue(
          state,
          value as string,
          "completed message content part",
        );
        if (missingDelta !== undefined) {
          yield { type: "text-delta", delta: missingDelta };
        }
        reconcileMessageAnnotations(
          state,
          part,
          value as string,
          "completed message content part",
        );
        state.contentPartDone = true;
      }
      return;
    }

    if (type === "response.output_text.delta" || type === "response.refusal.delta") {
      if (
        typeof record.delta !== "string"
      ) {
        throw invalidOpenAIResponsesStream(
          context,
          type === "response.refusal.delta"
            ? "refusal delta was malformed"
            : "output-text delta was malformed",
        );
      }
      const itemId = readMessageItemId(record, "message delta");
      const message = getMessageState(itemId, "message delta");
      assertOutputIndex(itemId, record, "message delta");
      const contentIndex = readContentIndex(record);
      const kind = type === "response.refusal.delta" ? "refusal" : "output_text";
      const part = getOrCreateMessagePart(message, contentIndex, kind, "message delta");
      if (part.valueDone || part.contentPartDone) {
        throw invalidOpenAIResponsesStream(context, "message delta followed a completed part");
      }
      if (record.delta.length > 0) {
        part.sawDelta = true;
      }
      appendRetainedTextDelta(part, record.delta);
      if (record.delta.length > 0) {
        part.emittedValue = true;
        yield { type: "text-delta", delta: record.delta };
      }
      return;
    }

    if (type === "response.output_text.annotation.added") {
      const itemId = readMessageItemId(record, "output-text annotation event");
      const message = getMessageState(itemId, "output-text annotation event");
      assertOutputIndex(itemId, record, "output-text annotation event");
      const contentIndex = readContentIndex(record);
      if (
        !Number.isSafeInteger(record.annotation_index) ||
        (record.annotation_index as number) < 0 ||
        (record.annotation_index as number) >=
          MAX_OPENAI_RESPONSES_STREAM_CONTENT_PARTS
      ) {
        throw invalidOpenAIResponsesStream(
          context,
          "output-text annotation index was malformed",
        );
      }
      const part = getOrCreateMessagePart(
        message,
        contentIndex,
        "output_text",
        "output-text annotation event",
      );
      if (part.contentPartDone || part.annotationSnapshot !== undefined) {
        throw invalidOpenAIResponsesStream(
          context,
          "output-text annotation followed a completed part",
        );
      }
      const annotationIndex = record.annotation_index as number;
      if (part.annotations.has(annotationIndex)) {
        throw invalidOpenAIResponsesStream(
          context,
          "output-text annotation index was reused",
        );
      }
      part.annotations.set(
        annotationIndex,
        serializeUrlCitation(
          record.annotation,
          `output-text annotation ${annotationIndex}`,
        ),
      );
      return;
    }

    if (type === "response.output_text.done" || type === "response.refusal.done") {
      const itemId = readMessageItemId(record, "completed message value");
      const message = getMessageState(itemId, "completed message value");
      assertOutputIndex(itemId, record, "completed message value");
      const contentIndex = readContentIndex(record);
      const kind = type === "response.refusal.done" ? "refusal" : "output_text";
      const value = kind === "refusal" ? record.refusal : record.text;
      if (typeof value !== "string") {
        throw invalidOpenAIResponsesStream(context, "completed message value was malformed");
      }
      const part = getOrCreateMessagePart(
        message,
        contentIndex,
        kind,
        "completed message value",
      );
      if (part.valueDone) {
        throw invalidOpenAIResponsesStream(context, "message value completed twice");
      }
      const missingDelta = reconcileRetainedTextValue(
        part,
        value,
        "completed message value",
      );
      if (missingDelta !== undefined) {
        yield { type: "text-delta", delta: missingDelta };
      }
      part.valueDone = true;
      return;
    }

    if (
      type === "response.reasoning_summary_part.added" ||
      type === "response.reasoning_summary_part.done"
    ) {
      const itemId = readMessageItemId(record, "reasoning summary-part event");
      const reasoning = reasoningBlocks.get(itemId);
      const part = readRecord(record.part);
      if (
        !reasoning ||
        !part ||
        part.type !== "summary_text" ||
        typeof part.text !== "string"
      ) {
        throw invalidOpenAIResponsesStream(context, "reasoning summary part was malformed");
      }
      assertOutputIndex(itemId, record, "reasoning summary-part event");
      const summaryIndex = readSummaryIndex(record);
      const existing = reasoning.summaryParts.get(summaryIndex);
      if (type === "response.reasoning_summary_part.added") {
        if (existing) {
          throw invalidOpenAIResponsesStream(context, "reasoning summary part was added twice");
        }
        if (part.text !== "") {
          throw invalidOpenAIResponsesStream(
            context,
            "added reasoning summary part was not empty",
          );
        }
        getOrCreateReasoningPart(reasoning.summaryParts, summaryIndex).contentPartAdded = true;
      } else {
        if (!existing?.contentPartAdded) {
          throw invalidOpenAIResponsesStream(
            context,
            "reasoning summary part completed before it was added",
          );
        }
        if (existing.contentPartDone) {
          throw invalidOpenAIResponsesStream(context, "reasoning summary part completed twice");
        }
        const missingDelta = reconcileRetainedTextValue(
          existing,
          part.text,
          "completed reasoning summary part",
        );
        yield* emitReasoningText(reasoning, missingDelta);
        existing.contentPartDone = true;
      }
      return;
    }

    if (
      type === "response.reasoning_summary_text.delta" ||
      type === "response.reasoning_summary_text.done" ||
      type === "response.reasoning_text.delta" ||
      type === "response.reasoning_text.done"
    ) {
      const itemId = readMessageItemId(record, "reasoning text event");
      const reasoning = reasoningBlocks.get(itemId);
      if (!reasoning) {
        throw invalidOpenAIResponsesStream(
          context,
          "reasoning text event referenced an unknown item",
        );
      }
      assertOutputIndex(itemId, record, "reasoning text event");
      const isSummary = type.includes("reasoning_summary_");
      const isDone = type.endsWith(".done");
      const index = isSummary ? readSummaryIndex(record) : readContentIndex(record);
      const parts = isSummary ? reasoning.summaryParts : reasoning.contentParts;
      const state = getOrCreateReasoningPart(parts, index);
      const value = isDone ? record.text : record.delta;
      if (typeof value !== "string") {
        throw invalidOpenAIResponsesStream(context, "reasoning text event was malformed");
      }
      if (isDone) {
        if (state.valueDone) {
          throw invalidOpenAIResponsesStream(context, "reasoning text completed twice");
        }
        const missingDelta = reconcileRetainedTextValue(
          state,
          value,
          "completed reasoning text",
        );
        yield* emitReasoningText(reasoning, missingDelta);
        state.valueDone = true;
      } else {
        if (state.valueDone || state.contentPartDone) {
          throw invalidOpenAIResponsesStream(
            context,
            "reasoning delta followed a completed part",
          );
        }
        if (value.length > 0) {
          state.sawDelta = true;
        }
        appendRetainedTextDelta(state, value);
        if (value.length > 0) {
          state.emittedValue = true;
        }
        yield* emitReasoningText(reasoning, value);
      }
      return;
    }

    if (type === "response.function_call_arguments.delta") {
      if (
        typeof record.item_id !== "string" ||
        record.item_id.length === 0 ||
        typeof record.delta !== "string"
      ) {
        throw invalidOpenAIResponsesStream(context, "function-call delta was malformed");
      }
      const state = functionCalls.get(record.item_id);
      if (!state) {
        throw invalidOpenAIResponsesStream(
          context,
          "function-call delta referenced an unknown item",
        );
      }
      assertOutputIndex(record.item_id, record, "function-call delta");
      if (state.argumentsDone) {
        throw invalidOpenAIResponsesStream(
          context,
          "function-call delta followed completed arguments",
        );
      }
      if (record.delta.length > 0 && !state.emittedStart) {
        yield {
          type: "tool-input-start",
          id: state.toolCallId,
          toolName: state.name,
        };
        state.emittedStart = true;
      }
      appendFunctionCallArgument(state, record.delta);
      if (record.delta.length > 0) {
        state.sawNonEmptyArgumentDelta = true;
        yield {
          type: "tool-input-delta",
          id: state.toolCallId,
          delta: record.delta,
        };
      }
      return;
    }

    if (type === "response.function_call_arguments.done") {
      if (
        typeof record.item_id !== "string" ||
        record.item_id.length === 0 ||
        typeof record.arguments !== "string"
      ) {
        throw invalidOpenAIResponsesStream(context, "completed function-call arguments malformed");
      }
      const state = functionCalls.get(record.item_id);
      if (!state) {
        throw invalidOpenAIResponsesStream(
          context,
          "completed function-call arguments referenced an unknown item",
        );
      }
      assertOutputIndex(record.item_id, record, "completed function-call arguments");
      if (typeof record.name !== "string" || record.name !== state.name) {
        throw invalidOpenAIResponsesStream(
          context,
          "completed function-call arguments name changed or was missing",
        );
      }
      if (state.argumentsDone) {
        throw invalidOpenAIResponsesStream(context, "function-call arguments completed twice");
      }
      const streamedArguments = joinOpenAIStreamToolArguments(state.argumentChunks);
      if (state.sawNonEmptyArgumentDelta && streamedArguments !== record.arguments) {
        throw invalidOpenAIResponsesStream(
          context,
          "completed function-call arguments disagreed with streamed deltas",
        );
      }
      if (!state.sawNonEmptyArgumentDelta) {
        appendFunctionCallArgument(state, record.arguments);
      }
      state.argumentsDone = true;
      return;
    }

    if (type === "response.output_item.done") {
      const { item, itemType, itemId } = readEventItem(record, "completed output");
      const outputItem = outputItems.get(itemId);
      if (!outputItem) {
        throw invalidOpenAIResponsesStream(context, "completed output referenced an unknown item");
      }
      if (outputItem.type !== itemType) {
        throw invalidOpenAIResponsesStream(context, "completed output item type changed");
      }
      assertOutputIndex(itemId, record, "completed output item");
      const validStatus = item.status === undefined ||
        item.status === "completed" ||
        item.status === "incomplete" ||
        (itemType === "web_search_call" && item.status === "failed");
      if (!validStatus) {
        throw invalidOpenAIResponsesStream(
          context,
          "completed output item status was malformed",
        );
      }
      if (itemType === "reasoning") {
        const state = reasoningBlocks.get(itemId);
        if (!state) {
          throw invalidOpenAIResponsesStream(
            context,
            "completed reasoning referenced an unknown item",
          );
        }
        yield* reconcileFinalReasoningParts(
          state,
          item.summary,
          state.summaryParts,
          "summary_text",
          "summary",
        );
        yield* reconcileFinalReasoningParts(
          state,
          item.content,
          state.contentParts,
          "reasoning_text",
          "content",
        );
        if (state.emittedStart) {
          yield { type: "reasoning-end", id: state.id };
        }
        releaseReasoningState(state);
        reasoningBlocks.delete(itemId);
      } else if (itemType === "function_call") {
        const state = functionCalls.get(itemId);
        if (!state) {
          throw invalidOpenAIResponsesStream(
            context,
            "completed function call referenced an unknown item",
          );
        }
        if (
          typeof item.call_id !== "string" ||
          item.call_id.length === 0 ||
          item.call_id !== state.toolCallId
        ) {
          throw invalidOpenAIResponsesStream(context, "completed function call id changed");
        }
        if (
          typeof item.name !== "string" ||
          item.name.length === 0 ||
          item.name !== state.name
        ) {
          throw invalidOpenAIResponsesStream(context, "completed function call name changed");
        }
        if (
          typeof item.arguments !== "string" ||
          (item.status !== undefined &&
            item.status !== "completed" &&
            item.status !== "incomplete")
        ) {
          throw invalidOpenAIResponsesStream(
            context,
            "completed function call arguments or status were malformed",
          );
        }
        const streamedArguments = joinOpenAIStreamToolArguments(state.argumentChunks);
        if (
          (state.argumentsDone || state.sawNonEmptyArgumentDelta) &&
          streamedArguments !== item.arguments
        ) {
          throw invalidOpenAIResponsesStream(
            context,
            "completed function call arguments disagreed with streamed deltas",
          );
        }
        if (!state.argumentsDone && !state.sawNonEmptyArgumentDelta) {
          appendFunctionCallArgument(state, item.arguments);
        }
        state.argumentsDone = true;
        const input = assertFunctionCallInput(state, context);
        if (!state.emittedStart) {
          yield {
            type: "tool-input-start",
            id: state.toolCallId,
            toolName: state.name,
          };
          yield {
            type: "tool-input-delta",
            id: state.toolCallId,
            delta: input,
          };
        }
        yield {
          type: "tool-call",
          toolCallId: state.toolCallId,
          toolName: state.name,
          input,
        };
        functionCalls.delete(itemId);
      } else if (itemType === "web_search_call") {
        const state = webSearchItems.get(itemId);
        if (!state || !context.webSearchToolName) {
          throw invalidOpenAIResponsesStream(
            context,
            "completed web-search call referenced an unknown item",
          );
        }
        const webSearch = normalizeOpenAIWebSearchCall(
          item,
          (issue) => invalidOpenAIResponsesStream(context, issue),
        );
        yield {
          type: "tool-input-delta",
          id: webSearch.id,
          delta: webSearch.input,
        };
        yield {
          type: "tool-call",
          toolCallId: webSearch.id,
          toolName: context.webSearchToolName,
          input: webSearch.input,
          providerExecuted: true,
        };
        yield {
          type: "tool-result",
          toolCallId: webSearch.id,
          toolName: context.webSearchToolName,
          result: webSearch.result,
          ...(webSearch.isError ? { isError: true } : {}),
          providerExecuted: true,
        };
        webSearchItems.delete(itemId);
      } else if (itemType === "message") {
        const state = messageItems.get(itemId);
        if (!state) {
          throw invalidOpenAIResponsesStream(
            context,
            "completed message referenced an unknown item",
          );
        }
        if (
          item.role !== "assistant" ||
          !Array.isArray(item.content) ||
          (item.status !== undefined &&
            item.status !== "completed" &&
            item.status !== "incomplete")
        ) {
          throw invalidOpenAIResponsesStream(
            context,
            "completed message role, content, or status were malformed",
          );
        }
        const finalContentIndices = new Set<number>();
        for (const [contentIndex, rawPart] of item.content.entries()) {
          const part = readRecord(rawPart);
          if (!part) {
            throw invalidOpenAIResponsesStream(
              context,
              "completed message content part was not an object",
            );
          }
          const kind = validateMessageContentPart(
            part,
            "completed message content part",
          );
          const partState = getOrCreateMessagePart(
            state,
            contentIndex,
            kind,
            "completed message content part",
          );
          if (
            partState.contentPartAdded &&
            (!partState.valueDone || !partState.contentPartDone)
          ) {
            throw invalidOpenAIResponsesStream(
              context,
              "completed message had an unfinished content part",
            );
          }
          const finalValue = kind === "output_text" ? part.text : part.refusal;
          const missingDelta = reconcileRetainedTextValue(
            partState,
            finalValue as string,
            "completed message content part",
          );
          if (missingDelta !== undefined) {
            yield { type: "text-delta", delta: missingDelta };
          }
          reconcileMessageAnnotations(
            partState,
            part,
            finalValue as string,
            "completed message content part",
          );
          finalContentIndices.add(contentIndex);
        }
        for (const contentIndex of state.parts.keys()) {
          if (!finalContentIndices.has(contentIndex)) {
            throw invalidOpenAIResponsesStream(
              context,
              "completed message omitted a streamed content part",
            );
          }
        }
        releaseMessageState(state);
        messageItems.delete(itemId);
      } else {
        throw invalidOpenAIResponsesStream(
          context,
          "completed output item type was unsupported",
        );
      }
      retainCompletedOutputItem(outputItem, item);
      outputItems.delete(itemId);
      return;
    }

    if (
      type === "response.completed" ||
      type === "response.failed" ||
      type === "response.incomplete"
    ) {
      if (sawTerminalEvent) {
        throw invalidOpenAIResponsesStream(context, "stream contained multiple terminal events");
      }
      if (outputItems.size > 0) {
        throw invalidOpenAIResponsesStream(
          context,
          "terminal response arrived with unfinished output items",
        );
      }
      const responseRecord = readRecord(record.response);
      if (!responseRecord || typeof responseRecord.status !== "string") {
        throw invalidOpenAIResponsesStream(context, "terminal response status was missing");
      }
      const expectedStatus = type.slice("response.".length);
      if (responseRecord.status !== expectedStatus) {
        throw invalidOpenAIResponsesStream(
          context,
          "terminal response status did not match its event type",
        );
      }
      finishReason = normalizeOpenAIResponsesFinishReason(responseRecord.status);
      usage = mergeOpenAIResponsesUsage(usage, record);
      sawTerminalEvent = true;
      return;
    }

    if (
      type === "response.created" ||
      type === "response.in_progress" ||
      type === "response.queued"
    ) {
      const response = readRecord(record.response);
      const expectedStatus = type === "response.created"
        ? "in_progress"
        : type.slice("response.".length);
      if (!response || response.status !== expectedStatus) {
        throw invalidOpenAIResponsesStream(
          context,
          "response lifecycle status did not match its event type",
        );
      }
      return;
    }

    throw invalidOpenAIResponsesStream(context, `event type ${type} was unsupported`);
  }

  for await (const chunk of stream) {
    buffer = appendOpenAISseChunk(
      decoder,
      buffer,
      chunk,
      (issue) => invalidOpenAIResponsesStream(context, issue),
    );
    const parsed = parseOpenAISseBuffer(
      buffer,
      (issue) => invalidOpenAIResponsesStream(context, issue),
    );
    buffer = parsed.remainder;
    for (const event of parsed.events) {
      yield* processEvent(event);
    }
  }

  buffer = finishOpenAISseDecoding(
    decoder,
    buffer,
    (issue) => invalidOpenAIResponsesStream(context, issue),
  );
  if (buffer.trim().length > 0) {
    const parsed = parseOpenAISseBuffer(
      buffer,
      (issue) => invalidOpenAIResponsesStream(context, issue),
      true,
    );
    for (const event of parsed.events) {
      yield* processEvent(event);
    }
  }

  if (!sawTerminalEvent) {
    throw invalidOpenAIResponsesStream(context, "stream ended before a terminal response event");
  }
  if (
    outputItems.size > 0 ||
    reasoningBlocks.size > 0 ||
    functionCalls.size > 0 ||
    messageItems.size > 0 ||
    webSearchItems.size > 0
  ) {
    throw invalidOpenAIResponsesStream(context, "stream ended with unfinished output items");
  }

  let providerMetadata: Record<string, unknown> | undefined;
  if (retainRawOutputItems && rawOutputItemsByOrder.length > 0) {
    if (
      rawOutputItemsByOrder.length !== seenOutputItemIds.size ||
      rawOutputItemsByOrder.some((item) => item === undefined)
    ) {
      throw invalidOpenAIResponsesStream(
        context,
        "raw response metadata omitted a completed output item",
      );
    }
    const rawOutputEntries = rawOutputItemsByOrder as Array<{
      item: Record<string, unknown>;
      order: number;
      outputIndex?: number;
    }>;
    const indexedEntryCount = rawOutputEntries.filter(
      (entry) => entry.outputIndex !== undefined,
    ).length;
    if (
      indexedEntryCount !== 0 &&
      indexedEntryCount !== rawOutputEntries.length
    ) {
      throw invalidOpenAIResponsesStream(
        context,
        "raw response output order was only partially indexed",
      );
    }
    const orderedEntries = indexedEntryCount === rawOutputEntries.length
      ? rawOutputEntries.toSorted((left, right) =>
        (left.outputIndex as number) - (right.outputIndex as number)
      )
      : rawOutputEntries.toSorted((left, right) => left.order - right.order);
    if (
      indexedEntryCount > 0 &&
      orderedEntries.some((entry, index) => entry.outputIndex !== index)
    ) {
      throw invalidOpenAIResponsesStream(
        context,
        "raw response output indexes were not contiguous",
      );
    }
    const candidateMetadata = createOpenAIRawResponseMetadata(
      orderedEntries.map((entry) => entry.item),
    );
    try {
      readOpenAIRawResponseOutputItems(candidateMetadata);
    } catch {
      throw invalidOpenAIResponsesStream(
        context,
        "raw response output items were unsafe to replay",
      );
    }
    providerMetadata = candidateMetadata;
  }

  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}
