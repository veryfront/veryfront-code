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
  extractOpenAIEmbeddings,
  extractOpenAIUsage,
  extractOpenAIUsageTokens,
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
  readRecord,
  requestJson,
  requestStream,
  stringifyJsonValue,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
} from "veryfront/provider/shared";
import type { RuntimeUsage } from "veryfront/provider/shared";
import {
  buildOpenAIChatRequest,
  type OpenAICompatibleLanguageOptions,
} from "./openai-chat-request-builder.ts";
import { streamOpenAICompatibleParts } from "./openai-chat-stream.ts";
import { buildOpenAIResponsesRequest } from "./openai-responses-request-builder.ts";
import { isOpenAIReasoningModel } from "./openai-reasoning-models.ts";
import {
  extractOpenAIResponsesUsage,
  normalizeOpenAIResponsesFinishReason,
  streamOpenAIResponsesParts,
} from "./openai-responses-stream.ts";

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
  /** Display/telemetry label. */
  name?: string;
  /** Provider identity for OpenAI request defaults. Defaults to `name` in low-level factories. */
  providerName?: string;
  fetch?: typeof globalThis.fetch;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getOpenAIProviderLabel(config: { name?: string }): string {
  return readNonEmptyString(config.name) ?? "openai";
}

function getRuntimeOpenAIProviderName(config: OpenAIRuntimeConfig): string {
  return readNonEmptyString(config.providerName) ?? getOpenAIProviderLabel(config);
}

function getLLMOpenAIProviderName(config: LLMProviderConfig): string {
  return readNonEmptyString(config.providerName) ?? "openai";
}

type OpenAICompatibleChoice = {
  message?: unknown;
  delta?: unknown;
  finish_reason?: unknown;
};

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

// ---------------------------------------------------------------------------
// Public factory functions
// ---------------------------------------------------------------------------

export function createOpenAIModelRuntime(
  config: OpenAIRuntimeConfig,
  modelId: string,
): ModelRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const providerLabel = getOpenAIProviderLabel(config);
  const providerName = getRuntimeOpenAIProviderName(config);
  return {
    provider: providerLabel,
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
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
        providerName,
        options,
        true,
        warnings,
      );
      return requestStream({
        url,
        fetchImpl,
        providerLabel,
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
  const providerLabel = getOpenAIProviderLabel(config);
  const providerName = getRuntimeOpenAIProviderName(config);
  return {
    provider: providerLabel,
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getOpenAIResponsesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIResponsesRequest(
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
        providerName,
        options,
        true,
        warnings,
      );
      return requestStream({
        url,
        fetchImpl,
        providerLabel,
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
  const providerLabel = getOpenAIProviderLabel(config);
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
    const providerLabel = getOpenAIProviderLabel(config);
    const providerName = getLLMOpenAIProviderName(config);
    if (isOpenAIReasoningModel(modelId, providerName)) {
      return createOpenAIResponsesRuntime(
        {
          apiKey: config.credential,
          baseURL: config.baseURL,
          name: providerLabel,
          providerName,
          fetch: config.fetch,
        },
        modelId,
      );
    }

    return createOpenAIModelRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: providerLabel,
        providerName,
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
        name: getOpenAIProviderLabel(config),
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
        name: getOpenAIProviderLabel(config),
        providerName: getLLMOpenAIProviderName(config),
        fetch: config.fetch,
      },
      modelId,
    );
  }
}
