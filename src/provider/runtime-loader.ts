import { isNumberArray } from "./runtime-loader/provider-embedding-responses.ts";
import {
  mergeUsage,
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
type WarningCollector = {
  push(warning: ProviderWarning): void;
  drain(): ProviderWarning[];
};

/** Create warning collector. */
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

/** Serialize a JSON-compatible value. */
export function stringifyJsonValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

/** Read text content parts from provider messages. */
export function readTextParts(parts: Array<{ type: string; text?: string }>): string {
  let text = "";
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      text += part.text;
    }
  }
  return text;
}

function toOpenAICompatibleUserContent(
  parts: RuntimePromptUserContent,
): OpenAICompatibleUserContent {
  if (!parts.some((part) => part.type !== "text" && part.mediaType.startsWith("image/"))) {
    return readTextParts(parts);
  }

  const content: Exclude<OpenAICompatibleUserContent, string> = [];

  for (const part of parts) {
    if (part.type === "text") {
      if (part.text.length > 0) {
        content.push({ type: "text", text: part.text });
      }
      continue;
    }
    if (part.type === "image" || part.mediaType.startsWith("image/")) {
      content.push({ type: "image_url", image_url: { url: part.url } });
    }
  }

  return content.length > 0 ? content : readTextParts(parts);
}

/** Convert runtime prompt messages into OpenAI-compatible chat messages. */
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
        messages.push({ role: "user", content: toOpenAICompatibleUserContent(message.content) });
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

/** Convert runtime tool definitions into OpenAI-compatible function tools. */
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

/** Options accepted by read provider. */
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

/** Zod schema for unwrap tool input. */
export function unwrapToolInputSchema(inputSchema: unknown): unknown {
  if (typeof inputSchema !== "object" || inputSchema === null || Array.isArray(inputSchema)) {
    return inputSchema;
  }

  const candidate = Reflect.get(inputSchema, "jsonSchema");
  return candidate ?? inputSchema;
}
