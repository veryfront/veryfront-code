/**
 * OpenAI provider, implements the {@link LLMProvider} contract for OpenAI,
 * OpenAI-compatible endpoints (Azure OpenAI, Moonshot AI), and OpenAI's
 * Responses API.
 *
 * Ported from `src/provider/runtime-loader.ts` as part of PR 11.
 *
 * @module extensions/ext-llm-openai/openai-provider
 */

import type { LLMProvider, LLMProviderConfig } from "veryfront/extensions/llm";
import type {
  EmbeddingRuntime,
  ModelRuntime,
  RuntimeAssistantContentPart,
} from "veryfront/provider/types";
import {
  buildProviderError,
  createOpenAIRequestInit,
  createWarningCollector,
  getOpenAIChatCompletionsUrl,
  getOpenAIEmbeddingUrl,
  getOpenAIResponsesUrl,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  readGatewayBillingMode,
  readRecord,
  requestJson,
  requestStream,
  type RuntimeUsage,
  stringifyJsonValue,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
} from "veryfront/provider/shared";
import {
  buildOpenAIChatRequest,
  type OpenAICompatibleLanguageOptions,
} from "./openai-chat-request-builder.ts";
import { MAX_OPENAI_STREAM_TOOL_CALLS, streamOpenAICompatibleParts } from "./openai-chat-stream.ts";
import { buildOpenAIResponsesRequest } from "./openai-responses-request-builder.ts";
import { isOpenAIReasoningModel } from "./openai-reasoning-models.ts";
import {
  isBoundedOpenAIStreamString,
  MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
  MAX_OPENAI_STREAM_ITEM_TYPE_BYTES,
  MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
} from "./openai-stream-metadata.ts";
import {
  extractOpenAIResponsesUsage,
  normalizeOpenAIResponsesFinishReason,
  streamOpenAIResponsesParts,
} from "./openai-responses-stream.ts";
import { isJsonObjectText, MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES } from "./openai-tool-input.ts";
import {
  createOpenAIRawResponseMetadata,
  MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES,
  MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS,
  normalizeOpenAIWebSearchCall,
  readOpenAIRawResponseOutputItems,
  resolveOpenAIWebSearchDescriptor,
  validateOpenAIUrlCitation,
} from "./openai-web-search.ts";

// Re-export error classes so extension tests can import from this module.
export {
  buildProviderError,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
};

export interface OpenAIRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  /** Display/telemetry label. */
  name?: string;
  /** Provider identity for OpenAI request defaults. Defaults to `name` in low-level factories. */
  providerName?: string;
  fetch?: typeof globalThis.fetch;
}

const OPENAI_RESPONSE_TEXT_ENCODER = new TextEncoder();

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getOpenAIProviderLabel(config: { name?: string }): string {
  return readNonEmptyString(config.name) ?? "openai";
}

function normalizeOpenAIProviderName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized === "" ? undefined : normalized;
}

function getRuntimeOpenAIProviderName(config: OpenAIRuntimeConfig): string {
  return normalizeOpenAIProviderName(config.providerName) ??
    normalizeOpenAIProviderName(config.name) ?? "openai";
}

function getLLMOpenAIProviderName(config: LLMProviderConfig): string {
  return normalizeOpenAIProviderName(config.providerName) ?? "openai";
}

type OpenAIModelTransport = "auto" | "chat-completions" | "responses";

function getOpenAIModelTransport(config: LLMProviderConfig): OpenAIModelTransport {
  const transport = config.openAITransport;
  if (transport === undefined) return "auto";
  if (transport === "chat-completions" || transport === "responses") {
    return transport;
  }
  throw new TypeError('OpenAI transport must be "chat-completions" or "responses"');
}

type OpenAICompatibleProviderKind = "openai" | "mistral" | "moonshotai";

type OpenAIResponseContext = {
  providerKind: OpenAICompatibleProviderKind;
  providerLabel: string;
};

function getOpenAICompatibleProviderKind(
  config: OpenAIRuntimeConfig,
): OpenAICompatibleProviderKind {
  const providerName = getRuntimeOpenAIProviderName(config).trim().toLowerCase();
  return providerName === "mistral" || providerName === "moonshotai" ? providerName : "openai";
}

function invalidOpenAIResponse(
  context: OpenAIResponseContext,
  issue: string,
): ProviderRequestError {
  return new ProviderRequestError({
    provider: context.providerKind,
    status: 200,
    message: `${context.providerLabel} request failed: invalid successful response (${issue})`,
    retryable: false,
  });
}

function sanitizeRuntimeUsage(usage: RuntimeUsage | undefined): RuntimeUsage | undefined {
  const normalized = mergeUsage(undefined, usage);
  return normalized && Object.keys(normalized).length > 0 ? normalized : undefined;
}

function readUsageTokenCount(value: unknown): number | undefined {
  return typeof value === "number" &&
      Number.isFinite(value) &&
      Number.isSafeInteger(value) &&
      value >= 0
    ? value
    : undefined;
}

type OpenAICompatibleChoice = {
  message?: unknown;
  delta?: unknown;
  finish_reason?: unknown;
};

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

function extractOpenAIEmbeddings(
  payload: unknown,
  expectedCount: number,
  context: OpenAIResponseContext,
): number[][] {
  const record = readRecord(payload);
  const data = record?.data;
  if (!Array.isArray(data)) {
    throw invalidOpenAIResponse(context, "embedding data array missing");
  }
  if (data.length !== expectedCount) {
    throw invalidOpenAIResponse(
      context,
      `expected ${expectedCount} embedding vectors but received ${data.length}`,
    );
  }

  const positionalEmbeddings: number[][] = [];
  const indexedEmbeddings: Array<number[] | undefined> = Array(expectedCount);
  let indexMode: "indexed" | "positional" | undefined;
  let dimensions: number | undefined;

  for (const item of data) {
    const itemRecord = readRecord(item);
    const embedding = itemRecord?.embedding;
    if (!isNumberArray(embedding) || embedding.length === 0) {
      throw invalidOpenAIResponse(context, "embedding vector missing or invalid");
    }
    dimensions ??= embedding.length;
    if (embedding.length !== dimensions) {
      throw invalidOpenAIResponse(context, "embedding vectors had inconsistent dimensions");
    }

    const rawIndex = itemRecord?.index;
    const itemIndexMode = rawIndex === undefined ? "positional" : "indexed";
    if (indexMode !== undefined && indexMode !== itemIndexMode) {
      throw invalidOpenAIResponse(context, "embedding indices were inconsistently provided");
    }
    indexMode = itemIndexMode;

    if (itemIndexMode === "positional") {
      positionalEmbeddings.push(embedding);
      continue;
    }
    if (
      typeof rawIndex !== "number" ||
      !Number.isSafeInteger(rawIndex) ||
      rawIndex < 0 ||
      rawIndex >= expectedCount
    ) {
      throw invalidOpenAIResponse(context, "embedding index was invalid");
    }
    if (indexedEmbeddings[rawIndex] !== undefined) {
      throw invalidOpenAIResponse(context, "embedding indices contained a duplicate");
    }
    indexedEmbeddings[rawIndex] = embedding;
  }

  if (indexMode !== "indexed") {
    return positionalEmbeddings;
  }
  return indexedEmbeddings.map((embedding) => {
    if (embedding === undefined) {
      throw invalidOpenAIResponse(context, "embedding indices were incomplete");
    }
    return embedding;
  });
}

function extractOpenAIUsageTokens(payload: unknown): number | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  const totalTokens = usage?.total_tokens;
  return readUsageTokenCount(totalTokens);
}

// ---------------------------------------------------------------------------
// Chat helpers
// ---------------------------------------------------------------------------

function normalizeOpenAIFinishReason(
  raw: unknown,
): string | { unified: string; raw: string } | null {
  if (typeof raw !== "string") {
    return null;
  }

  if (raw === "tool_calls") {
    return { unified: "tool-calls", raw };
  }

  if (raw === "content_filter") {
    return { unified: "content-filter", raw };
  }

  return raw;
}

function extractOpenAIUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  const totalTokens = usage.total_tokens;
  const promptTokensDetails = readRecord(usage.prompt_tokens_details);
  const cachedTokens = promptTokensDetails?.cached_tokens;
  const completionTokensDetails = readRecord(usage.completion_tokens_details);
  const reasoningTokens = completionTokensDetails?.reasoning_tokens;
  const veryfront = readRecord(usage.veryfront);
  const costSource = veryfront?.cost_source;
  const billingMode = readGatewayBillingMode(veryfront?.billing_mode);
  const usageCaptureStatus = veryfront?.usage_capture_status;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof totalTokens === "number" ? totalTokens : undefined,
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

function extractOpenAIContentText(
  content: unknown,
  context: OpenAIResponseContext,
): string {
  if (typeof content === "string") {
    if (
      OPENAI_RESPONSE_TEXT_ENCODER.encode(content).byteLength >
        MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES
    ) {
      throw invalidOpenAIResponse(
        context,
        `message content exceeded ${MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES} UTF-8 bytes`,
      );
    }
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }
  if (content.length > MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS) {
    throw invalidOpenAIResponse(
      context,
      `message content exceeded ${MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS} parts`,
    );
  }

  const textParts: string[] = [];
  let retainedBytes = 0;
  for (const part of content) {
    const record = readRecord(part);
    if (!record) {
      throw invalidOpenAIResponse(context, "message content part was not an object");
    }
    const type = record?.type;
    let value: string;
    if (type === "text") {
      if (typeof record.text !== "string") {
        throw invalidOpenAIResponse(context, "text content part was malformed");
      }
      value = record.text;
    } else if (type === "refusal") {
      if (typeof record.refusal !== "string") {
        throw invalidOpenAIResponse(context, "refusal content part was malformed");
      }
      value = record.refusal;
    } else {
      throw invalidOpenAIResponse(context, "message content part type was unsupported");
    }
    const valueBytes = OPENAI_RESPONSE_TEXT_ENCODER.encode(value).byteLength;
    if (
      valueBytes >
        MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES - retainedBytes
    ) {
      throw invalidOpenAIResponse(
        context,
        `message content exceeded ${MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES} UTF-8 bytes`,
      );
    }
    retainedBytes += valueBytes;
    textParts.push(value);
  }

  return textParts.join("");
}

function extractOpenAIToolCalls(
  message: Record<string, unknown>,
  context: OpenAIResponseContext,
): Array<{
  toolCallId: string;
  toolName: string;
  input: string;
}> {
  const toolCalls = message.tool_calls;
  if (toolCalls === undefined || toolCalls === null) {
    return [];
  }
  if (!Array.isArray(toolCalls)) {
    throw invalidOpenAIResponse(context, "message tool_calls was not an array");
  }
  if (toolCalls.length > MAX_OPENAI_STREAM_TOOL_CALLS) {
    throw invalidOpenAIResponse(
      context,
      `message exceeded ${MAX_OPENAI_STREAM_TOOL_CALLS} tool calls`,
    );
  }

  const normalized: Array<{ toolCallId: string; toolName: string; input: string }> = [];
  const seenToolCallIds = new Set<string>();
  let retainedArgumentBytes = 0;
  for (const entry of toolCalls) {
    const record = readRecord(entry);
    const id = isBoundedOpenAIStreamString(
        record?.id,
        MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
      )
      ? record.id
      : undefined;
    const fn = readRecord(record?.function);
    const name = isBoundedOpenAIStreamString(
        fn?.name,
        MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
      )
      ? fn.name
      : undefined;
    const argumentsText = typeof fn?.arguments === "string" ? fn.arguments : undefined;
    if (record?.type !== "function" || !id || !name || argumentsText === undefined) {
      throw invalidOpenAIResponse(context, "message contained a malformed tool call");
    }
    if (seenToolCallIds.has(id)) {
      throw invalidOpenAIResponse(context, "message contained duplicate tool call ids");
    }
    const argumentBytes = OPENAI_RESPONSE_TEXT_ENCODER.encode(argumentsText).byteLength;
    if (
      argumentBytes >
        MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES - retainedArgumentBytes
    ) {
      throw invalidOpenAIResponse(
        context,
        `message tool call arguments exceeded ${MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES} UTF-8 bytes`,
      );
    }
    if (!isJsonObjectText(argumentsText)) {
      throw invalidOpenAIResponse(
        context,
        "message tool call arguments were not valid JSON object text",
      );
    }
    retainedArgumentBytes += argumentBytes;
    seenToolCallIds.add(id);
    normalized.push({
      toolCallId: id,
      toolName: name,
      input: argumentsText,
    });
  }

  return normalized;
}

function extractFirstChoice(
  payload: unknown,
  context: OpenAIResponseContext,
): OpenAICompatibleChoice {
  const record = readRecord(payload);
  const choices = record?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw invalidOpenAIResponse(context, "choices array missing or empty");
  }

  const first = readRecord(choices[0]);
  if (!first) {
    throw invalidOpenAIResponse(context, "first choice was not an object");
  }

  return first;
}

function buildOpenAIGenerateResult(
  payload: unknown,
  context: OpenAIResponseContext,
): {
  content: Array<
    { type: "text"; text: string } | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: string;
    }
  >;
  finishReason?: string | { unified: string; raw: string } | null;
  usage?: RuntimeUsage;
} {
  const choice = extractFirstChoice(payload, context);
  const message = readRecord(choice.message);
  if (!message) {
    throw invalidOpenAIResponse(context, "choice message missing");
  }
  if (message.role !== "assistant") {
    throw invalidOpenAIResponse(context, "choice message role was not assistant");
  }
  if (
    message.content !== undefined &&
    message.content !== null &&
    typeof message.content !== "string" &&
    !Array.isArray(message.content)
  ) {
    throw invalidOpenAIResponse(context, "message content had an invalid type");
  }
  if (
    message.refusal !== undefined &&
    message.refusal !== null &&
    typeof message.refusal !== "string"
  ) {
    throw invalidOpenAIResponse(context, "message refusal had an invalid type");
  }
  if (typeof choice.finish_reason !== "string" || choice.finish_reason.length === 0) {
    throw invalidOpenAIResponse(context, "choice finish reason missing");
  }
  const regularText = extractOpenAIContentText(message.content, context);
  const refusalText = typeof message.refusal === "string" ? message.refusal : "";
  const regularTextBytes = OPENAI_RESPONSE_TEXT_ENCODER.encode(regularText).byteLength;
  const refusalTextBytes = OPENAI_RESPONSE_TEXT_ENCODER.encode(refusalText).byteLength;
  if (
    refusalTextBytes >
      MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES - regularTextBytes
  ) {
    throw invalidOpenAIResponse(
      context,
      `message content exceeded ${MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES} UTF-8 bytes`,
    );
  }
  const text = regularText + refusalText;
  const toolCalls = extractOpenAIToolCalls(message, context);
  if ((choice.finish_reason === "tool_calls") !== (toolCalls.length > 0)) {
    throw invalidOpenAIResponse(
      context,
      "choice finish reason and tool calls were inconsistent",
    );
  }
  const content = [
    ...(text.length > 0 ? [{ type: "text" as const, text }] : []),
    ...toolCalls.map((toolCall) => ({
      type: "tool-call" as const,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      input: toolCall.input,
    })),
  ];

  return {
    content,
    finishReason: normalizeOpenAIFinishReason(choice?.finish_reason),
    usage: sanitizeRuntimeUsage(extractOpenAIUsage(payload)),
  };
}

// ---------------------------------------------------------------------------
// Responses API result helpers
// ---------------------------------------------------------------------------

type OpenAIResponsesContentPart =
  | { type: "text"; text: string }
  | {
    type: "reasoning";
    text?: string;
    signature?: string;
  }
  | {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: string;
    providerExecuted?: boolean;
  }
  | {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError?: boolean;
    providerExecuted: true;
  };

function assertTerminalOpenAIResponsesOutputItem(
  item: Record<string, unknown>,
  context: OpenAIResponseContext,
): void {
  const validStatus = item.status === undefined ||
    item.status === "completed" ||
    item.status === "incomplete" ||
    (item.type === "web_search_call" && item.status === "failed");
  if (!validStatus) {
    throw invalidOpenAIResponse(context, "output item status was unsupported or nonterminal");
  }
}

function createValidatedOpenAIRawResponseMetadata(
  outputItems: Array<Record<string, unknown>>,
  context: OpenAIResponseContext,
): Record<string, unknown> {
  const metadata = createOpenAIRawResponseMetadata(outputItems);
  try {
    readOpenAIRawResponseOutputItems(metadata);
  } catch {
    throw invalidOpenAIResponse(
      context,
      "raw response output items were unsafe to replay",
    );
  }
  return metadata;
}

function buildOpenAIResponsesGenerateResult(
  payload: unknown,
  context: OpenAIResponseContext,
  webSearchToolName?: string,
): {
  content: OpenAIResponsesContentPart[];
  finishReason?: string | { unified: string; raw: string } | null;
  usage?: RuntimeUsage;
  providerMetadata?: Record<string, unknown>;
} {
  const record = readRecord(payload);
  if (!record) {
    throw invalidOpenAIResponse(context, "response body was not an object");
  }
  if (typeof record.status !== "string" || record.status.length === 0) {
    throw invalidOpenAIResponse(context, "response status missing");
  }
  if (
    record.status !== "completed" &&
    record.status !== "incomplete" &&
    record.status !== "failed"
  ) {
    throw invalidOpenAIResponse(context, "response status was unsupported or nonterminal");
  }
  if (!Array.isArray(record.output)) {
    throw invalidOpenAIResponse(context, "output array missing");
  }
  const output = record.output;
  if (output.length > MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS) {
    throw invalidOpenAIResponse(
      context,
      `output exceeded ${MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS} items`,
    );
  }
  const content: OpenAIResponsesContentPart[] = [];
  const rawOutputItems: Array<Record<string, unknown>> = [];
  const seenOutputItemIds = new Set<string>();
  const seenToolCallIds = new Set<string>();
  let normalizedContentBytes = 0;

  function reserveNormalizedContent(value: string, issue: string): void {
    const valueBytes = OPENAI_RESPONSE_TEXT_ENCODER.encode(value).byteLength;
    if (
      valueBytes > MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES -
          normalizedContentBytes
    ) {
      throw invalidOpenAIResponse(
        context,
        `${issue} exceeded ${MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES} UTF-8 bytes`,
      );
    }
    normalizedContentBytes += valueBytes;
  }

  for (const item of output) {
    const itemRecord = readRecord(item);
    if (!itemRecord) {
      throw invalidOpenAIResponse(context, "output item was not an object");
    }
    rawOutputItems.push(itemRecord);
    const itemType = isBoundedOpenAIStreamString(
        itemRecord.type,
        MAX_OPENAI_STREAM_ITEM_TYPE_BYTES,
      )
      ? itemRecord.type
      : undefined;
    if (!itemType) {
      throw invalidOpenAIResponse(context, "output item type missing");
    }
    assertTerminalOpenAIResponsesOutputItem(itemRecord, context);
    if (
      !isBoundedOpenAIStreamString(
        itemRecord.id,
        MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
      )
    ) {
      throw invalidOpenAIResponse(context, "output item id was malformed");
    }
    if (seenOutputItemIds.has(itemRecord.id)) {
      throw invalidOpenAIResponse(context, "response contained duplicate output item ids");
    }
    seenOutputItemIds.add(itemRecord.id);

    if (itemType === "message") {
      if (itemRecord.role !== "assistant") {
        throw invalidOpenAIResponse(context, "message output role was not assistant");
      }
      if (!Array.isArray(itemRecord.content)) {
        throw invalidOpenAIResponse(context, "message output content was not an array");
      }
      if (itemRecord.content.length > MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS) {
        throw invalidOpenAIResponse(
          context,
          "message output contained too many content parts",
        );
      }
      // A message item bundles one or more output_text parts.
      const textParts: string[] = [];
      for (const part of itemRecord.content) {
        const p = readRecord(part);
        if (!p) {
          throw invalidOpenAIResponse(context, "message content part was not an object");
        }
        if (p.type === "output_text") {
          if (typeof p.text !== "string") {
            throw invalidOpenAIResponse(context, "output-text content part was malformed");
          }
          if (p.annotations !== undefined) {
            if (
              !Array.isArray(p.annotations) ||
              p.annotations.length > MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS
            ) {
              throw invalidOpenAIResponse(context, "output-text annotations were malformed");
            }
            for (const annotation of p.annotations) {
              const citation = validateOpenAIUrlCitation(
                annotation,
                (issue) => invalidOpenAIResponse(context, issue),
              );
              if ((citation.end_index as number) > p.text.length) {
                throw invalidOpenAIResponse(
                  context,
                  "URL citation annotation range exceeded output text",
                );
              }
            }
          }
          reserveNormalizedContent(p.text, "normalized response content");
          textParts.push(p.text);
        } else if (p.type === "refusal") {
          if (
            typeof p.refusal !== "string" ||
            p.annotations !== undefined
          ) {
            throw invalidOpenAIResponse(context, "refusal content part was malformed");
          }
          reserveNormalizedContent(p.refusal, "normalized response content");
          textParts.push(p.refusal);
        } else {
          throw invalidOpenAIResponse(context, "message content part type was unsupported");
        }
      }
      const text = textParts.join("");
      if (text.length > 0) {
        content.push({ type: "text", text });
      }
      continue;
    }

    if (itemType === "function_call") {
      const toolCallId = isBoundedOpenAIStreamString(
          itemRecord.call_id,
          MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
        )
        ? itemRecord.call_id
        : undefined;
      const toolName = isBoundedOpenAIStreamString(
          itemRecord.name,
          MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
        )
        ? itemRecord.name
        : undefined;
      if (
        !toolCallId ||
        !toolName ||
        !isBoundedOpenAIStreamString(
          itemRecord.arguments,
          MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES,
        )
      ) {
        throw invalidOpenAIResponse(context, "function call output item was malformed");
      }
      if (seenToolCallIds.has(toolCallId)) {
        throw invalidOpenAIResponse(context, "response contained duplicate function call ids");
      }
      if (!isJsonObjectText(itemRecord.arguments)) {
        throw invalidOpenAIResponse(
          context,
          "function call arguments were not valid JSON object text",
        );
      }
      reserveNormalizedContent(itemRecord.arguments, "normalized response content");
      content.push({
        type: "tool-call",
        toolCallId,
        toolName,
        input: itemRecord.arguments,
      });
      seenToolCallIds.add(toolCallId);
      continue;
    }

    if (itemType === "web_search_call") {
      if (!webSearchToolName) {
        throw invalidOpenAIResponse(
          context,
          "provider emitted web search without a configured web-search tool",
        );
      }
      const webSearch = normalizeOpenAIWebSearchCall(
        itemRecord,
        (issue) => invalidOpenAIResponse(context, issue),
      );
      if (seenToolCallIds.has(webSearch.id)) {
        throw invalidOpenAIResponse(context, "response contained duplicate tool call ids");
      }
      reserveNormalizedContent(webSearch.input, "normalized response content");
      reserveNormalizedContent(
        stringifyJsonValue(webSearch.result),
        "normalized response content",
      );
      content.push({
        type: "tool-call",
        toolCallId: webSearch.id,
        toolName: webSearchToolName,
        input: webSearch.input,
        providerExecuted: true,
      });
      content.push({
        type: "tool-result",
        toolCallId: webSearch.id,
        toolName: webSearchToolName,
        result: webSearch.result,
        ...(webSearch.isError ? { isError: true } : {}),
        providerExecuted: true,
      });
      seenToolCallIds.add(webSearch.id);
      continue;
    }

    if (itemType === "reasoning") {
      if (
        (itemRecord.summary !== undefined && !Array.isArray(itemRecord.summary)) ||
        (itemRecord.content !== undefined && !Array.isArray(itemRecord.content))
      ) {
        throw invalidOpenAIResponse(
          context,
          "reasoning summary or content was not an array",
        );
      }
      const summary = Array.isArray(itemRecord.summary) ? itemRecord.summary : [];
      const reasoningContent = Array.isArray(itemRecord.content) ? itemRecord.content : [];
      if (
        summary.length > MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS ||
        reasoningContent.length > MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS
      ) {
        throw invalidOpenAIResponse(context, "reasoning contained too many parts");
      }
      const reasoningText: string[] = [];
      for (
        const [parts, expectedType] of [
          [summary, "summary_text"],
          [reasoningContent, "reasoning_text"],
        ] as const
      ) {
        for (const rawPart of parts) {
          const part = readRecord(rawPart);
          if (
            !part ||
            part.type !== expectedType ||
            typeof part.text !== "string" ||
            (part.id !== undefined &&
              !isBoundedOpenAIStreamString(
                part.id,
                MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
              ))
          ) {
            throw invalidOpenAIResponse(
              context,
              expectedType === "summary_text"
                ? "reasoning summary item was malformed"
                : "reasoning content item was malformed",
            );
          }
          if (part.text.length > 0) {
            reserveNormalizedContent(part.text, "normalized response content");
            reasoningText.push(part.text);
          }
        }
      }
      if (
        itemRecord.encrypted_content !== undefined &&
        (typeof itemRecord.encrypted_content !== "string" ||
          OPENAI_RESPONSE_TEXT_ENCODER.encode(itemRecord.encrypted_content).byteLength >
            MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES)
      ) {
        throw invalidOpenAIResponse(context, "reasoning encrypted content was malformed");
      }
      const signature = typeof itemRecord.encrypted_content === "string"
        ? itemRecord.encrypted_content
        : undefined;
      if (signature !== undefined) {
        reserveNormalizedContent(signature, "normalized response content");
      }
      if (reasoningText.length > 0 || signature !== undefined) {
        content.push({
          type: "reasoning",
          ...(reasoningText.length > 0 ? { text: reasoningText.join("") } : {}),
          ...(signature !== undefined ? { signature } : {}),
        });
      }
      continue;
    }

    throw invalidOpenAIResponse(context, "output item type was unsupported");
  }
  return {
    content,
    finishReason: normalizeOpenAIResponsesFinishReason(record?.status),
    usage: sanitizeRuntimeUsage(extractOpenAIResponsesUsage(payload)),
    ...(rawOutputItems.length > 0
      ? {
        providerMetadata: createValidatedOpenAIRawResponseMetadata(
          rawOutputItems,
          context,
        ),
      }
      : {}),
  };
}

function createOpenAIProviderAbortScope(callerSignal: AbortSignal | undefined): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) {
    abortFromCaller();
    return { controller, dispose() {} };
  }

  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  return {
    controller,
    dispose() {
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function createCancelableOpenAIProviderStream(
  iterable: AsyncIterable<unknown>,
  providerAbortController: AbortController,
  disposeAbortScope: () => void,
): ReadableStream<unknown> {
  const iterator = iterable[Symbol.asyncIterator]();
  let consumerCanceled = false;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeAbortScope();
  };

  return new ReadableStream<unknown>(
    {
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) {
            dispose();
            controller.close();
            return;
          }
          controller.enqueue(next.value);
        } catch (error) {
          if (!providerAbortController.signal.aborted) {
            providerAbortController.abort(error);
          }
          dispose();
          if (!consumerCanceled) {
            controller.error(error);
          }
        }
      },
      async cancel(reason) {
        consumerCanceled = true;
        if (!providerAbortController.signal.aborted) {
          providerAbortController.abort(reason);
        }
        try {
          await iterator.return?.();
        } catch (error) {
          if (!providerAbortController.signal.aborted) {
            throw error;
          }
        } finally {
          dispose();
        }
      },
    },
    // Avoid speculative reads so cancellation reaches the provider body as
    // soon as the consumer stops after its most recent part.
    { highWaterMark: 0 },
  );
}

// ---------------------------------------------------------------------------
// Public factory functions
// ---------------------------------------------------------------------------

export function createOpenAIModelRuntime(
  config: OpenAIRuntimeConfig,
  modelId: string,
): ModelRuntime<OpenAICompatibleLanguageOptions, RuntimeAssistantContentPart> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const providerLabel = getOpenAIProviderLabel(config);
  const providerName = getRuntimeOpenAIProviderName(config);
  const providerKind = getOpenAICompatibleProviderKind(config);
  const responseContext = { providerKind, providerLabel };
  return {
    provider: providerLabel,
    modelProvider: providerName,
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate(options: OpenAICompatibleLanguageOptions) {
      const url = getOpenAIChatCompletionsUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIChatRequest(
        modelId,
        providerName,
        options,
        false,
        warnings,
      );
      return requestJson({
        url,
        fetchImpl,
        providerLabel,
        providerKind,
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((payload) => {
        const drained = warnings.drain();
        return {
          ...buildOpenAIGenerateResult(payload, responseContext),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
    async doStream(options: OpenAICompatibleLanguageOptions) {
      const url = getOpenAIChatCompletionsUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIChatRequest(
        modelId,
        providerName,
        options,
        true,
        warnings,
      );
      const providerAbortScope = createOpenAIProviderAbortScope(options.abortSignal);
      try {
        const responseStream = await requestStream({
          url,
          fetchImpl,
          providerLabel,
          providerKind,
          init: createOpenAIRequestInit({
            apiKey: config.apiKey,
            extraHeaders: options.headers,
            body: JSON.stringify(body),
            signal: providerAbortScope.controller.signal,
          }),
        });
        const drained = warnings.drain();
        return {
          stream: createCancelableOpenAIProviderStream(
            streamOpenAICompatibleParts(responseStream, responseContext),
            providerAbortScope.controller,
            providerAbortScope.dispose,
          ),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      } catch (error) {
        providerAbortScope.dispose();
        throw error;
      }
    },
  };
}

export function createOpenAIResponsesRuntime(
  config: OpenAIRuntimeConfig,
  modelId: string,
): ModelRuntime<OpenAICompatibleLanguageOptions, RuntimeAssistantContentPart> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const providerLabel = getOpenAIProviderLabel(config);
  const providerName = getRuntimeOpenAIProviderName(config);
  const providerKind = getOpenAICompatibleProviderKind(config);
  const responseContext = { providerKind, providerLabel };
  return {
    provider: providerLabel,
    modelProvider: providerName,
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate(options: OpenAICompatibleLanguageOptions) {
      const url = getOpenAIResponsesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIResponsesRequest(
        modelId,
        providerName,
        options,
        false,
        warnings,
      );
      const webSearchToolName = resolveOpenAIWebSearchDescriptor(options.tools)?.name;
      return requestJson({
        url,
        fetchImpl,
        providerLabel,
        providerKind,
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((payload) => {
        const drained = warnings.drain();
        return {
          ...buildOpenAIResponsesGenerateResult(
            payload,
            responseContext,
            webSearchToolName,
          ),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
    async doStream(options: OpenAICompatibleLanguageOptions) {
      const url = getOpenAIResponsesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIResponsesRequest(
        modelId,
        providerName,
        options,
        true,
        warnings,
      );
      const webSearchToolName = resolveOpenAIWebSearchDescriptor(options.tools)?.name;
      const providerAbortScope = createOpenAIProviderAbortScope(options.abortSignal);
      try {
        const responseStream = await requestStream({
          url,
          fetchImpl,
          providerLabel,
          providerKind,
          init: createOpenAIRequestInit({
            apiKey: config.apiKey,
            extraHeaders: options.headers,
            body: JSON.stringify(body),
            signal: providerAbortScope.controller.signal,
          }),
        });
        const drained = warnings.drain();
        return {
          stream: createCancelableOpenAIProviderStream(
            streamOpenAIResponsesParts(responseStream, {
              ...responseContext,
              webSearchToolName,
              preserveRawOutputItems: true,
            }),
            providerAbortScope.controller,
            providerAbortScope.dispose,
          ),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      } catch (error) {
        providerAbortScope.dispose();
        throw error;
      }
    },
  };
}

function requestUsesOpenAIHostedTool(optionsForRuntime: OpenAICompatibleLanguageOptions): boolean {
  const options = readRecord(optionsForRuntime);
  if (!options || options.tools === undefined) return false;
  if (!Array.isArray(options.tools)) {
    throw new TypeError("OpenAI runtime tools must be an array");
  }
  return resolveOpenAIWebSearchDescriptor(
    options.tools as OpenAICompatibleLanguageOptions["tools"],
  ) !== undefined;
}

function createOpenAIChatCompletionsOnlyRuntime(
  chatRuntime: ModelRuntime<OpenAICompatibleLanguageOptions, RuntimeAssistantContentPart>,
): ModelRuntime<OpenAICompatibleLanguageOptions, RuntimeAssistantContentPart> {
  function assertHostedToolsSupported(options: OpenAICompatibleLanguageOptions): void {
    if (requestUsesOpenAIHostedTool(options)) {
      throw new TypeError(
        "OpenAI hosted tools require the Responses API and are unavailable with Chat Completions",
      );
    }
  }

  return {
    ...chatRuntime,
    async doGenerate(optionsForRuntime: OpenAICompatibleLanguageOptions) {
      assertHostedToolsSupported(optionsForRuntime);
      return await chatRuntime.doGenerate(optionsForRuntime);
    },
    async doStream(optionsForRuntime: OpenAICompatibleLanguageOptions) {
      assertHostedToolsSupported(optionsForRuntime);
      return await chatRuntime.doStream(optionsForRuntime);
    },
  };
}

function createOpenAIAdaptiveModelRuntime(
  chatRuntime: ModelRuntime<OpenAICompatibleLanguageOptions, RuntimeAssistantContentPart>,
  responsesRuntime: ModelRuntime<OpenAICompatibleLanguageOptions, RuntimeAssistantContentPart>,
): ModelRuntime<OpenAICompatibleLanguageOptions, RuntimeAssistantContentPart> {
  return {
    ...chatRuntime,
    doGenerate(optionsForRuntime: OpenAICompatibleLanguageOptions) {
      return requestUsesOpenAIHostedTool(optionsForRuntime)
        ? responsesRuntime.doGenerate(optionsForRuntime)
        : chatRuntime.doGenerate(optionsForRuntime);
    },
    doStream(optionsForRuntime: OpenAICompatibleLanguageOptions) {
      return requestUsesOpenAIHostedTool(optionsForRuntime)
        ? responsesRuntime.doStream(optionsForRuntime)
        : chatRuntime.doStream(optionsForRuntime);
    },
  };
}

export function createOpenAIEmbeddingRuntime(
  config: OpenAIRuntimeConfig,
  modelId: string,
): EmbeddingRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const providerLabel = getOpenAIProviderLabel(config);
  const providerKind = getOpenAICompatibleProviderKind(config);
  const responseContext = { providerKind, providerLabel };
  return {
    provider: providerLabel,
    modelId,
    supportsParallelCalls: true,
    doEmbed({ values, abortSignal }) {
      if (values.length === 0) {
        return Promise.resolve({
          embeddings: [],
          warnings: [],
          rawResponse: { data: [] },
        });
      }

      const url = getOpenAIEmbeddingUrl(config.baseURL);
      return requestJson({
        url,
        fetchImpl,
        providerLabel,
        providerKind,
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          body: JSON.stringify({
            model: modelId,
            input: values,
          }),
          signal: abortSignal,
        }),
      }).then((payload) => {
        const tokens = extractOpenAIUsageTokens(payload);
        return {
          embeddings: extractOpenAIEmbeddings(payload, values.length, responseContext),
          ...(tokens !== undefined ? { usage: { tokens } } : {}),
          rawResponse: payload,
          warnings: [],
        };
      });
    },
  };
}

export class OpenAIProvider implements LLMProvider {
  readonly id = "openai";

  createModel(
    modelId: string,
    config: LLMProviderConfig,
  ): ModelRuntime<OpenAICompatibleLanguageOptions, RuntimeAssistantContentPart> {
    const providerLabel = getOpenAIProviderLabel(config);
    const providerName = getLLMOpenAIProviderName(config);
    const runtimeConfig: OpenAIRuntimeConfig = {
      apiKey: config.credential,
      baseURL: config.baseURL,
      name: providerLabel,
      providerName,
      fetch: config.fetch,
    };
    const responsesRuntime = createOpenAIResponsesRuntime(
      runtimeConfig,
      modelId,
    );
    const chatRuntime = createOpenAIModelRuntime(runtimeConfig, modelId);
    const transport = getOpenAIModelTransport(config);
    if (
      transport === "responses" ||
      (transport === "auto" && isOpenAIReasoningModel(modelId, providerName))
    ) {
      return responsesRuntime;
    }
    if (transport === "chat-completions") {
      return createOpenAIChatCompletionsOnlyRuntime(chatRuntime);
    }

    return createOpenAIAdaptiveModelRuntime(
      chatRuntime,
      responsesRuntime,
    );
  }

  createEmbedding(modelId: string, config: LLMProviderConfig): EmbeddingRuntime {
    return createOpenAIEmbeddingRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: getOpenAIProviderLabel(config),
        providerName: getLLMOpenAIProviderName(config),
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createResponses(
    modelId: string,
    config: LLMProviderConfig,
  ): ModelRuntime<OpenAICompatibleLanguageOptions, RuntimeAssistantContentPart> {
    return createOpenAIResponsesRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: getOpenAIProviderLabel(config),
        providerName: getLLMOpenAIProviderName(config),
        fetch: config.fetch,
      },
      modelId,
    );
  }
}
