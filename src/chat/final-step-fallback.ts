import {
  isReasoningPart,
  isRecord,
  isTextPart,
  isToolCallPart,
  isToolResultPart,
} from "./conversation.ts";
import type { ChatUiMessage, ChatUiMessageChunk, MessageMetadata } from "./types.ts";
import { parseKnownProblemBody, safeJsonParse } from "./provider-errors.ts";
import { formatToolErrorText } from "./ag-ui-helpers.ts";

const MAX_FALLBACK_TOOL_INPUT_DEPTH = 64;
const MAX_FALLBACK_TOOL_INPUT_ENTRIES = 10_000;
const MAX_FINAL_STEP_RESPONSE_BODY_CHARS = 1_048_576;

function readOwnDataProperty(value: object, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function snapshotToolInputValue(
  value: unknown,
  context: { active: WeakSet<object>; remainingEntries: number },
  depth: number,
): unknown {
  if (depth > MAX_FALLBACK_TOOL_INPUT_DEPTH) return "[MaxDepth]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return null;
  if (context.active.has(value)) return "[Circular]";

  context.active.add(value);
  try {
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (
        let index = 0;
        index < value.length && context.remainingEntries > 0;
        index += 1
      ) {
        context.remainingEntries -= 1;
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        result.push(snapshotToolInputValue(
          descriptor && "value" in descriptor ? descriptor.value : undefined,
          context,
          depth + 1,
        ));
      }
      return result;
    }

    const entries: Array<[string, unknown]> = [];
    for (const key of Object.keys(value)) {
      if (context.remainingEntries <= 0) break;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) continue;
      context.remainingEntries -= 1;
      entries.push([key, snapshotToolInputValue(descriptor.value, context, depth + 1)]);
    }
    return Object.fromEntries(entries);
  } catch {
    return "[Unserializable]";
  } finally {
    context.active.delete(value);
  }
}

function toToolInput(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const snapshot = snapshotToolInputValue(value, {
    active: new WeakSet<object>(),
    remainingEntries: MAX_FALLBACK_TOOL_INPUT_ENTRIES,
  }, 0);
  return isRecord(snapshot) ? snapshot : {};
}

function toFallbackValue(value: unknown): unknown {
  return snapshotToolInputValue(value, {
    active: new WeakSet<object>(),
    remainingEntries: MAX_FALLBACK_TOOL_INPUT_ENTRIES,
  }, 0);
}

/** Default value for stream promise timeout ms. */
export const DEFAULT_STREAM_PROMISE_TIMEOUT_MS = 10_000;
const MAX_TIMER_DURATION_MS = 2_147_483_647;

/** Raised when final stream steps do not settle before the configured deadline. */
export class StreamStepsTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Stream steps did not settle within ${timeoutMs}ms`);
    this.name = "StreamStepsTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// --- Shared types ---

/** Public API contract for chat fallback part. */
export type ChatFallbackPart = ChatUiMessage["parts"][number];
/** Public API contract for chat part. */
type ChatPart = ChatFallbackPart;

/** Public API contract for final step tool call. */
export interface FinalStepToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/** Result returned from final step tool. */
export interface FinalStepToolResult {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  /** Whether the provider reported this tool result as an error. */
  isError?: boolean;
  /** Normalized public error text when `isError` is true. */
  errorText?: string;
}

/** State for fallback tool chunk. */
export interface FallbackToolChunkState {
  startedToolCallIds: ReadonlySet<string>;
  inputAvailableToolCallIds: ReadonlySet<string>;
  outputAvailableToolCallIds: ReadonlySet<string>;
  outputErrorToolCallIds?: ReadonlySet<string>;
  outputDeniedToolCallIds?: ReadonlySet<string>;
}

interface FallbackToolChunkDescriptor {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  outputState:
    | "started"
    | "input-available"
    | "output-available"
    | "output-error"
    | "output-denied";
  output?: unknown;
  errorText?: string;
}

type FallbackParsedPart =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string; signature?: string; redactedData?: string }
  | ({ kind: "tool" } & FallbackToolChunkDescriptor);

function getProviderToolResultErrorText(output: unknown): string | null {
  if (!isRecord(output) || readOwnDataProperty(output, "type") !== "error-text") {
    return null;
  }

  const value = readOwnDataProperty(output, "value");
  return formatToolErrorText(value ?? "Tool execution failed");
}

function getFallbackToolResultFields(
  result: FinalStepToolResult,
): Pick<FallbackToolChunkDescriptor, "outputState" | "output" | "errorText"> {
  return result.isError
    ? {
      outputState: "output-error",
      errorText: result.errorText ?? formatToolErrorText(result.output),
    }
    : { outputState: "output-available", output: result.output };
}

function buildToolUiPart(descriptor: FallbackToolChunkDescriptor): ChatPart {
  return {
    type: "dynamic-tool",
    toolName: descriptor.toolName,
    toolCallId: descriptor.toolCallId,
    input: descriptor.input,
    state: descriptor.outputState === "started" ? "pending" : descriptor.outputState,
    ...(descriptor.outputState === "output-available"
      ? { output: toFallbackValue(descriptor.output) }
      : {}),
    ...(descriptor.outputState === "output-error" && descriptor.errorText
      ? { errorText: descriptor.errorText }
      : {}),
  };
}

function buildChatPartFromParsedPart(part: FallbackParsedPart): ChatPart {
  switch (part.kind) {
    case "text":
      return { type: "text", text: part.text };
    case "reasoning":
      return {
        type: "reasoning",
        text: part.text,
        ...(part.signature ? { signature: part.signature } : {}),
        ...(part.redactedData ? { redactedData: part.redactedData } : {}),
      };
    case "tool":
      return buildToolUiPart(part);
  }
}

function toChatParts(parts: readonly FallbackParsedPart[]): ChatPart[] {
  return parts.map(buildChatPartFromParsedPart);
}

function upsertParsedToolResult(
  parts: FallbackParsedPart[],
  result: FinalStepToolResult,
): void {
  const existingIndex = parts.findIndex(
    (part) => part.kind === "tool" && part.toolCallId === result.toolCallId,
  );

  if (existingIndex >= 0) {
    const existingPart = parts[existingIndex];
    if (!existingPart || existingPart.kind !== "tool") {
      return;
    }

    parts[existingIndex] = {
      ...existingPart,
      ...getFallbackToolResultFields(result),
    };
    return;
  }

  parts.push({
    kind: "tool",
    toolName: result.toolName,
    toolCallId: result.toolCallId,
    input: toToolInput(result.input),
    ...getFallbackToolResultFields(result),
  });
}

// --- Ordered-part building ---

function getActiveTurnMessages(messages: unknown[]): unknown[] {
  let activeTurnStart = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (isRecord(message) && (message.role === "user" || message.role === "system")) {
      activeTurnStart = index + 1;
    }
  }
  return activeTurnStart === 0 ? messages : messages.slice(activeTurnStart);
}

function buildOrderedFallbackParsedPartsFromContentMessages(
  messages: unknown[],
): FallbackParsedPart[] {
  const activeMessages = getActiveTurnMessages(messages);
  const orderedParts: FallbackParsedPart[] = [];
  const toolCallsById = new Map<string, FinalStepToolCall>();
  const toolResultsById = new Map<string, FinalStepToolResult>();

  for (
    const toolCall of activeMessages.flatMap((message) => {
      if (!isRecord(message) || !Array.isArray(message.content)) {
        return [];
      }

      return message.content.flatMap((part) =>
        isToolCallPart(part)
          ? [
            {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            } satisfies FinalStepToolCall,
          ]
          : []
      );
    })
  ) {
    toolCallsById.set(toolCall.toolCallId, toolCall);
  }

  for (
    const toolResult of activeMessages.flatMap((message) => {
      if (!isRecord(message) || !Array.isArray(message.content)) {
        return [];
      }

      return message.content.flatMap((part) => {
        if (!isToolResultPart(part)) return [];
        const output = readOwnDataProperty(part, "output");
        const errorText = getProviderToolResultErrorText(output);
        return [
          {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: toolCallsById.get(part.toolCallId)?.input ?? {},
            output,
            ...(errorText ? { isError: true, errorText } : {}),
          } satisfies FinalStepToolResult,
        ];
      });
    })
  ) {
    toolResultsById.set(toolResult.toolCallId, toolResult);
  }

  for (const message of activeMessages) {
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (isTextPart(part)) {
        const text = part.text.trim();
        if (text.length > 0) {
          orderedParts.push({
            kind: "text",
            text,
          });
        }
        continue;
      }

      if (isReasoningPart(part)) {
        orderedParts.push({
          kind: "reasoning",
          text: typeof part.text === "string" ? part.text.trim() : "",
          ...(typeof part.signature === "string" ? { signature: part.signature } : {}),
          ...(typeof part.redactedData === "string" ? { redactedData: part.redactedData } : {}),
        });
        continue;
      }

      if (isToolCallPart(part)) {
        const toolResult = toolResultsById.get(part.toolCallId);
        const toolCall = toolCallsById.get(part.toolCallId);
        orderedParts.push({
          kind: "tool",
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          input: toToolInput(toolCall?.input ?? part.input),
          ...(toolResult
            ? getFallbackToolResultFields(toolResult)
            : { outputState: "input-available" as const }),
        });
        continue;
      }

      if (isToolResultPart(part)) {
        const toolCall = toolCallsById.get(part.toolCallId);
        const output = readOwnDataProperty(part, "output");
        const errorText = getProviderToolResultErrorText(output);
        upsertParsedToolResult(orderedParts, {
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          input: toolCall?.input ?? {},
          output,
          ...(errorText ? { isError: true, errorText } : {}),
        });
      }
    }
  }

  return orderedParts;
}

function buildOrderedFallbackParsedPartsFromUiMessages(messages: unknown[]): FallbackParsedPart[] {
  const orderedParts: FallbackParsedPart[] = [];

  for (const message of getActiveTurnMessages(messages)) {
    if (!isRecord(message) || !Array.isArray(message.parts)) {
      continue;
    }

    if (message.role === "assistant") {
      for (const part of message.parts) {
        if (!isRecord(part) || typeof part.type !== "string") {
          continue;
        }

        if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) {
          orderedParts.push({
            kind: "text",
            text: part.text.trim(),
          });
          continue;
        }

        if (part.type === "reasoning" && typeof part.text === "string") {
          orderedParts.push({
            kind: "reasoning",
            text: part.text.trim(),
            ...(typeof part.signature === "string" ? { signature: part.signature } : {}),
            ...(typeof part.redactedData === "string" ? { redactedData: part.redactedData } : {}),
          });
          continue;
        }

        const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : null;
        if (!toolCallId) {
          continue;
        }

        const explicitToolName = typeof part.toolName === "string" ? part.toolName : null;
        const derivedToolName = explicitToolName ??
          (part.type.startsWith("tool-")
            ? part.type.slice(5)
            : part.type === "dynamic-tool"
            ? null
            : null);
        if (!derivedToolName) {
          continue;
        }

        const input = toToolInput("args" in part ? part.args : "input" in part ? part.input : {});
        const state = typeof part.state === "string" ? part.state : "input-available";
        const outputState = state === "pending" || state === "input-streaming"
          ? "started"
          : state === "output-available" || state === "completed"
          ? "output-available"
          : state === "output-error" || state === "error"
          ? "output-error"
          : state === "output-denied"
          ? "output-denied"
          : "input-available";

        orderedParts.push({
          kind: "tool",
          toolName: derivedToolName,
          toolCallId,
          input,
          outputState,
          ...(outputState === "output-available" && "output" in part
            ? { output: part.output }
            : {}),
          ...(outputState === "output-error" && typeof part.errorText === "string"
            ? { errorText: part.errorText }
            : {}),
        });
      }
      continue;
    }

    if (message.role === "tool") {
      for (const part of message.parts) {
        if (
          !isRecord(part) ||
          (part.type !== "tool-result" && part.type !== "tool_result")
        ) {
          continue;
        }

        const toolCallId = typeof part.toolCallId === "string"
          ? part.toolCallId
          : typeof part.tool_call_id === "string"
          ? part.tool_call_id
          : typeof part.id === "string"
          ? part.id
          : null;
        if (!toolCallId) continue;

        const existingIndex = orderedParts.findIndex(
          (existingPart) => existingPart.kind === "tool" && existingPart.toolCallId === toolCallId,
        );
        if (existingIndex < 0) {
          continue;
        }

        const existingPart = orderedParts[existingIndex];
        if (existingPart === undefined || existingPart.kind !== "tool") {
          continue;
        }

        const output = toFallbackValue(
          "output" in part ? part.output : "result" in part ? part.result : null,
        );
        const isError = part.is_error === true || part.isError === true;
        orderedParts[existingIndex] = isError
          ? {
            ...existingPart,
            outputState: "output-error",
            errorText: formatToolErrorText(output),
          }
          : {
            ...existingPart,
            outputState: "output-available",
            output,
          };
      }
    }
  }

  return orderedParts;
}

function buildFallbackParsedPartsFromResponseMessages(step: unknown): FallbackParsedPart[] {
  if (!isRecord(step) || !isRecord(step.response) || !Array.isArray(step.response.messages)) {
    return [];
  }

  return buildOrderedFallbackParsedPartsFromContentMessages(step.response.messages);
}

function buildFallbackParsedPartsFromUiResponseMessages(step: unknown): FallbackParsedPart[] {
  if (!isRecord(step) || !isRecord(step.response) || !Array.isArray(step.response.messages)) {
    return [];
  }

  return buildOrderedFallbackParsedPartsFromUiMessages(step.response.messages);
}

function buildFallbackParsedPartsFromExtractedStep(input: {
  step: unknown;
  extractFinalStepText: (step: unknown) => string;
  extractFinalStepToolCalls: (step: unknown) => FinalStepToolCall[];
  extractFinalStepToolResults: (step: unknown) => FinalStepToolResult[];
}): FallbackParsedPart[] {
  const parts: FallbackParsedPart[] = buildToolChunkDescriptorsFromStep({
    step: input.step,
    extractFinalStepToolCalls: input.extractFinalStepToolCalls,
    extractFinalStepToolResults: input.extractFinalStepToolResults,
  }).map((descriptor) => ({
    kind: "tool",
    ...descriptor,
  }));

  const text = input.extractFinalStepText(input.step);
  if (text.length > 0) {
    parts.push({
      kind: "text",
      text,
    });
  }

  return parts;
}

function buildFallbackParsedPartsFromInput(input: {
  step: unknown;
  extractFinalStepText: (step: unknown) => string;
  extractFinalStepToolCalls: (step: unknown) => FinalStepToolCall[];
  extractFinalStepToolResults: (step: unknown) => FinalStepToolResult[];
}): FallbackParsedPart[] {
  const appendMissingExtractedText = (
    parts: FallbackParsedPart[],
  ): FallbackParsedPart[] => {
    const text = extractMissingFallbackText({
      parts: toChatParts(parts),
      step: input.step,
      extractFinalStepText: input.extractFinalStepText,
    });
    return text.length > 0 ? [...parts, { kind: "text", text }] : parts;
  };

  const orderedResponseParts = buildFallbackParsedPartsFromResponseMessages(input.step);
  if (orderedResponseParts.length > 0) {
    return appendMissingExtractedText(orderedResponseParts);
  }

  if (isRecord(input.step) && Array.isArray(input.step.messages)) {
    const orderedTopLevelContentParts = buildOrderedFallbackParsedPartsFromContentMessages(
      input.step.messages,
    );
    if (orderedTopLevelContentParts.length > 0) {
      return appendMissingExtractedText(orderedTopLevelContentParts);
    }
  }

  const orderedUiResponseParts = buildFallbackParsedPartsFromUiResponseMessages(input.step);
  if (orderedUiResponseParts.length > 0) {
    return appendMissingExtractedText(orderedUiResponseParts);
  }

  if (isRecord(input.step) && Array.isArray(input.step.messages)) {
    const orderedUiTopLevelParts = buildOrderedFallbackParsedPartsFromUiMessages(
      input.step.messages,
    );
    if (orderedUiTopLevelParts.length > 0) {
      return appendMissingExtractedText(orderedUiTopLevelParts);
    }
  }

  return buildFallbackParsedPartsFromExtractedStep(input);
}

// --- Part extraction ---

function extractTextFromAssistantContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" &&
        part.text.trim().length > 0
        ? [part.text.trim()]
        : []
    )
    .join("\n")
    .trim();
}

function extractTextFromResponseMessages(step: unknown): string {
  if (!isRecord(step) || !isRecord(step.response) || !Array.isArray(step.response.messages)) {
    return "";
  }

  const assistantTexts = getActiveTurnMessages(step.response.messages)
    .flatMap((message) =>
      isRecord(message) && message.role === "assistant"
        ? [extractTextFromAssistantContent(message.content)]
        : []
    )
    .filter((text) => text.length > 0);

  return assistantTexts.join("\n").trim();
}

function buildFallbackUiMessagePartsFromInput(input: {
  step: unknown;
  extractFinalStepText: (step: unknown) => string;
  extractFinalStepToolCalls: (step: unknown) => FinalStepToolCall[];
  extractFinalStepToolResults: (step: unknown) => FinalStepToolResult[];
}): ChatPart[] {
  return toChatParts(buildFallbackParsedPartsFromInput(input));
}

// --- Text diffing ---

function hasEquivalentTextPart(parts: readonly ChatPart[], text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return false;
  }

  return parts.some(
    (part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" &&
      part.text.trim() === normalized,
  );
}

function collectExistingTextParts(parts: readonly ChatPart[]): string[] {
  return parts.flatMap((part) =>
    isRecord(part) && part.type === "text" && typeof part.text === "string" &&
      part.text.trim().length > 0
      ? [part.text.trim()]
      : []
  );
}

function extractMissingFallbackText(input: {
  parts: readonly ChatPart[];
  step: unknown;
  extractFinalStepText: (step: unknown) => string;
}): string {
  const finalText = input.extractFinalStepText(input.step);
  if (finalText.length === 0 || hasEquivalentTextPart(input.parts, finalText)) {
    return "";
  }

  const existingTexts = collectExistingTextParts(input.parts);
  if (existingTexts.length === 0) {
    return finalText;
  }

  const prefixCandidates = [
    existingTexts.join("\n\n").trim(),
    existingTexts.join("\n").trim(),
    existingTexts.join("").trim(),
  ].filter((candidate) => candidate.length > 0);

  const matchedPrefix = prefixCandidates
    .filter((candidate) => finalText.startsWith(candidate))
    .sort((left, right) => right.length - left.length)[0];

  if (!matchedPrefix) {
    return finalText;
  }

  return finalText.slice(matchedPrefix.length).replace(/^\s+/, "").trim();
}

function appendMissingFallbackTextPartFromInput(input: {
  parts: readonly ChatPart[];
  step: unknown;
  extractFinalStepText: (step: unknown) => string;
}): ChatPart[] {
  const text = extractMissingFallbackText(input);
  if (text.length === 0) {
    return [...input.parts];
  }

  return [
    ...input.parts,
    {
      type: "text",
      text,
    },
  ];
}

function buildMissingFallbackTextChunksFromInput(input: {
  parts: readonly ChatPart[];
  step: unknown;
  messageId: string;
  extractFinalStepText: (step: unknown) => string;
}): ChatUiMessageChunk<MessageMetadata>[] {
  const text = extractMissingFallbackText(input);
  if (text.length === 0) {
    return [];
  }

  return [
    {
      type: "text-start",
      id: input.messageId,
    },
    {
      type: "text-delta",
      id: input.messageId,
      delta: text,
    },
    {
      type: "text-end",
      id: input.messageId,
    },
  ];
}

// --- Tool-chunk assembly ---

function buildToolChunkDescriptorsFromStep(input: {
  step: unknown;
  extractFinalStepToolCalls: (step: unknown) => FinalStepToolCall[];
  extractFinalStepToolResults: (step: unknown) => FinalStepToolResult[];
}): FallbackToolChunkDescriptor[] {
  const descriptors: FallbackToolChunkDescriptor[] = [];
  const toolCalls = input.extractFinalStepToolCalls(input.step);
  const toolResults = new Map(
    input.extractFinalStepToolResults(input.step).map((
      toolResult,
    ) => [toolResult.toolCallId, toolResult]),
  );
  const handledToolCallIds = new Set<string>();

  for (const toolCall of toolCalls) {
    const toolResult = toolResults.get(toolCall.toolCallId);
    handledToolCallIds.add(toolCall.toolCallId);

    descriptors.push({
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      input: toToolInput(toolCall.input),
      ...(toolResult
        ? getFallbackToolResultFields(toolResult)
        : { outputState: "input-available" as const }),
    });
  }

  for (const toolResult of toolResults.values()) {
    if (handledToolCallIds.has(toolResult.toolCallId)) {
      continue;
    }

    descriptors.push({
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName,
      input: toToolInput(toolResult.input),
      ...getFallbackToolResultFields(toolResult),
    });
  }

  return descriptors;
}

function buildToolChunkDescriptorsFromParts(
  parts: readonly ChatPart[],
): FallbackToolChunkDescriptor[] {
  const descriptors: FallbackToolChunkDescriptor[] = [];

  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }
    if (part.type !== "dynamic-tool" && part.type !== "tool_call" && part.type !== "tool-call") {
      continue;
    }
    if (!("toolCallId" in part) || typeof part.toolCallId !== "string") {
      continue;
    }
    if (!("toolName" in part) || typeof part.toolName !== "string") {
      continue;
    }
    if (!("input" in part) || !("state" in part) || typeof part.state !== "string") {
      continue;
    }

    const toolCallId = part.toolCallId;
    const toolName = part.toolName;
    const input = toToolInput(part.input);
    const state = part.state;

    switch (state) {
      case "pending":
      case "input-streaming":
        descriptors.push({ toolCallId, toolName, input, outputState: "started" });
        break;
      case "input-available":
      case "approval-requested":
      case "approval-responded":
      case "output-streaming":
        descriptors.push({ toolCallId, toolName, input, outputState: "input-available" });
        break;
      case "output-available":
      case "completed":
        descriptors.push({
          toolCallId,
          toolName,
          input,
          outputState: "output-available",
          output: "output" in part ? part.output : undefined,
        });
        break;
      case "output-error":
      case "error":
        descriptors.push({
          toolCallId,
          toolName,
          input,
          outputState: "output-error",
          ...("errorText" in part && typeof part.errorText === "string"
            ? { errorText: part.errorText }
            : {}),
        });
        break;
      case "output-denied":
        descriptors.push({ toolCallId, toolName, input, outputState: "output-denied" });
        break;
    }
  }

  return descriptors;
}

function buildToolFallbackChunks(
  descriptors: readonly FallbackToolChunkDescriptor[],
  state?: Partial<FallbackToolChunkState>,
): ChatUiMessageChunk<MessageMetadata>[] {
  const normalizedState = createMutableFallbackToolChunkState(state);
  const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];

  for (const descriptor of descriptors) {
    if (!normalizedState.startedToolCallIds.has(descriptor.toolCallId)) {
      chunks.push({
        type: "tool-input-start",
        toolCallId: descriptor.toolCallId,
        toolName: descriptor.toolName,
      });
    }

    if (
      descriptor.outputState !== "started" &&
      !normalizedState.inputAvailableToolCallIds.has(descriptor.toolCallId)
    ) {
      chunks.push({
        type: "tool-input-available",
        toolCallId: descriptor.toolCallId,
        toolName: descriptor.toolName,
        input: descriptor.input,
      });
    }

    switch (descriptor.outputState) {
      case "output-available":
        if (!normalizedState.outputAvailableToolCallIds.has(descriptor.toolCallId)) {
          chunks.push({
            type: "tool-output-available",
            toolCallId: descriptor.toolCallId,
            output: toFallbackValue(descriptor.output),
          });
        }
        break;
      case "output-error":
        if (!normalizedState.outputErrorToolCallIds?.has(descriptor.toolCallId)) {
          chunks.push({
            type: "tool-output-error",
            toolCallId: descriptor.toolCallId,
            errorText: descriptor.errorText ?? "Tool execution failed",
          });
        }
        break;
      case "output-denied":
        if (!normalizedState.outputDeniedToolCallIds?.has(descriptor.toolCallId)) {
          chunks.push({
            type: "tool-output-denied",
            toolCallId: descriptor.toolCallId,
          });
        }
        break;
    }

    markToolDescriptorEmitted(normalizedState, descriptor);
  }

  return chunks;
}

function createMutableFallbackToolChunkState(
  state?: Partial<FallbackToolChunkState>,
): {
  startedToolCallIds: Set<string>;
  inputAvailableToolCallIds: Set<string>;
  outputAvailableToolCallIds: Set<string>;
  outputErrorToolCallIds: Set<string>;
  outputDeniedToolCallIds: Set<string>;
} {
  const mutableState = {
    startedToolCallIds: new Set(state?.startedToolCallIds ?? []),
    inputAvailableToolCallIds: new Set(state?.inputAvailableToolCallIds ?? []),
    outputAvailableToolCallIds: new Set(state?.outputAvailableToolCallIds ?? []),
    outputErrorToolCallIds: new Set(state?.outputErrorToolCallIds ?? []),
    outputDeniedToolCallIds: new Set(state?.outputDeniedToolCallIds ?? []),
  };

  for (const toolCallId of mutableState.inputAvailableToolCallIds) {
    mutableState.startedToolCallIds.add(toolCallId);
  }
  for (
    const terminalIds of [
      mutableState.outputAvailableToolCallIds,
      mutableState.outputErrorToolCallIds,
      mutableState.outputDeniedToolCallIds,
    ]
  ) {
    for (const toolCallId of terminalIds) {
      mutableState.startedToolCallIds.add(toolCallId);
      mutableState.inputAvailableToolCallIds.add(toolCallId);
    }
  }

  return mutableState;
}

function markToolDescriptorEmitted(
  state: ReturnType<typeof createMutableFallbackToolChunkState>,
  descriptor: FallbackToolChunkDescriptor,
): void {
  state.startedToolCallIds.add(descriptor.toolCallId);

  if (descriptor.outputState !== "started") {
    state.inputAvailableToolCallIds.add(descriptor.toolCallId);
  }

  switch (descriptor.outputState) {
    case "output-available":
      state.outputAvailableToolCallIds.add(descriptor.toolCallId);
      break;
    case "output-error":
      state.outputErrorToolCallIds.add(descriptor.toolCallId);
      break;
    case "output-denied":
      state.outputDeniedToolCallIds.add(descriptor.toolCallId);
      break;
  }
}

function getIndexedFallbackChunkId(
  baseId: string,
  kind: "reasoning" | "text",
  index: number,
): string {
  if (kind === "text" && index === 0) {
    return baseId;
  }

  if (index === 0) {
    return `${baseId}:${kind}`;
  }

  return `${baseId}:${kind}:${index + 1}`;
}

function buildFallbackUiMessageChunksFromParsedParts(
  parts: readonly FallbackParsedPart[],
  messageId: string,
  state?: Partial<FallbackToolChunkState>,
): ChatUiMessageChunk<MessageMetadata>[] {
  const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
  const toolState = createMutableFallbackToolChunkState(state);
  let reasoningIndex = 0;
  let textIndex = 0;

  for (const part of parts) {
    switch (part.kind) {
      case "reasoning": {
        const id = getIndexedFallbackChunkId(messageId, "reasoning", reasoningIndex);
        reasoningIndex += 1;

        chunks.push({ type: "reasoning-start", id });
        if (part.text.length > 0) {
          chunks.push({ type: "reasoning-delta", id, delta: part.text });
        }
        chunks.push({
          type: "reasoning-end",
          id,
          ...(part.signature ? { signature: part.signature } : {}),
          ...(part.redactedData ? { redactedData: part.redactedData } : {}),
        });
        break;
      }
      case "text": {
        const id = getIndexedFallbackChunkId(messageId, "text", textIndex);
        textIndex += 1;

        chunks.push({ type: "text-start", id });
        chunks.push({ type: "text-delta", id, delta: part.text });
        chunks.push({ type: "text-end", id });
        break;
      }
      case "tool":
        chunks.push(...buildToolFallbackChunks([part], toolState));
        markToolDescriptorEmitted(toolState, part);
        break;
    }
  }

  return chunks;
}

function buildMissingFallbackToolChunksFromInput(input: {
  step: unknown;
  state?: Partial<FallbackToolChunkState>;
  extractFinalStepToolCalls: (step: unknown) => FinalStepToolCall[];
  extractFinalStepToolResults: (step: unknown) => FinalStepToolResult[];
}): ChatUiMessageChunk<MessageMetadata>[] {
  return buildToolFallbackChunks(
    buildToolChunkDescriptorsFromStep({
      step: input.step,
      extractFinalStepToolCalls: input.extractFinalStepToolCalls,
      extractFinalStepToolResults: input.extractFinalStepToolResults,
    }),
    input.state,
  );
}

function buildMissingFallbackToolChunksFromPartsFromInput(
  parts: readonly ChatPart[],
  state?: Partial<FallbackToolChunkState>,
): ChatUiMessageChunk<MessageMetadata>[] {
  return buildToolFallbackChunks(buildToolChunkDescriptorsFromParts(parts), state);
}

/** Error shape for final step terminal. */
export interface FinalStepTerminalError {
  code: string;
  message: string;
}

async function resolveStreamPromiseWithTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DURATION_MS
  ) {
    throw new RangeError("timeoutMs must be a positive safe timer duration");
  }

  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_resolve, reject) => {
        timeoutId = globalThis.setTimeout(
          () => reject(new StreamStepsTimeoutError(timeoutMs)),
          timeoutMs,
        );
        maybeUnrefTimer(timeoutId);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

function maybeUnrefTimer(timer: ReturnType<typeof globalThis.setTimeout>): void {
  if (typeof timer !== "object" || timer === null || !("unref" in timer)) {
    return;
  }
  const candidate: { unref?: unknown } = timer;
  if (typeof candidate.unref === "function") {
    candidate.unref();
  }
}

/** Return last stream step. */
export async function getLastStreamStep(
  result: { steps: PromiseLike<readonly unknown[]> },
  timeoutMs = DEFAULT_STREAM_PROMISE_TIMEOUT_MS,
): Promise<unknown | null> {
  const steps = await resolveStreamPromiseWithTimeout(result.steps, timeoutMs);
  return steps.at(-1) ?? null;
}

/** Return stream steps. */
export async function getStreamSteps(
  result: { steps: PromiseLike<readonly unknown[]> },
  timeoutMs = DEFAULT_STREAM_PROMISE_TIMEOUT_MS,
): Promise<{ steps: readonly unknown[]; lastStep: unknown | null }> {
  const steps = await resolveStreamPromiseWithTimeout(result.steps, timeoutMs);
  return { steps, lastStep: steps.at(-1) ?? null };
}

/** Extract final step finish reason. */
export function extractFinalStepFinishReason(step: unknown): string | null {
  if (!isRecord(step) || typeof step.finishReason !== "string") {
    return null;
  }

  return step.finishReason;
}

/** Extract final step text. */
export function extractFinalStepText(step: unknown): string {
  if (isRecord(step) && typeof step.text === "string" && step.text.trim().length > 0) {
    return step.text.trim();
  }

  return extractTextFromResponseMessages(step);
}

/** Extract final step tool calls. */
export function extractFinalStepToolCalls(step: unknown): FinalStepToolCall[] {
  if (!isRecord(step) || !Array.isArray(step.toolCalls)) {
    return [];
  }

  return step.toolCalls.flatMap((toolCall) => {
    if (
      !isRecord(toolCall) || typeof toolCall.toolCallId !== "string" ||
      typeof toolCall.toolName !== "string"
    ) {
      return [];
    }

    return [
      {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: "input" in toolCall ? toolCall.input : {},
      },
    ];
  });
}

/** Extract final step tool results. */
export function extractFinalStepToolResults(step: unknown): FinalStepToolResult[] {
  if (!isRecord(step) || !Array.isArray(step.toolResults)) {
    return [];
  }

  const toolInputs = new Map(
    extractFinalStepToolCalls(step).map((toolCall) => [toolCall.toolCallId, toolCall.input]),
  );

  return step.toolResults.flatMap((toolResult) => {
    if (
      !isRecord(toolResult) || typeof toolResult.toolCallId !== "string" ||
      typeof toolResult.toolName !== "string"
    ) {
      return [];
    }

    const output = "output" in toolResult ? toolResult.output : null;
    const providerErrorText = getProviderToolResultErrorText(output);
    const isError = toolResult.isError === true || toolResult.is_error === true ||
      providerErrorText !== null;
    return [{
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName,
      input: "input" in toolResult
        ? toolResult.input
        : (toolInputs.get(toolResult.toolCallId) ?? {}),
      output,
      ...(isError
        ? { isError: true, errorText: providerErrorText ?? formatToolErrorText(output) }
        : {}),
    }];
  });
}

function parseFinalStepResponseBody(step: unknown): unknown | null {
  if (!isRecord(step) || !isRecord(step.response) || !("body" in step.response)) {
    return null;
  }

  return step.response.body ?? null;
}

function parseProblemBody(body: unknown): FinalStepTerminalError | null {
  const match = parseKnownProblemBody(body);
  if (!match) {
    return null;
  }

  return { code: match.code, message: match.message };
}

/** Error shape for extract final step terminal. */
export function extractFinalStepTerminalError(step: unknown): FinalStepTerminalError | null {
  const responseBody = parseFinalStepResponseBody(step);
  if (responseBody == null) {
    return null;
  }

  if (typeof responseBody === "string") {
    if (responseBody.length > MAX_FINAL_STEP_RESPONSE_BODY_CHARS) {
      return null;
    }
    const parsedResponseBody = safeJsonParse(responseBody);
    if (!parsedResponseBody.ok) {
      return null;
    }

    return parseProblemBody(parsedResponseBody.value);
  }

  return parseProblemBody(responseBody);
}

/** Builds fallback UI message parts. */
export function buildFallbackUiMessageParts(step: unknown): ChatPart[] {
  return buildFallbackUiMessagePartsFromInput({
    step,
    extractFinalStepText,
    extractFinalStepToolCalls,
    extractFinalStepToolResults,
  });
}

/** Append missing fallback text part. */
export function appendMissingFallbackTextPart(
  parts: readonly ChatPart[],
  step: unknown,
): ChatPart[] {
  return appendMissingFallbackTextPartFromInput({
    parts,
    step,
    extractFinalStepText,
  });
}

/** Builds fallback UI message chunks. */
export function buildFallbackUiMessageChunks(
  step: unknown,
  messageId: string,
): ChatUiMessageChunk<MessageMetadata>[] {
  return buildFallbackUiMessageChunksFromParsedParts(
    buildFallbackParsedPartsFromInput({
      step,
      extractFinalStepText,
      extractFinalStepToolCalls,
      extractFinalStepToolResults,
    }),
    messageId,
  );
}

/** Builds missing fallback tool chunks. */
export function buildMissingFallbackToolChunks(
  step: unknown,
  state?: Partial<FallbackToolChunkState>,
): ChatUiMessageChunk<MessageMetadata>[] {
  return buildMissingFallbackToolChunksFromInput({
    step,
    state,
    extractFinalStepToolCalls,
    extractFinalStepToolResults,
  });
}

/** Builds missing fallback tool chunks from parts. */
export function buildMissingFallbackToolChunksFromParts(
  parts: readonly ChatPart[],
  state?: Partial<FallbackToolChunkState>,
): ChatUiMessageChunk<MessageMetadata>[] {
  if (parts.length === 0 && (!state || Object.keys(state).length === 0)) {
    return [];
  }

  return buildMissingFallbackToolChunksFromPartsFromInput(parts, state);
}

/** Builds missing fallback text chunks. */
export function buildMissingFallbackTextChunks(
  parts: readonly ChatPart[],
  step: unknown,
  messageId: string,
): ChatUiMessageChunk<MessageMetadata>[] {
  return buildMissingFallbackTextChunksFromInput({
    parts,
    step,
    messageId,
    extractFinalStepText,
  });
}
