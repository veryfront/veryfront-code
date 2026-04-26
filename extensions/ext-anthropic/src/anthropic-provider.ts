/**
 * Anthropic provider — implements the {@link AIProvider} contract for
 * Anthropic's Messages API (direct + via Veryfront Cloud / Bedrock-compatible
 * proxies).
 *
 * Ported from `src/provider/runtime-loader.ts` as part of PR 12.
 *
 * @module extensions/ext-anthropic/anthropic-provider
 */

import type { AIProvider, AIProviderConfig } from "veryfront/extensions/interfaces";
import type { ModelRuntime } from "veryfront/provider/types";
import {
  buildProviderError,
  createAnthropicRequestInit,
  createWarningCollector,
  getAnthropicMessagesUrl,
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
import type { RuntimePromptMessage } from "veryfront/provider/shared";

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

export interface AnthropicRuntimeConfig {
  apiKey?: string;
  authToken?: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Internal types (mirrored from runtime-loader.ts)
// ---------------------------------------------------------------------------

type ProviderCacheTtl = boolean | "5m" | "1h";

type ProviderCacheControlOption = {
  system?: ProviderCacheTtl;
  tools?: ProviderCacheTtl;
};

type ProviderReasoningEffort = "low" | "medium" | "high" | "max";

type ProviderReasoningOption = {
  enabled?: boolean;
  effort?: ProviderReasoningEffort;
  budgetTokens?: number;
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
  cacheControl?: ProviderCacheControlOption;
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

type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

type WarningCollector = ReturnType<typeof createWarningCollector>;

// ---------------------------------------------------------------------------
// Anthropic-specific types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Anthropic helper functions
// ---------------------------------------------------------------------------

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
        init: createAnthropicRequestInit({
          apiKey: config.apiKey,
          authToken: config.authToken,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
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
        init: createAnthropicRequestInit({
          apiKey: config.apiKey,
          authToken: config.authToken,
          extraHeaders: options.headers,
          enableFineGrainedToolStreaming: true,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((responseStream) => {
        const drained = warnings.drain();
        return {
          stream: ReadableStream.from(
            withToolInputStatusTransitions(streamAnthropicCompatibleParts(responseStream)),
          ),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
  };
}

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createAnthropicModelRuntime(
      {
        apiKey: config.credential,
        authToken: typeof config.authToken === "string" ? config.authToken : undefined,
        baseURL: config.baseURL,
        name: config.name ?? "anthropic",
        fetch: config.fetch,
      },
      modelId,
    );
  }
}
