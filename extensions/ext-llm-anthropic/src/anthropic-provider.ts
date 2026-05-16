/**
 * Anthropic provider - implements the {@link LLMProvider} contract for
 * Anthropic's Messages API (direct + via Veryfront Cloud / Bedrock-compatible
 * proxies).
 *
 * Ported from `src/provider/runtime-loader.ts` as part of PR 12.
 *
 * @module extensions/ext-llm-anthropic/anthropic-provider
 */

import type { LLMProvider, LLMProviderConfig } from "veryfront/extensions/llm";
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
  readRecord,
  requestJson,
  requestStream,
  stringifyJsonValue,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
} from "veryfront/provider/shared";
import {
  buildAnthropicMessagesRequest,
  type OpenAICompatibleLanguageOptions,
} from "./anthropic-request-builder.ts";

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

type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

// ---------------------------------------------------------------------------
// Anthropic-specific types
// ---------------------------------------------------------------------------

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
 * content_block_location citation kinds - see
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

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";

  createModel(modelId: string, config: LLMProviderConfig): ModelRuntime {
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
