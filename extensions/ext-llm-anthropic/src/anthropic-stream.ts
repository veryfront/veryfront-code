import {
  mergeUsage,
  parseSseChunk,
  readRecord,
  stringifyJsonValue,
} from "veryfront/provider/shared";

type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
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

export function normalizeAnthropicFinishReason(
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

export function extractAnthropicUsage(payload: unknown): RuntimeUsage | undefined {
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

export async function* streamAnthropicCompatibleParts(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCalls = new Map<number, AnthropicStreamToolCallState>();
  const reasoningBlocks = new Map<number, AnthropicStreamReasoningState>();
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: RuntimeUsage | undefined;
  let completedClientToolUseStep = false;

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
        if (!current.providerExecuted) {
          completedClientToolUseStep = true;
        }
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

    if (completedClientToolUseStep && toolCalls.size === 0) {
      yield {
        type: "finish",
        finishReason: { unified: "tool-calls", raw: "tool_use" },
        ...(usage ? { usage } : {}),
      };
      return;
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
