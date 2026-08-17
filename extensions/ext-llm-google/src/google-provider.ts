/**
 * Google provider - implements the {@link LLMProvider} contract for Google's
 * Generative Language API (direct + via Veryfront Cloud).
 *
 * Ported from `src/provider/runtime-loader.ts` as part of PR 13.
 *
 * @module extensions/ext-llm-google/google-provider
 */

import type { LLMProvider, LLMProviderConfig } from "veryfront/extensions/llm";
import type {
  EmbeddingRuntime,
  ModelRuntime,
  RuntimeAssistantContentPart,
} from "veryfront/provider/types";
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
} from "veryfront/provider/shared";
import type { RuntimeUsage } from "veryfront/provider/shared";
import {
  buildGoogleGenerateContentRequest,
  type OpenAICompatibleLanguageOptions,
} from "./google-request-builder.ts";
import {
  createGoogleToolCallCorrelationRegistry,
  GOOGLE_CODE_EXECUTION_TOOL_NAME,
  googleCodeExecutionInput,
  googleCodeExecutionOutput,
  readGoogleCodeExecutionResult,
  readGoogleExecutableCode,
  readGooglePartDataField,
} from "./google-content-parts.ts";
import { readGoogleGroundingMetadata } from "./google-grounding-metadata.ts";
import {
  createGoogleProviderMetadata,
  readGoogleThoughtSignature,
  reconcileGoogleProviderMetadata,
} from "./google-thought-signatures.ts";
import {
  extractGoogleCandidateParts,
  extractGoogleUsage,
  normalizeGoogleFinishReason,
  streamGoogleCompatibleParts,
} from "./google-stream.ts";

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
};

export interface GoogleRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

type GoogleResponseContext = {
  providerLabel: string;
};

type GoogleGenerateEnvelope = {
  candidate?: Record<string, unknown>;
  promptBlockReason?: string;
};

// ---------------------------------------------------------------------------
// Google-specific types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Google helper functions
// ---------------------------------------------------------------------------

function invalidGoogleResponse(
  context: GoogleResponseContext,
  issue: string,
): ProviderRequestError {
  return new ProviderRequestError({
    provider: "google",
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

function extractGoogleEmbedding(
  payload: unknown,
  context: GoogleResponseContext,
): number[] {
  const record = readRecord(payload);
  if (!record) {
    throw invalidGoogleResponse(context, "embedding response body was not an object");
  }
  const embeddings = record?.embeddings;

  if (embeddings !== undefined) {
    if (!Array.isArray(embeddings) || embeddings.length !== 1) {
      throw invalidGoogleResponse(
        context,
        "embedding response must contain exactly one embedding",
      );
    }
    const firstEmbedding = readRecord(embeddings[0]);
    const values = firstEmbedding?.values;
    if (isNumberArray(values) && values.length > 0) {
      return values;
    }
    throw invalidGoogleResponse(context, "embedding vector missing or invalid");
  }

  const embedding = readRecord(record.embedding);
  const values = embedding?.values;
  if (isNumberArray(values) && values.length > 0) {
    return values;
  }

  throw invalidGoogleResponse(context, "embedding vector missing or invalid");
}

function extractGoogleUsageTokens(payload: unknown): number | undefined {
  const record = readRecord(payload);
  const usageMetadata = readRecord(record?.usageMetadata);
  const promptTokenCount = usageMetadata?.promptTokenCount;
  return readUsageTokenCount(promptTokenCount);
}

function sumGoogleUsageTokens(payloads: unknown[]): number | undefined {
  let totalTokens = 0;
  for (const payload of payloads) {
    const tokens = extractGoogleUsageTokens(payload);
    if (tokens === undefined) {
      return undefined;
    }
    totalTokens += tokens;
    if (readUsageTokenCount(totalTokens) === undefined) {
      return undefined;
    }
  }
  return totalTokens;
}

function readGoogleGenerateCandidate(
  payload: unknown,
  context: GoogleResponseContext,
): GoogleGenerateEnvelope {
  const record = readRecord(payload);
  if (!record) {
    throw invalidGoogleResponse(context, "generation response body was not an object");
  }

  const candidates = record.candidates;
  if (candidates !== undefined && !Array.isArray(candidates)) {
    throw invalidGoogleResponse(context, "candidates was not an array");
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    const promptFeedback = readRecord(record.promptFeedback);
    const promptBlockReason = promptFeedback?.blockReason;
    if (typeof promptBlockReason === "string" && promptBlockReason.length > 0) {
      return { promptBlockReason };
    }
    throw invalidGoogleResponse(context, "candidates array missing or empty");
  }
  if (candidates.length !== 1) {
    throw invalidGoogleResponse(context, "generation response contained multiple candidates");
  }

  const candidate = readRecord(candidates[0]);
  if (!candidate) {
    throw invalidGoogleResponse(context, "first candidate was not an object");
  }

  const finishReason = candidate.finishReason;
  if (finishReason !== undefined && typeof finishReason !== "string") {
    throw invalidGoogleResponse(context, "candidate finish reason was malformed");
  }

  if (candidate.content === undefined) {
    if (typeof finishReason !== "string") {
      throw invalidGoogleResponse(context, "candidate contained no output content");
    }
    return { candidate };
  }

  const content = readRecord(candidate.content);
  if (!content) {
    throw invalidGoogleResponse(context, "candidate content parts missing or malformed");
  }
  if (content.parts === undefined && typeof finishReason === "string") {
    return { candidate };
  }
  if (!Array.isArray(content.parts)) {
    throw invalidGoogleResponse(context, "candidate content parts missing or malformed");
  }
  for (const part of content.parts) {
    if (!readRecord(part)) {
      throw invalidGoogleResponse(context, "candidate content part was not an object");
    }
  }

  return { candidate };
}

function buildGoogleGenerateResult(
  payload: unknown,
  context: GoogleResponseContext,
): {
  content: Array<
    | { type: "text"; text: string }
    | { type: "reasoning"; text?: string; signature?: string }
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
    }
  >;
  finishReason?: string | { unified: string; raw: string } | null;
  usage?: RuntimeUsage;
  groundingMetadata?: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
} {
  const envelope = readGoogleGenerateCandidate(payload, context);
  const candidate = envelope.candidate;
  const parts = candidate ? extractGoogleCandidateParts(payload) : [];
  const content: Array<
    | { type: "text"; text: string }
    | { type: "reasoning"; text?: string; signature?: string }
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
    }
  > = [];
  const toolCallRegistry = createGoogleToolCallCorrelationRegistry();

  for (const [index, part] of parts.entries()) {
    let thoughtSignature: string | undefined;
    try {
      thoughtSignature = readGoogleThoughtSignature(part);
    } catch {
      throw invalidGoogleResponse(context, "candidate thought signature was malformed");
    }
    if (part.thought !== undefined && typeof part.thought !== "boolean") {
      throw invalidGoogleResponse(context, "candidate thought marker was malformed");
    }
    let dataField: ReturnType<typeof readGooglePartDataField>;
    try {
      dataField = readGooglePartDataField(part);
    } catch (error) {
      const issue = error instanceof Error &&
          (error.message.includes("unsupported") || error.message.includes("unknown"))
        ? "candidate part contained an unsupported data field"
        : "candidate part contained multiple data fields";
      throw invalidGoogleResponse(context, issue);
    }
    if (dataField === "text") {
      if (typeof part.text !== "string") {
        throw invalidGoogleResponse(context, "candidate text part was malformed");
      }
      if (part.thought === true) {
        if (part.text.length > 0 || thoughtSignature !== undefined) {
          content.push({
            type: "reasoning",
            ...(part.text.length > 0 ? { text: part.text } : {}),
            ...(thoughtSignature !== undefined ? { signature: thoughtSignature } : {}),
          });
        }
        continue;
      }
      if (part.text.length > 0) {
        content.push({ type: "text", text: part.text });
      }
      continue;
    }

    if (dataField === "functionCall") {
      const functionCall = readRecord(part.functionCall);
      if (
        !functionCall || typeof functionCall.name !== "string" || functionCall.name.length === 0
      ) {
        throw invalidGoogleResponse(context, "candidate function call was malformed");
      }
      if (
        functionCall.id !== undefined &&
        (typeof functionCall.id !== "string" || functionCall.id.length === 0)
      ) {
        throw invalidGoogleResponse(context, "candidate function call id was malformed");
      }
      // Gemini omits `args` entirely for zero-parameter tool calls.
      const functionCallArgs = functionCall.args === undefined ? {} : readRecord(functionCall.args);
      if (!functionCallArgs) {
        throw invalidGoogleResponse(
          context,
          "candidate function call arguments were not an object",
        );
      }
      let toolCallId: string;
      try {
        toolCallId = toolCallRegistry.registerFunctionCall(
          index,
          typeof functionCall.id === "string" ? functionCall.id : undefined,
        );
      } catch {
        throw invalidGoogleResponse(context, "candidate tool call id was duplicated");
      }
      content.push({
        type: "tool-call",
        toolCallId,
        toolName: functionCall.name,
        input: stringifyJsonValue(functionCallArgs),
      });
      continue;
    }

    if (dataField === "executableCode") {
      let executableCode: ReturnType<typeof readGoogleExecutableCode>;
      try {
        executableCode = readGoogleExecutableCode(part.executableCode);
      } catch {
        throw invalidGoogleResponse(context, "candidate executable code was malformed");
      }

      let toolCallId: string;
      try {
        toolCallId = toolCallRegistry.registerCodeExecution(
          executableCode.providerId,
        );
      } catch {
        throw invalidGoogleResponse(context, "candidate executable code id was duplicated");
      }

      content.push({
        type: "tool-call",
        toolCallId,
        toolName: GOOGLE_CODE_EXECUTION_TOOL_NAME,
        input: stringifyJsonValue(googleCodeExecutionInput(executableCode)),
        providerExecuted: true,
      });
      continue;
    }

    let result: ReturnType<typeof readGoogleCodeExecutionResult>;
    try {
      result = readGoogleCodeExecutionResult(part.codeExecutionResult);
    } catch {
      throw invalidGoogleResponse(context, "candidate code execution result was malformed");
    }
    let toolCallId: string;
    try {
      toolCallId = toolCallRegistry.resolveCodeExecutionResult(
        result.providerId,
      );
    } catch {
      throw invalidGoogleResponse(
        context,
        "candidate code execution result did not match executable code",
      );
    }
    content.push({
      type: "tool-result",
      toolCallId,
      toolName: GOOGLE_CODE_EXECUTION_TOOL_NAME,
      result: googleCodeExecutionOutput(result),
      ...(result.isError ? { isError: true } : {}),
      providerExecuted: true,
    });
  }
  try {
    toolCallRegistry.assertSettled();
  } catch {
    throw invalidGoogleResponse(
      context,
      "candidate executable code had no matching execution result",
    );
  }
  const finishReason = envelope.promptBlockReason
    ? { unified: "content-filter", raw: envelope.promptBlockReason }
    : normalizeGoogleFinishReason(candidate?.finishReason);
  const isContentFiltered = typeof finishReason === "object" &&
    finishReason?.unified === "content-filter";
  if (content.length === 0 && !isContentFiltered) {
    throw invalidGoogleResponse(context, "candidate contained no supported output content");
  }

  // Google owns the nested grounding shape and may add fields over time. Keep
  // it opaque, but require the documented object envelope before exposing it.
  let groundingMetadata: Record<string, unknown> | undefined;
  if (candidate?.groundingMetadata !== undefined) {
    try {
      groundingMetadata = readGoogleGroundingMetadata(candidate.groundingMetadata);
    } catch {
      throw invalidGoogleResponse(context, "candidate grounding metadata was malformed");
    }
  }
  const usage = sanitizeRuntimeUsage(extractGoogleUsage(payload));
  let providerMetadata: Record<string, unknown> | undefined;
  try {
    providerMetadata = createGoogleProviderMetadata(parts, groundingMetadata);
  } catch {
    throw invalidGoogleResponse(
      context,
      "provider metadata could not be retained safely",
    );
  }

  return {
    content,
    finishReason,
    ...(usage ? { usage } : {}),
    ...(groundingMetadata ? { groundingMetadata } : {}),
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}

function createGoogleProviderAbortScope(callerSignal: AbortSignal | undefined): {
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

function createCancelableGoogleStream(
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
    { highWaterMark: 0 },
  );
}

export function createGoogleModelRuntime(
  config: GoogleRuntimeConfig,
  modelId: string,
): ModelRuntime<OpenAICompatibleLanguageOptions, RuntimeAssistantContentPart> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const providerLabel = config.name ?? "google";
  const responseContext = { providerLabel };
  return {
    provider: providerLabel,
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    _reconcileProviderMetadata(
      input: {
        providerMetadata: Record<string, unknown>;
        suppressedToolCalls: readonly { id: string; name: string }[];
      },
    ) {
      return reconcileGoogleProviderMetadata(
        input.providerMetadata,
        input.suppressedToolCalls,
      );
    },
    doGenerate(options: OpenAICompatibleLanguageOptions) {
      const url = getGoogleGenerateContentUrl(config.baseURL, modelId);
      const warnings = createWarningCollector();
      const body = buildGoogleGenerateContentRequest(
        providerLabel,
        options,
        warnings,
      );
      return requestJson({
        url,
        fetchImpl,
        providerLabel,
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
          ...buildGoogleGenerateResult(payload, responseContext),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
    async doStream(options: OpenAICompatibleLanguageOptions) {
      const url = getGoogleStreamGenerateContentUrl(config.baseURL, modelId);
      const warnings = createWarningCollector();
      const body = buildGoogleGenerateContentRequest(
        providerLabel,
        options,
        warnings,
      );
      const providerAbortScope = createGoogleProviderAbortScope(options.abortSignal);
      let responseStream: ReadableStream<Uint8Array>;
      try {
        responseStream = await requestStream({
          url,
          fetchImpl,
          providerLabel,
          providerKind: "google",
          init: createGoogleRequestInit({
            apiKey: config.apiKey,
            extraHeaders: options.headers,
            body: JSON.stringify(body),
            signal: providerAbortScope.controller.signal,
          }),
        });
      } catch (error) {
        providerAbortScope.dispose();
        throw error;
      }

      const drained = warnings.drain();
      return {
        stream: createCancelableGoogleStream(
          streamGoogleCompatibleParts(responseStream, responseContext),
          providerAbortScope.controller,
          providerAbortScope.dispose,
        ),
        ...(drained.length > 0 ? { warnings: drained } : {}),
      };
    },
  };
}

export function createGoogleEmbeddingRuntime(
  config: GoogleRuntimeConfig,
  modelId: string,
): EmbeddingRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const providerLabel = config.name ?? "google";
  const responseContext = { providerLabel };
  return {
    provider: providerLabel,
    modelId,
    supportsParallelCalls: true,
    async doEmbed({ values, abortSignal }) {
      if (values.length === 0) {
        return {
          embeddings: [],
          warnings: [],
          rawResponse: { embeddings: [] },
        };
      }

      const url = getGoogleEmbeddingUrl(config.baseURL, modelId);
      const providerAbortScope = createGoogleProviderAbortScope(abortSignal);
      try {
        providerAbortScope.controller.signal.throwIfAborted();
        const requests = values.map((value) =>
          requestJson({
            url,
            fetchImpl,
            providerLabel,
            providerKind: "google",
            init: createGoogleRequestInit({
              apiKey: config.apiKey,
              body: JSON.stringify({
                content: {
                  parts: [{ text: value }],
                },
              }),
              signal: providerAbortScope.controller.signal,
            }),
          }).then((payload) => ({
            payload,
            embedding: extractGoogleEmbedding(payload, responseContext),
          })).catch((error) => {
            if (!providerAbortScope.controller.signal.aborted) {
              providerAbortScope.controller.abort(error);
            }
            throw error;
          })
        );

        let results: Array<{ payload: unknown; embedding: number[] }>;
        try {
          results = await Promise.all(requests);
        } catch (error) {
          if (abortSignal?.aborted) {
            throw abortSignal.reason;
          }
          throw error;
        }

        const payloads = results.map((result) => result.payload);
        const tokens = sumGoogleUsageTokens(payloads);
        const embeddings = results.map((result) => result.embedding);
        const dimensions = embeddings[0]?.length;
        if (
          dimensions !== undefined &&
          embeddings.some((embedding) => embedding.length !== dimensions)
        ) {
          throw invalidGoogleResponse(
            responseContext,
            "embedding vectors had inconsistent dimensions",
          );
        }
        return {
          embeddings,
          ...(tokens !== undefined ? { usage: { tokens } } : {}),
          rawResponse: payloads,
          warnings: [],
        };
      } finally {
        providerAbortScope.dispose();
      }
    },
  };
}

export class GoogleProvider implements LLMProvider {
  readonly id = "google";

  createModel(
    modelId: string,
    config: LLMProviderConfig,
  ): ModelRuntime<OpenAICompatibleLanguageOptions, RuntimeAssistantContentPart> {
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
