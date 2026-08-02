import {
  mergeUsage,
  parseFinalSseChunk,
  parseSseChunk,
  ProviderRequestError,
  readRecord,
  type RuntimeUsage,
  stringifyJsonValue,
} from "veryfront/provider/shared";
import {
  createGoogleToolCallCorrelationRegistry,
  GOOGLE_CODE_EXECUTION_TOOL_NAME,
  googleCodeExecutionInput,
  googleCodeExecutionOutput,
  readGoogleCodeExecutionResult,
  readGoogleExecutableCode,
  readGooglePartDataField,
} from "./google-content-parts.ts";
import { mergeGoogleGroundingMetadata } from "./google-grounding-metadata.ts";
import {
  createGoogleProviderMetadata,
  MAX_GOOGLE_PROVIDER_METADATA_BYTES,
  readGoogleThoughtSignature,
} from "./google-thought-signatures.ts";

export const MAX_GOOGLE_SSE_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_GOOGLE_SSE_BUFFER_CODE_UNITS = 8 * 1024 * 1024;
export const MAX_GOOGLE_RETAINED_STATE_BYTES = MAX_GOOGLE_PROVIDER_METADATA_BYTES;
export const MAX_GOOGLE_RETAINED_STATE_ITEMS = 8_192;
const GOOGLE_RETAINED_STATE_ENCODER = new TextEncoder();

const GOOGLE_CONTENT_FILTER_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
  "ESCALATION",
]);

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
    default:
      if (GOOGLE_CONTENT_FILTER_FINISH_REASONS.has(raw)) {
        return { unified: "content-filter", raw };
      }
      return raw.toLowerCase();
  }
}

export function extractGoogleUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usageMetadata);
  if (!usage) {
    return undefined;
  }

  const readTokenCount = (value: unknown): number | undefined =>
    typeof value === "number" &&
      Number.isFinite(value) &&
      Number.isSafeInteger(value) &&
      value >= 0
      ? value
      : undefined;
  const inputTokens = readTokenCount(usage.promptTokenCount);
  const outputTokens = readTokenCount(usage.candidatesTokenCount);
  const totalTokens = readTokenCount(usage.totalTokenCount);
  const cacheReadInputTokens = readTokenCount(usage.cachedContentTokenCount);
  const reasoningTokens = readTokenCount(usage.thoughtsTokenCount);
  const normalized: RuntimeUsage = {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };

  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
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

type GoogleStreamContext = {
  providerLabel?: string;
};

function invalidGoogleStream(
  context: GoogleStreamContext,
  issue: string,
): ProviderRequestError {
  return new ProviderRequestError({
    provider: "google",
    status: 200,
    message: `${
      context.providerLabel ?? "google"
    } request failed: invalid successful stream (${issue})`,
    retryable: false,
  });
}

function mergeGoogleUsage(
  current: RuntimeUsage | undefined,
  payload: unknown,
): RuntimeUsage | undefined {
  const merged = mergeUsage(current, extractGoogleUsage(payload));
  return merged && Object.keys(merged).length > 0 ? merged : undefined;
}

function isContentFilterFinishReason(
  value: string | { unified: string; raw: string } | null,
): boolean {
  return typeof value === "object" && value?.unified === "content-filter";
}

export async function* streamGoogleCompatibleParts(
  stream: ReadableStream<Uint8Array>,
  context: GoogleStreamContext = {},
): AsyncIterable<unknown> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  const seenToolCalls = new Map<
    string,
    {
      callShape: string;
      rawPartIndex: number;
      thoughtSignature?: string;
    }
  >();
  const seenCodeExecutions = new Map<
    string,
    {
      callShape: string;
      rawPartIndex: number;
      thoughtSignature?: string;
    }
  >();
  const seenCodeExecutionResults = new Map<
    string,
    {
      resultShape: string;
      rawPartIndex: number;
      thoughtSignature?: string;
    }
  >();
  const pendingAnonymousCodeExecutions: Array<{
    callShape: string;
    rawPartIndex: number;
    thoughtSignature?: string;
  }> = [];
  const toolCallRegistry = createGoogleToolCallCorrelationRegistry();
  const rawAssistantParts: Array<Record<string, unknown>> = [];
  let retainedStateBytes = 0;
  let retainedStateItems = 0;
  let reasoningId: string | null = null;
  let reasoningSignature: string | undefined;
  let reasoningIndex = 0;
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: RuntimeUsage | undefined;
  let groundingMetadata: Record<string, unknown> | undefined;
  let sawCandidateEnvelope = false;
  let sawOutput = false;
  let sawFinishReason = false;
  let sawDone = false;

  const reserveRetainedItem = (issue: string): void => {
    if (retainedStateItems >= MAX_GOOGLE_RETAINED_STATE_ITEMS) {
      throw invalidGoogleStream(
        context,
        `retained state exceeded ${MAX_GOOGLE_RETAINED_STATE_ITEMS} items (${issue})`,
      );
    }
    retainedStateItems++;
  };

  const reserveRetainedBytes = (value: string, issue: string): void => {
    const bytes = GOOGLE_RETAINED_STATE_ENCODER.encode(value).byteLength;
    if (bytes > MAX_GOOGLE_RETAINED_STATE_BYTES - retainedStateBytes) {
      throw invalidGoogleStream(
        context,
        `retained state exceeded ${MAX_GOOGLE_RETAINED_STATE_BYTES} UTF-8 bytes (${issue})`,
      );
    }
    retainedStateBytes += bytes;
  };

  const retainRawAssistantPart = (part: Record<string, unknown>): number => {
    let serialized: string;
    try {
      serialized = stringifyJsonValue(part);
    } catch {
      throw invalidGoogleStream(context, "candidate part could not be retained safely");
    }
    reserveRetainedItem("raw candidate part");
    reserveRetainedBytes(serialized, "raw candidate part");
    return rawAssistantParts.push(part) - 1;
  };

  const reserveCorrelation = (issue: string, ...values: string[]): void => {
    reserveRetainedItem(issue);
    for (const value of values) reserveRetainedBytes(value, issue);
  };

  const mergeReplaySignature = (
    prior: { rawPartIndex: number; thoughtSignature?: string },
    thoughtSignature: string | undefined,
    changedIssue: string,
  ): void => {
    if (
      thoughtSignature !== undefined &&
      prior.thoughtSignature !== undefined &&
      thoughtSignature !== prior.thoughtSignature
    ) {
      throw invalidGoogleStream(context, changedIssue);
    }
    if (thoughtSignature !== undefined && prior.thoughtSignature === undefined) {
      const previousRawPart = rawAssistantParts[prior.rawPartIndex];
      if (!previousRawPart) {
        throw invalidGoogleStream(context, "candidate replay history was inconsistent");
      }
      reserveRetainedBytes(thoughtSignature, "replayed thought signature");
      previousRawPart.thoughtSignature = thoughtSignature;
      prior.thoughtSignature = thoughtSignature;
    }
  };

  function* processEvent(event: unknown | "[DONE]"): Generator<unknown> {
    if (event === "[DONE]") {
      if (sawDone) {
        throw invalidGoogleStream(context, "stream contained duplicate [DONE] markers");
      }
      sawDone = true;
      return;
    }
    if (sawDone) {
      throw invalidGoogleStream(context, "event appeared after [DONE]");
    }
    const record = readRecord(event);
    if (!record) {
      throw invalidGoogleStream(context, "event was not an object");
    }
    const usageRecord = readRecord(record.usageMetadata);
    usage = mergeGoogleUsage(usage, record);

    const promptFeedback = readRecord(record.promptFeedback);
    const promptBlockReason = promptFeedback?.blockReason;
    if (
      promptBlockReason !== undefined &&
      (typeof promptBlockReason !== "string" || promptBlockReason.length === 0)
    ) {
      throw invalidGoogleStream(context, "prompt block reason was malformed");
    }
    if (typeof promptBlockReason === "string") {
      if (sawFinishReason || sawDone) {
        throw invalidGoogleStream(context, "stream contained duplicate terminal reasons");
      }
      finishReason = { unified: "content-filter", raw: promptBlockReason };
      sawCandidateEnvelope = true;
      sawFinishReason = true;
    }

    if (record.candidates === undefined) {
      if (!usageRecord && typeof promptBlockReason !== "string") {
        throw invalidGoogleStream(context, "event had neither candidates nor usage");
      }
      return;
    }
    if (!Array.isArray(record.candidates)) {
      throw invalidGoogleStream(context, "candidates was not an array");
    }
    if (record.candidates.length === 0) {
      if (!usageRecord && typeof promptBlockReason !== "string") {
        throw invalidGoogleStream(context, "empty candidates event had no usage or block reason");
      }
      return;
    }
    if (record.candidates.length !== 1) {
      throw invalidGoogleStream(context, "event contained multiple candidates");
    }
    if (typeof promptBlockReason === "string") {
      throw invalidGoogleStream(context, "blocked event also contained a candidate");
    }
    const candidate = readRecord(record.candidates[0]);
    if (!candidate) {
      throw invalidGoogleStream(context, "first candidate was not an object");
    }
    if (sawFinishReason || sawDone) {
      const issue = typeof candidate.finishReason === "string"
        ? "stream contained duplicate terminal reasons"
        : "candidate appeared after a terminal marker";
      throw invalidGoogleStream(context, issue);
    }
    sawCandidateEnvelope = true;
    if (candidate.groundingMetadata !== undefined) {
      try {
        groundingMetadata = mergeGoogleGroundingMetadata(
          groundingMetadata,
          candidate.groundingMetadata,
        );
      } catch {
        throw invalidGoogleStream(context, "candidate grounding metadata was malformed");
      }
    }
    if (
      candidate.finishReason !== undefined &&
      (typeof candidate.finishReason !== "string" || candidate.finishReason.length === 0)
    ) {
      throw invalidGoogleStream(context, "candidate finish reason was malformed");
    }
    const candidateFinishReason = typeof candidate.finishReason === "string"
      ? candidate.finishReason
      : undefined;

    let parts: unknown[] = [];
    if (candidate.content !== undefined) {
      const content = readRecord(candidate.content);
      if (!content) {
        throw invalidGoogleStream(context, "candidate content was not an object");
      }
      if (content.parts !== undefined && !Array.isArray(content.parts)) {
        throw invalidGoogleStream(context, "candidate content parts was not an array");
      }
      parts = Array.isArray(content.parts) ? content.parts : [];
    } else if (candidateFinishReason === undefined) {
      throw invalidGoogleStream(context, "candidate had neither content nor a finish reason");
    }

    for (const [candidatePartIndex, rawPart] of parts.entries()) {
      const part = readRecord(rawPart);
      if (!part) {
        throw invalidGoogleStream(context, "candidate content part was not an object");
      }
      if (part.thought !== undefined && typeof part.thought !== "boolean") {
        throw invalidGoogleStream(context, "candidate thought marker was malformed");
      }
      let thoughtSignature: string | undefined;
      try {
        thoughtSignature = readGoogleThoughtSignature(part);
      } catch {
        throw invalidGoogleStream(context, "candidate thought signature was malformed");
      }
      let dataField: ReturnType<typeof readGooglePartDataField>;
      try {
        dataField = readGooglePartDataField(part);
      } catch (error) {
        const issue = error instanceof Error &&
            (error.message.includes("unsupported") || error.message.includes("unknown"))
          ? "candidate part contained an unsupported data field"
          : "candidate part contained multiple data fields";
        throw invalidGoogleStream(context, issue);
      }

      const partText = dataField === "text" && typeof part.text === "string"
        ? part.text
        : undefined;
      if (dataField === "text" && partText === undefined) {
        throw invalidGoogleStream(context, "candidate text part was malformed");
      }
      if (dataField === "text") {
        retainRawAssistantPart(part);
      }

      if (partText !== undefined && part.thought === true) {
        if (
          reasoningId &&
          thoughtSignature !== undefined &&
          reasoningSignature !== undefined &&
          thoughtSignature !== reasoningSignature
        ) {
          yield {
            type: "reasoning-end",
            id: reasoningId,
            signature: reasoningSignature,
          };
          reasoningId = null;
          reasoningSignature = undefined;
        }
        if (!reasoningId && (partText.length > 0 || thoughtSignature !== undefined)) {
          reasoningId = `reasoning-${reasoningIndex++}`;
          yield { type: "reasoning-start", id: reasoningId };
        }
        if (thoughtSignature !== undefined) {
          reasoningSignature = thoughtSignature;
        }
        if (reasoningId) {
          sawOutput = true;
          if (partText.length > 0) {
            yield {
              type: "reasoning-delta",
              id: reasoningId,
              delta: partText,
            };
          }
        }
        continue;
      }

      if (reasoningId) {
        yield {
          type: "reasoning-end",
          id: reasoningId,
          ...(reasoningSignature !== undefined ? { signature: reasoningSignature } : {}),
        };
        reasoningId = null;
        reasoningSignature = undefined;
      }

      if (partText !== undefined) {
        if (partText.length > 0) {
          sawOutput = true;
          yield { type: "text-delta", delta: partText };
        }
        continue;
      }

      if (dataField === "functionCall") {
        const functionCall = readRecord(part.functionCall);
        if (
          !functionCall ||
          typeof functionCall.name !== "string" ||
          functionCall.name.length === 0
        ) {
          throw invalidGoogleStream(context, "candidate function call was malformed");
        }
        if (
          functionCall.id !== undefined &&
          (typeof functionCall.id !== "string" || functionCall.id.length === 0)
        ) {
          throw invalidGoogleStream(context, "candidate function call id was malformed");
        }
        // Gemini omits `args` entirely for zero-parameter tool calls.
        const functionCallArgs = functionCall.args === undefined
          ? {}
          : readRecord(functionCall.args);
        if (!functionCallArgs) {
          throw invalidGoogleStream(
            context,
            "candidate function call arguments were not an object",
          );
        }

        let serializedInput: string;
        try {
          serializedInput = stringifyJsonValue(functionCallArgs);
        } catch {
          throw invalidGoogleStream(context, "candidate function call arguments were malformed");
        }
        const providerId = typeof functionCall.id === "string" ? functionCall.id : undefined;
        const rawPartIndex = rawAssistantParts.length;
        // Gemini may replay an anonymous function call in later candidate
        // envelopes. Its candidate-part position is stable across those
        // cumulative snapshots; our growing retained-output index is not.
        const deduplicationKey = providerId ?? `anonymous-${candidatePartIndex}`;
        const callShape = `${functionCall.name}\u0000${serializedInput}`;
        const previousToolCall = seenToolCalls.get(deduplicationKey);
        if (previousToolCall !== undefined) {
          if (previousToolCall.callShape !== callShape) {
            throw invalidGoogleStream(context, "candidate function call changed after emission");
          }
          mergeReplaySignature(
            previousToolCall,
            thoughtSignature,
            "candidate function call thought signature changed after emission",
          );
          continue;
        }

        let toolCallId: string;
        try {
          toolCallId = toolCallRegistry.registerFunctionCall(rawPartIndex, providerId);
        } catch {
          throw invalidGoogleStream(context, "candidate tool call id was duplicated");
        }
        retainRawAssistantPart(part);
        reserveCorrelation(
          "function-call correlation",
          deduplicationKey,
          callShape,
          ...(thoughtSignature === undefined ? [] : [thoughtSignature]),
        );
        seenToolCalls.set(deduplicationKey, {
          callShape,
          rawPartIndex,
          ...(thoughtSignature !== undefined ? { thoughtSignature } : {}),
        });

        sawOutput = true;
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
        continue;
      }

      if (dataField === "executableCode") {
        let executableCode: ReturnType<typeof readGoogleExecutableCode>;
        try {
          executableCode = readGoogleExecutableCode(part.executableCode);
        } catch {
          throw invalidGoogleStream(context, "candidate executable code was malformed");
        }
        const serializedInput = stringifyJsonValue(googleCodeExecutionInput(executableCode));
        const callShape = serializedInput;
        let toolCallId: string;

        if (executableCode.providerId !== undefined) {
          const prior = seenCodeExecutions.get(executableCode.providerId);
          if (prior) {
            if (prior.callShape !== callShape) {
              throw invalidGoogleStream(
                context,
                "candidate executable code changed after emission",
              );
            }
            mergeReplaySignature(
              prior,
              thoughtSignature,
              "candidate executable code thought signature changed after emission",
            );
            continue;
          }
          try {
            toolCallId = toolCallRegistry.registerCodeExecution(
              executableCode.providerId,
            );
          } catch {
            throw invalidGoogleStream(context, "candidate executable code id was duplicated");
          }
        } else {
          const prior = pendingAnonymousCodeExecutions.at(-1);
          if (prior?.callShape === callShape) {
            mergeReplaySignature(
              prior,
              thoughtSignature,
              "candidate executable code thought signature changed after emission",
            );
            continue;
          }
          try {
            toolCallId = toolCallRegistry.registerCodeExecution(undefined);
          } catch {
            throw invalidGoogleStream(context, "candidate executable code id was duplicated");
          }
        }

        const rawPartIndex = retainRawAssistantPart(part);
        reserveCorrelation(
          "code-execution correlation",
          callShape,
          ...(executableCode.providerId === undefined ? [] : [executableCode.providerId]),
          ...(thoughtSignature === undefined ? [] : [thoughtSignature]),
        );
        const pending = {
          callShape,
          rawPartIndex,
          ...(thoughtSignature !== undefined ? { thoughtSignature } : {}),
        };
        if (executableCode.providerId === undefined) {
          pendingAnonymousCodeExecutions.push(pending);
        } else {
          seenCodeExecutions.set(executableCode.providerId, pending);
        }

        sawOutput = true;
        yield {
          type: "tool-input-start",
          id: toolCallId,
          toolName: GOOGLE_CODE_EXECUTION_TOOL_NAME,
          providerExecuted: true,
        };
        yield {
          type: "tool-input-delta",
          id: toolCallId,
          delta: serializedInput,
        };
        yield {
          type: "tool-call",
          toolCallId,
          toolName: GOOGLE_CODE_EXECUTION_TOOL_NAME,
          input: serializedInput,
          providerExecuted: true,
        };
        continue;
      }

      let result: ReturnType<typeof readGoogleCodeExecutionResult>;
      try {
        result = readGoogleCodeExecutionResult(part.codeExecutionResult);
      } catch {
        throw invalidGoogleStream(context, "candidate code execution result was malformed");
      }
      const resultValue = googleCodeExecutionOutput(result);
      const resultShape = stringifyJsonValue(resultValue);
      let toolCallId: string;

      if (result.providerId !== undefined) {
        const priorResult = seenCodeExecutionResults.get(result.providerId);
        if (priorResult) {
          if (priorResult.resultShape !== resultShape) {
            throw invalidGoogleStream(
              context,
              "candidate code execution result changed after emission",
            );
          }
          mergeReplaySignature(
            priorResult,
            thoughtSignature,
            "candidate code execution result thought signature changed after emission",
          );
          continue;
        }
        try {
          toolCallId = toolCallRegistry.resolveCodeExecutionResult(result.providerId);
        } catch {
          throw invalidGoogleStream(
            context,
            "candidate code execution result did not match executable code",
          );
        }
      } else {
        try {
          toolCallId = toolCallRegistry.resolveCodeExecutionResult(undefined);
        } catch {
          throw invalidGoogleStream(
            context,
            "candidate code execution result did not match executable code",
          );
        }
        pendingAnonymousCodeExecutions.shift();
      }

      const rawPartIndex = retainRawAssistantPart(part);
      if (result.providerId !== undefined) {
        reserveCorrelation(
          "code-result correlation",
          result.providerId,
          resultShape,
          ...(thoughtSignature === undefined ? [] : [thoughtSignature]),
        );
        seenCodeExecutionResults.set(result.providerId, {
          resultShape,
          rawPartIndex,
          ...(thoughtSignature !== undefined ? { thoughtSignature } : {}),
        });
      }
      sawOutput = true;
      yield result.isError
        ? {
          type: "tool-error",
          toolCallId,
          toolName: GOOGLE_CODE_EXECUTION_TOOL_NAME,
          error: resultValue,
          isError: true,
          providerExecuted: true,
        }
        : {
          type: "tool-result",
          toolCallId,
          toolName: GOOGLE_CODE_EXECUTION_TOOL_NAME,
          result: resultValue,
          providerExecuted: true,
        };
    }

    if (candidateFinishReason !== undefined) {
      if (sawFinishReason) {
        throw invalidGoogleStream(context, "stream contained duplicate terminal reasons");
      }
      finishReason = normalizeGoogleFinishReason(candidateFinishReason);
      sawFinishReason = true;
    }
  }

  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) {
      throw invalidGoogleStream(context, "stream chunk was not binary data");
    }
    if (chunk.byteLength > MAX_GOOGLE_SSE_CHUNK_BYTES) {
      throw invalidGoogleStream(
        context,
        `SSE chunk exceeded ${MAX_GOOGLE_SSE_CHUNK_BYTES} bytes`,
      );
    }
    let decodedChunk: string;
    try {
      decodedChunk = decoder.decode(chunk, { stream: true });
    } catch {
      throw invalidGoogleStream(context, "stream contained invalid UTF-8");
    }
    if (decodedChunk.length > MAX_GOOGLE_SSE_BUFFER_CODE_UNITS - buffer.length) {
      throw invalidGoogleStream(
        context,
        `SSE buffer exceeded ${MAX_GOOGLE_SSE_BUFFER_CODE_UNITS} code units`,
      );
    }
    buffer += decodedChunk;
    let parsed: ReturnType<typeof parseSseChunk>;
    try {
      parsed = parseSseChunk(buffer);
    } catch {
      throw invalidGoogleStream(context, "SSE event framing was malformed");
    }
    buffer = parsed.remainder;
    for (const event of parsed.events) {
      yield* processEvent(event);
    }
  }

  let decodedTail: string;
  try {
    decodedTail = decoder.decode();
  } catch {
    throw invalidGoogleStream(context, "stream contained invalid UTF-8");
  }
  if (decodedTail.length > MAX_GOOGLE_SSE_BUFFER_CODE_UNITS - buffer.length) {
    throw invalidGoogleStream(
      context,
      `SSE buffer exceeded ${MAX_GOOGLE_SSE_BUFFER_CODE_UNITS} code units`,
    );
  }
  buffer += decodedTail;
  if (buffer.trim().length > 0) {
    let parsed: ReturnType<typeof parseSseChunk>;
    try {
      parsed = parseFinalSseChunk(buffer);
    } catch {
      throw invalidGoogleStream(context, "trailing SSE event was malformed");
    }
    for (const event of parsed.events) {
      yield* processEvent(event);
    }
  }

  if (!sawCandidateEnvelope) {
    throw invalidGoogleStream(context, "stream contained no candidate envelope");
  }
  if (!sawFinishReason && !sawDone) {
    throw invalidGoogleStream(context, "stream ended before a terminal marker");
  }
  try {
    toolCallRegistry.assertSettled();
  } catch {
    throw invalidGoogleStream(
      context,
      "candidate executable code had no matching execution result",
    );
  }
  const contentFiltered = isContentFilterFinishReason(finishReason);
  if (!sawOutput && !contentFiltered) {
    throw invalidGoogleStream(context, "stream contained no supported output content");
  }

  if (reasoningId) {
    yield {
      type: "reasoning-end",
      id: reasoningId,
      ...(reasoningSignature !== undefined ? { signature: reasoningSignature } : {}),
    };
  }

  let providerMetadata: Record<string, unknown> | undefined;
  try {
    providerMetadata = createGoogleProviderMetadata(
      rawAssistantParts,
      groundingMetadata,
    );
  } catch {
    // The stream accounts for retained raw parts and correlation state under
    // the same byte ceiling as replay metadata. The final owned snapshot also
    // includes JSON container overhead and grounding metadata, so translate
    // any remaining snapshot-boundary failure into the stream's typed error
    // contract instead of leaking an implementation TypeError.
    throw invalidGoogleStream(context, "provider metadata could not be retained safely");
  }
  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}
