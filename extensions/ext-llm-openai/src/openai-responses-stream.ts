import { parseSseChunk, readRecord } from "veryfront/provider/shared";

type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningTokens?: number;
};

type OpenAIResponsesStreamReasoningState = {
  id: string;
  emittedStart: boolean;
};

type OpenAIResponsesStreamFunctionCallState = {
  id: string;
  toolCallId: string;
  name: string;
  arguments: string;
};

/**
 * The Responses API uses `input_tokens` / `output_tokens` field names
 * instead of Chat Completions' `prompt_tokens` / `completion_tokens`.
 */
export function extractOpenAIResponsesUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  // Streaming usage lives on response.completed inside `response.usage`;
  // non-streaming has it at the top level.
  const responseRecord = readRecord(record?.response);
  const usage = readRecord(responseRecord?.usage) ?? readRecord(record?.usage);
  if (!usage) return undefined;

  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  const totalTokens = typeof usage.total_tokens === "number"
    ? usage.total_tokens
    : (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  const inputDetails = readRecord(usage.input_tokens_details);
  const cachedTokens = inputDetails?.cached_tokens;
  const outputDetails = readRecord(usage.output_tokens_details);
  const reasoningTokens = outputDetails?.reasoning_tokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(typeof cachedTokens === "number" ? { cacheReadInputTokens: cachedTokens } : {}),
    ...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
  };
}

export function normalizeOpenAIResponsesFinishReason(
  raw: unknown,
): string | { unified: string; raw: string } | null {
  if (typeof raw !== "string") return null;
  switch (raw) {
    case "completed":
      return { unified: "stop", raw };
    case "incomplete":
      return { unified: "length", raw };
    case "failed":
      return { unified: "error", raw };
    case "in_progress":
      return null;
    default:
      return raw;
  }
}

/**
 * Parse the Responses API streaming event grammar into the same UI part
 * shapes the existing OpenAI / Anthropic / Google streams emit.
 */
export async function* streamOpenAIResponsesParts(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const reasoningBlocks = new Map<string, OpenAIResponsesStreamReasoningState>();
  const functionCalls = new Map<string, OpenAIResponsesStreamFunctionCallState>();
  const startedToolCalls = new Set<string>();
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: RuntimeUsage | undefined;
  let reasoningCounter = 0;

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      if (event === "[DONE]") continue;
      const record = readRecord(event);
      const type = typeof record?.type === "string" ? record.type : undefined;
      if (!type) continue;

      // response.output_item.added: a new output item begins.
      if (type === "response.output_item.added") {
        const item = readRecord(record?.item);
        const itemType = typeof item?.type === "string" ? item.type : undefined;
        const itemId = typeof item?.id === "string" ? item.id : undefined;
        if (itemType === "function_call" && itemId) {
          const callId = typeof item?.call_id === "string" ? item.call_id : itemId;
          const name = typeof item?.name === "string" ? item.name : "";
          functionCalls.set(itemId, {
            id: itemId,
            toolCallId: callId,
            name,
            arguments: "",
          });
        }
        if (itemType === "reasoning" && itemId) {
          reasoningBlocks.set(itemId, {
            id: `reasoning-${reasoningCounter++}`,
            emittedStart: false,
          });
        }
        continue;
      }

      // response.output_text.delta: text chunk for a message item.
      if (type === "response.output_text.delta" && typeof record?.delta === "string") {
        if (record.delta.length > 0) {
          yield { type: "text-delta", delta: record.delta };
        }
        continue;
      }

      // response.reasoning_summary_text.delta: reasoning summary text chunk.
      if (type === "response.reasoning_summary_text.delta" && typeof record?.delta === "string") {
        const itemId = typeof record?.item_id === "string" ? record.item_id : undefined;
        const state = itemId ? reasoningBlocks.get(itemId) : undefined;
        if (state && record.delta.length > 0) {
          if (!state.emittedStart) {
            yield { type: "reasoning-start", id: state.id };
            state.emittedStart = true;
          }
          yield { type: "reasoning-delta", id: state.id, delta: record.delta };
        }
        continue;
      }

      // response.function_call_arguments.delta: tool call argument chunk.
      if (type === "response.function_call_arguments.delta" && typeof record?.delta === "string") {
        const itemId = typeof record?.item_id === "string" ? record.item_id : undefined;
        const state = itemId ? functionCalls.get(itemId) : undefined;
        if (state && record.delta.length > 0) {
          if (!startedToolCalls.has(state.id)) {
            yield {
              type: "tool-input-start",
              id: state.toolCallId,
              toolName: state.name,
            };
            startedToolCalls.add(state.id);
          }
          state.arguments += record.delta;
          yield {
            type: "tool-input-delta",
            id: state.toolCallId,
            delta: record.delta,
          };
        }
        continue;
      }

      // response.output_item.done: an item has finished emitting deltas.
      if (type === "response.output_item.done") {
        const item = readRecord(record?.item);
        const itemType = typeof item?.type === "string" ? item.type : undefined;
        const itemId = typeof item?.id === "string" ? item.id : undefined;
        if (itemType === "reasoning" && itemId) {
          const state = reasoningBlocks.get(itemId);
          if (state?.emittedStart) {
            yield { type: "reasoning-end", id: state.id };
          }
          reasoningBlocks.delete(itemId);
        }
        if (itemType === "function_call" && itemId) {
          const state = functionCalls.get(itemId);
          if (state) {
            yield {
              type: "tool-call",
              toolCallId: state.toolCallId,
              toolName: state.name,
              input: state.arguments,
            };
          }
          functionCalls.delete(itemId);
        }
        continue;
      }

      // response.completed: terminal event with the final response object.
      if (type === "response.completed") {
        usage = extractOpenAIResponsesUsage(record) ?? usage;
        const responseRecord = readRecord(record?.response);
        finishReason = normalizeOpenAIResponsesFinishReason(responseRecord?.status);
        continue;
      }

      if (type === "response.failed" || type === "response.incomplete") {
        const responseRecord = readRecord(record?.response);
        finishReason = normalizeOpenAIResponsesFinishReason(responseRecord?.status) ??
          (type === "response.failed"
            ? { unified: "error", raw: "failed" }
            : { unified: "length", raw: "incomplete" });
        usage = extractOpenAIResponsesUsage(record) ?? usage;
        continue;
      }
    }
  }

  // Close any reasoning streams still open at end-of-stream (defensive).
  for (const state of reasoningBlocks.values()) {
    if (state.emittedStart) {
      yield { type: "reasoning-end", id: state.id };
    }
  }

  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
  };
}
