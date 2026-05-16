import { parseSseChunk, readRecord } from "veryfront/provider/shared";

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

type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

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

export async function* streamOpenAICompatibleParts(
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
