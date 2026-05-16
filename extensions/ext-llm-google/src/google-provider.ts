/**
 * Google provider - implements the {@link LLMProvider} contract for Google's
 * Generative Language API (direct + via Veryfront Cloud).
 *
 * Ported from `src/provider/runtime-loader.ts` as part of PR 13.
 *
 * @module extensions/ext-llm-google/google-provider
 */

import type { LLMProvider, LLMProviderConfig } from "veryfront/extensions/llm";
import type { EmbeddingRuntime, ModelRuntime } from "veryfront/provider/types";
import {
  buildProviderError,
  createGoogleRequestInit,
  createWarningCollector,
  getGoogleEmbeddingUrl,
  getGoogleGenerateContentUrl,
  getGoogleStreamGenerateContentUrl,
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
  unwrapToolInputSchema,
  withToolInputStatusTransitions,
} from "veryfront/provider/shared";
import type { RuntimeUsage } from "veryfront/provider/shared";
import {
  buildGoogleGenerateContentRequest,
  type OpenAICompatibleLanguageOptions,
} from "./google-request-builder.ts";

// Re-export error classes so extension tests can import them from this module
// and from `veryfront/provider/shared` interchangeably.
export {
  buildProviderError,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  parseSseChunk,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  unwrapToolInputSchema,
  withToolInputStatusTransitions,
};

export interface GoogleRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Google-specific types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Google helper functions
// ---------------------------------------------------------------------------

function extractGoogleEmbedding(payload: unknown): number[] {
  const record = readRecord(payload);
  const embeddings = record?.embeddings;

  if (Array.isArray(embeddings) && embeddings.length > 0) {
    const firstEmbedding = readRecord(embeddings[0]);
    const values = firstEmbedding?.values;
    if (isNumberArray(values)) {
      return values;
    }
  }

  const embedding = readRecord(record?.embedding);
  const values = embedding?.values;
  if (isNumberArray(values)) {
    return values;
  }

  throw new Error("Invalid Google embedding response: embedding vector missing");
}

function extractGoogleUsageTokens(payload: unknown): number | undefined {
  const record = readRecord(payload);
  const usageMetadata = readRecord(record?.usageMetadata);
  const promptTokenCount = usageMetadata?.promptTokenCount;
  return typeof promptTokenCount === "number" ? promptTokenCount : undefined;
}

function normalizeGoogleFinishReason(
  raw: unknown,
): string | { unified: string; raw: string } | null {
  if (typeof raw !== "string") {
    return null;
  }

  switch (raw) {
    case "STOP":
      return { unified: "stop", raw };
    case "MAX_TOKENS":
      return { unified: "length", raw };
    case "SAFETY":
    case "RECITATION":
      return { unified: "content-filter", raw };
    default:
      return raw.toLowerCase();
  }
}

function extractGoogleUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usageMetadata);
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.promptTokenCount;
  const outputTokens = usage.candidatesTokenCount;
  const totalTokens = usage.totalTokenCount;
  const cachedContentTokenCount = usage.cachedContentTokenCount;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof totalTokens === "number" ? totalTokens : undefined,
    ...(typeof cachedContentTokenCount === "number"
      ? { cacheReadInputTokens: cachedContentTokenCount }
      : {}),
  };
}

function extractFirstGoogleCandidate(payload: unknown): Record<string, unknown> | undefined {
  const record = readRecord(payload);
  const candidates = record?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return undefined;
  }

  return readRecord(candidates[0]);
}

function extractGoogleCandidateParts(payload: unknown): Array<Record<string, unknown>> {
  const candidate = extractFirstGoogleCandidate(payload);
  const content = readRecord(candidate?.content);
  const parts = content?.parts;
  if (!Array.isArray(parts)) {
    return [];
  }

  return parts.flatMap((part) => {
    const record = readRecord(part);
    return record ? [record] : [];
  });
}

function buildGoogleGenerateResult(payload: unknown): {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
  >;
  finishReason?: string | { unified: string; raw: string } | null;
  usage?: RuntimeUsage;
  groundingMetadata?: Record<string, unknown>;
} {
  const parts = extractGoogleCandidateParts(payload);
  const content: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
  > = [];

  for (const [index, part] of parts.entries()) {
    if (typeof part.text === "string" && part.text.length > 0) {
      content.push({ type: "text", text: part.text });
      continue;
    }

    const functionCall = readRecord(part.functionCall);
    if (typeof functionCall?.name === "string") {
      content.push({
        type: "tool-call",
        toolCallId: typeof functionCall.id === "string" ? functionCall.id : `tool-${index}`,
        toolName: functionCall.name,
        input: stringifyJsonValue(functionCall.args ?? {}),
      });
    }
  }

  // Gemini grounding (google_search / google_search_retrieval) returns
  // a per-candidate groundingMetadata object with web search queries,
  // grounding chunks, and citation indices into the response text.
  // Pass it through opaquely so callers can render footnotes / source
  // chips / "Search results" UI without parsing the wire shape.
  const candidate = extractFirstGoogleCandidate(payload);
  const groundingMetadata = readRecord(candidate?.groundingMetadata);

  return {
    content,
    finishReason: normalizeGoogleFinishReason(candidate?.finishReason),
    usage: extractGoogleUsage(payload),
    ...(groundingMetadata ? { groundingMetadata } : {}),
  };
}

async function* streamGoogleCompatibleParts(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const seenToolCalls = new Set<string>();
  let reasoningId: string | null = null;
  let reasoningIndex = 0;
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: RuntimeUsage | undefined;

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      if (event === "[DONE]") {
        continue;
      }

      usage = extractGoogleUsage(event) ?? usage;
      const candidate = extractFirstGoogleCandidate(event);
      const normalizedFinishReason = normalizeGoogleFinishReason(candidate?.finishReason);
      if (normalizedFinishReason) {
        finishReason = normalizedFinishReason;
      }

      for (const [index, part] of extractGoogleCandidateParts(event).entries()) {
        const isThought = part.thought === true;
        if (isThought && typeof part.text === "string" && part.text.length > 0) {
          if (!reasoningId) {
            reasoningId = `reasoning-${reasoningIndex++}`;
            yield {
              type: "reasoning-start",
              id: reasoningId,
            };
          }

          yield {
            type: "reasoning-delta",
            id: reasoningId,
            delta: part.text,
          };
          continue;
        }

        if (reasoningId) {
          yield {
            type: "reasoning-end",
            id: reasoningId,
          };
          reasoningId = null;
        }

        if (typeof part.text === "string" && part.text.length > 0) {
          yield { type: "text-delta", delta: part.text };
          continue;
        }

        const functionCall = readRecord(part.functionCall);
        if (typeof functionCall?.name !== "string") {
          continue;
        }

        const toolCallId = typeof functionCall.id === "string" ? functionCall.id : `tool-${index}`;
        if (seenToolCalls.has(toolCallId)) {
          continue;
        }

        const serializedInput = stringifyJsonValue(functionCall.args ?? {});
        seenToolCalls.add(toolCallId);
        yield {
          type: "tool-input-start",
          id: toolCallId,
          toolName: functionCall.name,
        };
        yield {
          type: "tool-input-delta",
          id: toolCallId,
          delta: serializedInput,
        };
        yield {
          type: "tool-call",
          toolCallId,
          toolName: functionCall.name,
          input: serializedInput,
        };
      }
    }
  }

  if (buffer.trim().length > 0) {
    const parsed = parseSseChunk(`${buffer}\n\n`);
    for (const event of parsed.events) {
      if (event === "[DONE]") {
        continue;
      }
      usage = extractGoogleUsage(event) ?? usage;
    }
  }

  if (reasoningId) {
    yield {
      type: "reasoning-end",
      id: reasoningId,
    };
  }

  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
  };
}

export function createGoogleModelRuntime(
  config: GoogleRuntimeConfig,
  modelId: string,
): ModelRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    provider: config.name ?? "google",
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getGoogleGenerateContentUrl(config.baseURL, modelId);
      const warnings = createWarningCollector();
      const body = buildGoogleGenerateContentRequest(
        config.name ?? "google",
        options,
        warnings,
      );
      return requestJson({
        url,
        fetchImpl,
        providerLabel: config.name ?? "google",
        providerKind: "google",
        init: createGoogleRequestInit({
          apiKey: config.apiKey,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((payload) => {
        const drained = warnings.drain();
        return {
          ...buildGoogleGenerateResult(payload),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
    doStream(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getGoogleStreamGenerateContentUrl(config.baseURL, modelId);
      const warnings = createWarningCollector();
      const body = buildGoogleGenerateContentRequest(
        config.name ?? "google",
        options,
        warnings,
      );
      return requestStream({
        url,
        fetchImpl,
        providerLabel: config.name ?? "google",
        providerKind: "google",
        init: createGoogleRequestInit({
          apiKey: config.apiKey,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((responseStream) => {
        const drained = warnings.drain();
        return {
          stream: ReadableStream.from(
            withToolInputStatusTransitions(streamGoogleCompatibleParts(responseStream)),
          ),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
  };
}

export function createGoogleEmbeddingRuntime(
  config: GoogleRuntimeConfig,
  modelId: string,
): EmbeddingRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    provider: config.name ?? "google",
    modelId,
    supportsParallelCalls: true,
    doEmbed({ values, abortSignal }) {
      if (values.length === 0) {
        return Promise.resolve({
          embeddings: [],
          warnings: [],
          rawResponse: { embeddings: [] },
        });
      }

      const url = getGoogleEmbeddingUrl(config.baseURL, modelId);
      return Promise.all(values.map((value) =>
        requestJson({
          url,
          fetchImpl,
          providerLabel: config.name ?? "google",
          providerKind: "google",
          init: createGoogleRequestInit({
            apiKey: config.apiKey,
            body: JSON.stringify({
              content: {
                parts: [{ text: value }],
              },
            }),
            signal: abortSignal,
          }),
        })
      )).then((payloads) => ({
        embeddings: payloads.map(extractGoogleEmbedding),
        usage: {
          tokens: payloads.reduce<number>(
            (total, payload) => total + (extractGoogleUsageTokens(payload) ?? 0),
            0,
          ),
        },
        rawResponse: payloads,
        warnings: [],
      }));
    },
  };
}

export class GoogleProvider implements LLMProvider {
  readonly id = "google";

  createModel(modelId: string, config: LLMProviderConfig): ModelRuntime {
    return createGoogleModelRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "google",
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createEmbedding(modelId: string, config: LLMProviderConfig): EmbeddingRuntime {
    return createGoogleEmbeddingRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "google",
        fetch: config.fetch,
      },
      modelId,
    );
  }
}
