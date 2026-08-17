import {
  mergeUsage,
  ProviderRequestError,
  readGatewayBillingMode,
  readRecord,
} from "veryfront/provider/shared";
import type { RuntimeUsage } from "veryfront/provider/shared";
import {
  appendOpenAIStreamToolArgument,
  isJsonObjectText,
  joinOpenAIStreamToolArguments,
  MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES,
  MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS,
  type OpenAIStreamToolArgumentBudget,
} from "./openai-tool-input.ts";
import {
  isBoundedOpenAIStreamString,
  MAX_OPENAI_STREAM_CONTENT_PARTS,
  MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
  MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
} from "./openai-stream-metadata.ts";
import {
  appendOpenAISseChunk,
  finishOpenAISseDecoding,
  parseOpenAISseBuffer,
} from "./openai-sse-buffer.ts";

type OpenAICompatibleProviderKind = "openai" | "mistral" | "moonshotai";

type OpenAIChatStreamContext = {
  providerKind?: OpenAICompatibleProviderKind;
  providerLabel?: string;
};

type OpenAIStreamToolCallState = {
  id: string;
  name: string;
  argumentChunks: string[];
  started: boolean;
};

export const MAX_OPENAI_STREAM_TOOL_CALLS = 1_024;

function invalidOpenAIStream(
  context: OpenAIChatStreamContext,
  issue: string,
): ProviderRequestError {
  const providerKind = context.providerKind ?? "openai";
  return new ProviderRequestError({
    provider: providerKind,
    status: 200,
    message: `${
      context.providerLabel ?? providerKind
    } request failed: invalid successful stream (${issue})`,
    retryable: false,
  });
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
  const completionTokensDetails = readRecord(usage.completion_tokens_details);
  const reasoningTokens = completionTokensDetails?.reasoning_tokens;
  const veryfront = readRecord(usage.veryfront);
  const costSource = veryfront?.cost_source;
  const billingMode = readGatewayBillingMode(veryfront?.billing_mode);
  const usageCaptureStatus = veryfront?.usage_capture_status;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof totalTokens === "number" ? totalTokens : undefined,
    ...(typeof cachedTokens === "number" ? { cacheReadInputTokens: cachedTokens } : {}),
    ...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
    ...(typeof veryfront?.billable_input_tokens === "number"
      ? { billableInputTokens: veryfront.billable_input_tokens }
      : {}),
    ...(typeof veryfront?.billable_output_tokens === "number"
      ? { billableOutputTokens: veryfront.billable_output_tokens }
      : {}),
    ...(typeof veryfront?.cost_usd === "number" ? { costUsd: veryfront.cost_usd } : {}),
    ...(typeof veryfront?.provider_input_cost_usd === "number"
      ? { providerInputCostUsd: veryfront.provider_input_cost_usd }
      : {}),
    ...(typeof veryfront?.provider_output_cost_usd === "number"
      ? { providerOutputCostUsd: veryfront.provider_output_cost_usd }
      : {}),
    ...(typeof veryfront?.provider_cost_usd === "number"
      ? { providerCostUsd: veryfront.provider_cost_usd }
      : {}),
    ...(typeof veryfront?.veryfront_input_charge_usd === "number"
      ? { veryfrontInputChargeUsd: veryfront.veryfront_input_charge_usd }
      : {}),
    ...(typeof veryfront?.veryfront_output_charge_usd === "number"
      ? { veryfrontOutputChargeUsd: veryfront.veryfront_output_charge_usd }
      : {}),
    ...(typeof veryfront?.veryfront_charge_usd === "number"
      ? { veryfrontChargeUsd: veryfront.veryfront_charge_usd }
      : {}),
    ...(typeof veryfront?.veryfront_billed_usd === "number"
      ? { veryfrontBilledUsd: veryfront.veryfront_billed_usd }
      : {}),
    ...(typeof veryfront?.cost_credits === "number" ? { costCredits: veryfront.cost_credits } : {}),
    ...(costSource === "gateway" || costSource === "missing" || costSource === "partial"
      ? { costSource }
      : {}),
    ...(billingMode !== undefined ? { billingMode } : {}),
    ...(usageCaptureStatus === "complete" ||
        usageCaptureStatus === "missing" ||
        usageCaptureStatus === "partial"
      ? { usageCaptureStatus }
      : {}),
  };
}

function mergeOpenAIUsage(
  current: RuntimeUsage | undefined,
  payload: unknown,
): RuntimeUsage | undefined {
  const merged = mergeUsage(current, extractOpenAIUsage(payload));
  return merged && Object.keys(merged).length > 0 ? merged : undefined;
}

function extractOpenAIContentText(
  content: unknown,
  context: OpenAIChatStreamContext,
): string {
  if (content === undefined || content === null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    throw invalidOpenAIStream(context, "choice delta content had an invalid type");
  }
  if (content.length > MAX_OPENAI_STREAM_CONTENT_PARTS) {
    throw invalidOpenAIStream(
      context,
      `choice delta content exceeded ${MAX_OPENAI_STREAM_CONTENT_PARTS} parts`,
    );
  }

  const textParts: string[] = [];
  for (const part of content) {
    const record = readRecord(part);
    if (!record) {
      throw invalidOpenAIStream(context, "choice delta content part was not an object");
    }
    if (record.type === "text") {
      if (typeof record.text !== "string") {
        throw invalidOpenAIStream(context, "choice delta text part was malformed");
      }
      textParts.push(record.text);
    } else if (record.type === "refusal") {
      if (typeof record.refusal !== "string") {
        throw invalidOpenAIStream(context, "choice delta refusal part was malformed");
      }
      textParts.push(record.refusal);
    } else {
      throw invalidOpenAIStream(context, "choice delta content part type was unsupported");
    }
  }
  return textParts.join("");
}

function assertCompleteToolInput(
  toolCall: OpenAIStreamToolCallState,
  context: OpenAIChatStreamContext,
): string {
  const argumentsText = joinOpenAIStreamToolArguments(toolCall.argumentChunks);
  if (!toolCall.started || !toolCall.id || !toolCall.name || !argumentsText) {
    throw invalidOpenAIStream(context, "tool call was incomplete");
  }
  if (!isJsonObjectText(argumentsText)) {
    throw invalidOpenAIStream(context, "tool call arguments were not valid JSON object text");
  }
  return argumentsText;
}

function isToolCallsFinishReason(
  value: string | { unified: string; raw: string } | null,
): boolean {
  return typeof value === "object" && value?.unified === "tool-calls";
}

export async function* streamOpenAICompatibleParts(
  stream: ReadableStream<Uint8Array>,
  context: OpenAIChatStreamContext = {},
): AsyncIterable<unknown> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  const toolCalls = new Map<number, OpenAIStreamToolCallState>();
  const toolCallIndicesById = new Map<string, number>();
  let reasoningId: string | null = null;
  let reasoningIndex = 0;
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: RuntimeUsage | undefined;
  let sawChoiceEnvelope = false;
  let sawFinishReason = false;
  let sawDone = false;
  const toolArgumentBudget: OpenAIStreamToolArgumentBudget = {
    bytes: 0,
    fragments: 0,
  };

  function* processEvent(event: unknown | "[DONE]"): Generator<unknown> {
    if (event === "[DONE]") {
      if (sawDone) {
        throw invalidOpenAIStream(context, "stream contained multiple done markers");
      }
      if (!sawFinishReason) {
        throw invalidOpenAIStream(context, "done marker arrived before a finish reason");
      }
      sawDone = true;
      return;
    }
    if (sawDone) {
      throw invalidOpenAIStream(context, "stream contained data after its done marker");
    }

    const record = readRecord(event);
    if (!record) {
      throw invalidOpenAIStream(context, "event was not an object");
    }
    const usageRecord = readRecord(record.usage);
    usage = mergeOpenAIUsage(usage, record);

    if (record.choices === undefined) {
      if (!usageRecord) {
        throw invalidOpenAIStream(context, "event had neither choices nor usage");
      }
      return;
    }
    if (!Array.isArray(record.choices)) {
      throw invalidOpenAIStream(context, "choices was not an array");
    }
    if (record.choices.length === 0) {
      if (!usageRecord) {
        throw invalidOpenAIStream(context, "empty choices event had no usage");
      }
      return;
    }
    if (sawFinishReason) {
      throw invalidOpenAIStream(context, "stream contained choice data after its finish reason");
    }

    const choice = readRecord(record.choices[0]);
    if (!choice) {
      throw invalidOpenAIStream(context, "first choice was not an object");
    }
    sawChoiceEnvelope = true;

    if (
      choice.finish_reason !== undefined &&
      choice.finish_reason !== null &&
      (typeof choice.finish_reason !== "string" || choice.finish_reason.length === 0)
    ) {
      throw invalidOpenAIStream(context, "choice finish reason was malformed");
    }

    let delta: Record<string, unknown>;
    if (choice.delta === undefined || choice.delta === null) {
      if (typeof choice.finish_reason !== "string") {
        throw invalidOpenAIStream(context, "choice had neither a delta nor a finish reason");
      }
      delta = {};
    } else {
      const deltaRecord = readRecord(choice.delta);
      if (!deltaRecord) {
        throw invalidOpenAIStream(context, "choice delta was not an object");
      }
      delta = deltaRecord;
    }

    // Optional delta fields are `null` rather than absent on many
    // OpenAI-compatible gateways (Moonshot/Kimi sends `reasoning_content: null`
    // on both the opening and the finish chunk). Treat `null` as "not present
    // on this chunk", matching how `content`, `refusal`, `tool_calls`, and
    // `finish_reason` are already handled below.
    if (
      delta.role !== undefined && delta.role !== null &&
      delta.role !== "assistant"
    ) {
      throw invalidOpenAIStream(context, "choice delta role was not assistant");
    }
    if (
      delta.reasoning_content !== undefined && delta.reasoning_content !== null &&
      typeof delta.reasoning_content !== "string"
    ) {
      throw invalidOpenAIStream(context, "reasoning delta was malformed");
    }
    if (
      typeof delta.reasoning_content === "string" &&
      delta.reasoning_content.length > 0
    ) {
      if (!reasoningId) {
        reasoningId = `reasoning-${reasoningIndex++}`;
        yield { type: "reasoning-start", id: reasoningId };
      }
      yield {
        type: "reasoning-delta",
        id: reasoningId,
        delta: delta.reasoning_content,
      };
    }

    const refusal = delta.refusal;
    if (refusal !== undefined && refusal !== null && typeof refusal !== "string") {
      throw invalidOpenAIStream(context, "refusal delta was malformed");
    }
    const textDelta = extractOpenAIContentText(delta.content, context) +
      (typeof refusal === "string" ? refusal : "");
    if (textDelta.length > 0) {
      if (reasoningId) {
        yield { type: "reasoning-end", id: reasoningId };
        reasoningId = null;
      }
      yield { type: "text-delta", delta: textDelta };
    }

    if (
      delta.tool_calls !== undefined &&
      delta.tool_calls !== null &&
      !Array.isArray(delta.tool_calls)
    ) {
      throw invalidOpenAIStream(context, "tool_calls delta was not an array");
    }
    const rawToolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const rawToolCall of rawToolCalls) {
      if (reasoningId) {
        yield { type: "reasoning-end", id: reasoningId };
        reasoningId = null;
      }

      const toolCallRecord = readRecord(rawToolCall);
      if (!toolCallRecord) {
        throw invalidOpenAIStream(context, "tool call delta was not an object");
      }
      const index = toolCallRecord.index;
      if (!Number.isSafeInteger(index) || (index as number) < 0) {
        throw invalidOpenAIStream(context, "tool call index was malformed");
      }
      const toolCallIndex = index as number;
      // As with the reasoning delta above, gateways repeat `id`, `type`, and
      // `function.name` as `null` on continuation fragments instead of omitting
      // them; only the opening fragment carries real values. Treat `null` as
      // absent so the fragment merges into the call already being assembled.
      if (
        toolCallRecord.id !== undefined && toolCallRecord.id !== null &&
        !isBoundedOpenAIStreamString(
          toolCallRecord.id,
          MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
        )
      ) {
        throw invalidOpenAIStream(context, "tool call id was malformed");
      }
      if (
        toolCallRecord.type !== undefined && toolCallRecord.type !== null &&
        toolCallRecord.type !== "function"
      ) {
        throw invalidOpenAIStream(context, "tool call type was not function");
      }
      const existingToolCall = toolCalls.get(toolCallIndex);
      if (!existingToolCall && toolCalls.size >= MAX_OPENAI_STREAM_TOOL_CALLS) {
        throw invalidOpenAIStream(
          context,
          `stream exceeded ${MAX_OPENAI_STREAM_TOOL_CALLS} tool calls`,
        );
      }
      const current = existingToolCall ?? {
        id: "",
        name: "",
        argumentChunks: [],
        started: false,
      };
      if (typeof toolCallRecord.id === "string") {
        const existingIndex = toolCallIndicesById.get(toolCallRecord.id);
        if (existingIndex !== undefined && existingIndex !== toolCallIndex) {
          throw invalidOpenAIStream(context, "tool call id was reused at another index");
        }
        if (current.id && current.id !== toolCallRecord.id) {
          throw invalidOpenAIStream(context, "tool call id changed while streaming");
        }
        current.id = toolCallRecord.id;
        toolCallIndicesById.set(toolCallRecord.id, toolCallIndex);
      }

      if (toolCallRecord.function !== undefined && toolCallRecord.function !== null) {
        const fn = readRecord(toolCallRecord.function);
        if (!fn) {
          throw invalidOpenAIStream(context, "tool call function was not an object");
        }
        if (
          fn.name !== undefined && fn.name !== null &&
          !isBoundedOpenAIStreamString(fn.name, MAX_OPENAI_STREAM_TOOL_NAME_BYTES)
        ) {
          throw invalidOpenAIStream(context, "tool call function name was malformed");
        }
        if (typeof fn.name === "string") {
          if (current.name && current.name !== fn.name) {
            throw invalidOpenAIStream(context, "tool call function name changed while streaming");
          }
          current.name = fn.name;
        }

        if (!current.started && current.id && current.name) {
          current.started = true;
          yield {
            type: "tool-input-start",
            id: current.id,
            toolName: current.name,
          };
        }

        if (
          fn.arguments !== undefined && fn.arguments !== null &&
          typeof fn.arguments !== "string"
        ) {
          throw invalidOpenAIStream(context, "tool call arguments delta was malformed");
        }
        if (typeof fn.arguments === "string") {
          if (!current.started) {
            throw invalidOpenAIStream(
              context,
              "tool call arguments arrived before its id and name",
            );
          }
          const limit = appendOpenAIStreamToolArgument(
            toolArgumentBudget,
            current.argumentChunks,
            fn.arguments,
          );
          if (limit === "bytes") {
            throw invalidOpenAIStream(
              context,
              `tool call arguments exceeded ${MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES} UTF-8 bytes`,
            );
          }
          if (limit === "fragments") {
            throw invalidOpenAIStream(
              context,
              `tool call arguments exceeded ${MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS} fragments`,
            );
          }
          if (fn.arguments.length > 0) {
            yield {
              type: "tool-input-delta",
              id: current.id,
              delta: fn.arguments,
            };
          }
        }
      }

      toolCalls.set(toolCallIndex, current);
    }

    if (typeof choice.finish_reason === "string") {
      finishReason = normalizeOpenAIFinishReason(choice.finish_reason);
      sawFinishReason = true;
    }
  }

  for await (const chunk of stream) {
    buffer = appendOpenAISseChunk(
      decoder,
      buffer,
      chunk,
      (issue) => invalidOpenAIStream(context, issue),
    );
    const parsed = parseOpenAISseBuffer(
      buffer,
      (issue) => invalidOpenAIStream(context, issue),
    );
    buffer = parsed.remainder;
    for (const event of parsed.events) {
      yield* processEvent(event);
    }
  }

  buffer = finishOpenAISseDecoding(
    decoder,
    buffer,
    (issue) => invalidOpenAIStream(context, issue),
  );
  if (buffer.trim().length > 0) {
    const parsed = parseOpenAISseBuffer(
      buffer,
      (issue) => invalidOpenAIStream(context, issue),
      true,
    );
    for (const event of parsed.events) {
      yield* processEvent(event);
    }
  }

  if (!sawChoiceEnvelope) {
    throw invalidOpenAIStream(context, "stream contained no choice envelope");
  }
  if (!sawFinishReason) {
    throw invalidOpenAIStream(context, "stream ended before a finish reason");
  }

  if (reasoningId) {
    yield { type: "reasoning-end", id: reasoningId };
  }

  const finishedWithToolCalls = isToolCallsFinishReason(finishReason);
  if (finishedWithToolCalls) {
    if (toolCalls.size === 0) {
      throw invalidOpenAIStream(context, "tool-call finish contained no tool calls");
    }
    for (const toolCall of toolCalls.values()) {
      const input = assertCompleteToolInput(toolCall, context);
      yield {
        type: "tool-call",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input,
      };
    }
  } else if (toolCalls.size > 0) {
    throw invalidOpenAIStream(context, "stream ended with unfinished tool calls");
  }

  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
  };
}
