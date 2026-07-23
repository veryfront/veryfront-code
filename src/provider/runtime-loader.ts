import {
  extractGoogleEmbedding,
  extractGoogleUsageTokens,
  extractOpenAIEmbeddings,
  extractOpenAIUsageTokens,
  isNumberArray,
} from "./runtime-loader/provider-embedding-responses.ts";
import {
  extractAnthropicUsage,
  extractGoogleUsage,
  extractOpenAIResponsesUsage,
  extractOpenAIUsage,
  mergeUsage,
  normalizeRuntimeUsage,
  readGatewayBillingMode,
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
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import {
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
} from "./runtime-loader/tool-input-status.ts";

const MAX_PROVIDER_CONTENT_PARTS = 4_096;
const MAX_PROVIDER_MESSAGES = 1_024;
const MAX_PROVIDER_TEXT_CHARACTERS = 8 * 1_024 * 1_024;
const MAX_PROVIDER_TOOLS = 128;
const MAX_TOOL_CALL_ID_CHARACTERS = 1_024;
const MAX_TOOL_NAME_CHARACTERS = 256;

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
  extractAnthropicUsage,
  extractGoogleEmbedding,
  extractGoogleUsage,
  extractGoogleUsageTokens,
  extractOpenAIEmbeddings,
  extractOpenAIResponsesUsage,
  extractOpenAIUsage,
  extractOpenAIUsageTokens,
  isNumberArray,
  mergeUsage,
  normalizeRuntimeUsage,
  parseRetryAfterMs,
  readGatewayBillingMode,
  readRecord,
  requestJson,
  requestStream,
};
export type { RuntimeUsage };

/** Message shape for runtime prompt. */
export type RuntimePromptMessage =
  | { role: "system"; content: string }
  | {
    role: "user";
    content: Array<
      | { type: "text"; text: string }
      | { type: "image" | "file"; mediaType: string; url: string; filename?: string }
    >;
  }
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
/** Tool definition accepted by the shared provider request builders. */
export type RuntimeToolDefinition =
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
 * `topK`, `presencePenalty`, `frequencyPenalty`) - silently dropping
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
   *  - `default` - standard processing (default if unset)
   *  - `flex` - lower-priority queue, lower per-token cost, longer
   *    expected latency. Useful for batchy or non-interactive workloads.
   *  - `scale` - reserved-capacity tier with strict latency SLOs.
   *  - `auto` - let OpenAI pick.
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
   *  - `{ type: "text" }` - the default (no constraint).
   *  - `{ type: "json" }` - emits OpenAI's `response_format:
   *    { type: "json_object" }` to force the model to return valid JSON.
   *  - `{ type: "json_schema", name, schema, strict? }` - emits
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
   * The shape varies - string container id or a structured object
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
/** Message shape for OpenAI-compatible chat requests. */
export type OpenAICompatibleChatMessage =
  | { role: "system"; content: string }
  | {
    role: "user";
    content:
      | string
      | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
  }
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
type RuntimePromptUserContent = Extract<RuntimePromptMessage, { role: "user" }>["content"];
type OpenAICompatibleUserContent = Extract<
  OpenAICompatibleChatMessage,
  { role: "user" }
>["content"];
/** Request payload for OpenAI-compatible chat completion providers. */
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
/** Bounded collector for warnings produced while translating a request. */
export type WarningCollector = {
  push(warning: ProviderWarning): void;
  drain(): ProviderWarning[];
};

/** Create warning collector. */
export function createWarningCollector(): WarningCollector {
  const list: ProviderWarning[] = [];
  return {
    push(warning) {
      if (list.length >= 128) {
        throw new RangeError("Provider warning limit exceeded");
      }
      list.push(warning);
    },
    drain() {
      return list.splice(0, list.length);
    },
  };
}

/** Serialize a JSON-compatible value. */
export function stringifyJsonValue(value: unknown): string {
  if (typeof value === "string") {
    if (value.length > MAX_PROVIDER_TEXT_CHARACTERS) {
      throw new RangeError("Provider JSON value exceeded the supported size");
    }
    return value;
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    throw new TypeError("Provider tool value must be JSON serializable");
  }
  if (serialized.length > MAX_PROVIDER_TEXT_CHARACTERS) {
    throw new RangeError("Provider JSON value exceeded the supported size");
  }
  return serialized;
}

/** Read text content parts from provider messages. */
export function readTextParts(parts: Array<{ type: string; text?: string }>): string {
  return readTextPartRecords(readContentPartRecords(parts));
}

function readContentPartRecords(parts: unknown): Record<string, unknown>[] {
  if (!Array.isArray(parts) || parts.length > MAX_PROVIDER_CONTENT_PARTS) {
    throw new RangeError("Provider message contains too many content parts");
  }
  return parts.map((part) => {
    const record = readRecord(part);
    if (!record || typeof record.type !== "string") {
      throw new TypeError("Provider message contains an invalid content part");
    }
    return record;
  });
}

function readTextPartRecords(parts: Record<string, unknown>[]): string {
  const chunks: string[] = [];
  let totalLength = 0;
  for (const part of parts) {
    if (part.type === "text") {
      if (typeof part.text !== "string") {
        throw new TypeError("Provider text content part is invalid");
      }
      totalLength += part.text.length;
      if (totalLength > MAX_PROVIDER_TEXT_CHARACTERS) {
        throw new RangeError("Provider message text exceeded the supported size");
      }
      chunks.push(part.text);
    }
  }
  return chunks.join("");
}

function assertBoundedString(
  value: unknown,
  label: string,
  maximum: number,
): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > maximum ||
    hasUnsafeControlCharacters(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
}

function assertSafeProviderMediaUrl(value: string): void {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_PROVIDER_TEXT_CHARACTERS
  ) {
    throw new TypeError("Provider image URL is invalid");
  }
  if (value.startsWith("data:")) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Provider image URL is invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username ||
    parsed.password
  ) {
    throw new TypeError("Provider image URL is invalid");
  }
}

function toOpenAICompatibleUserContent(
  parts: unknown,
  consumeCharacters: (value: string) => void,
): OpenAICompatibleUserContent {
  const partRecords = readContentPartRecords(parts);
  const textContent = readTextPartRecords(partRecords);
  consumeCharacters(textContent);
  let containsImage = false;
  for (const part of partRecords) {
    if (part.type === "text") continue;
    if (
      (part.type !== "image" && part.type !== "file") ||
      typeof part.mediaType !== "string" || typeof part.url !== "string"
    ) {
      throw new TypeError("Provider message contains an invalid content part");
    }
    if (part.type === "file" && !part.mediaType.startsWith("image/")) {
      throw new TypeError("Provider chat prompt contains an unsupported non-image file");
    }
    containsImage = true;
  }
  if (!containsImage) {
    return textContent;
  }

  const content: Exclude<OpenAICompatibleUserContent, string> = [];

  for (const part of partRecords) {
    if (part.type === "text") {
      if (typeof part.text === "string" && part.text.length > 0) {
        content.push({ type: "text", text: part.text });
      }
      continue;
    }
    if (
      (part.type === "image" || part.type === "file") &&
      typeof part.url === "string"
    ) {
      assertSafeProviderMediaUrl(part.url);
      consumeCharacters(part.url);
      content.push({ type: "image_url", image_url: { url: part.url } });
    }
  }

  return content.length > 0 ? content : textContent;
}

/** Convert runtime prompt messages into OpenAI-compatible chat messages. */
export function toOpenAICompatibleMessages(
  prompt: RuntimePromptMessage[],
): OpenAICompatibleChatMessage[] {
  if (!Array.isArray(prompt) || prompt.length > MAX_PROVIDER_MESSAGES) {
    throw new RangeError("Provider prompt must contain at most 1024 messages");
  }
  if (prompt.length === 0) {
    throw new RangeError("Provider prompt must contain at least one message");
  }
  const messages: OpenAICompatibleChatMessage[] = [];
  let totalCharacters = 0;
  let totalContentParts = 0;

  const consumeCharacters = (value: string): void => {
    totalCharacters += value.length;
    if (totalCharacters > MAX_PROVIDER_TEXT_CHARACTERS) {
      throw new RangeError("Provider prompt exceeded the supported size");
    }
  };

  const consumeContentParts = (parts: unknown[]): void => {
    totalContentParts += parts.length;
    if (totalContentParts > MAX_PROVIDER_CONTENT_PARTS) {
      throw new RangeError("Provider prompt contains too many content parts");
    }
  };

  for (const messageValue of prompt) {
    const message = readRecord(messageValue);
    if (!message) {
      throw new TypeError("Provider prompt contains an invalid message");
    }
    switch (message.role) {
      case "system":
        if (
          typeof message.content !== "string" ||
          message.content.length > MAX_PROVIDER_TEXT_CHARACTERS
        ) {
          throw new RangeError("Provider message text exceeded the supported size");
        }
        consumeCharacters(message.content);
        messages.push({ role: "system", content: message.content });
        break;
      case "user": {
        if (!Array.isArray(message.content)) {
          throw new TypeError("Provider user message content must be an array");
        }
        consumeContentParts(message.content);
        messages.push({
          role: "user",
          content: toOpenAICompatibleUserContent(message.content, consumeCharacters),
        });
        break;
      }
      case "assistant": {
        if (!Array.isArray(message.content)) {
          throw new TypeError("Provider assistant message content must be an array");
        }
        consumeContentParts(message.content);
        const contentParts = readContentPartRecords(message.content);
        const text = readTextPartRecords(contentParts);
        consumeCharacters(text);
        const toolCalls: NonNullable<
          Extract<OpenAICompatibleChatMessage, { role: "assistant" }>["tool_calls"]
        > = [];

        for (const part of contentParts) {
          if (part.type === "text") {
            continue;
          }
          // OpenAI Chat Completions has no roundtrip slot for Anthropic
          // thinking blocks - they get dropped on replay. Anthropic-only.
          if (part.type === "reasoning") {
            continue;
          }

          if (part.type !== "tool-call") {
            throw new TypeError("Provider assistant message contains an invalid content part");
          }
          assertBoundedString(
            part.toolCallId,
            "Provider tool call ID",
            MAX_TOOL_CALL_ID_CHARACTERS,
          );
          assertBoundedString(part.toolName, "Provider tool name", MAX_TOOL_NAME_CHARACTERS);
          const input = stringifyJsonValue(part.input);
          consumeCharacters(part.toolCallId);
          consumeCharacters(part.toolName);
          consumeCharacters(input);

          toolCalls.push({
            id: part.toolCallId,
            type: "function",
            function: {
              name: part.toolName,
              arguments: input,
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
      case "tool": {
        if (!Array.isArray(message.content)) {
          throw new TypeError("Provider tool message content must be an array");
        }
        consumeContentParts(message.content);
        const contentParts = readContentPartRecords(message.content);
        for (const part of contentParts) {
          const outputRecord = readRecord(part.output);
          if (part.type !== "tool-result" || outputRecord?.type !== "json") {
            throw new TypeError("Provider tool message contains an invalid content part");
          }
          assertBoundedString(
            part.toolCallId,
            "Provider tool call ID",
            MAX_TOOL_CALL_ID_CHARACTERS,
          );
          const output = stringifyJsonValue(outputRecord.value);
          consumeCharacters(part.toolCallId);
          consumeCharacters(output);
          messages.push({
            role: "tool",
            tool_call_id: part.toolCallId,
            content: output,
          });
        }
        break;
      }
      default:
        throw new TypeError("Provider prompt contains an invalid role");
    }
  }

  return messages;
}

/** Convert runtime tool definitions into OpenAI-compatible function tools. */
export function toOpenAICompatibleTools(
  tools: RuntimeToolDefinition[] | undefined,
): OpenAICompatibleChatRequest["tools"] | undefined {
  if (!tools) {
    return undefined;
  }
  if (!Array.isArray(tools) || tools.length > MAX_PROVIDER_TOOLS) {
    throw new RangeError(`Provider request must contain at most ${MAX_PROVIDER_TOOLS} tools`);
  }

  const functions: NonNullable<OpenAICompatibleChatRequest["tools"]> = [];
  for (const toolValue of tools) {
    const tool = readRecord(toolValue);
    if (!tool) {
      throw new TypeError("Provider tool definition is invalid");
    }
    if (tool.type === "provider") continue;
    if (tool.type !== "function") {
      throw new TypeError("Provider tool definition is invalid");
    }
    assertBoundedString(tool.name, "Provider tool name", MAX_TOOL_NAME_CHARACTERS);
    if (
      tool.description !== undefined &&
      (typeof tool.description !== "string" ||
        tool.description.length > MAX_PROVIDER_TEXT_CHARACTERS)
    ) {
      throw new TypeError("Provider tool description is invalid");
    }
    functions.push({
      type: "function",
      function: {
        name: tool.name,
        parameters: unwrapToolInputSchema(tool.inputSchema),
        ...(tool.description !== undefined ? { description: tool.description } : {}),
      },
    });
  }

  return functions.length > 0 ? functions : undefined;
}

/** Options accepted by read provider. */
export function readProviderOptions(
  providerOptions: Record<string, unknown> | undefined,
  ...providerNames: string[]
): Record<string, unknown> {
  if (!providerOptions) {
    return {};
  }

  const optionsRecord = readRecord(providerOptions);
  if (!optionsRecord) return {};

  const merged: Record<string, unknown> = {};
  for (const key of providerNames) {
    const value = optionsRecord[key];
    const record = readRecord(value);
    if (record) {
      for (const [field, fieldValue] of Object.entries(record)) {
        Object.defineProperty(merged, field, {
          configurable: true,
          enumerable: true,
          value: fieldValue,
          writable: true,
        });
      }
    }
  }

  return merged;
}

/** Zod schema for unwrap tool input. */
export function unwrapToolInputSchema(inputSchema: unknown): unknown {
  if (typeof inputSchema !== "object" || inputSchema === null || Array.isArray(inputSchema)) {
    return inputSchema;
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(inputSchema, "jsonSchema");
  } catch {
    return inputSchema;
  }
  return descriptor && "value" in descriptor && descriptor.value !== undefined
    ? descriptor.value
    : inputSchema;
}
