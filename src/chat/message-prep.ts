import {
  convertUiMessagesToProviderModelMessages,
  getStringField,
  isReasoningPart,
  isToolCallPart,
  isToolResultPart,
} from "./conversation.ts";
import {
  buildDataFileAnnotation,
  type ChatToolResultOutput,
  type ChatToolResultPart,
  type ChatUiMessage,
  type ChatUiMessagePart,
  normalizeInlineAttachmentMediaType,
  type ProviderModelMessage,
  type UploadedFileReference,
} from "./types.ts";

const CHARS_PER_TOKEN = 4;

export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? "").length / CHARS_PER_TOKEN);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

export function compressTurn(
  messages: ProviderModelMessage[],
  startIdx: number,
  endIdx: number,
): ProviderModelMessage[] {
  let userQuery = "";
  const toolNames: string[] = [];
  let assistantConclusion = "";

  for (let i = startIdx; i <= endIdx; i++) {
    const msg = messages[i];
    if (msg.role === "user") {
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      userQuery = truncate(text, 100);
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "tool-call") {
          toolNames.push(part.toolName);
        } else if (part.type === "text") {
          assistantConclusion = truncate(part.text, 150);
        }
      }
    } else if (msg.role === "assistant" && typeof msg.content === "string") {
      assistantConclusion = truncate(msg.content, 150);
    }
  }

  const toolSummary = toolNames.length > 0 ? ` → used ${toolNames.join(", ")}` : "";
  const conclusionSummary = assistantConclusion ? ` → ${assistantConclusion}` : "";
  const summary = `[Compressed: ${userQuery}${toolSummary}${conclusionSummary}]`;

  return [
    { role: "user", content: summary },
    { role: "assistant", content: "Acknowledged." },
  ];
}

interface TurnWindow {
  startIdx: number;
  endIdx: number;
  tokens: number;
  compressed?: boolean;
}

function collectTurns(messages: ProviderModelMessage[]): TurnWindow[] {
  const turns: TurnWindow[] = [];
  let currentTurn: TurnWindow | null = null;

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      if (currentTurn) {
        currentTurn.endIdx = i - 1;
        turns.push(currentTurn);
      }
      currentTurn = { startIdx: i, endIdx: i, tokens: estimateTokens(messages[i].content) };
    } else if (currentTurn) {
      currentTurn.endIdx = i;
      currentTurn.tokens += estimateTokens(messages[i].content);
    }
  }

  if (currentTurn) {
    currentTurn.endIdx = messages.length - 1;
    turns.push(currentTurn);
  }

  return turns;
}

export function enforceTokenBudgetWithTurnCompression(
  messages: ProviderModelMessage[],
  budget: number,
  overhead: number,
): ProviderModelMessage[] {
  const effectiveBudget = budget - overhead;
  let totalTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  if (totalTokens <= effectiveBudget) return messages;

  const turns = collectTurns(messages);
  const minKeep = Math.min(2, turns.length);
  const result = [...messages];

  let compressCount = 0;
  while (totalTokens > effectiveBudget && compressCount < turns.length - minKeep) {
    const turn = turns[compressCount];
    if (turn.compressed) {
      compressCount++;
      continue;
    }

    const compressed = compressTurn(messages, turn.startIdx, turn.endIdx);
    const compressedTokens = compressed.reduce(
      (sum, message) => sum + estimateTokens(message.content),
      0,
    );
    const saved = turn.tokens - compressedTokens;
    if (saved <= 0) {
      compressCount++;
      continue;
    }

    const turnLength = turn.endIdx - turn.startIdx + 1;
    result.splice(turn.startIdx, turnLength, ...compressed);
    const indexShift = compressed.length - turnLength;
    for (let j = compressCount + 1; j < turns.length; j++) {
      turns[j].startIdx += indexShift;
      turns[j].endIdx += indexShift;
    }
    turn.endIdx = turn.startIdx + compressed.length - 1;
    turn.tokens = compressedTokens;
    turn.compressed = true;
    totalTokens -= saved;
    compressCount++;
  }

  if (totalTokens <= effectiveBudget) return result;

  const finalTurns = collectTurns(result);
  const finalMinKeep = Math.min(2, finalTurns.length);
  let dropCount = 0;
  while (totalTokens > effectiveBudget && dropCount < finalTurns.length - finalMinKeep) {
    totalTokens -= finalTurns[dropCount].tokens;
    dropCount++;
  }

  if (dropCount === 0) return result;

  const firstKeepIdx = finalTurns[dropCount].startIdx;
  return result.slice(firstKeepIdx);
}

const BUDGET_RATIO = 0.85;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_TOKEN_BUDGET = Math.floor(DEFAULT_CONTEXT_WINDOW * BUDGET_RATIO);
const TOKENS_PER_TOOL = 250;

const MASK_THRESHOLD = 500;

function serializedLength(value: unknown): number {
  return JSON.stringify(value ?? "").length;
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ToolCallInfo {
  toolName: string;
  input: unknown;
}

export function isModelSupportedFileMediaType(mediaType: string): boolean {
  return mediaType.startsWith("image/") || mediaType === "application/pdf" ||
    mediaType === "text/plain";
}

export function normalizeMessageFilePartMediaTypes(messages: ChatUiMessage[]): ChatUiMessage[] {
  return messages.map((message) => {
    if (!message.parts.some((part) => part.type === "file")) {
      return message;
    }

    const parts = message.parts.map((part) => {
      if (part.type !== "file") {
        return part;
      }

      const mediaType = normalizeInlineAttachmentMediaType(part.filename, part.mediaType);
      if (mediaType === part.mediaType) {
        return part;
      }

      return {
        ...part,
        mediaType,
      };
    });

    return { ...message, parts };
  });
}

export function rewriteUnsupportedFilePartsAsAnnotations(
  messages: ChatUiMessage[],
): ChatUiMessage[] {
  return messages.map((message) => {
    if (message.parts.length === 0) {
      return message;
    }

    const kept: ChatUiMessagePart[] = [];
    const dataFiles: UploadedFileReference[] = [];

    for (const part of message.parts) {
      if (part.type !== "file") {
        kept.push(part);
        continue;
      }

      const normalizedMediaType = normalizeInlineAttachmentMediaType(part.filename, part.mediaType);
      if (isModelSupportedFileMediaType(normalizedMediaType)) {
        kept.push({
          ...part,
          mediaType: normalizedMediaType,
        });
        continue;
      }

      dataFiles.push({
        name: part.filename || "file",
        mediaType: normalizedMediaType,
        ...(part.url ? { url: part.url } : {}),
        ...(part.uploadId ? { uploadId: part.uploadId } : {}),
        ...(part.uploadPath ? { path: part.uploadPath } : {}),
      });
    }

    if (dataFiles.length === 0) {
      return message;
    }

    const annotation = buildDataFileAnnotation(dataFiles);
    const lastTextIndex = kept.findLastIndex((part) => part.type === "text");

    if (lastTextIndex >= 0) {
      const textPart = kept[lastTextIndex];
      if (textPart.type === "text") {
        kept[lastTextIndex] = { type: "text", text: textPart.text + annotation };
      }
    } else {
      kept.push({ type: "text", text: annotation.trimStart() });
    }

    return { ...message, parts: kept };
  });
}

function isPendingToolPart(part: unknown): boolean {
  if (!isRecord(part) || typeof part.type !== "string") {
    return false;
  }

  const state = typeof part.state === "string" ? part.state : null;
  const isPendingState = state === "pending" || state === "input-available" ||
    state === "input-streaming";
  if (!isPendingState) {
    return false;
  }

  return part.type === "dynamic-tool" || part.type === "tool_call" || part.type.startsWith("tool-");
}

export function stripPendingToolParts(messages: ChatUiMessage[]): ChatUiMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant" || message.parts.length === 0) {
      return [message];
    }

    const parts = message.parts.filter((part) => !isPendingToolPart(part));
    if (parts.length === message.parts.length) {
      return [message];
    }

    if (parts.length === 0) {
      return [];
    }

    return [{ ...message, parts }];
  });
}

function isKeepableModelPart(part: unknown, includeReasoning: boolean): boolean {
  if (!isRecord(part) || typeof part.type !== "string") return false;

  switch (part.type) {
    case "text":
      return typeof part.text === "string" && part.text.trim().length > 0;
    case "reasoning":
      return includeReasoning;
    case "tool-call":
    case "tool-result":
    case "image":
      return true;
    case "file": {
      const hasMediaType = typeof part.mediaType === "string" && part.mediaType.length > 0;
      if (!hasMediaType) {
        return false;
      }

      const url = typeof part.url === "string" ? part.url : "";
      if (url.startsWith("data:image/") && part.filename === "preview-screenshot.png") {
        return false;
      }
      return true;
    }
    default:
      return true;
  }
}

function hasValidContent(message: ProviderModelMessage): boolean {
  const content = message.content;

  if (content === undefined || content === null) return false;
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content)) return content.some((part) => isKeepableModelPart(part, false));
  return true;
}

function cleanContent<T>(content: T[]): T[] {
  const hasSubstantiveContent = content.some((part) => isKeepableModelPart(part, false));
  return content.filter((part) => isKeepableModelPart(part, hasSubstantiveContent));
}

export function sanitizeProviderModelMessages(
  messages: ProviderModelMessage[],
): ProviderModelMessage[] {
  const result: ProviderModelMessage[] = [];

  for (const message of messages) {
    if (Array.isArray(message.content)) {
      if (message.role === "user") {
        const cleaned = cleanContent(message.content);
        if (cleaned.length > 0) result.push({ ...message, content: cleaned });
      } else if (message.role === "assistant") {
        const cleaned = cleanContent(message.content);
        if (cleaned.length > 0) result.push({ ...message, content: cleaned });
      } else if (message.role === "tool") {
        const cleaned = cleanContent(message.content);
        if (cleaned.length > 0) result.push({ ...message, content: cleaned });
      }
      continue;
    }

    if (hasValidContent(message)) {
      result.push(message);
    }
  }

  return result;
}

/**
 * @deprecated Use sanitizeProviderModelMessages for provider-facing model payloads.
 */
export const sanitizeModelMessages = sanitizeProviderModelMessages;

function filterValidMessages(messages: ProviderModelMessage[]): ProviderModelMessage[] {
  return messages.filter((message) => {
    const content = message.content;
    if (content === undefined || content === null) return false;
    if (typeof content === "string") return content.trim().length > 0;
    if (Array.isArray(content)) return content.length > 0;
    return true;
  });
}

export function prepareProviderModelMessagesFromUiMessages(
  messages: ChatUiMessage[],
): ProviderModelMessage[] {
  const validMessages = messages.filter((message) =>
    message && typeof message === "object" && "role" in message
  );
  const normalizedMessages = normalizeMessageFilePartMediaTypes(validMessages);
  const strippedPendingToolMessages = stripPendingToolParts(normalizedMessages);
  const rewrittenMessages = rewriteUnsupportedFilePartsAsAnnotations(strippedPendingToolMessages);
  const providerModelMessages = convertUiMessagesToProviderModelMessages(rewrittenMessages);
  const patchedMessages = ensureToolCallInputs(dedupeToolHistory(providerModelMessages));
  const sanitized = sanitizeProviderModelMessages(patchedMessages);
  const masked = maskOldToolOutputs(sanitized);
  const compacted = enforceTokenBudget(masked);
  const filtered = filterValidMessages(compacted);
  return repairToolPairs(filtered);
}

function buildToolCallMap(messages: ProviderModelMessage[]): Map<string, ToolCallInfo> {
  const map = new Map<string, ToolCallInfo>();

  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (isToolCallPart(part)) {
        map.set(part.toolCallId, { toolName: part.toolName, input: part.input });
      }
    }
  }

  return map;
}

function maskReadFile(input: unknown, charCount: number): string {
  const path = getStringField(input, "path", "unknown");
  return `[File read: ${path} — content omitted (${charCount} chars)]`;
}

function maskBash(input: unknown, output: unknown, charCount: number): string {
  const cmd = truncate(getStringField(input, "command", "unknown"), 80);
  let exitCode = "?";
  const parsed = tryParseJson(output);
  if (isRecord(parsed) && "exitCode" in parsed) {
    exitCode = String(parsed.exitCode);
  }
  return `[Command: ${cmd} — exit ${exitCode}, output omitted (${charCount} chars)]`;
}

function maskWebSearch(output: unknown): unknown {
  const parsed = tryParseJson(output);
  if (!Array.isArray(parsed)) return output;
  return parsed.map((item: unknown) => {
    if (!isRecord(item)) return item;
    const { encryptedContent: _, ...rest } = item;
    return rest;
  });
}

function maskWebFetch(input: unknown, charCount: number): string {
  const url = getStringField(input, "url", "unknown");
  return `[Fetched: ${url} — content omitted (${charCount} chars)]`;
}

function maskTask(output: unknown, charCount: number): unknown {
  const parsed = tryParseJson(output);
  if (!isRecord(parsed)) {
    return `[task output omitted (${charCount} chars)]`;
  }

  const masked: Record<string, unknown> = {};

  if ("success" in parsed) masked.success = parsed.success;
  if ("description" in parsed) masked.description = parsed.description;
  if ("result" in parsed) {
    masked.result = typeof parsed.result === "string"
      ? truncate(parsed.result, 500)
      : parsed.result;
  }

  return masked;
}

function maskGeneric(toolName: string, charCount: number): string {
  return `[${toolName} output omitted (${charCount} chars)]`;
}

function getOutputValue(output: unknown): unknown {
  if (!isRecord(output)) return output;
  if ((output.type === "text" || output.type === "json") && "value" in output) {
    return output.value;
  }
  return output;
}

function wrapToolResultOutput(
  original: ChatToolResultOutput,
  newValue: unknown,
): ChatToolResultOutput {
  const textValue = typeof newValue === "string" ? newValue : JSON.stringify(newValue);
  if (original.type === "text") {
    return { ...original, value: textValue };
  }
  if (original.type === "json") {
    return { type: "text", value: textValue };
  }
  return original;
}

export function maskOldToolOutputs(messages: ProviderModelMessage[]): ProviderModelMessage[] {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx <= 0) return messages;

  const toolCallMap = buildToolCallMap(messages);

  return messages.map((msg, idx) => {
    if (idx >= lastUserIdx) return msg;

    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const filtered = msg.content.filter((part) => !isReasoningPart(part));
      if (filtered.length !== msg.content.length) {
        return { ...msg, content: filtered };
      }
      return msg;
    }

    if (msg.role !== "tool" || !Array.isArray(msg.content)) return msg;

    const newContent: ChatToolResultPart[] = msg.content.map((part) => {
      if (part.type !== "tool-result") {
        return part;
      }

      const rawValue = getOutputValue(part.output);
      const charCount = serializedLength(rawValue);

      if (charCount < MASK_THRESHOLD) return part;

      const callInfo = toolCallMap.get(part.toolCallId);
      const toolName = part.toolName || callInfo?.toolName || "unknown";
      const input = callInfo?.input;

      let masked: unknown;

      switch (toolName) {
        case "readFile":
        case "get_file":
          masked = maskReadFile(input, charCount);
          break;
        case "bash":
          masked = maskBash(input, rawValue, charCount);
          break;
        case "web_search":
          masked = maskWebSearch(rawValue);
          break;
        case "web_fetch":
          masked = maskWebFetch(input, charCount);
          break;
        case "task":
          masked = maskTask(rawValue, charCount);
          break;
        default:
          masked = maskGeneric(toolName, charCount);
          break;
      }

      return { ...part, output: wrapToolResultOutput(part.output, masked) };
    });

    return { ...msg, content: newContent };
  });
}

function createSyntheticToolResult(toolCallId: string, toolName: string): ChatToolResultPart {
  return {
    type: "tool-result",
    toolCallId,
    toolName,
    output: { type: "text", value: "[tool result unavailable]" },
  };
}

export function repairToolPairs(messages: ProviderModelMessage[]): ProviderModelMessage[] {
  const result = [...messages];
  let mutated = false;

  for (let index = 0; index < result.length; index++) {
    const message = result[index];
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }

    const inlineResultIds = new Set<string>();
    for (const part of message.content) {
      if (isToolResultPart(part)) {
        inlineResultIds.add(part.toolCallId);
      }
    }

    const repairedContent: typeof message.content = [];
    const regularToolCalls: Array<{ id: string; toolName: string }> = [];

    for (const part of message.content) {
      repairedContent.push(part);

      if (!isToolCallPart(part)) {
        continue;
      }

      const toolName = part.toolName ?? "unknown";

      if (part.providerExecuted) {
        if (!inlineResultIds.has(part.toolCallId)) {
          repairedContent.push(createSyntheticToolResult(part.toolCallId, toolName));
          mutated = true;
        }
        continue;
      }

      if (!inlineResultIds.has(part.toolCallId)) {
        regularToolCalls.push({ id: part.toolCallId, toolName });
      }
    }

    if (repairedContent.length !== message.content.length) {
      result[index] = {
        ...message,
        content: repairedContent,
      };
    }

    if (regularToolCalls.length === 0) {
      continue;
    }

    const nextMessage = result[index + 1];
    const immediateResultIds = new Set<string>();

    if (nextMessage?.role === "tool" && Array.isArray(nextMessage.content)) {
      for (const part of nextMessage.content) {
        if (isToolResultPart(part)) {
          immediateResultIds.add(part.toolCallId);
        }
      }
    }

    const unresolvedCalls = regularToolCalls.filter((toolCall) =>
      !immediateResultIds.has(toolCall.id)
    );
    if (unresolvedCalls.length === 0) {
      continue;
    }

    const movedResults = new Map<string, ChatToolResultPart>();

    for (
      let laterIndex = index + 2;
      laterIndex < result.length && movedResults.size < unresolvedCalls.length;
      laterIndex++
    ) {
      const laterMessage = result[laterIndex];
      if (laterMessage?.role !== "tool" || !Array.isArray(laterMessage.content)) {
        continue;
      }

      let removedFromLater = false;
      const keptLaterContent = laterMessage.content.filter((part) => {
        if (!isToolResultPart(part)) {
          return true;
        }

        if (
          !unresolvedCalls.some((toolCall) => toolCall.id === part.toolCallId) ||
          movedResults.has(part.toolCallId)
        ) {
          return true;
        }

        movedResults.set(part.toolCallId, part);
        removedFromLater = true;
        return false;
      });

      if (!removedFromLater) {
        continue;
      }

      mutated = true;
      if (keptLaterContent.length === 0) {
        result.splice(laterIndex, 1);
        laterIndex--;
        continue;
      }

      result[laterIndex] = {
        ...laterMessage,
        content: keptLaterContent,
      };
    }

    const repairedResults = unresolvedCalls.map(
      (toolCall) =>
        movedResults.get(toolCall.id) ?? createSyntheticToolResult(toolCall.id, toolCall.toolName),
    );

    if (nextMessage?.role === "tool" && Array.isArray(nextMessage.content)) {
      result[index + 1] = {
        ...nextMessage,
        content: [...repairedResults, ...nextMessage.content],
      };
    } else {
      const toolMessage: ProviderModelMessage = {
        role: "tool",
        content: repairedResults,
      };
      result.splice(index + 1, 0, toolMessage);
    }
    mutated = true;
  }

  return mutated ? result : messages;
}

export function estimateOverhead(instructions: unknown, toolCount: number): number {
  const instructionTokens = estimateTokens(instructions);
  return instructionTokens + toolCount * TOKENS_PER_TOOL;
}

export function ensureToolCallInputs(messages: ProviderModelMessage[]): ProviderModelMessage[] {
  let mutated = false;

  const result = messages.map((msg) => {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg;

    let msgMutated = false;
    const newContent = msg.content.map((part) => {
      if (isToolCallPart(part)) {
        const input = part.input;
        if (
          input === undefined || input === null || typeof input !== "object" || Array.isArray(input)
        ) {
          msgMutated = true;
          return { ...part, input: {} };
        }
      }
      return part;
    });

    if (msgMutated) {
      mutated = true;
      return { ...msg, content: newContent };
    }
    return msg;
  });

  return mutated ? result : messages;
}

export function compactForStep(
  messages: ProviderModelMessage[],
  overhead: number = 0,
): ProviderModelMessage[] {
  const compacted = enforceTokenBudget(
    maskOldToolOutputs(messages),
    DEFAULT_TOKEN_BUDGET,
    overhead,
  );

  let end = compacted.length;
  while (end > 1 && compacted[end - 1].role === "assistant") {
    end--;
  }

  const trimmed = end < compacted.length ? compacted.slice(0, end) : compacted;

  return ensureToolCallInputs(repairToolPairs(dedupeToolHistory(trimmed)));
}

export function dedupeToolHistory(messages: ProviderModelMessage[]): ProviderModelMessage[] {
  const seenToolCallIds = new Set<string>();
  const seenToolResultIds = new Set<string>();
  let mutated = false;

  const deduped: ProviderModelMessage[] = [];

  const filterParts = <T>(parts: T[]): { filtered: T[]; changed: boolean } => {
    const filtered = parts.filter((part) => {
      if (isToolCallPart(part)) {
        if (seenToolCallIds.has(part.toolCallId)) {
          mutated = true;
          return false;
        }
        seenToolCallIds.add(part.toolCallId);
        return true;
      }
      if (isToolResultPart(part)) {
        if (seenToolResultIds.has(part.toolCallId)) {
          mutated = true;
          return false;
        }
        seenToolResultIds.add(part.toolCallId);
        return true;
      }
      return true;
    });
    return { filtered, changed: filtered.length !== parts.length };
  };

  for (const message of messages) {
    if (message.role === "user" && Array.isArray(message.content)) {
      const { filtered, changed } = filterParts(message.content);
      if (!changed) {
        deduped.push(message);
        continue;
      }
      if (filtered.length > 0) deduped.push({ ...message, content: filtered });
    } else if (message.role === "assistant" && Array.isArray(message.content)) {
      const { filtered, changed } = filterParts(message.content);
      if (!changed) {
        deduped.push(message);
        continue;
      }
      if (filtered.length > 0) deduped.push({ ...message, content: filtered });
    } else if (message.role === "tool") {
      const { filtered, changed } = filterParts(message.content);
      if (!changed) {
        deduped.push(message);
        continue;
      }
      if (filtered.length > 0) deduped.push({ ...message, content: filtered });
    } else {
      deduped.push(message);
    }
  }

  return mutated ? deduped : messages;
}

export function enforceTokenBudget(
  messages: ProviderModelMessage[],
  budget: number = DEFAULT_TOKEN_BUDGET,
  overhead: number = 0,
): ProviderModelMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  return enforceTokenBudgetWithTurnCompression(messages, budget, overhead);
}

/**
 * @deprecated Use prepareProviderModelMessagesFromUiMessages for provider-facing model payloads.
 */
export const prepareModelMessagesFromUiMessages = prepareProviderModelMessagesFromUiMessages;
