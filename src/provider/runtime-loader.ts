import type { EmbeddingRuntime, ModelRuntime } from "./types.ts";

export interface OpenAIRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

export interface AnthropicRuntimeConfig {
  apiKey?: string;
  authToken?: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

export interface GoogleRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

type RuntimePromptMessage =
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
type OpenAICompatibleChatMessage =
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
type OpenAICompatibleChatRequest = {
  model: string;
  messages: OpenAICompatibleChatMessage[];
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  max_tokens?: number;
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
type OpenAICompatibleChoice = {
  message?: unknown;
  delta?: unknown;
  finish_reason?: unknown;
};
type OpenAIStreamToolCallState = {
  id: string;
  name: string;
  arguments: string;
  started: boolean;
};
type AnthropicCompatibleMessage = {
  role: "user" | "assistant";
  content: Array<Record<string, unknown>>;
};
type AnthropicCompatibleRequest = {
  model: string;
  messages: AnthropicCompatibleMessage[];
  max_tokens: number;
  stream?: boolean;
  /**
   * String form is the classic shorthand. Array-of-blocks form is required
   * when the system prompt carries a cache_control breakpoint, because
   * cache_control lives on an individual content block, not on a raw string.
   */
  system?: string | Array<Record<string, unknown>>;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  [key: string]: unknown;
};
type AnthropicStreamToolCallState = {
  id: string;
  name: string;
  input: string;
  providerExecuted?: boolean;
};
type AnthropicStreamReasoningState = {
  id: string;
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
  tools?: Array<{
    functionDeclarations: Array<Record<string, unknown>>;
  }>;
  toolConfig?: {
    functionCallingConfig: Record<string, unknown>;
  };
  generationConfig?: Record<string, unknown>;
  [key: string]: unknown;
};

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function getOpenAIEmbeddingUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_OPENAI_BASE_URL, "embeddings");
}

function getAnthropicMessagesUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_ANTHROPIC_BASE_URL, "messages");
}

function getOpenAIChatCompletionsUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_OPENAI_BASE_URL, "chat/completions");
}

function getGoogleGenerateContentUrl(baseURL: string | undefined, modelId: string): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:generateContent`,
  );
}

function getGoogleStreamGenerateContentUrl(baseURL: string | undefined, modelId: string): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`,
  );
}

function getGoogleEmbeddingUrl(baseURL: string | undefined, modelId: string): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:embedContent`,
  );
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number");
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(value));
}

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

type ProviderKind = "anthropic" | "openai" | "google";

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

function createWarningCollector(): WarningCollector {
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

/**
 * Base class for typed provider errors. The `retryable` flag is the
 * primary signal for callers (or a retry wrapper) to decide whether to
 * re-issue the request. `retryAfterMs` is set when the provider gave an
 * explicit delay hint (Retry-After header, Retry-Info trailer).
 */
export class ProviderError extends Error {
  readonly provider: ProviderKind;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(options: {
    provider: ProviderKind;
    status: number;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
  }) {
    super(options.message);
    this.name = new.target.name;
    this.provider = options.provider;
    this.status = options.status;
    this.retryable = options.retryable;
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
  }
}

/** Provider reports it is overloaded (Anthropic 529, OpenAI/Google 503). */
export class ProviderOverloadedError extends ProviderError {}

/** Provider is rate limiting this API key (OpenAI/Google 429 with Retry-After). */
export class ProviderRateLimitError extends ProviderError {}

/** Provider account quota is exhausted — non-retryable. */
export class ProviderQuotaError extends ProviderError {}

/** Non-retryable 4xx/5xx that doesn't fit another bucket. */
export class ProviderRequestError extends ProviderError {}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.round(asNumber * 1000);
  }
  // HTTP-date form (rare in practice for LLM providers).
  const parsed = Date.parse(header);
  if (!Number.isNaN(parsed)) {
    return Math.max(0, parsed - Date.now());
  }
  return undefined;
}

/**
 * Inspect a non-2xx response and build the most specific ProviderError
 * subclass we can. Reads the response body as text (it's already dead
 * on the wire by this point). Body classification handles the cases
 * where HTTP status alone is ambiguous — notably OpenAI
 * `insufficient_quota` vs `rate_limit_exceeded` both arriving as 429.
 */
async function buildProviderError(
  provider: ProviderKind,
  response: Response,
): Promise<ProviderError> {
  const rawBody = await response.text();
  const message = rawBody.trim() || `${response.status} ${response.statusText}`.trim();
  const status = response.status;
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));

  const parsedBody = (() => {
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  })();
  const errorRecord = readRecord(parsedBody?.error);
  const errorCode = typeof errorRecord?.code === "string"
    ? errorRecord.code
    : typeof errorRecord?.type === "string"
    ? errorRecord.type
    : typeof errorRecord?.status === "string"
    ? errorRecord.status
    : undefined;

  // Anthropic 529 = overloaded. Anthropic surfaces this with
  // { error: { type: "overloaded_error" } } in the body.
  if (provider === "anthropic" && status === 529) {
    return new ProviderOverloadedError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  // OpenAI / Google 503 = overloaded.
  if ((provider === "openai" || provider === "google") && status === 503) {
    return new ProviderOverloadedError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  // OpenAI 429 splits based on the error code in the body:
  //  - insufficient_quota → hard quota, non-retryable
  //  - rate_limit_exceeded / tokens_per_min_exceeded → retry with Retry-After
  if (provider === "openai" && status === 429) {
    if (errorCode === "insufficient_quota") {
      return new ProviderQuotaError({
        provider,
        status,
        message,
        retryable: false,
      });
    }
    return new ProviderRateLimitError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  // Google 429 RESOURCE_EXHAUSTED is almost always the daily free-tier
  // quota — surface as a hard quota error so callers don't hot-loop on
  // retries that can't possibly succeed until midnight UTC.
  if (provider === "google" && status === 429) {
    if (errorCode === "RESOURCE_EXHAUSTED") {
      return new ProviderQuotaError({
        provider,
        status,
        message,
        retryable: false,
      });
    }
    return new ProviderRateLimitError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  return new ProviderRequestError({
    provider,
    status,
    message,
    retryable: false,
  });
}

async function requestJson(options: {
  url: string;
  fetchImpl: typeof globalThis.fetch;
  init: RequestInit;
  providerLabel: string;
  providerKind: ProviderKind;
}): Promise<unknown> {
  const response = await options.fetchImpl(options.url, options.init);
  if (!response.ok) {
    const err = await buildProviderError(options.providerKind, response);
    err.message = `${options.providerLabel} request failed: ${err.message}`;
    throw err;
  }

  return response.json();
}

async function requestStream(options: {
  url: string;
  fetchImpl: typeof globalThis.fetch;
  init: RequestInit;
  providerLabel: string;
  providerKind: ProviderKind;
}): Promise<ReadableStream<Uint8Array>> {
  const response = await options.fetchImpl(options.url, options.init);
  if (!response.ok) {
    const err = await buildProviderError(options.providerKind, response);
    err.message = `${options.providerLabel} request failed: ${err.message}`;
    throw err;
  }

  if (!response.body) {
    throw new ProviderRequestError({
      provider: options.providerKind,
      status: response.status,
      message: `${options.providerLabel} request failed: stream body missing`,
      retryable: false,
    });
  }

  return response.body;
}

function stringifyJsonValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function readTextParts(parts: Array<{ type: string; text?: string }>): string {
  let text = "";
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      text += part.text;
    }
  }
  return text;
}

function toOpenAICompatibleMessages(prompt: RuntimePromptMessage[]): OpenAICompatibleChatMessage[] {
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

function toOpenAICompatibleTools(
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

function readProviderOptions(
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

function createRequestHeaders(options: {
  apiKeyHeaderName: string;
  apiKey: string;
  extraHeaders?: HeadersInit;
}): Headers {
  const headers = new Headers(options.extraHeaders);
  headers.set("content-type", "application/json");
  headers.set(options.apiKeyHeaderName, options.apiKey);
  return headers;
}

function normalizeAnthropicFinishReason(
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

type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

function extractAnthropicUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheCreationInputTokens = usage.cache_creation_input_tokens;
  const cacheReadInputTokens = usage.cache_read_input_tokens;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof inputTokens === "number" || typeof outputTokens === "number"
      ? (typeof inputTokens === "number" ? inputTokens : 0) +
        (typeof outputTokens === "number" ? outputTokens : 0)
      : undefined,
    ...(typeof cacheCreationInputTokens === "number" ? { cacheCreationInputTokens } : {}),
    ...(typeof cacheReadInputTokens === "number" ? { cacheReadInputTokens } : {}),
  };
}

function mergeUsage(
  current: RuntimeUsage | undefined,
  next: RuntimeUsage | undefined,
): RuntimeUsage | undefined {
  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  const inputTokens = next.inputTokens ?? current.inputTokens;
  const outputTokens = next.outputTokens ?? current.outputTokens;
  const cacheCreationInputTokens = next.cacheCreationInputTokens ??
    current.cacheCreationInputTokens;
  const cacheReadInputTokens = next.cacheReadInputTokens ?? current.cacheReadInputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
  };
}

function normalizeAnthropicToolChoice(toolChoice: unknown): unknown {
  if (typeof toolChoice === "string") {
    return { type: toolChoice };
  }

  return toolChoice;
}

function toSnakeCaseRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`),
      value,
    ]),
  );
}

/**
 * Recursive snake_case key converter for nested config objects (used for
 * Anthropic mcp_servers, where authorizationToken / toolConfiguration /
 * allowedTools all need conversion).
 */
function deepSnakeCase(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepSnakeCase);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`),
        deepSnakeCase(v),
      ]),
    );
  }
  return value;
}

function pushAnthropicUserContent(
  messages: AnthropicCompatibleMessage[],
  content: Array<Record<string, unknown>>,
): void {
  if (content.length === 0) {
    return;
  }

  const lastMessage = messages.at(-1);
  if (lastMessage?.role === "user") {
    lastMessage.content.push(...content);
    return;
  }

  messages.push({
    role: "user",
    content,
  });
}

/**
 * Resolves a {@link ProviderCacheTtl} into Anthropic's `cache_control` shape.
 *
 * Returns `undefined` when caching is not requested (`false` / `undefined`),
 * `{ type: "ephemeral" }` for the 5-minute default (`true` / `"5m"`), or
 * `{ type: "ephemeral", ttl: "1h" }` for the extended 1-hour cache.
 */
function resolveAnthropicCacheControlBlock(
  ttl: ProviderCacheTtl | undefined,
): { type: "ephemeral"; ttl?: "1h" } | undefined {
  if (ttl === undefined || ttl === false) {
    return undefined;
  }
  if (ttl === "1h") {
    return { type: "ephemeral", ttl: "1h" };
  }
  return { type: "ephemeral" };
}

function toAnthropicMessages(
  prompt: RuntimePromptMessage[],
  systemCacheControl?: { type: "ephemeral"; ttl?: "1h" },
): {
  system?: string | Array<Record<string, unknown>>;
  messages: AnthropicCompatibleMessage[];
} {
  const systemParts: string[] = [];
  const messages: AnthropicCompatibleMessage[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system":
        if (message.content.length > 0) {
          systemParts.push(message.content);
        }
        break;
      case "user":
        pushAnthropicUserContent(messages, [{
          type: "text",
          text: readTextParts(message.content),
        }]);
        break;
      case "assistant":
        messages.push({
          role: "assistant",
          content: message.content.map((part) => {
            if (part.type === "text") {
              return { type: "text", text: part.text };
            }
            if (part.type === "reasoning") {
              // Redacted thinking blocks roundtrip as the encrypted blob
              // form Anthropic gave us. Plain thinking blocks need the
              // signature to verify on the server.
              if (typeof part.redactedData === "string") {
                return {
                  type: "redacted_thinking",
                  data: part.redactedData,
                };
              }
              return {
                type: "thinking",
                thinking: part.text ?? "",
                ...(typeof part.signature === "string" ? { signature: part.signature } : {}),
              };
            }
            return {
              type: "tool_use",
              id: part.toolCallId,
              name: part.toolName,
              input: part.input,
            };
          }),
        });
        break;
      case "tool":
        pushAnthropicUserContent(
          messages,
          message.content.map((part) => ({
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: stringifyJsonValue(part.output.value),
          })),
        );
        break;
    }
  }

  if (systemParts.length === 0) {
    return { messages };
  }

  const joined = systemParts.join("\n\n");

  // Cache-controlled system prompts must use the array-of-blocks form so the
  // breakpoint lands on an individual content block. Callers that don't opt
  // in keep the legacy raw-string form for backward compatibility.
  if (systemCacheControl) {
    return {
      system: [{
        type: "text",
        text: joined,
        cache_control: systemCacheControl,
      }],
      messages,
    };
  }

  return { system: joined, messages };
}

/**
 * Short-name → latest-versioned-type alias map for Anthropic provider tools.
 *
 * Anthropic tool types are date-stamped (e.g. `code_execution_20260120`) so
 * callers either pin a version or get the latest. We accept both: a caller
 * can pass `anthropic.code_execution` and we map to the latest known version,
 * or pass `anthropic.code_execution_20250522` and we forward verbatim.
 *
 * Versions chosen here are the latest documented releases as of 2026-04-15
 * — see https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview.
 * When Anthropic ships newer versions, update this map.
 */
const ANTHROPIC_TOOL_VERSION_ALIASES: Record<string, string> = {
  code_execution: "code_execution_20260120",
  computer_use: "computer_20250124",
  computer: "computer_20250124",
  text_editor: "text_editor_20250728",
  bash: "bash_20250124",
  memory: "memory_20250818",
  web_search: "web_search_20250305",
  web_fetch: "web_fetch_20250910",
};

function resolveAnthropicProviderType(rawType: string): string {
  // Already-versioned types (contain a date stamp suffix) pass through verbatim.
  if (/_\d{8}$/.test(rawType)) {
    return rawType;
  }
  return ANTHROPIC_TOOL_VERSION_ALIASES[rawType] ?? rawType;
}

function toAnthropicTools(
  tools: RuntimeToolDefinition[] | undefined,
  toolsCacheControl?: { type: "ephemeral"; ttl?: "1h" },
): Array<Record<string, unknown>> | undefined {
  if (!tools) {
    return undefined;
  }

  const normalized: Array<Record<string, unknown>> = [];

  for (const tool of tools) {
    if (tool.type === "function") {
      normalized.push({
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        input_schema: unwrapToolInputSchema(tool.inputSchema),
      });
      continue;
    }

    if (!tool.id.startsWith("anthropic.")) {
      continue;
    }

    const rawType = tool.id.slice("anthropic.".length);
    if (rawType.length === 0) {
      continue;
    }

    normalized.push({
      type: resolveAnthropicProviderType(rawType),
      name: tool.name,
      ...toSnakeCaseRecord(tool.args),
    });
  }

  if (normalized.length === 0) {
    return undefined;
  }

  // Attach the cache breakpoint to the final tool entry so Anthropic caches
  // the entire tools block up to and including that definition. Earlier tool
  // entries are implicitly covered by the same breakpoint per Anthropic's
  // walk-backward cache lookup behaviour.
  if (toolsCacheControl) {
    const lastIndex = normalized.length - 1;
    normalized[lastIndex] = {
      ...normalized[lastIndex],
      cache_control: toolsCacheControl,
    };
  }

  return normalized;
}

function createAnthropicRequestHeaders(options: {
  apiKey?: string;
  authToken?: string;
  extraHeaders?: HeadersInit;
}): Headers {
  const headers = new Headers(options.extraHeaders);
  headers.set("content-type", "application/json");
  headers.set("anthropic-version", headers.get("anthropic-version") ?? "2023-06-01");

  if (options.authToken) {
    headers.set("authorization", `Bearer ${options.authToken}`);
  } else if (options.apiKey) {
    headers.set("x-api-key", options.apiKey);
  }

  return headers;
}

/**
 * Anthropic's Messages API requires `max_tokens` on every call, so the
 * outbound request builder must always supply a number. Picking the right
 * one means knowing the model: different Claude families have wildly
 * different maximum output budgets, and a flat default either truncates
 * modern models mid-response or gets rejected with "too many tokens" on
 * older ones. Return the model's advertised maximum as the default, and
 * clamp caller-provided values at that same ceiling for known models so a
 * bad input becomes a clipped response rather than an API error. Unknown
 * model ids get a conservative 4096 fallback and pass caller values
 * through unchanged, since we have no intel to clamp against.
 */
function getAnthropicModelCapabilities(
  modelId: string,
): { maxOutputTokens: number; isKnownModel: boolean } {
  if (modelId.includes("claude-sonnet-4-6") || modelId.includes("claude-opus-4-6")) {
    return { maxOutputTokens: 128_000, isKnownModel: true };
  }
  if (
    modelId.includes("claude-sonnet-4-5") ||
    modelId.includes("claude-opus-4-5") ||
    modelId.includes("claude-haiku-4-5")
  ) {
    return { maxOutputTokens: 64_000, isKnownModel: true };
  }
  if (modelId.includes("claude-opus-4-1")) {
    return { maxOutputTokens: 32_000, isKnownModel: true };
  }
  if (modelId.includes("claude-sonnet-4-")) {
    return { maxOutputTokens: 64_000, isKnownModel: true };
  }
  if (modelId.includes("claude-opus-4-")) {
    return { maxOutputTokens: 32_000, isKnownModel: true };
  }
  if (modelId.includes("claude-3-haiku")) {
    return { maxOutputTokens: 4096, isKnownModel: true };
  }
  return { maxOutputTokens: 4096, isKnownModel: false };
}

function resolveAnthropicMaxTokens(
  modelId: string,
  callerMaxOutputTokens: number | undefined,
): number {
  const { maxOutputTokens: modelMax, isKnownModel } = getAnthropicModelCapabilities(modelId);
  const requested = callerMaxOutputTokens ?? modelMax;
  if (isKnownModel && requested > modelMax) {
    return modelMax;
  }
  return requested;
}

/**
 * Map a unified reasoning effort level to an Anthropic `thinking.budget_tokens`
 * value. Anthropic's minimum accepted budget is 1024; higher tiers give Claude
 * more headroom to explore. `max` maps to the upper bound documented for
 * Claude 4.x family (32k tokens of thinking — caller can override via
 * `budgetTokens` if they need more).
 */
function resolveAnthropicThinkingBudget(
  option: ProviderReasoningOption | undefined,
): number | undefined {
  if (!option || option.enabled !== true) {
    return undefined;
  }
  if (typeof option.budgetTokens === "number" && option.budgetTokens >= 1024) {
    return option.budgetTokens;
  }
  switch (option.effort) {
    case "low":
      return 1024;
    case "high":
      return 16_384;
    case "max":
      return 32_768;
    case "medium":
    default:
      return 4096;
  }
}

function buildAnthropicMessagesRequest(
  modelId: string,
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  stream: boolean,
  warnings: WarningCollector,
): AnthropicCompatibleRequest {
  const systemCacheControl = resolveAnthropicCacheControlBlock(
    options.cacheControl?.system,
  );
  const toolsCacheControl = resolveAnthropicCacheControlBlock(
    options.cacheControl?.tools,
  );

  const { system, messages } = toAnthropicMessages(options.prompt, systemCacheControl);
  const anthropicTools = toAnthropicTools(options.tools, toolsCacheControl);
  const thinkingBudget = resolveAnthropicThinkingBudget(options.reasoning);
  const thinkingEnabled = thinkingBudget !== undefined;

  // Anthropic doesn't support these unified options at all — emit warnings
  // so callers don't quietly pass values that have zero effect.
  if (options.presencePenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "presencePenalty",
      details: "Anthropic Messages API has no equivalent and the value was dropped.",
    });
  }
  if (options.frequencyPenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "frequencyPenalty",
      details: "Anthropic Messages API has no equivalent and the value was dropped.",
    });
  }
  if (options.seed !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "seed",
      details: "Anthropic Messages API does not support deterministic seeding.",
    });
  }
  if (options.topK !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "topK",
      details: "Anthropic Messages API does not expose top_k on this surface.",
    });
  }
  if (
    options.stopSequences && options.stopSequences.length > 4
  ) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "stopSequences",
      details:
        `Anthropic accepts at most 4 stop sequences; ${options.stopSequences.length} were provided and the extras were truncated.`,
    });
  }
  if (thinkingEnabled && options.temperature !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "temperature",
      details:
        "Dropped because Anthropic rejects sampling params when extended thinking is enabled.",
    });
  }
  if (thinkingEnabled && options.topP !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "topP",
      details:
        "Dropped because Anthropic rejects sampling params when extended thinking is enabled.",
    });
  }
  if (options.responseFormat && options.responseFormat.type !== "text") {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "responseFormat",
      details:
        "Anthropic Messages API does not have a structured-output response_format equivalent. Use a tool with the schema as input_schema instead.",
    });
  }

  // Anthropic requires max_tokens > budget_tokens when thinking is enabled.
  // Growing max_tokens by the thinking budget preserves the caller's intended
  // output budget, and we clamp the sum at the model's advertised maximum so
  // the request never exceeds the API's hard cap.
  const baseMaxTokens = resolveAnthropicMaxTokens(modelId, options.maxOutputTokens);
  const maxTokens = thinkingEnabled
    ? Math.min(
      baseMaxTokens + (thinkingBudget ?? 0),
      getAnthropicModelCapabilities(modelId).maxOutputTokens,
    )
    : baseMaxTokens;

  const body: AnthropicCompatibleRequest = {
    model: modelId,
    messages,
    max_tokens: maxTokens,
    ...(stream ? { stream: true } : {}),
    ...(system ? { system } : {}),
    // Sampling params are mutually exclusive with thinking on Anthropic — the
    // API rejects the combo outright. Drop them silently when thinking is on
    // (callers see thinking's output instead of what they'd have gotten from
    // custom sampling, which is the documented tradeoff).
    ...(!thinkingEnabled && options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(!thinkingEnabled && options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.stopSequences && options.stopSequences.length > 0
      ? { stop_sequences: options.stopSequences.slice(0, 4) }
      : {}),
    ...(anthropicTools ? { tools: anthropicTools } : {}),
    ...(options.toolChoice !== undefined
      ? { tool_choice: normalizeAnthropicToolChoice(options.toolChoice) }
      : {}),
    ...(thinkingEnabled ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } } : {}),
    ...(typeof options.userId === "string" && options.userId.length > 0
      ? { metadata: { user_id: options.userId } }
      : {}),
    ...(options.mcpServers && options.mcpServers.length > 0
      ? { mcp_servers: deepSnakeCase(options.mcpServers) as unknown[] }
      : {}),
    ...(options.anthropicContainer !== undefined ? { container: options.anthropicContainer } : {}),
  };

  Object.assign(body, readProviderOptions(options.providerOptions, "anthropic", providerName));
  return body;
}

type AnthropicReasoningContent = {
  type: "reasoning";
  text?: string;
  signature?: string;
  redactedData?: string;
};

type AnthropicCitation = {
  type: string;
  citedText?: string;
  url?: string;
  title?: string;
  startCharIndex?: number;
  endCharIndex?: number;
  startBlockIndex?: number;
  endBlockIndex?: number;
  startPageNumber?: number;
  endPageNumber?: number;
  documentIndex?: number;
  documentTitle?: string;
};

type AnthropicTextContent = {
  type: "text";
  text: string;
  citations?: AnthropicCitation[];
};

/**
 * Best-effort camelCase normalization of a single Anthropic citation
 * record. Handles the union of fields across web_search_result_location,
 * web_fetch_result_location, char_location, page_location, and
 * content_block_location citation kinds — see
 * https://docs.claude.com/en/docs/build-with-claude/citations
 */
function normalizeAnthropicCitation(raw: unknown): AnthropicCitation | undefined {
  const r = readRecord(raw);
  if (!r) return undefined;
  const typeStr = typeof r.type === "string" ? r.type : undefined;
  if (!typeStr) return undefined;
  const out: AnthropicCitation = { type: typeStr };
  if (typeof r.cited_text === "string") out.citedText = r.cited_text;
  if (typeof r.url === "string") out.url = r.url;
  if (typeof r.title === "string") out.title = r.title;
  if (typeof r.start_char_index === "number") out.startCharIndex = r.start_char_index;
  if (typeof r.end_char_index === "number") out.endCharIndex = r.end_char_index;
  if (typeof r.start_block_index === "number") out.startBlockIndex = r.start_block_index;
  if (typeof r.end_block_index === "number") out.endBlockIndex = r.end_block_index;
  if (typeof r.start_page_number === "number") out.startPageNumber = r.start_page_number;
  if (typeof r.end_page_number === "number") out.endPageNumber = r.end_page_number;
  if (typeof r.document_index === "number") out.documentIndex = r.document_index;
  if (typeof r.document_title === "string") out.documentTitle = r.document_title;
  return out;
}

function buildAnthropicGenerateResult(payload: unknown): {
  content: Array<
    | AnthropicTextContent
    | AnthropicReasoningContent
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
    | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown }
  >;
  finishReason?: string | { unified: string; raw: string } | null;
  usage?: RuntimeUsage;
} {
  const record = readRecord(payload);
  const content = Array.isArray(record?.content) ? record.content : [];
  const normalized: Array<
    | AnthropicTextContent
    | AnthropicReasoningContent
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
    | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown }
  > = [];

  for (const blockValue of content) {
    const block = readRecord(blockValue);
    const blockType = typeof block?.type === "string" ? block.type : undefined;

    if (blockType === "text" && typeof block?.text === "string" && block.text.length > 0) {
      const citationsRaw = Array.isArray(block.citations) ? block.citations : undefined;
      const citations = citationsRaw
        ?.flatMap((c) => {
          const normalizedCitation = normalizeAnthropicCitation(c);
          return normalizedCitation ? [normalizedCitation] : [];
        });
      normalized.push({
        type: "text",
        text: block.text,
        ...(citations && citations.length > 0 ? { citations } : {}),
      });
      continue;
    }

    // Thinking blocks carry the cleartext trace plus a signature that
    // Anthropic uses to verify on subsequent turns. Surfacing both lets
    // callers persist them as `reasoning` content parts and replay on
    // the next turn so Claude can continue from the same thinking.
    if (blockType === "thinking") {
      normalized.push({
        type: "reasoning",
        ...(typeof block?.thinking === "string" ? { text: block.thinking } : {}),
        ...(typeof block?.signature === "string" ? { signature: block.signature } : {}),
      });
      continue;
    }

    // Redacted thinking blocks arrive when Claude's safety classifier
    // hides the trace. Pass the encrypted blob through opaquely so the
    // caller can replay it on the next turn (Anthropic still needs the
    // blob to verify continuity even though it can't read it).
    if (blockType === "redacted_thinking" && typeof block?.data === "string") {
      normalized.push({
        type: "reasoning",
        redactedData: block.data,
      });
      continue;
    }

    if (
      (blockType === "tool_use" || blockType === "server_tool_use") &&
      typeof block?.id === "string" &&
      typeof block?.name === "string"
    ) {
      normalized.push({
        type: "tool-call",
        toolCallId: block.id,
        toolName: block.name,
        input: stringifyJsonValue(block.input ?? {}),
      });
      continue;
    }

    if (
      blockType === "web_search_tool_result" &&
      typeof block?.tool_use_id === "string" &&
      Array.isArray(block?.content)
    ) {
      normalized.push({
        type: "tool-result",
        toolCallId: block.tool_use_id,
        toolName: "web_search",
        result: block.content,
      });
    }

    if (
      blockType === "web_fetch_tool_result" &&
      typeof block?.tool_use_id === "string" &&
      readRecord(block?.content)
    ) {
      normalized.push({
        type: "tool-result",
        toolCallId: block.tool_use_id,
        toolName: "web_fetch",
        result: block.content,
      });
    }
  }

  return {
    content: normalized,
    finishReason: normalizeAnthropicFinishReason(record?.stop_reason),
    usage: extractAnthropicUsage(payload),
  };
}

function parseSseChunk(chunk: string): {
  events: Array<unknown | "[DONE]">;
  remainder: string;
} {
  const blocks = chunk.split(/\r?\n\r?\n/);
  const remainder = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    const dataLines = block.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) {
      return [];
    }

    const payload = dataLines.join("\n").trim();
    if (payload === "[DONE]") {
      return ["[DONE]" as const];
    }

    try {
      return [JSON.parse(payload) as unknown];
    } catch {
      return [];
    }
  });

  return { events, remainder };
}

async function* streamAnthropicCompatibleParts(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCalls = new Map<number, AnthropicStreamToolCallState>();
  const reasoningBlocks = new Map<number, AnthropicStreamReasoningState>();
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

      const record = readRecord(event);
      const eventType = typeof record?.type === "string" ? record.type : undefined;
      usage = mergeUsage(usage, extractAnthropicUsage(record));

      if (eventType === "message_start") {
        usage = mergeUsage(usage, extractAnthropicUsage(record?.message));
        continue;
      }

      if (eventType === "content_block_start") {
        const index = typeof record?.index === "number" ? record.index : 0;
        const contentBlock = readRecord(record?.content_block);
        const blockType = typeof contentBlock?.type === "string" ? contentBlock.type : undefined;

        if (
          blockType === "text" && typeof contentBlock?.text === "string" &&
          contentBlock.text.length > 0
        ) {
          yield { type: "text-delta", delta: contentBlock.text };
          continue;
        }

        if (blockType === "thinking") {
          const reasoningId = `thinking-${index}`;
          reasoningBlocks.set(index, { id: reasoningId });
          yield {
            type: "reasoning-start",
            id: reasoningId,
          };

          if (typeof contentBlock?.thinking === "string" && contentBlock.thinking.length > 0) {
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
          reasoningBlocks.set(index, { id: reasoningId });
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
            input: "",
            ...(providerExecuted ? { providerExecuted } : {}),
          };

          toolCalls.set(index, current);
          yield {
            type: "tool-input-start",
            id: current.id,
            toolName: current.name,
            ...(providerExecuted ? { providerExecuted } : {}),
          };

          const initialInput = contentBlock.input;
          if (initialInput !== undefined) {
            const serializedInput = stringifyJsonValue(initialInput);
            current.input += serializedInput;
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
          typeof contentBlock?.tool_use_id === "string" &&
          Array.isArray(contentBlock?.content)
        ) {
          yield {
            type: "tool-result",
            toolCallId: contentBlock.tool_use_id,
            toolName: "web_search",
            result: contentBlock.content,
            providerExecuted: true,
          };
        }

        if (
          blockType === "web_fetch_tool_result" &&
          typeof contentBlock?.tool_use_id === "string" &&
          readRecord(contentBlock?.content)
        ) {
          yield {
            type: "tool-result",
            toolCallId: contentBlock.tool_use_id,
            toolName: "web_fetch",
            result: contentBlock.content,
            providerExecuted: true,
          };
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

          yield {
            type: "reasoning-delta",
            id: current.id,
            delta: delta.thinking,
          };
          continue;
        }

        if (deltaType === "input_json_delta" && typeof delta?.partial_json === "string") {
          const current = toolCalls.get(index);
          if (!current) {
            continue;
          }

          current.input += delta.partial_json;
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
          };
          reasoningBlocks.delete(index);
          continue;
        }

        const current = toolCalls.get(index);
        if (!current) {
          continue;
        }

        yield {
          type: "tool-call",
          toolCallId: current.id,
          toolName: current.name,
          input: current.input.length > 0 ? current.input : "{}",
          ...(current.providerExecuted ? { providerExecuted: true } : {}),
        };
        toolCalls.delete(index);
        continue;
      }

      if (eventType === "message_delta") {
        const delta = readRecord(record?.delta);
        const normalizedFinishReason = normalizeAnthropicFinishReason(delta?.stop_reason);
        if (normalizedFinishReason) {
          finishReason = normalizedFinishReason;
        }
      }
    }
  }

  if (buffer.trim().length > 0) {
    const parsed = parseSseChunk(`${buffer}\n\n`);
    for (const event of parsed.events) {
      if (event === "[DONE]") {
        continue;
      }
      const record = readRecord(event);
      usage = mergeUsage(usage, extractAnthropicUsage(record));
    }
  }

  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
  };
}

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

/**
 * OpenAI reasoning models (o1 / o3 / o4 family) use the completion path but
 * have different constraints than chat models: sampling params are rejected,
 * and they accept a `reasoning_effort` field. We detect them by model id
 * prefix so callers don't have to configure it per runtime.
 */
function isOpenAIReasoningModel(modelId: string): boolean {
  return /^o[134](-|$)/.test(modelId);
}

/**
 * Map the unified reasoning effort to OpenAI's `reasoning_effort` enum.
 * OpenAI doesn't accept "max" — we collapse it to "high".
 */
function resolveOpenAIReasoningEffort(
  option: ProviderReasoningOption | undefined,
): "low" | "medium" | "high" | undefined {
  if (!option || option.enabled !== true) {
    return undefined;
  }
  switch (option.effort) {
    case "low":
      return "low";
    case "high":
    case "max":
      return "high";
    case "medium":
    default:
      return "medium";
  }
}

function buildOpenAIChatRequest(
  modelId: string,
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  stream: boolean,
  warnings: WarningCollector,
): OpenAICompatibleChatRequest {
  const isReasoningModel = isOpenAIReasoningModel(modelId);
  const reasoningEffort = resolveOpenAIReasoningEffort(options.reasoning);
  const reasoningEnabled = isReasoningModel || reasoningEffort !== undefined;

  // OpenAI Chat Completions has no top_k surface (it's exposed only on the
  // Responses API for some reasoning models). Quietly accepting it would
  // mislead callers into thinking it took effect.
  if (options.topK !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "openai",
      setting: "topK",
      details: "OpenAI Chat Completions does not expose top_k; the value was dropped.",
    });
  }

  // Reasoning models (o1 / o3 / o4) reject sampling params outright. Emit
  // warnings at build time so callers see *why* the value didn't apply
  // rather than a 400 from the API.
  if (reasoningEnabled) {
    const dropped: Array<[keyof typeof options, string]> = [
      ["temperature", "temperature"],
      ["topP", "top_p"],
      ["presencePenalty", "presence_penalty"],
      ["frequencyPenalty", "frequency_penalty"],
    ];
    for (const [key, openaiName] of dropped) {
      if (options[key] !== undefined) {
        warnings.push({
          type: "unsupported-setting",
          provider: "openai",
          setting: key,
          details:
            `Dropped because OpenAI reasoning models reject ${openaiName}. Reasoning was active for this request.`,
        });
      }
    }
  }

  const body: OpenAICompatibleChatRequest = {
    model: modelId,
    messages: toOpenAICompatibleMessages(options.prompt),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...(options.maxOutputTokens !== undefined ? { max_tokens: options.maxOutputTokens } : {}),
    // OpenAI reasoning models reject temperature / top_p / frequency / presence.
    // Drop them silently rather than letting the API bounce the request.
    ...(!reasoningEnabled && options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(!reasoningEnabled && options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.stopSequences && options.stopSequences.length > 0
      ? { stop: options.stopSequences }
      : {}),
    ...(toOpenAICompatibleTools(options.tools)
      ? { tools: toOpenAICompatibleTools(options.tools) }
      : {}),
    ...(options.toolChoice !== undefined ? { tool_choice: options.toolChoice } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(!reasoningEnabled && options.presencePenalty !== undefined
      ? { presence_penalty: options.presencePenalty }
      : {}),
    ...(!reasoningEnabled && options.frequencyPenalty !== undefined
      ? { frequency_penalty: options.frequencyPenalty }
      : {}),
    ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
    ...(typeof options.userId === "string" && options.userId.length > 0
      ? { user: options.userId }
      : {}),
    ...(options.serviceTier !== undefined ? { service_tier: options.serviceTier } : {}),
    ...(options.parallelToolCalls !== undefined
      ? { parallel_tool_calls: options.parallelToolCalls }
      : {}),
    ...(options.responseFormat && options.responseFormat.type !== "text"
      ? {
        response_format: options.responseFormat.type === "json" ? { type: "json_object" } : {
          type: "json_schema",
          json_schema: {
            name: options.responseFormat.name,
            ...(typeof options.responseFormat.description === "string"
              ? { description: options.responseFormat.description }
              : {}),
            schema: unwrapToolInputSchema(options.responseFormat.schema),
            ...(options.responseFormat.strict !== undefined
              ? { strict: options.responseFormat.strict }
              : {}),
          },
        },
      }
      : {}),
  };

  Object.assign(body, readProviderOptions(options.providerOptions, "openai", providerName));
  return body;
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
): GoogleCompatibleRequest["tools"] | undefined {
  if (!tools) {
    return undefined;
  }

  const functionDeclarations = tools.flatMap((tool) =>
    tool.type === "function"
      ? [{
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        parameters: unwrapToolInputSchema(tool.inputSchema),
      }]
      : []
  );

  return functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;
}

function unwrapToolInputSchema(inputSchema: unknown): unknown {
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
  if (record?.type === "tool" && typeof record.name === "string") {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [record.name],
      },
    };
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

  return {
    content,
    finishReason: normalizeGoogleFinishReason(extractFirstGoogleCandidate(payload)?.finishReason),
    usage: extractGoogleUsage(payload),
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

async function* streamOpenAICompatibleParts(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCalls = new Map<number, OpenAIStreamToolCallState>();
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

      const record = readRecord(event);
      usage = extractOpenAIUsage(record) ?? usage;
      const choice = extractFirstChoice(record);
      if (!choice) {
        continue;
      }

      const delta = readRecord(choice.delta);
      if (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0) {
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
          delta: delta.reasoning_content,
        };
      }

      const textDelta = extractOpenAIContentText(delta?.content);
      if (textDelta.length > 0) {
        if (reasoningId) {
          yield {
            type: "reasoning-end",
            id: reasoningId,
          };
          reasoningId = null;
        }
        yield { type: "text-delta", delta: textDelta };
      }

      const rawToolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
      for (const rawToolCall of rawToolCalls) {
        if (reasoningId) {
          yield {
            type: "reasoning-end",
            id: reasoningId,
          };
          reasoningId = null;
        }

        const toolCallRecord = readRecord(rawToolCall);
        const index = typeof toolCallRecord?.index === "number" ? toolCallRecord.index : 0;
        const current = toolCalls.get(index) ?? {
          id: typeof toolCallRecord?.id === "string" ? toolCallRecord.id : `tool-${index}`,
          name: "",
          arguments: "",
          started: false,
        };

        if (typeof toolCallRecord?.id === "string") {
          current.id = toolCallRecord.id;
        }

        const fn = readRecord(toolCallRecord?.function);
        if (typeof fn?.name === "string") {
          current.name = fn.name;
        }

        if (!current.started && current.name.length > 0) {
          current.started = true;
          yield {
            type: "tool-input-start",
            id: current.id,
            toolName: current.name,
          };
        }

        if (typeof fn?.arguments === "string" && fn.arguments.length > 0) {
          current.arguments += fn.arguments;
          yield {
            type: "tool-input-delta",
            id: current.id,
            delta: fn.arguments,
          };
        }

        toolCalls.set(index, current);
      }

      const normalizedFinishReason = normalizeOpenAIFinishReason(choice.finish_reason);
      if (normalizedFinishReason) {
        finishReason = normalizedFinishReason;
      }
    }
  }

  if (buffer.trim().length > 0) {
    const parsed = parseSseChunk(`${buffer}\n\n`);
    for (const event of parsed.events) {
      if (event === "[DONE]") {
        continue;
      }

      const record = readRecord(event);
      usage = extractOpenAIUsage(record) ?? usage;
    }
  }

  if (reasoningId) {
    yield {
      type: "reasoning-end",
      id: reasoningId,
    };
  }

  if (
    finishReason &&
    typeof finishReason === "object" &&
    finishReason.unified === "tool-calls"
  ) {
    for (const toolCall of toolCalls.values()) {
      yield {
        type: "tool-call",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.arguments,
      };
    }
  }

  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
  };
}

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
        init: {
          method: "POST",
          headers: createRequestHeaders({
            apiKeyHeaderName: "authorization",
            apiKey: `Bearer ${config.apiKey}`,
            extraHeaders: options.headers,
          }),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        },
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
        init: {
          method: "POST",
          headers: createRequestHeaders({
            apiKeyHeaderName: "authorization",
            apiKey: `Bearer ${config.apiKey}`,
            extraHeaders: options.headers,
          }),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        },
      }).then((responseStream) => {
        const drained = warnings.drain();
        return {
          stream: ReadableStream.from(streamOpenAICompatibleParts(responseStream)),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
  };
}

export function createAnthropicModelRuntime(
  config: AnthropicRuntimeConfig,
  modelId: string,
): ModelRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    provider: config.name ?? "anthropic",
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getAnthropicMessagesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildAnthropicMessagesRequest(
        modelId,
        config.name ?? "anthropic",
        options,
        false,
        warnings,
      );
      return requestJson({
        url,
        fetchImpl,
        providerLabel: config.name ?? "anthropic",
        providerKind: "anthropic",
        init: {
          method: "POST",
          headers: createAnthropicRequestHeaders({
            apiKey: config.apiKey,
            authToken: config.authToken,
            extraHeaders: options.headers,
          }),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        },
      }).then((payload) => {
        const drained = warnings.drain();
        return {
          ...buildAnthropicGenerateResult(payload),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
    doStream(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getAnthropicMessagesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildAnthropicMessagesRequest(
        modelId,
        config.name ?? "anthropic",
        options,
        true,
        warnings,
      );
      return requestStream({
        url,
        fetchImpl,
        providerLabel: config.name ?? "anthropic",
        providerKind: "anthropic",
        init: {
          method: "POST",
          headers: createAnthropicRequestHeaders({
            apiKey: config.apiKey,
            authToken: config.authToken,
            extraHeaders: options.headers,
          }),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        },
      }).then((responseStream) => {
        const drained = warnings.drain();
        return {
          stream: ReadableStream.from(streamAnthropicCompatibleParts(responseStream)),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
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
        init: {
          method: "POST",
          headers: createRequestHeaders({
            apiKeyHeaderName: "x-goog-api-key",
            apiKey: config.apiKey,
            extraHeaders: options.headers,
          }),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        },
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
        init: {
          method: "POST",
          headers: createRequestHeaders({
            apiKeyHeaderName: "x-goog-api-key",
            apiKey: config.apiKey,
            extraHeaders: options.headers,
          }),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        },
      }).then((responseStream) => {
        const drained = warnings.drain();
        return {
          stream: ReadableStream.from(streamGoogleCompatibleParts(responseStream)),
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
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: modelId,
            input: values,
          }),
          signal: abortSignal,
        },
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
          init: {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": config.apiKey,
            },
            body: JSON.stringify({
              content: {
                parts: [{ text: value }],
              },
            }),
            signal: abortSignal,
          },
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
