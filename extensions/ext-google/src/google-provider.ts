/**
 * Google provider — implements the {@link AIProvider} contract for Google's
 * Generative Language API (direct + via Veryfront Cloud).
 *
 * Ported from `src/provider/runtime-loader.ts` as part of PR 13.
 *
 * @module extensions/ext-google/google-provider
 */

import type {
  AIProvider,
  AIProviderConfig,
} from "veryfront/extensions/interfaces";
import type {
  EmbeddingRuntime,
  ModelRuntime,
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
  readProviderOptions,
  readRecord,
  readTextParts,
  requestJson,
  requestStream,
  stringifyJsonValue,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  unwrapToolInputSchema,
  withToolInputStatusTransitions,
} from "veryfront/provider/shared";
import type {
  ProviderWarning,
  RuntimePromptMessage,
  RuntimeUsage,
} from "veryfront/provider/shared";

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
  apiKey?: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Internal types (mirrored from runtime-loader.ts)
// ---------------------------------------------------------------------------

type RuntimeToolDefinition =
  | {
    type: "function";
    name: string;
    description?: string;
    inputSchema: unknown;
  }
  | {
    type: "provider";
    name: string;
    id: `${string}.${string}`;
    args: Record<string, unknown>;
  };

type ProviderReasoningEffort = "low" | "medium" | "high" | "max";

type ProviderReasoningOption = {
  enabled?: boolean;
  effort?: ProviderReasoningEffort;
  budgetTokens?: number;
};

type OpenAICompatibleLanguageOptions = {
  prompt: RuntimePromptMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  tools?: RuntimeToolDefinition[];
  toolChoice?: unknown;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
  includeRawChunks?: boolean;
  abortSignal?: AbortSignal;
  cacheControl?: unknown;
  reasoning?: ProviderReasoningOption;
  userId?: string;
  requestLabels?: Record<string, string>;
  serviceTier?: "auto" | "default" | "flex" | "scale";
  parallelToolCalls?: boolean;
  responseFormat?:
    | { type: "text" }
    | { type: "json" }
    | {
      type: "json_schema";
      name: string;
      schema: unknown;
      description?: string;
      strict?: boolean;
    };
  anthropicContainer?: unknown;
  googleCachedContent?: string;
  googleSafetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
  mcpServers?: Array<Record<string, unknown>>;
};

type WarningCollector = ReturnType<typeof createWarningCollector>;

// ---------------------------------------------------------------------------
// Google-specific types
// ---------------------------------------------------------------------------

type GoogleCompatibleContent = {
  role: "user" | "model";
  parts: Array<Record<string, unknown>>;
};
type GoogleCompatibleRequest = {
  contents: GoogleCompatibleContent[];
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  tools?: Array<Record<string, unknown>>;
  toolConfig?: {
    functionCallingConfig: Record<string, unknown>;
  };
  generationConfig?: Record<string, unknown>;
  [key: string]: unknown;
};

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

function toGoogleContents(
  prompt: RuntimePromptMessage[],
): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GoogleCompatibleContent[];
} {
  const systemParts: string[] = [];
  const contents: GoogleCompatibleContent[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system":
        if (message.content.length > 0) {
          systemParts.push(message.content);
        }
        break;
      case "user":
        contents.push({
          role: "user",
          parts: [{ text: readTextParts(message.content) }],
        });
        break;
      case "assistant": {
        // Anthropic-only `reasoning` parts have no Gemini equivalent
        // and are dropped on replay.
        const parts: Array<Record<string, unknown>> = [];
        for (const part of message.content) {
          if (part.type === "text") {
            parts.push({ text: part.text });
            continue;
          }
          if (part.type === "reasoning") {
            continue;
          }
          parts.push({
            functionCall: {
              id: part.toolCallId,
              name: part.toolName,
              args: part.input,
            },
          });
        }
        contents.push({ role: "model", parts });
        break;
      }
      case "tool":
        contents.push({
          role: "user",
          parts: message.content.map((part) => ({
            functionResponse: {
              id: part.toolCallId,
              name: part.toolName,
              response: {
                result: part.output.value,
              },
            },
          })),
        });
        break;
    }
  }

  return {
    ...(systemParts.length > 0
      ? { systemInstruction: { parts: systemParts.map((text) => ({ text })) } }
      : {}),
    contents,
  };
}

function toGoogleTools(
  tools: RuntimeToolDefinition[] | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!tools) {
    return undefined;
  }

  const functionDeclarations: Array<Record<string, unknown>> = [];
  const providerEntries: Array<Record<string, unknown>> = [];

  for (const tool of tools) {
    if (tool.type === "function") {
      functionDeclarations.push({
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        parameters: unwrapToolInputSchema(tool.inputSchema),
      });
      continue;
    }

    // Gemini provider tools — code_execution, google_search,
    // google_search_retrieval — each lives in its own tools[] entry
    // with a single key keyed by the camelCase tool name and an
    // optional config payload (caller-provided tool.args).
    if (!tool.id.startsWith("google.")) {
      continue;
    }
    const providerType = tool.id.slice("google.".length);
    if (providerType.length === 0) {
      continue;
    }
    const camelKey = providerType.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
    providerEntries.push({ [camelKey]: tool.args ?? {} });
  }

  const result: Array<Record<string, unknown>> = [];
  if (functionDeclarations.length > 0) {
    result.push({ functionDeclarations });
  }
  result.push(...providerEntries);
  return result.length > 0 ? result : undefined;
}

function normalizeGoogleToolChoice(toolChoice: unknown):
  | GoogleCompatibleRequest["toolConfig"]
  | undefined {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (typeof toolChoice === "string") {
    switch (toolChoice) {
      case "none":
        return { functionCallingConfig: { mode: "NONE" } };
      case "any":
      case "required":
        return { functionCallingConfig: { mode: "ANY" } };
      default:
        return { functionCallingConfig: { mode: "AUTO" } };
    }
  }

  const record = readRecord(toolChoice);
  if (!record) return undefined;

  // Single-tool restriction: { type: "tool", name } — pin to one
  // function via mode: ANY + allowedFunctionNames: [name].
  if (record.type === "tool" && typeof record.name === "string") {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [record.name],
      },
    };
  }

  // Multi-tool restriction: { type: "tools", names: string[] } — pin
  // to a subset via mode: ANY + the full allowedFunctionNames array.
  if (record.type === "tools" && Array.isArray(record.names)) {
    const names = record.names.filter((n): n is string => typeof n === "string");
    if (names.length > 0) {
      return {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: names,
        },
      };
    }
  }

  // Explicit mode forms: { type: "auto" | "none" | "any" }.
  if (record.type === "auto") {
    return { functionCallingConfig: { mode: "AUTO" } };
  }
  if (record.type === "none") {
    return { functionCallingConfig: { mode: "NONE" } };
  }
  if (record.type === "any" || record.type === "required") {
    return { functionCallingConfig: { mode: "ANY" } };
  }

  return undefined;
}

/**
 * Map the unified reasoning option to Gemini's thinkingConfig. Gemini 2.5+
 * accepts `includeThoughts: true` to stream back `thought` parts, and
 * `thinkingBudget: N` to cap the thinking token count. The effort levels
 * here follow Google's own guidance (low ~= 512, medium ~= 2048,
 * high ~= 8192, max = -1 means "dynamic/no cap").
 */
function resolveGoogleThinkingConfig(
  option: ProviderReasoningOption | undefined,
): Record<string, unknown> | undefined {
  if (!option || option.enabled !== true) {
    return undefined;
  }
  const config: Record<string, unknown> = { includeThoughts: true };
  if (typeof option.budgetTokens === "number") {
    config.thinkingBudget = option.budgetTokens;
    return config;
  }
  switch (option.effort) {
    case "low":
      config.thinkingBudget = 512;
      break;
    case "high":
      config.thinkingBudget = 8192;
      break;
    case "max":
      config.thinkingBudget = -1;
      break;
    case "medium":
    default:
      config.thinkingBudget = 2048;
      break;
  }
  return config;
}

function buildGoogleGenerationConfig(
  options: OpenAICompatibleLanguageOptions,
): Record<string, unknown> | undefined {
  const thinkingConfig = resolveGoogleThinkingConfig(options.reasoning);
  const config: Record<string, unknown> = {
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.topP !== undefined ? { topP: options.topP } : {}),
    ...(options.topK !== undefined ? { topK: options.topK } : {}),
    ...(options.stopSequences && options.stopSequences.length > 0
      ? { stopSequences: options.stopSequences }
      : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(thinkingConfig ? { thinkingConfig } : {}),
  };

  return Object.keys(config).length > 0 ? config : undefined;
}

function buildGoogleGenerateContentRequest(
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  warnings: WarningCollector,
): GoogleCompatibleRequest {
  // Google generate-content surface doesn't accept presence/frequency
  // penalties on most current models. Emit warnings and let the request
  // through without them.
  if (options.presencePenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "google",
      setting: "presencePenalty",
      details: "Gemini generateContent does not accept presencePenalty; the value was dropped.",
    } as ProviderWarning);
  }
  if (options.frequencyPenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "google",
      setting: "frequencyPenalty",
      details: "Gemini generateContent does not accept frequencyPenalty; the value was dropped.",
    } as ProviderWarning);
  }
  if (options.responseFormat && options.responseFormat.type !== "text") {
    warnings.push({
      type: "unsupported-setting",
      provider: "google",
      setting: "responseFormat",
      details:
        "Gemini uses generationConfig.responseMimeType + responseSchema for structured outputs, which is a separate surface and not yet wired through this option.",
    } as ProviderWarning);
  }

  const { systemInstruction, contents } = toGoogleContents(options.prompt);
  const generationConfig = buildGoogleGenerationConfig(options);
  // requestLabels wins over userId-derived labels: when callers explicitly
  // provide a label map, that's the source of truth. Otherwise fall back
  // to {user_id} derived from the unified userId option.
  const labels = options.requestLabels && Object.keys(options.requestLabels).length > 0
    ? options.requestLabels
    : typeof options.userId === "string" && options.userId.length > 0
    ? { user_id: options.userId }
    : undefined;
  const body: GoogleCompatibleRequest = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(toGoogleTools(options.tools) ? { tools: toGoogleTools(options.tools) } : {}),
    ...(normalizeGoogleToolChoice(options.toolChoice)
      ? { toolConfig: normalizeGoogleToolChoice(options.toolChoice) }
      : {}),
    ...(generationConfig ? { generationConfig } : {}),
    ...(labels ? { labels } : {}),
    ...(typeof options.googleCachedContent === "string" && options.googleCachedContent.length > 0
      ? { cachedContent: options.googleCachedContent }
      : {}),
    ...(options.googleSafetySettings && options.googleSafetySettings.length > 0
      ? { safetySettings: options.googleSafetySettings }
      : {}),
  };

  Object.assign(body, readProviderOptions(options.providerOptions, "google", providerName));
  return body;
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

export class GoogleProvider implements AIProvider {
  readonly id = "google";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
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

  createEmbedding(modelId: string, config: AIProviderConfig): EmbeddingRuntime {
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
