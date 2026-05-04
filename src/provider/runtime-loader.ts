import type { EmbeddingRuntime, ModelRuntime } from "./types.ts";
import {
  getGoogleEmbeddingUrl,
  getGoogleGenerateContentUrl,
  getGoogleStreamGenerateContentUrl,
} from "./runtime-loader/provider-endpoints.ts";
import {
  extractGoogleEmbedding,
  extractGoogleUsageTokens,
  isNumberArray,
} from "./runtime-loader/provider-embedding-responses.ts";
import { normalizeGoogleFinishReason } from "./runtime-loader/provider-finish-reasons.ts";
import { createGoogleRequestInit } from "./runtime-loader/provider-request-init.ts";
import { parseSseChunk } from "./runtime-loader/provider-sse.ts";
import {
  extractGoogleUsage,
  mergeUsage,
  type RuntimeUsage,
} from "./runtime-loader/provider-usage.ts";
import type { ProviderKind } from "./runtime-loader/provider-http.ts";
import {
  buildProviderError,
  parseRetryAfterMs,
  requestJson,
  requestStream,
} from "./runtime-loader/provider-http.ts";
import { readRecord } from "./runtime-loader/provider-records.ts";
import {
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
} from "./runtime-loader/tool-input-status.ts";

export {
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "./runtime-loader/provider-http.ts";
export { TOOL_INPUT_PENDING_THRESHOLD_MS, withToolInputStatusTransitions };
export {
  buildProviderError,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  readRecord,
  requestJson,
  requestStream,
};

export interface GoogleRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

export type RuntimePromptMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: Array<{ type: "text"; text: string }> }
  | {
    role: "assistant";
    content: Array<
      | { type: "text"; text: string }
      | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
        providerExecuted?: boolean;
      }
      | {
        // Anthropic thinking block replay. Carries the original signed
        // thinking trace so that on the next turn Anthropic can verify
        // the signature and let Claude continue reasoning from the same
        // point. `text` + `signature` are the normal pair for an
        // un-redacted thinking block; `redactedData` is set instead of
        // both when Anthropic returned an encrypted opaque payload.
        type: "reasoning";
        text?: string;
        signature?: string;
        redactedData?: string;
      }
    >;
  }
  | {
    role: "tool";
    content: Array<{
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: { type: "json"; value: unknown };
    }>;
  };
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
/**
 * TTL for a single prompt-cache breakpoint.
 *
 * `true` and `"5m"` both map to Anthropic's default ephemeral (5-minute) cache.
 * `"1h"` maps to the extended 1-hour cache at a 2x write cost. Callers can
 * pick per breakpoint target.
 */
type ProviderCacheTtl = boolean | "5m" | "1h";

/**
 * Per-provider prompt / context caching controls.
 *
 * For Anthropic, flipping these on emits `cache_control: { type: "ephemeral" }`
 * breakpoints on the assembled system prompt and/or the last tool definition
 * sent to the Messages API, enabling Anthropic's explicit prompt cache.
 *
 * OpenAI's prompt cache is automatic on gpt-4o+ and has no request-side
 * directive to emit, so this option is a no-op for the OpenAI runtime. Google
 * uses a separate `cachedContent` resource model that is intentionally not
 * covered by this option (it belongs on a dedicated Gemini-specific surface).
 */
type ProviderCacheControlOption = {
  /**
   * Attach a cache breakpoint to the final system-prompt text block.
   * Use when the system prompt is large and reused across requests.
   */
  system?: ProviderCacheTtl;
  /**
   * Attach a cache breakpoint to the last tool definition in `tools`.
   * Use when the tool schemas are large and identical across requests.
   */
  tools?: ProviderCacheTtl;
};

/**
 * Unified effort level for extended reasoning / thinking. Maps to
 * per-provider knobs: Anthropic `thinking.budget_tokens`, OpenAI
 * `reasoning_effort`, Gemini `thinkingConfig.thinkingBudget`.
 */
type ProviderReasoningEffort = "low" | "medium" | "high" | "max";

/**
 * Unified reasoning / thinking request option.
 *
 * Setting `enabled: true` turns on extended thinking on providers that
 * support it (Anthropic Claude 4.x, OpenAI o-series, Gemini 2.5+). The
 * `effort` field picks a coarse budget; when `budgetTokens` is set it
 * wins for providers that take a numeric budget (Anthropic, Gemini).
 *
 * Providers that do not support reasoning treat this as a no-op. On
 * Anthropic + OpenAI, enabling reasoning also disables sampling params
 * that the providers reject in combination (`temperature`, `topP`,
 * `topK`, `presencePenalty`, `frequencyPenalty`) — silently dropping
 * them rather than failing the request.
 */
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
  /**
   * Per-provider prompt / context caching controls. See
   * {@link ProviderCacheControlOption}. When unset, caching behaviour is
   * unchanged on every provider.
   */
  cacheControl?: ProviderCacheControlOption;
  /**
   * Enable extended reasoning / thinking on providers that support it.
   * See {@link ProviderReasoningOption}. When unset, reasoning behaviour
   * is unchanged on every provider.
   */
  reasoning?: ProviderReasoningOption;
  /**
   * Stable per-user identifier for rate-limiting, abuse detection, and
   * billing attribution. Maps to:
   *  - Anthropic: `metadata.user_id`
   *  - OpenAI: `user`
   *  - Google: `labels.user_id` (when {@link requestLabels} is unset)
   */
  userId?: string;
  /**
   * Provider-specific label map for Google Gemini's `labels` field.
   * Anthropic and OpenAI don't have an arbitrary-label equivalent, so
   * this is intentionally Google-only. When unset, no labels are sent.
   */
  requestLabels?: Record<string, string>;
  /**
   * OpenAI-specific. Maps to the `service_tier` field on Chat Completions
   * which trades latency for cost. Documented values:
   *
   *  - `default` — standard processing (default if unset)
   *  - `flex` — lower-priority queue, lower per-token cost, longer
   *    expected latency. Useful for batchy or non-interactive workloads.
   *  - `scale` — reserved-capacity tier with strict latency SLOs.
   *  - `auto` — let OpenAI pick.
   *
   * Forwarded verbatim. Anthropic and Google have no equivalent and
   * the field is silently omitted on those providers.
   */
  serviceTier?: "auto" | "default" | "flex" | "scale";
  /**
   * OpenAI-specific. When `false`, OpenAI runs tool calls sequentially
   * instead of in parallel. Useful for ordered side effects where
   * concurrent calls would race. Default behaviour (unset) is parallel.
   */
  parallelToolCalls?: boolean;
  /**
   * Structured-output response format. Maps to OpenAI's `response_format`
   * field on Chat Completions (and Responses). Three variants:
   *
   *  - `{ type: "text" }` — the default (no constraint).
   *  - `{ type: "json" }` — emits OpenAI's `response_format:
   *    { type: "json_object" }` to force the model to return valid JSON.
   *  - `{ type: "json_schema", name, schema, strict? }` — emits
   *    OpenAI's `response_format: { type: "json_schema", json_schema: {
   *    name, schema, strict } }` for fully constrained structured
   *    outputs (gpt-4o-2024-08-06+).
   *
   * On Anthropic and Google this option emits an "unsupported-setting"
   * warning when set to anything other than `text` (those providers
   * have their own structured-output surfaces and need a dedicated
   * follow-up to wire them in).
   */
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
  /**
   * Anthropic-specific. `container` field for programmatic tool calling
   * and agent skills. Anthropic uses this to scope a session to a
   * sandboxed container (e.g. for Computer Use, code execution
   * sandboxes, or skills loaded from a container). Forwarded verbatim.
   *
   * The shape varies — string container id or a structured object
   * depending on the feature. Caller passes whatever Anthropic's docs
   * specify for the target feature.
   */
  anthropicContainer?: unknown;
  /**
   * Google-specific. Reference to a previously-created Gemini cached
   * content resource (created via the separate caches API) to attach
   * to this request. Resource name format:
   * `cachedContents/<id>`. See https://ai.google.dev/gemini-api/docs/caching.
   *
   * Cache creation itself is out of scope for the runtime — callers
   * use the Gemini REST API or SDK to create the cache, then pass the
   * resource name here on each subsequent generate call to attach the
   * cached prefix and avoid re-paying for it.
   */
  googleCachedContent?: string;
  /**
   * Google-specific. Per-request safety filter configuration for
   * Gemini. Each entry pairs a HARM_CATEGORY_* with a threshold
   * (BLOCK_NONE / BLOCK_LOW_AND_ABOVE / BLOCK_MEDIUM_AND_ABOVE /
   * BLOCK_ONLY_HIGH). Forwarded verbatim as the `safetySettings`
   * field. See https://ai.google.dev/gemini-api/docs/safety-settings.
   */
  googleSafetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
  /**
   * Anthropic-specific. Native MCP server definitions to pass directly
   * on the Messages API request body. Lets callers register MCP servers
   * server-side instead of reloading them into local function tools.
   *
   * Caller must opt into the MCP beta by adding the matching header to
   * `headers`, e.g. `{ "anthropic-beta": "mcp-client-2025-04-04" }`.
   * Without that header Anthropic will reject the request.
   *
   * Each entry is forwarded with camelCase keys converted to snake_case
   * so `authorizationToken` → `authorization_token`,
   * `toolConfiguration.allowedTools` → `tool_configuration.allowed_tools`,
   * etc.
   */
  mcpServers?: Array<Record<string, unknown>>;
};
export type OpenAICompatibleChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
    role: "assistant";
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }
  | {
    role: "tool";
    tool_call_id: string;
    content: string;
  };
export type OpenAICompatibleChatRequest = {
  model: string;
  messages: OpenAICompatibleChatMessage[];
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      parameters: unknown;
      description?: string;
    };
  }>;
  tool_choice?: unknown;
  seed?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  [key: string]: unknown;
};
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

/**
 * Structured warning emitted when a provider runtime drops or rewrites a
 * caller-provided option. Mirrors the AI ecosystem convention (Vercel AI
 * SDK, LangChain) of returning `unsupported-setting` warnings on the
 * runtime result so callers can discover silently-dropped fields without
 * having to read the source.
 */
export type ProviderWarning = {
  type: "unsupported-setting" | "other";
  setting?: string;
  details?: string;
  provider: ProviderKind;
};

/**
 * Mutable warning collector handed to per-provider request builders so
 * they can append entries during the build pass instead of plumbing a
 * return-tuple shape through every helper.
 */
type WarningCollector = {
  push(warning: ProviderWarning): void;
  drain(): ProviderWarning[];
};

export function createWarningCollector(): WarningCollector {
  const list: ProviderWarning[] = [];
  return {
    push(warning) {
      list.push(warning);
    },
    drain() {
      return list.slice();
    },
  };
}

export function stringifyJsonValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

export function readTextParts(parts: Array<{ type: string; text?: string }>): string {
  let text = "";
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      text += part.text;
    }
  }
  return text;
}

export function toOpenAICompatibleMessages(
  prompt: RuntimePromptMessage[],
): OpenAICompatibleChatMessage[] {
  const messages: OpenAICompatibleChatMessage[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system":
        messages.push({ role: "system", content: message.content });
        break;
      case "user":
        messages.push({ role: "user", content: readTextParts(message.content) });
        break;
      case "assistant": {
        let text = "";
        const toolCalls: NonNullable<
          Extract<OpenAICompatibleChatMessage, { role: "assistant" }>["tool_calls"]
        > = [];

        for (const part of message.content) {
          if (part.type === "text") {
            text += part.text;
            continue;
          }
          // OpenAI Chat Completions has no roundtrip slot for Anthropic
          // thinking blocks — they get dropped on replay. Anthropic-only.
          if (part.type === "reasoning") {
            continue;
          }

          toolCalls.push({
            id: part.toolCallId,
            type: "function",
            function: {
              name: part.toolName,
              arguments: stringifyJsonValue(part.input),
            },
          });
        }

        messages.push({
          role: "assistant",
          content: text.length > 0 ? text : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
        break;
      }
      case "tool":
        for (const part of message.content) {
          messages.push({
            role: "tool",
            tool_call_id: part.toolCallId,
            content: stringifyJsonValue(part.output.value),
          });
        }
        break;
    }
  }

  return messages;
}

export function toOpenAICompatibleTools(
  tools: RuntimeToolDefinition[] | undefined,
): OpenAICompatibleChatRequest["tools"] | undefined {
  if (!tools) {
    return undefined;
  }

  const functions = tools.flatMap((tool) =>
    tool.type === "function"
      ? [{
        type: "function" as const,
        function: {
          name: tool.name,
          parameters: unwrapToolInputSchema(tool.inputSchema),
          ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        },
      }]
      : []
  );

  return functions.length > 0 ? functions : undefined;
}

export function readProviderOptions(
  providerOptions: Record<string, unknown> | undefined,
  ...providerNames: string[]
): Record<string, unknown> {
  if (!providerOptions) {
    return {};
  }

  const merged: Record<string, unknown> = {};
  for (const key of providerNames) {
    const value = providerOptions[key];
    const record = readRecord(value);
    if (record) {
      Object.assign(merged, record);
    }
  }

  return merged;
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

export function unwrapToolInputSchema(inputSchema: unknown): unknown {
  if (typeof inputSchema !== "object" || inputSchema === null || Array.isArray(inputSchema)) {
    return inputSchema;
  }

  const candidate = Reflect.get(inputSchema, "jsonSchema");
  return candidate ?? inputSchema;
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
    });
  }
  if (options.frequencyPenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "google",
      setting: "frequencyPenalty",
      details: "Gemini generateContent does not accept frequencyPenalty; the value was dropped.",
    });
  }
  if (options.responseFormat && options.responseFormat.type !== "text") {
    warnings.push({
      type: "unsupported-setting",
      provider: "google",
      setting: "responseFormat",
      details:
        "Gemini uses generationConfig.responseMimeType + responseSchema for structured outputs, which is a separate surface and not yet wired through this option.",
    });
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
