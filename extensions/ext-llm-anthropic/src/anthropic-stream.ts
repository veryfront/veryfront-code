import {
  mergeUsage,
  parseSseChunk,
  readGatewayBillingMode,
  readRecord,
  stringifyJsonValue,
} from "veryfront/provider/shared";
import type { RuntimeUsage } from "veryfront/provider/shared";

type AnthropicStreamToolCallState = {
  id: string;
  name: string;
  input: string;
  providerExecuted?: boolean;
};

type AnthropicStreamReasoningState = {
  id: string;
  text: string;
  signature?: string;
  redactedData?: string;
};

type AnthropicStreamOptions = {
  clientToolUseTrailingUsageGraceMs?: number;
  clientToolUseTrailingUsageTimeoutMode?: "cancel" | "drain";
  clientToolUseTrailingUsageDrainTimeoutMs?: number;
};

type AnthropicStreamReadResult =
  | { kind: "chunk"; chunk: Uint8Array }
  | { kind: "done" }
  | { kind: "timeout"; readerMode: "cancel" | "drain" };

const CLIENT_TOOL_USE_FINISH_REASON = { unified: "tool-calls", raw: "tool_use" } as const;
const DEFAULT_CLIENT_TOOL_USE_TRAILING_USAGE_GRACE_MS = 100;
const DEFAULT_CLIENT_TOOL_USE_TRAILING_USAGE_DRAIN_TIMEOUT_MS = 15_000;

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0,
  );
}

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
  const veryfront = readRecord(usage.veryfront);
  const costSource = veryfront?.cost_source;
  const billingMode = readGatewayBillingMode(veryfront?.billing_mode);
  const usageCaptureStatus = veryfront?.usage_capture_status;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof inputTokens === "number" || typeof outputTokens === "number"
      ? (typeof inputTokens === "number" ? inputTokens : 0) +
        (typeof outputTokens === "number" ? outputTokens : 0)
      : undefined,
    ...(typeof cacheCreationInputTokens === "number" ? { cacheCreationInputTokens } : {}),
    ...(typeof cacheReadInputTokens === "number" ? { cacheReadInputTokens } : {}),
    ...(typeof veryfront?.billable_input_tokens === "number"
      ? { billableInputTokens: veryfront.billable_input_tokens }
      : {}),
    ...(typeof veryfront?.billable_output_tokens === "number"
      ? { billableOutputTokens: veryfront.billable_output_tokens }
      : {}),
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

function isToolCallsFinishReason(
  finishReason: string | { unified: string; raw: string } | null,
): boolean {
  return finishReason === "tool-calls" ||
    (typeof finishReason === "object" && finishReason?.unified === "tool-calls");
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs?: number,
  timeoutMode: "cancel" | "drain" = "cancel",
  drainTimeoutMs = DEFAULT_CLIENT_TOOL_USE_TRAILING_USAGE_DRAIN_TIMEOUT_MS,
): Promise<AnthropicStreamReadResult> {
  if (timeoutMs === undefined) {
    const read = await reader.read();
    return read.done ? { kind: "done" } : { kind: "chunk", chunk: read.value };
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const readPromise = reader.read().then((read): AnthropicStreamReadResult =>
    read.done ? { kind: "done" } : { kind: "chunk", chunk: read.value }
  );
  const timeoutPromise = new Promise<AnthropicStreamReadResult>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({ kind: "timeout", readerMode: timeoutMode }),
      Math.max(1, timeoutMs),
    );
  });

  try {
    const result = await Promise.race([readPromise, timeoutPromise]);
    if (result.kind === "timeout") {
      if (timeoutMode === "drain") {
        void drainStreamReaderAfterTimeout(reader, readPromise, drainTimeoutMs);
      } else {
        await cancelStreamReader(
          reader,
          "Timed out waiting for trailing Anthropic tool-use usage metadata",
        );
      }
    }
    return result;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function cancelStreamReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: string,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // The upstream body may already be closed or canceled by the runtime.
  }
}

async function drainStreamReaderAfterTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  pendingRead: Promise<AnthropicStreamReadResult>,
  timeoutMs: number,
): Promise<void> {
  const timeoutId = setTimeout(() => {
    void cancelStreamReader(
      reader,
      "Timed out draining trailing Anthropic tool-use usage metadata",
    );
  }, Math.max(1, timeoutMs));

  try {
    const firstRead = await pendingRead;
    if (firstRead.kind === "done") {
      return;
    }

    while (true) {
      const read = await reader.read();
      if (read.done) {
        return;
      }
    }
  } catch {
    // The caller has already emitted a finish event; late drain failures should
    // not fail the completed tool turn.
  } finally {
    clearTimeout(timeoutId);
    reader.releaseLock();
  }
}

export async function* streamAnthropicCompatibleParts(
  stream: ReadableStream<Uint8Array>,
  options: AnthropicStreamOptions = {},
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  const trailingUsageGraceMs = options.clientToolUseTrailingUsageGraceMs ??
    DEFAULT_CLIENT_TOOL_USE_TRAILING_USAGE_GRACE_MS;
  const trailingUsageTimeoutMode = options.clientToolUseTrailingUsageTimeoutMode ?? "cancel";
  const trailingUsageDrainTimeoutMs = options.clientToolUseTrailingUsageDrainTimeoutMs ??
    DEFAULT_CLIENT_TOOL_USE_TRAILING_USAGE_DRAIN_TIMEOUT_MS;
  let readerReleased = false;
  let buffer = "";
  const toolCalls = new Map<number, AnthropicStreamToolCallState>();
  const reasoningBlocks = new Map<number, AnthropicStreamReasoningState>();
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: RuntimeUsage | undefined;
  let completedClientToolUseStep = false;
  let clientToolUseIdleDeadlineMs: number | null = null;
  let clientToolUseTerminalDeadlineMs: number | null = null;

  const mergeTrailingBufferUsage = () => {
    if (buffer.trim().length === 0) {
      return;
    }

    const parsed = parseSseChunk(`${buffer}\n\n`);
    buffer = parsed.remainder;
    for (const event of parsed.events) {
      if (event === "[DONE]") {
        continue;
      }
      const record = readRecord(event);
      usage = mergeUsage(usage, extractAnthropicUsage(record));
    }
  };

  const getClientToolUseReadTimeoutMs = () => {
    if (!completedClientToolUseStep || toolCalls.size > 0) {
      return undefined;
    }

    const deadline = isToolCallsFinishReason(finishReason)
      ? clientToolUseTerminalDeadlineMs
      : clientToolUseIdleDeadlineMs;
    return deadline === null ? undefined : Math.max(1, deadline - Date.now());
  };

  const buildFinishPart = () => ({
    type: "finish",
    finishReason: finishReason ??
      (completedClientToolUseStep ? CLIENT_TOOL_USE_FINISH_REASON : null),
    ...(usage ? { usage } : {}),
  });

  try {
    while (true) {
      const read = await readStreamChunk(
        reader,
        getClientToolUseReadTimeoutMs(),
        trailingUsageTimeoutMode,
        trailingUsageDrainTimeoutMs,
      );
      if (read.kind === "timeout") {
        readerReleased = read.readerMode === "drain";
        mergeTrailingBufferUsage();
        finishReason ??= CLIENT_TOOL_USE_FINISH_REASON;
        yield buildFinishPart();
        return;
      }

      if (read.kind === "done") {
        break;
      }

      buffer += decoder.decode(read.chunk, { stream: true });
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
            reasoningBlocks.set(index, { id: reasoningId, text: "" });
            yield {
              type: "reasoning-start",
              id: reasoningId,
            };

            if (typeof contentBlock?.thinking === "string" && contentBlock.thinking.length > 0) {
              const current = reasoningBlocks.get(index);
              if (current) {
                current.text += contentBlock.thinking;
              }
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
            reasoningBlocks.set(index, {
              id: reasoningId,
              text: "",
              ...(typeof contentBlock?.data === "string"
                ? { redactedData: contentBlock.data }
                : {}),
            });
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
            clientToolUseIdleDeadlineMs = null;
            clientToolUseTerminalDeadlineMs = null;
            yield {
              type: "tool-input-start",
              id: current.id,
              toolName: current.name,
              ...(providerExecuted ? { providerExecuted } : {}),
            };

            const initialInput = contentBlock.input;
            if (initialInput !== undefined && !isEmptyRecord(initialInput)) {
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

            current.text += delta.thinking;
            yield {
              type: "reasoning-delta",
              id: current.id,
              delta: delta.thinking,
            };
            continue;
          }

          if (deltaType === "signature_delta" && typeof delta?.signature === "string") {
            const current = reasoningBlocks.get(index);
            if (current) {
              current.signature = delta.signature;
            }
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
              ...(reasoning.signature ? { signature: reasoning.signature } : {}),
              ...(reasoning.redactedData ? { redactedData: reasoning.redactedData } : {}),
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
            clientToolUseIdleDeadlineMs = null;
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
        if (isToolCallsFinishReason(finishReason)) {
          clientToolUseIdleDeadlineMs = null;
          clientToolUseTerminalDeadlineMs ??= Date.now() + trailingUsageGraceMs;
        } else {
          clientToolUseIdleDeadlineMs ??= Date.now() + trailingUsageGraceMs;
        }
      }
    }
  } finally {
    if (!readerReleased) {
      reader.releaseLock();
    }
  }

  mergeTrailingBufferUsage();

  yield buildFinishPart();
}
