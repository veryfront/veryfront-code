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
import type { EmbeddingRuntime, ModelRuntime } from "veryfront/provider/types";
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
  parseSseChunk,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  readRecord,
  requestJson,
  requestStream,
  stringifyJsonValue,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
} from "veryfront/provider/shared";
import {
  buildOpenAIChatRequest,
  type OpenAICompatibleLanguageOptions,
} from "./openai-chat-request-builder.ts";
import { streamOpenAICompatibleParts } from "./openai-chat-stream.ts";
import { buildOpenAIResponsesRequest } from "./openai-responses-request-builder.ts";

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
  withToolInputStatusTransitions,
};

export interface OpenAIRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

type OpenAICompatibleChoice = {
  message?: unknown;
  delta?: unknown;
  finish_reason?: unknown;
};

type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

function extractOpenAIEmbeddings(payload: unknown): number[][] {
  const record = readRecord(payload);
  const data = record?.data;
  if (!Array.isArray(data)) {
    throw new Error("Invalid OpenAI embedding response: data array missing");
  }

  const embeddings: number[][] = [];

  for (const item of data) {
    const itemRecord = readRecord(item);
    const embedding = itemRecord?.embedding;
    if (!isNumberArray(embedding)) {
      throw new Error("Invalid OpenAI embedding response: embedding vector missing");
    }
    embeddings.push(embedding);
  }

  return embeddings;
}

function extractOpenAIUsageTokens(payload: unknown): number | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  const totalTokens = usage?.total_tokens;
  return typeof totalTokens === "number" ? totalTokens : undefined;
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

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof totalTokens === "number" ? totalTokens : undefined,
    ...(typeof cachedTokens === "number" ? { cacheReadInputTokens: cachedTokens } : {}),
  };
}

function extractOpenAIContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  let text = "";
  for (const part of content) {
    const record = readRecord(part);
    const type = record?.type;
    if (type === "text" && typeof record?.text === "string") {
      text += record.text;
    }
  }

  return text;
}

function extractOpenAIToolCalls(message: Record<string, unknown>): Array<{
  toolCallId: string;
  toolName: string;
  input: string;
}> {
  const toolCalls = message.tool_calls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  const normalized: Array<{ toolCallId: string; toolName: string; input: string }> = [];
  for (const entry of toolCalls) {
    const record = readRecord(entry);
    const id = typeof record?.id === "string" ? record.id : undefined;
    const fn = readRecord(record?.function);
    const name = typeof fn?.name === "string" ? fn.name : undefined;
    const argumentsText = typeof fn?.arguments === "string" ? fn.arguments : undefined;
    if (!id || !name || argumentsText === undefined) {
      continue;
    }
    normalized.push({
      toolCallId: id,
      toolName: name,
      input: argumentsText,
    });
  }

  return normalized;
}

function extractFirstChoice(payload: unknown): OpenAICompatibleChoice | undefined {
  const record = readRecord(payload);
  const choices = record?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }

  const first = readRecord(choices[0]);
  if (!first) {
    return undefined;
  }

  return first;
}

function buildOpenAIGenerateResult(payload: unknown): {
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
  const choice = extractFirstChoice(payload);
  const message = readRecord(choice?.message);
  const text = extractOpenAIContentText(message?.content);
  const toolCalls = message ? extractOpenAIToolCalls(message) : [];

  return {
    content: [
      ...(text.length > 0 ? [{ type: "text" as const, text }] : []),
      ...toolCalls.map((toolCall) => ({
        type: "tool-call" as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
      })),
    ],
    finishReason: normalizeOpenAIFinishReason(choice?.finish_reason),
    usage: extractOpenAIUsage(payload),
  };
}

// ---------------------------------------------------------------------------
// Responses API result helpers
// ---------------------------------------------------------------------------

/**
 * The Responses API uses `input_tokens` / `output_tokens` field names
 * instead of Chat Completions' `prompt_tokens` / `completion_tokens`.
 */
function extractOpenAIResponsesUsage(payload: unknown): RuntimeUsage | undefined {
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

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(typeof cachedTokens === "number" ? { cacheReadInputTokens: cachedTokens } : {}),
  };
}

function normalizeOpenAIResponsesFinishReason(
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
      return raw;
  }
}

type OpenAIResponsesContentPart =
  | { type: "text"; text: string }
  | {
    type: "reasoning";
    summaries?: Array<{ id?: string; text: string }>;
    signature?: string;
  }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: string };

function buildOpenAIResponsesGenerateResult(payload: unknown): {
  content: OpenAIResponsesContentPart[];
  finishReason?: string | { unified: string; raw: string } | null;
  usage?: RuntimeUsage;
} {
  const record = readRecord(payload);
  const output = Array.isArray(record?.output) ? record.output : [];
  const content: OpenAIResponsesContentPart[] = [];

  for (const item of output) {
    const itemRecord = readRecord(item);
    const itemType = typeof itemRecord?.type === "string" ? itemRecord.type : undefined;

    if (itemType === "message" && Array.isArray(itemRecord?.content)) {
      // A message item bundles one or more output_text parts.
      let text = "";
      for (const part of itemRecord.content) {
        const p = readRecord(part);
        if (typeof p?.type === "string" && p.type === "output_text" && typeof p.text === "string") {
          text += p.text;
        }
      }
      if (text.length > 0) {
        content.push({ type: "text", text });
      }
      continue;
    }

    if (itemType === "function_call") {
      content.push({
        type: "tool-call",
        toolCallId: typeof itemRecord?.call_id === "string"
          ? itemRecord.call_id
          : (typeof itemRecord?.id === "string" ? itemRecord.id : ""),
        toolName: typeof itemRecord?.name === "string" ? itemRecord.name : "",
        input: typeof itemRecord?.arguments === "string"
          ? itemRecord.arguments
          : stringifyJsonValue(itemRecord?.arguments ?? {}),
      });
      continue;
    }

    if (itemType === "reasoning") {
      const summary = Array.isArray(itemRecord?.summary) ? itemRecord.summary : [];
      const summaries: Array<{ id?: string; text: string }> = [];
      for (const s of summary) {
        const sr = readRecord(s);
        if (typeof sr?.text === "string" && sr.text.length > 0) {
          summaries.push({
            ...(typeof sr?.id === "string" ? { id: sr.id } : {}),
            text: sr.text,
          });
        }
      }
      content.push({
        type: "reasoning",
        ...(summaries.length > 0 ? { summaries } : {}),
        ...(typeof itemRecord?.encrypted_content === "string"
          ? { signature: itemRecord.encrypted_content }
          : {}),
      });
      continue;
    }
  }

  return {
    content,
    finishReason: normalizeOpenAIResponsesFinishReason(record?.status),
    usage: extractOpenAIResponsesUsage(payload),
  };
}

type OpenAIResponsesStreamReasoningState = {
  id: string;
  emittedStart: boolean;
};

type OpenAIResponsesStreamFunctionCallState = {
  id: string;
  toolCallId: string;
  name: string;
  arguments: string;
};

/**
 * Parse the Responses API streaming event grammar into the same UI part
 * shapes the existing OpenAI / Anthropic / Google streams emit.
 */
async function* streamOpenAIResponsesParts(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const reasoningBlocks = new Map<string, OpenAIResponsesStreamReasoningState>();
  const functionCalls = new Map<string, OpenAIResponsesStreamFunctionCallState>();
  const startedToolCalls = new Set<string>();
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: RuntimeUsage | undefined;
  let reasoningCounter = 0;

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      if (event === "[DONE]") continue;
      const record = readRecord(event);
      const type = typeof record?.type === "string" ? record.type : undefined;
      if (!type) continue;

      // response.output_item.added: a new output item begins.
      if (type === "response.output_item.added") {
        const item = readRecord(record?.item);
        const itemType = typeof item?.type === "string" ? item.type : undefined;
        const itemId = typeof item?.id === "string" ? item.id : undefined;
        if (itemType === "function_call" && itemId) {
          const callId = typeof item?.call_id === "string" ? item.call_id : itemId;
          const name = typeof item?.name === "string" ? item.name : "";
          functionCalls.set(itemId, {
            id: itemId,
            toolCallId: callId,
            name,
            arguments: "",
          });
        }
        if (itemType === "reasoning" && itemId) {
          reasoningBlocks.set(itemId, {
            id: `reasoning-${reasoningCounter++}`,
            emittedStart: false,
          });
        }
        continue;
      }

      // response.output_text.delta: text chunk for a message item.
      if (type === "response.output_text.delta" && typeof record?.delta === "string") {
        if (record.delta.length > 0) {
          yield { type: "text-delta", delta: record.delta };
        }
        continue;
      }

      // response.reasoning_summary_text.delta: reasoning summary text chunk.
      if (type === "response.reasoning_summary_text.delta" && typeof record?.delta === "string") {
        const itemId = typeof record?.item_id === "string" ? record.item_id : undefined;
        const state = itemId ? reasoningBlocks.get(itemId) : undefined;
        if (state && record.delta.length > 0) {
          if (!state.emittedStart) {
            yield { type: "reasoning-start", id: state.id };
            state.emittedStart = true;
          }
          yield { type: "reasoning-delta", id: state.id, delta: record.delta };
        }
        continue;
      }

      // response.function_call_arguments.delta: tool call argument chunk.
      if (type === "response.function_call_arguments.delta" && typeof record?.delta === "string") {
        const itemId = typeof record?.item_id === "string" ? record.item_id : undefined;
        const state = itemId ? functionCalls.get(itemId) : undefined;
        if (state && record.delta.length > 0) {
          if (!startedToolCalls.has(state.id)) {
            yield {
              type: "tool-input-start",
              id: state.toolCallId,
              toolName: state.name,
            };
            startedToolCalls.add(state.id);
          }
          state.arguments += record.delta;
          yield {
            type: "tool-input-delta",
            id: state.toolCallId,
            delta: record.delta,
          };
        }
        continue;
      }

      // response.output_item.done: an item has finished emitting deltas.
      if (type === "response.output_item.done") {
        const item = readRecord(record?.item);
        const itemType = typeof item?.type === "string" ? item.type : undefined;
        const itemId = typeof item?.id === "string" ? item.id : undefined;
        if (itemType === "reasoning" && itemId) {
          const state = reasoningBlocks.get(itemId);
          if (state?.emittedStart) {
            yield { type: "reasoning-end", id: state.id };
          }
          reasoningBlocks.delete(itemId);
        }
        if (itemType === "function_call" && itemId) {
          const state = functionCalls.get(itemId);
          if (state) {
            yield {
              type: "tool-call",
              toolCallId: state.toolCallId,
              toolName: state.name,
              input: state.arguments,
            };
          }
          functionCalls.delete(itemId);
        }
        continue;
      }

      // response.completed: terminal event with the final response object.
      if (type === "response.completed") {
        usage = extractOpenAIResponsesUsage(record) ?? usage;
        const responseRecord = readRecord(record?.response);
        finishReason = normalizeOpenAIResponsesFinishReason(responseRecord?.status);
        continue;
      }

      if (type === "response.failed" || type === "response.incomplete") {
        const responseRecord = readRecord(record?.response);
        finishReason = normalizeOpenAIResponsesFinishReason(responseRecord?.status) ??
          (type === "response.failed"
            ? { unified: "error", raw: "failed" }
            : { unified: "length", raw: "incomplete" });
        usage = extractOpenAIResponsesUsage(record) ?? usage;
        continue;
      }
    }
  }

  // Close any reasoning streams still open at end-of-stream (defensive).
  for (const state of reasoningBlocks.values()) {
    if (state.emittedStart) {
      yield { type: "reasoning-end", id: state.id };
    }
  }

  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public factory functions
// ---------------------------------------------------------------------------

export function createOpenAIModelRuntime(
  config: OpenAIRuntimeConfig,
  modelId: string,
): ModelRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    provider: config.name ?? "openai",
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getOpenAIChatCompletionsUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIChatRequest(
        modelId,
        config.name ?? "openai",
        options,
        false,
        warnings,
      );
      return requestJson({
        url,
        fetchImpl,
        providerLabel: config.name ?? "openai",
        providerKind: "openai",
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((payload) => {
        const drained = warnings.drain();
        return {
          ...buildOpenAIGenerateResult(payload),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
    doStream(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getOpenAIChatCompletionsUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIChatRequest(
        modelId,
        config.name ?? "openai",
        options,
        true,
        warnings,
      );
      return requestStream({
        url,
        fetchImpl,
        providerLabel: config.name ?? "openai",
        providerKind: "openai",
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((responseStream) => {
        const drained = warnings.drain();
        return {
          stream: ReadableStream.from(
            withToolInputStatusTransitions(streamOpenAICompatibleParts(responseStream)),
          ),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
  };
}

export function createOpenAIResponsesRuntime(
  config: OpenAIRuntimeConfig,
  modelId: string,
): ModelRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    provider: config.name ?? "openai",
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getOpenAIResponsesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIResponsesRequest(
        modelId,
        config.name ?? "openai",
        options,
        false,
        warnings,
      );
      return requestJson({
        url,
        fetchImpl,
        providerLabel: config.name ?? "openai",
        providerKind: "openai",
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((payload) => {
        const drained = warnings.drain();
        return {
          ...buildOpenAIResponsesGenerateResult(payload),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
    doStream(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getOpenAIResponsesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIResponsesRequest(
        modelId,
        config.name ?? "openai",
        options,
        true,
        warnings,
      );
      return requestStream({
        url,
        fetchImpl,
        providerLabel: config.name ?? "openai",
        providerKind: "openai",
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((responseStream) => {
        const drained = warnings.drain();
        return {
          stream: ReadableStream.from(
            withToolInputStatusTransitions(streamOpenAIResponsesParts(responseStream)),
          ),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
  };
}

export function createOpenAIEmbeddingRuntime(
  config: OpenAIRuntimeConfig,
  modelId: string,
): EmbeddingRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    provider: config.name ?? "openai",
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
        providerLabel: config.name ?? "openai",
        providerKind: "openai",
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          body: JSON.stringify({
            model: modelId,
            input: values,
          }),
          signal: abortSignal,
        }),
      }).then((payload) => ({
        embeddings: extractOpenAIEmbeddings(payload),
        usage: {
          tokens: extractOpenAIUsageTokens(payload),
        },
        rawResponse: payload,
        warnings: [],
      }));
    },
  };
}

export class OpenAIProvider implements LLMProvider {
  readonly id = "openai";

  createModel(modelId: string, config: LLMProviderConfig): ModelRuntime {
    return createOpenAIModelRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createEmbedding(modelId: string, config: LLMProviderConfig): EmbeddingRuntime {
    return createOpenAIEmbeddingRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createResponses(modelId: string, config: LLMProviderConfig): ModelRuntime {
    return createOpenAIResponsesRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }
}
