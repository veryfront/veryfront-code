import {
  parseFinalSseChunk,
  parseSseChunk,
  ProviderRequestError,
  readRecord,
  type RuntimeUsage,
  stringifyJsonValue,
} from "veryfront/provider/shared";

function invalidGoogleStream(issue: string): ProviderRequestError {
  return new ProviderRequestError({
    provider: "google",
    status: 200,
    message: `google request failed: invalid successful stream (${issue})`,
    retryable: false,
  });
}

function parseGoogleSseBuffer(
  buffer: string,
  trailing = false,
): ReturnType<typeof parseSseChunk> {
  try {
    return trailing ? parseFinalSseChunk(buffer) : parseSseChunk(buffer);
  } catch {
    throw invalidGoogleStream(
      trailing ? "trailing SSE event was malformed" : "SSE event framing was malformed",
    );
  }
}

export function normalizeGoogleFinishReason(
  raw: unknown,
): string | { unified: string; raw: string } | null {
  if (typeof raw !== "string") {
    return null;
  }

  switch (raw) {
    case "STOP":
      return { unified: "stop", raw };
    case "MAX_TOKENS":
      return { unified: "length", raw };
    case "SAFETY":
    case "RECITATION":
      return { unified: "content-filter", raw };
    default:
      return raw.toLowerCase();
  }
}

export function extractGoogleUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usageMetadata);
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.promptTokenCount;
  const outputTokens = usage.candidatesTokenCount;
  const totalTokens = usage.totalTokenCount;
  const cachedContentTokenCount = usage.cachedContentTokenCount;
  const thoughtsTokenCount = usage.thoughtsTokenCount;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof totalTokens === "number" ? totalTokens : undefined,
    ...(typeof cachedContentTokenCount === "number"
      ? { cacheReadInputTokens: cachedContentTokenCount }
      : {}),
    ...(typeof thoughtsTokenCount === "number" ? { reasoningTokens: thoughtsTokenCount } : {}),
  };
}

export function extractFirstGoogleCandidate(payload: unknown): Record<string, unknown> | undefined {
  const record = readRecord(payload);
  const candidates = record?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return undefined;
  }

  return readRecord(candidates[0]);
}

export function extractGoogleCandidateParts(payload: unknown): Array<Record<string, unknown>> {
  const candidate = extractFirstGoogleCandidate(payload);
  const content = readRecord(candidate?.content);
  const parts = content?.parts;
  if (!Array.isArray(parts)) {
    return [];
  }

  return parts.flatMap((part) => {
    const record = readRecord(part);
    return record ? [record] : [];
  });
}

export async function* streamGoogleCompatibleParts(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const seenToolCalls = new Set<string>();
  let reasoningId: string | null = null;
  let reasoningIndex = 0;
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: RuntimeUsage | undefined;

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const parsed = parseGoogleSseBuffer(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      if (event === "[DONE]") {
        continue;
      }

      usage = extractGoogleUsage(event) ?? usage;
      const candidate = extractFirstGoogleCandidate(event);
      const normalizedFinishReason = normalizeGoogleFinishReason(candidate?.finishReason);
      if (normalizedFinishReason) {
        finishReason = normalizedFinishReason;
      }

      for (const [index, part] of extractGoogleCandidateParts(event).entries()) {
        const isThought = part.thought === true;
        if (isThought && typeof part.text === "string" && part.text.length > 0) {
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
            delta: part.text,
          };
          continue;
        }

        if (reasoningId) {
          yield {
            type: "reasoning-end",
            id: reasoningId,
          };
          reasoningId = null;
        }

        if (typeof part.text === "string" && part.text.length > 0) {
          yield { type: "text-delta", delta: part.text };
          continue;
        }

        const functionCall = readRecord(part.functionCall);
        if (typeof functionCall?.name !== "string") {
          continue;
        }

        const toolCallId = typeof functionCall.id === "string" ? functionCall.id : `tool-${index}`;
        if (seenToolCalls.has(toolCallId)) {
          continue;
        }

        const serializedInput = stringifyJsonValue(functionCall.args ?? {});
        seenToolCalls.add(toolCallId);
        yield {
          type: "tool-input-start",
          id: toolCallId,
          toolName: functionCall.name,
        };
        yield {
          type: "tool-input-delta",
          id: toolCallId,
          delta: serializedInput,
        };
        yield {
          type: "tool-call",
          toolCallId,
          toolName: functionCall.name,
          input: serializedInput,
        };
      }
    }
  }

  if (buffer.trim().length > 0) {
    const parsed = parseGoogleSseBuffer(buffer, true);
    for (const event of parsed.events) {
      if (event === "[DONE]") {
        continue;
      }
      usage = extractGoogleUsage(event) ?? usage;
    }
  }

  if (reasoningId) {
    yield {
      type: "reasoning-end",
      id: reasoningId,
    };
  }

  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
  };
}
