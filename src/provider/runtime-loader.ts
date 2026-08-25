import { isNumberArray } from "./runtime-loader/provider-embedding-responses.ts";
import { createError, toError } from "#veryfront/errors";
import {
  mergeUsage,
  readGatewayBillingMode,
  type RuntimeUsage,
} from "./runtime-loader/provider-usage.ts";
import type { ProviderKind } from "./runtime-loader/provider-http.ts";
import type { ModelRuntimePromptMessage, ModelRuntimeToolDefinition } from "./types.ts";
import {
  buildProviderError,
  DEFAULT_PROVIDER_STREAM_HEADERS_TIMEOUT_MS,
  DEFAULT_PROVIDER_STREAM_TOTAL_HEADERS_BUDGET_MS,
  parseRetryAfterMs,
  requestJson,
  requestStream,
  waitForProviderStreamRetry,
} from "./runtime-loader/provider-http.ts";
import { readRecord } from "./runtime-loader/provider-records.ts";
import {
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
} from "./runtime-loader/tool-input-status.ts";
import { snapshotProviderJsonValue } from "./runtime-loader/json-snapshot.ts";

export {
  jsonValuesEqual,
  snapshotJsonValue,
  snapshotProviderJsonValue,
} from "./runtime-loader/json-snapshot.ts";
export type { JsonSnapshotOptions, JsonSnapshotValue } from "./runtime-loader/json-snapshot.ts";
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
  DEFAULT_PROVIDER_STREAM_HEADERS_TIMEOUT_MS,
  DEFAULT_PROVIDER_STREAM_TOTAL_HEADERS_BUDGET_MS,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  readGatewayBillingMode,
  readRecord,
  requestJson,
  requestStream,
  waitForProviderStreamRetry,
};
export type { RuntimePromptMessage } from "./types.ts";
export type { RuntimeUsage };
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
type RuntimePromptUserContent = Extract<
  ModelRuntimePromptMessage,
  { readonly role: "user" }
>["content"];
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
      return list.splice(0, list.length);
    },
  };
}

/** Serialize a JSON-compatible value. */
export function stringifyJsonValue(value: unknown): string {
  try {
    const serialized = JSON.stringify(
      snapshotProviderJsonValue(value, {
        sortObjectKeys: false,
        dropUndefinedMembers: true,
      }),
    );
    if (serialized === undefined) {
      throw new TypeError("value has no JSON representation");
    }
    return serialized;
  } catch {
    // Native JSON errors can include object paths or property names from the
    // rejected tool payload. Keep provider-boundary failures contextual
    // without retaining caller-controlled diagnostics as a public cause.
    throw new TypeError("Provider tool value must be JSON-serializable");
  }
}

/** Preserve provider-native argument text while serializing structured tool inputs. */
export function stringifyToolArguments(value: unknown): string {
  return typeof value === "string" ? value : stringifyJsonValue(value);
}

/** Preserve text tool results while serializing structured tool results. */
export function stringifyToolResultValue(value: unknown): string {
  // Same serialization contract as tool arguments — delegate so the two
  // cannot drift.
  return stringifyToolArguments(value);
}

/** Read text content parts from provider messages. */
export function readTextParts(
  parts: readonly { type: string; text?: string }[],
): string {
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

function incompatibleProviderReplayError(subject: "calls" | "results"): TypeError {
  return toError(
    createError({
      type: "config",
      message:
        `OpenAI-compatible provider-executed assistant tool ${subject} cannot be replayed through Chat Completions`,
    }),
    TypeError,
  );
}

/**
 * Convert runtime prompt messages into OpenAI-compatible chat messages.
 * Adjacent non-empty system layers become one ordered instruction so strict
 * Chat Completions providers receive a compatible message sequence.
 */
export function toOpenAICompatibleMessages(
  prompt: readonly ModelRuntimePromptMessage[],
): OpenAICompatibleChatMessage[] {
  const messages: OpenAICompatibleChatMessage[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system": {
        if (message.content.trim().length === 0) {
          break;
        }
        const previous = messages.at(-1);
        if (previous?.role === "system") {
          previous.content = `${previous.content}\n\n${message.content}`;
        } else {
          messages.push({ role: "system", content: message.content });
        }
        break;
      }
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
          if (part.type === "tool-result") {
            throw incompatibleProviderReplayError("results");
          }
          if (part.providerExecuted === true) {
            throw incompatibleProviderReplayError("calls");
          }

          toolCalls.push({
            id: part.toolCallId,
            type: "function",
            function: {
              name: part.toolName,
              arguments: stringifyToolArguments(part.input),
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
            content: stringifyToolResultValue(part.output.value),
          });
        }
        break;
    }
  }

  return messages;
}

/** Convert runtime tool definitions into OpenAI-compatible function tools. */
export function toOpenAICompatibleTools(
  tools: readonly ModelRuntimeToolDefinition[] | undefined,
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

  const merged = new Map<string, unknown>();
  for (const key of providerNames) {
    let ownsKey: boolean;
    let value: unknown;
    try {
      ownsKey = Object.hasOwn(providerOptions, key);
      if (!ownsKey) continue;
      value = Reflect.get(providerOptions, key);
    } catch {
      throw new TypeError(`Provider options for "${key}" could not be read`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    let entries: Array<[string, unknown]>;
    try {
      entries = Object.entries(value);
    } catch {
      throw new TypeError(`Provider options for "${key}" could not be enumerated`);
    }
    for (const [optionName, optionValue] of entries) {
      merged.set(optionName, optionValue);
    }
  }

  return Object.fromEntries(merged);
}

/** Zod schema for unwrap tool input. */
export function unwrapToolInputSchema(inputSchema: unknown): unknown {
  if (typeof inputSchema !== "object" || inputSchema === null || Array.isArray(inputSchema)) {
    return inputSchema;
  }

  let candidate: unknown;
  try {
    candidate = Reflect.get(inputSchema, "jsonSchema");
  } catch {
    throw new TypeError("Tool input schema jsonSchema property could not be read");
  }
  return candidate ?? inputSchema;
}
