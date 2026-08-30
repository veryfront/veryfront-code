import { PROVIDER_REPLAY_CHECKPOINT_INVALID } from "#veryfront/errors";
import {
  attachProviderMetadata,
  markProviderReplayDelivered,
  readAttachedProviderMetadata,
} from "#veryfront/agent/runtime/provider-metadata.ts";
import { stringifyChatJson } from "#veryfront/chat/json-value.ts";
import { snapshotProviderJsonValue } from "#veryfront/provider/runtime-loader.ts";
import { safeJsonParse } from "#veryfront/utils/json.ts";
import type { Message } from "../types.ts";
import { convertAgentRuntimeMessagesToProviderMessages } from "./message-adapter.ts";
import {
  MAX_PROVIDER_REPLAY_RAW_METADATA_DEPTH,
  MAX_PROVIDER_REPLAY_RAW_METADATA_NODES,
  MAX_PROVIDER_REPLAY_RAW_METADATA_STRING_CHARS,
} from "./provider-replay-limits.ts";
import { MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES } from "#veryfront/agent/conversation/run-event-limits.ts";
import {
  collectAnthropicProviderToolCallIds,
  groupAnthropicRawAssistantMessagesByAnchor,
  isAnthropicProviderToolResultBlock,
} from "./anthropic-provider-replay-block.ts";
import { readOwnDataProperty } from "./data-property-descriptor.ts";

const MAX_PROVIDER_REPLAY_BLOCKS = 100;
const MAX_PROVIDER_REPLAY_CHECKPOINTS = 100;
const MAX_PROVIDER_REPLAY_TOTAL_PARTS = 10_000;
const MAX_PROVIDER_REPLAY_MESSAGE_ID_LENGTH = 256;
const UTF8_ENCODER = new TextEncoder();

const CHECKPOINT_KEYS = new Set([
  "version",
  "messageId",
  "provider",
  "providerBlocks",
  "providerBlockPositions",
  "providerMessageBlockCounts",
  "totalPartCount",
  "elapsedMs",
  "emittedAt",
]);
const BLOCK_KEYS = new Set(["type", "provider", "block"]);
const WEB_SEARCH_ERROR_CODES = new Set([
  "invalid_tool_input",
  "unavailable",
  "max_uses_exceeded",
  "too_many_requests",
  "query_too_long",
  "request_too_large",
]);
const WEB_FETCH_ERROR_CODES = new Set([
  "invalid_tool_input",
  "url_too_long",
  "url_not_allowed",
  "url_not_in_prior_context",
  "url_not_accessible",
  "unsupported_content_type",
  "too_many_requests",
  "max_uses_exceeded",
  "unavailable",
]);
const CODE_EXECUTION_ERROR_CODES = new Set([
  "invalid_tool_input",
  "unavailable",
  "too_many_requests",
  "execution_time_exceeded",
]);
const BASH_CODE_EXECUTION_ERROR_CODES = new Set([
  ...CODE_EXECUTION_ERROR_CODES,
  "output_file_too_large",
]);
const TEXT_EDITOR_CODE_EXECUTION_ERROR_CODES = new Set([
  ...CODE_EXECUTION_ERROR_CODES,
  "file_not_found",
]);
/** Providers whose continuation contract can require opaque block replay. */
export type ProviderReplayProvider = "anthropic" | "openai-responses";

/** One opaque provider content block replayed byte-exact on resume. */
export type ProviderReplayBlock = {
  type: "provider-block";
  provider: ProviderReplayProvider;
  block: Record<string, unknown>;
};

/**
 * Provider-native replay state for one persisted assistant turn.
 *
 * Blocks are ordered by their original position within the turn; positions are
 * strictly increasing and bounded by `totalPartCount`. Block contents may carry
 * signed reasoning material and must never be logged or rendered as text.
 */
export type ProviderReplayCheckpoint = {
  version: 1;
  messageId: string;
  provider: ProviderReplayProvider;
  providerBlocks: ProviderReplayBlock[];
  providerBlockPositions: number[];
  /**
   * Optional raw Anthropic assistant-message grouping. Absent means the
   * historical stage-1 shape: all blocks came from one raw assistant message.
   */
  providerMessageBlockCounts?: number[];
  totalPartCount: number;
  elapsedMs?: number;
  emittedAt?: number;
};

/** Private durable event discriminator for provider-native replay state. */
export const AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE =
  "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT" as const;

/** Private durable event carrying provider-native replay state. */
export type ProviderReplayCheckpointEvent = ProviderReplayCheckpoint & {
  type: typeof AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE;
};

/** Run-local state accumulated until a provider turn requires opaque replay. */
export type ProviderReplayCheckpointEmissionState = {
  messageId: string;
  rawAssistantMessages: Record<string, unknown>[][];
  replayRequired: boolean;
};

type ApplyProviderReplayCheckpointsOptions = {
  activeProvider?: ProviderReplayProvider | "unsupported";
};

/**
 * Fails checkpoint validation without echoing payload contents. Blocks carry
 * signed reasoning material, so details name fields and indices only.
 */
function invalidCheckpoint(detail: string, context?: Record<string, unknown>): never {
  throw PROVIDER_REPLAY_CHECKPOINT_INVALID.create({ detail, ...(context ? { context } : {}) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isProviderReplayProvider(value: unknown): value is ProviderReplayProvider {
  return value === "anthropic" || value === "openai-responses";
}

function isReplayRequiredAnthropicBlock(block: Record<string, unknown>): boolean {
  return block.type === "thinking" || block.type === "redacted_thinking";
}

function snapshotAnthropicRawAssistantMessagesForEmission(
  providerMetadata: Record<string, unknown> | undefined,
): Record<string, unknown>[][] | undefined {
  if (providerMetadata === undefined) return undefined;
  const anthropic = readOwnDataProperty(
    providerMetadata,
    "anthropic",
    "provider metadata",
    false,
  );
  if (anthropic === undefined) return undefined;
  const rawAssistantMessages = readOwnDataProperty(
    anthropic,
    "rawAssistantMessages",
    "Anthropic provider metadata",
    false,
  );
  if (rawAssistantMessages === undefined) return undefined;

  let snapshot: unknown;
  try {
    snapshot = snapshotProviderJsonValue(rawAssistantMessages, {
      maxDepth: MAX_PROVIDER_REPLAY_RAW_METADATA_DEPTH,
      maxNodes: MAX_PROVIDER_REPLAY_RAW_METADATA_NODES,
      maxBytes: MAX_PROVIDER_REPLAY_RAW_METADATA_STRING_CHARS,
    });
  } catch {
    invalidCheckpoint("provider replay emission metadata exceeds raw metadata bounds");
  }
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    invalidCheckpoint("provider replay emission metadata must contain raw assistant messages");
  }
  const groups: Record<string, unknown>[][] = [];
  for (const [messageIndex, rawAssistantMessage] of snapshot.entries()) {
    if (!Array.isArray(rawAssistantMessage) || rawAssistantMessage.length === 0) {
      invalidCheckpoint("provider replay emission raw assistant message must contain blocks", {
        messageIndex,
      });
    }
    const blocks: Record<string, unknown>[] = [];
    for (const [blockIndex, block] of rawAssistantMessage.entries()) {
      if (!isRecord(block)) {
        invalidCheckpoint("provider replay emission block must be an object", {
          messageIndex,
          blockIndex,
        });
      }
      blocks.push(block);
    }
    groups.push(blocks);
  }
  return groups;
}

/** Create an emitter state, optionally continuing the latest checkpoint for this run message. */
export function createProviderReplayCheckpointEmissionState(input: {
  messageId: string;
  existingCheckpoint?: ProviderReplayCheckpoint;
}): ProviderReplayCheckpointEmissionState {
  if (
    !isNonEmptyString(input.messageId) ||
    input.messageId.length > MAX_PROVIDER_REPLAY_MESSAGE_ID_LENGTH
  ) {
    invalidCheckpoint("provider replay emission messageId must be a bounded non-empty string");
  }
  if (
    input.existingCheckpoint?.messageId !== undefined &&
    input.existingCheckpoint.messageId !== input.messageId
  ) {
    invalidCheckpoint(
      "provider replay emission checkpoint messageId does not match the run message",
    );
  }
  if (input.existingCheckpoint && input.existingCheckpoint.provider !== "anthropic") {
    invalidCheckpoint("provider replay emission can only continue an Anthropic checkpoint");
  }
  const rawAssistantMessages = input.existingCheckpoint
    ? getRawAssistantMessagesForCheckpoint(input.existingCheckpoint)
    : [];
  return {
    messageId: input.messageId,
    rawAssistantMessages: rawAssistantMessages.map((blocks) => [...blocks]),
    replayRequired: rawAssistantMessages.some((blocks) =>
      blocks.some(isReplayRequiredAnthropicBlock)
    ),
  };
}

/** Capture one provider step and return its cumulative checkpoint once replay is required. */
export function captureProviderReplayCheckpoint(
  state: ProviderReplayCheckpointEmissionState,
  providerMetadata: Record<string, unknown> | undefined,
): ProviderReplayCheckpoint | undefined {
  const rawAssistantMessages = snapshotAnthropicRawAssistantMessagesForEmission(providerMetadata);
  if (rawAssistantMessages === undefined) return undefined;
  state.rawAssistantMessages.push(...rawAssistantMessages);
  state.replayRequired ||= rawAssistantMessages.some((blocks) =>
    blocks.some(isReplayRequiredAnthropicBlock)
  );
  if (!state.replayRequired) return undefined;

  const blocks = state.rawAssistantMessages.flat();
  const checkpoint = parseProviderReplayCheckpoint({
    version: 1,
    messageId: state.messageId,
    provider: "anthropic",
    providerBlocks: blocks.map((block) => ({
      type: "provider-block",
      provider: "anthropic",
      block,
    })),
    providerBlockPositions: blocks.map((_, index) => index),
    providerMessageBlockCounts: state.rawAssistantMessages.map((group) => group.length),
    totalPartCount: blocks.length,
  });
  const eventForSizeCheck = {
    ...createProviderReplayCheckpointEvent(checkpoint),
    elapsedMs: Number.MAX_SAFE_INTEGER,
    emittedAt: Number.MAX_SAFE_INTEGER,
  };
  // The checkpoint is cumulative across the durable assistant turn. Exceeding
  // the mirror's event budget fails the run rather than silently dropping the
  // replay state. Monitor checkpoint sizes before enabling the host gate.
  if (
    UTF8_ENCODER.encode(stringifyChatJson(eventForSizeCheck)).byteLength >
      MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES
  ) {
    invalidCheckpoint("provider replay checkpoint event exceeds the durable event limit");
  }
  return checkpoint;
}

/** Encode a private checkpoint for the trusted run-event append path. */
export function createProviderReplayCheckpointEvent(
  checkpoint: ProviderReplayCheckpoint,
): ProviderReplayCheckpointEvent {
  return {
    type: AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE,
    ...checkpoint,
  };
}

/** Parse a private durable provider replay event without exposing its opaque contents. */
export function parseProviderReplayCheckpointEvent(
  value: unknown,
): ProviderReplayCheckpointEvent {
  let snapshot: unknown;
  try {
    snapshot = snapshotProviderJsonValue(value, {
      maxDepth: MAX_PROVIDER_REPLAY_RAW_METADATA_DEPTH,
      maxNodes: MAX_PROVIDER_REPLAY_RAW_METADATA_NODES,
      maxBytes: MAX_PROVIDER_REPLAY_RAW_METADATA_STRING_CHARS,
    });
  } catch {
    invalidCheckpoint("provider replay checkpoint event exceeds raw metadata bounds");
  }
  if (!isRecord(snapshot) || snapshot.type !== AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE) {
    invalidCheckpoint("provider replay checkpoint event type is invalid");
  }
  const checkpointValue: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(snapshot)) {
    if (key !== "type") checkpointValue[key] = entry;
  }
  return {
    type: AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE,
    ...parseProviderReplayCheckpoint(checkpointValue),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNullableNonNegativeSafeInteger(value: unknown): value is number | null {
  return value === null ||
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function assertRawProviderMetadataBounds(
  value: unknown,
  context?: Record<string, unknown>,
  detail = "checkpoint provider block exceeds raw metadata bounds",
): void {
  try {
    snapshotProviderJsonValue(value, {
      maxDepth: MAX_PROVIDER_REPLAY_RAW_METADATA_DEPTH,
      maxNodes: MAX_PROVIDER_REPLAY_RAW_METADATA_NODES,
      maxBytes: MAX_PROVIDER_REPLAY_RAW_METADATA_STRING_CHARS,
    });
  } catch {
    invalidCheckpoint(detail, context);
  }
}

function isSupportedAnthropicServerToolCaller(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (value.type === "direct") return true;
  return (
    value.type === "code_execution_20250825" || value.type === "code_execution_20260120"
  ) && isNonEmptyString(value.tool_id);
}

function toCanonicalAnthropicToolCall(
  block: Record<string, unknown>,
  providerExecuted: boolean,
): Record<string, unknown> {
  const input = block.input === undefined ? {} : block.input;
  if (!isNonEmptyString(block.id) || !isNonEmptyString(block.name) || !isRecord(input)) {
    invalidCheckpoint("checkpoint tool-use block is malformed");
  }
  if (block.type === "server_tool_use" && !isSupportedAnthropicServerToolCaller(block.caller)) {
    invalidCheckpoint("checkpoint server tool-use caller is malformed");
  }
  if (block.type === "mcp_tool_use" && !isNonEmptyString(block.server_name)) {
    invalidCheckpoint("checkpoint MCP tool-use server is malformed");
  }
  return {
    type: "tool-call",
    toolCallId: block.id,
    toolName: block.name,
    input,
    ...(providerExecuted ? { providerExecuted: true } : {}),
  };
}

function validateAnthropicThinkingReplayBlock(
  block: Record<string, unknown>,
  context?: Record<string, unknown>,
): void {
  if (block.thinking !== undefined && typeof block.thinking !== "string") {
    invalidCheckpoint("checkpoint thinking block is malformed", context);
  }
  if (block.signature !== undefined && typeof block.signature !== "string") {
    invalidCheckpoint("checkpoint thinking block is malformed", context);
  }
  if (block.thinking === undefined && block.signature === undefined) {
    invalidCheckpoint("checkpoint thinking block is malformed", context);
  }
}

// Container shape only; the per-field schema stays with the provider parser.
// mcp_tool_result carries a string or an array, web_search_tool_result an array
// of results or an error record, and every other supported result a record.
function hasSupportedAnthropicProviderToolResultContent(
  block: Record<string, unknown>,
): boolean {
  if (block.type === "mcp_tool_result") {
    return typeof block.content === "string" || Array.isArray(block.content);
  }
  if (block.type === "web_search_tool_result") {
    return Array.isArray(block.content) || isRecord(block.content);
  }
  return isRecord(block.content);
}

function validateAnthropicProviderToolResultBlock(
  block: Record<string, unknown>,
  context?: Record<string, unknown>,
): void {
  if (!isNonEmptyString(block.tool_use_id)) {
    invalidCheckpoint("checkpoint provider tool-result block is malformed", context);
  }
  if (!hasSupportedAnthropicProviderToolResultContent(block)) {
    invalidCheckpoint("checkpoint provider tool-result block is malformed", context);
  }
  if (block.type === "mcp_tool_result" && typeof block.is_error !== "boolean") {
    invalidCheckpoint("checkpoint provider tool-result block is malformed", context);
  }
  if (block.type === "mcp_tool_result") {
    if (!hasValidAnthropicMcpContent(block.content)) {
      invalidCheckpoint("checkpoint MCP tool-result content is malformed", context);
    }
    return;
  }
  const toolName = getAnthropicToolNameForResultBlock(block);
  if (
    toolName === undefined ||
    !hasValidAnthropicProviderToolResultContentForTool(block, toolName)
  ) {
    invalidCheckpoint("checkpoint provider tool-result content is malformed", context);
  }
}

function validateAnthropicReplayBlock(
  block: Record<string, unknown>,
  context?: Record<string, unknown>,
): void {
  switch (block.type) {
    case "text":
      if (typeof block.text !== "string") {
        invalidCheckpoint("checkpoint text block is malformed", context);
      }
      return;
    case "thinking":
      validateAnthropicThinkingReplayBlock(block, context);
      return;
    case "redacted_thinking":
      if (!isNonEmptyString(block.data)) {
        invalidCheckpoint("checkpoint redacted thinking block is malformed", context);
      }
      return;
    case "tool_use":
      toCanonicalAnthropicToolCall(block, false);
      return;
    case "server_tool_use":
    case "mcp_tool_use":
      toCanonicalAnthropicToolCall(block, true);
      return;
    default:
      if (isAnthropicProviderToolResultBlock(block)) {
        validateAnthropicProviderToolResultBlock(block, context);
        return;
      }
      invalidCheckpoint("checkpoint provider block cannot be projected for validation", context);
  }
}

function hasValidAnthropicErrorContent(
  content: Record<string, unknown>,
  type: string,
  allowedCodes?: ReadonlySet<string>,
): boolean {
  return content.type === type &&
    isNonEmptyString(content.error_code) &&
    (allowedCodes === undefined || allowedCodes.has(content.error_code));
}

function hasValidAnthropicMcpContent(value: unknown): boolean {
  if (typeof value === "string") return true;
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") return false;
    const citations = item.citations;
    return citations === undefined || citations === null ||
      Array.isArray(citations) &&
        citations.every((citation) => isRecord(citation) && isNonEmptyString(citation.type));
  });
}

function normalizeAnthropicMcpContent(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!isRecord(item)) return item;
    return {
      type: "text",
      text: item.text,
      ...(item.citations === undefined ? {} : { citations: item.citations }),
    };
  });
}

function hasValidAnthropicFileOutputs(
  value: unknown,
  expectedType: "code_execution_output" | "bash_code_execution_output",
): boolean {
  return Array.isArray(value) &&
    value.every((item) =>
      isRecord(item) && item.type === expectedType && isNonEmptyString(item.file_id)
    );
}

function hasValidAnthropicCodeExecutionContent(content: Record<string, unknown>): boolean {
  if (
    hasValidAnthropicErrorContent(
      content,
      "code_execution_tool_result_error",
      CODE_EXECUTION_ERROR_CODES,
    )
  ) {
    return true;
  }
  if (content.type === "code_execution_result") {
    return typeof content.stdout === "string" &&
      typeof content.stderr === "string" &&
      isSafeInteger(content.return_code) &&
      hasValidAnthropicFileOutputs(content.content, "code_execution_output");
  }
  if (content.type === "encrypted_code_execution_result") {
    return typeof content.encrypted_stdout === "string" &&
      typeof content.stderr === "string" &&
      isSafeInteger(content.return_code) &&
      hasValidAnthropicFileOutputs(content.content, "code_execution_output");
  }
  return false;
}

function hasValidAnthropicBashCodeExecutionContent(content: Record<string, unknown>): boolean {
  if (
    hasValidAnthropicErrorContent(
      content,
      "bash_code_execution_tool_result_error",
      BASH_CODE_EXECUTION_ERROR_CODES,
    )
  ) {
    return true;
  }
  return content.type === "bash_code_execution_result" &&
    typeof content.stdout === "string" &&
    typeof content.stderr === "string" &&
    isSafeInteger(content.return_code) &&
    hasValidAnthropicFileOutputs(content.content, "bash_code_execution_output");
}

function hasValidAnthropicTextEditorCodeExecutionContent(
  content: Record<string, unknown>,
): boolean {
  if (
    hasValidAnthropicErrorContent(
      content,
      "text_editor_code_execution_tool_result_error",
      TEXT_EDITOR_CODE_EXECUTION_ERROR_CODES,
    )
  ) {
    return "error_message" in content &&
      (content.error_message === null || typeof content.error_message === "string");
  }
  if (content.type === "text_editor_code_execution_view_result") {
    return typeof content.content === "string" &&
      (content.file_type === "text" ||
        content.file_type === "image" ||
        content.file_type === "pdf") &&
      "num_lines" in content &&
      isNullableNonNegativeSafeInteger(content.num_lines) &&
      "start_line" in content &&
      isNullableNonNegativeSafeInteger(content.start_line) &&
      "total_lines" in content &&
      isNullableNonNegativeSafeInteger(content.total_lines);
  }
  if (content.type === "text_editor_code_execution_create_result") {
    return typeof content.is_file_update === "boolean";
  }
  if (content.type === "text_editor_code_execution_str_replace_result") {
    return "lines" in content &&
      (content.lines === null ||
        Array.isArray(content.lines) &&
          content.lines.every((line) => typeof line === "string")) &&
      "old_start" in content &&
      isNullableNonNegativeSafeInteger(content.old_start) &&
      "old_lines" in content &&
      isNullableNonNegativeSafeInteger(content.old_lines) &&
      "new_start" in content &&
      isNullableNonNegativeSafeInteger(content.new_start) &&
      "new_lines" in content &&
      isNullableNonNegativeSafeInteger(content.new_lines);
  }
  return false;
}

function hasValidAnthropicWebSearchContent(content: unknown): boolean {
  if (isRecord(content)) {
    return hasValidAnthropicErrorContent(
      content,
      "web_search_tool_result_error",
      WEB_SEARCH_ERROR_CODES,
    );
  }
  return Array.isArray(content) &&
    content.every((item) =>
      isRecord(item) &&
      item.type === "web_search_result" &&
      isNonEmptyString(item.url) &&
      typeof item.title === "string" &&
      typeof item.encrypted_content === "string" &&
      "page_age" in item &&
      (item.page_age === null || typeof item.page_age === "string")
    );
}

function hasValidAnthropicWebFetchSource(value: unknown): boolean {
  if (!isRecord(value) || typeof value.data !== "string") return false;
  return value.type === "text" && value.media_type === "text/plain" ||
    value.type === "base64" && value.media_type === "application/pdf";
}

function hasValidAnthropicWebFetchContent(content: Record<string, unknown>): boolean {
  if (
    hasValidAnthropicErrorContent(
      content,
      "web_fetch_tool_result_error",
      WEB_FETCH_ERROR_CODES,
    )
  ) {
    return true;
  }
  const document = isRecord(content.content) ? content.content : undefined;
  const citations = document?.citations;
  return content.type === "web_fetch_result" &&
    isNonEmptyString(content.url) &&
    "retrieved_at" in content &&
    (content.retrieved_at === null || typeof content.retrieved_at === "string") &&
    document?.type === "document" &&
    hasValidAnthropicWebFetchSource(document.source) &&
    (document.title === undefined ||
      document.title === null ||
      typeof document.title === "string") &&
    (citations === undefined ||
      citations === null ||
      (isRecord(citations) && typeof citations.enabled === "boolean"));
}

function hasValidAnthropicProviderToolResultContentForTool(
  block: Record<string, unknown>,
  toolName: string,
): boolean {
  if (block.type === "mcp_tool_result") {
    return hasValidAnthropicMcpContent(block.content);
  }
  if (toolName === "web_search") {
    return isExpectedAnthropicResultTypeForTool(block.type, toolName) &&
      isSupportedAnthropicServerToolCaller(block.caller) &&
      hasValidAnthropicWebSearchContent(block.content);
  }
  const content = isRecord(block.content) ? block.content : undefined;
  if (!content) return false;
  switch (toolName) {
    case "web_fetch":
      return isExpectedAnthropicResultTypeForTool(block.type, toolName) &&
        isSupportedAnthropicServerToolCaller(block.caller) &&
        hasValidAnthropicWebFetchContent(content);
    case "code_execution":
      return isExpectedAnthropicResultTypeForTool(block.type, toolName) &&
        hasValidAnthropicCodeExecutionContent(content);
    case "bash_code_execution":
      return isExpectedAnthropicResultTypeForTool(block.type, toolName) &&
        hasValidAnthropicBashCodeExecutionContent(content);
    case "text_editor_code_execution":
      return isExpectedAnthropicResultTypeForTool(block.type, toolName) &&
        hasValidAnthropicTextEditorCodeExecutionContent(content);
    default:
      return false;
  }
}

function normalizeAnthropicFileOutputs(
  value: unknown,
  expectedType: "code_execution_output" | "bash_code_execution_output",
): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map((item) => {
      const record = isRecord(item) ? item : {};
      return { type: expectedType, fileId: record.file_id };
    })
    : [];
}

function normalizeAnthropicWebSearchContent(content: unknown): unknown {
  const error = normalizeAnthropicProviderErrorContent(
    content,
    "web_search_tool_result_error",
    WEB_SEARCH_ERROR_CODES,
  );
  if (error !== undefined) return error;
  if (!Array.isArray(content)) return content;
  return content.map((item) => {
    if (!isRecord(item) || item.type !== "web_search_result") return item;
    return {
      type: "web_search_result",
      url: item.url,
      title: item.title,
      pageAge: item.page_age,
      encryptedContent: item.encrypted_content,
    };
  });
}

function normalizeAnthropicWebFetchSource(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.type === "text" && value.media_type === "text/plain") {
    return {
      type: "text",
      mediaType: "text/plain",
      data: value.data,
    };
  }
  if (value.type === "base64" && value.media_type === "application/pdf") {
    return {
      type: "base64",
      mediaType: "application/pdf",
      data: value.data,
    };
  }
  return value;
}

function normalizeAnthropicWebFetchContent(content: unknown): unknown {
  const error = normalizeAnthropicProviderErrorContent(
    content,
    "web_fetch_tool_result_error",
    WEB_FETCH_ERROR_CODES,
  );
  if (error !== undefined) return error;
  if (!isRecord(content) || content.type !== "web_fetch_result") return content;
  const document = isRecord(content.content) ? content.content : undefined;
  return {
    type: "web_fetch_result",
    url: content.url,
    content: document
      ? {
        type: "document",
        source: normalizeAnthropicWebFetchSource(document.source),
        ...(document.title === undefined ? {} : { title: document.title }),
        ...(document.citations === undefined ? {} : { citations: document.citations }),
      }
      : content.content,
    retrievedAt: content.retrieved_at,
  };
}

function normalizeAnthropicCodeExecutionContent(content: unknown): unknown {
  const error = normalizeAnthropicProviderErrorContent(
    content,
    "code_execution_tool_result_error",
    CODE_EXECUTION_ERROR_CODES,
  );
  if (error !== undefined) return error;
  if (!isRecord(content)) return content;
  if (content.type === "code_execution_result") {
    return {
      type: "code_execution_result",
      stdout: content.stdout,
      stderr: content.stderr,
      returnCode: content.return_code,
      content: normalizeAnthropicFileOutputs(content.content, "code_execution_output"),
    };
  }
  if (content.type === "encrypted_code_execution_result") {
    return {
      type: "encrypted_code_execution_result",
      encryptedStdout: content.encrypted_stdout,
      stderr: content.stderr,
      returnCode: content.return_code,
      content: normalizeAnthropicFileOutputs(content.content, "code_execution_output"),
    };
  }
  return content;
}

function normalizeAnthropicBashCodeExecutionContent(content: unknown): unknown {
  const error = normalizeAnthropicProviderErrorContent(
    content,
    "bash_code_execution_tool_result_error",
    BASH_CODE_EXECUTION_ERROR_CODES,
  );
  if (error !== undefined) return error;
  if (!isRecord(content) || content.type !== "bash_code_execution_result") return content;
  return {
    type: "bash_code_execution_result",
    stdout: content.stdout,
    stderr: content.stderr,
    returnCode: content.return_code,
    content: normalizeAnthropicFileOutputs(content.content, "bash_code_execution_output"),
  };
}

function normalizeAnthropicTextEditorCodeExecutionContent(content: unknown): unknown {
  const error = normalizeAnthropicProviderErrorContent(
    content,
    "text_editor_code_execution_tool_result_error",
    TEXT_EDITOR_CODE_EXECUTION_ERROR_CODES,
  );
  if (error !== undefined) return error;
  if (!isRecord(content)) return content;
  switch (content.type) {
    case "text_editor_code_execution_view_result":
      return {
        type: "text_editor_code_execution_view_result",
        content: content.content,
        fileType: content.file_type,
        numLines: content.num_lines,
        startLine: content.start_line,
        totalLines: content.total_lines,
      };
    case "text_editor_code_execution_create_result":
      return {
        type: "text_editor_code_execution_create_result",
        isFileUpdate: content.is_file_update,
      };
    case "text_editor_code_execution_str_replace_result":
      return {
        type: "text_editor_code_execution_str_replace_result",
        lines: content.lines,
        oldStart: content.old_start,
        oldLines: content.old_lines,
        newStart: content.new_start,
        newLines: content.new_lines,
      };
    default:
      return content;
  }
}

function normalizeAnthropicProviderErrorContent(
  content: unknown,
  expectedType: string,
  allowedCodes: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (!isRecord(content) || !hasValidAnthropicErrorContent(content, expectedType, allowedCodes)) {
    return undefined;
  }
  const detail = expectedType === "text_editor_code_execution_tool_result_error" &&
      typeof content.error_message === "string"
    ? content.error_message
    : undefined;
  return {
    name: "AnthropicServerToolResultError",
    provider: "anthropic",
    code: content.error_code,
    ...(detail === undefined ? {} : { detail }),
  };
}

function normalizeAnthropicProviderToolResultContent(
  block: Record<string, unknown>,
): unknown {
  const normalized = (() => {
    switch (block.type) {
      case "mcp_tool_result":
        return normalizeAnthropicMcpContent(block.content);
      case "web_search_tool_result":
        return normalizeAnthropicWebSearchContent(block.content);
      case "web_fetch_tool_result":
        return normalizeAnthropicWebFetchContent(block.content);
      case "code_execution_tool_result":
        return normalizeAnthropicCodeExecutionContent(block.content);
      case "bash_code_execution_tool_result":
        return normalizeAnthropicBashCodeExecutionContent(block.content);
      case "text_editor_code_execution_tool_result":
        return normalizeAnthropicTextEditorCodeExecutionContent(block.content);
      default:
        return block.content;
    }
  })();
  if (
    isRecord(normalized) &&
    normalized.name === "AnthropicServerToolResultError" &&
    typeof normalized.code === "string" &&
    typeof block.tool_use_id === "string"
  ) {
    const toolName = getAnthropicToolNameForResultBlock(block);
    if (toolName !== undefined) {
      return {
        ...normalized,
        toolCallId: block.tool_use_id,
        toolName,
      };
    }
  }
  return normalized;
}

function getAnthropicToolNameForResultBlock(
  block: Record<string, unknown>,
): string | undefined {
  switch (block.type) {
    case "web_search_tool_result":
      return "web_search";
    case "web_fetch_tool_result":
      return "web_fetch";
    case "code_execution_tool_result":
      return "code_execution";
    case "bash_code_execution_tool_result":
      return "bash_code_execution";
    case "text_editor_code_execution_tool_result":
      return "text_editor_code_execution";
    default:
      return undefined;
  }
}

function expectedAnthropicResultTypeForTool(toolName: string): string | undefined {
  switch (toolName) {
    case "web_search":
      return "web_search_tool_result";
    case "web_fetch":
      return "web_fetch_tool_result";
    case "code_execution":
      return "code_execution_tool_result";
    case "bash_code_execution":
      return "bash_code_execution_tool_result";
    case "text_editor_code_execution":
      return "text_editor_code_execution_tool_result";
    default:
      return undefined;
  }
}

function isExpectedAnthropicResultTypeForTool(
  blockType: unknown,
  toolName: string,
): boolean {
  if (typeof blockType !== "string") return false;
  const expectedType = expectedAnthropicResultTypeForTool(toolName);
  return expectedType !== undefined && blockType === expectedType;
}

type PendingAnthropicProviderTool = {
  readonly name: string;
  readonly type: "server_tool_use" | "mcp_tool_use";
};

type AnthropicProviderToolCorrelationState = {
  readonly pendingProviderTools: Map<string, PendingAnthropicProviderTool>;
  readonly toolUseIds: Set<string>;
};

function createAnthropicProviderToolCorrelationState(): AnthropicProviderToolCorrelationState {
  return {
    pendingProviderTools: new Map(),
    toolUseIds: new Set(),
  };
}

function resetAnthropicProviderToolCorrelationState(
  state: AnthropicProviderToolCorrelationState,
): void {
  state.pendingProviderTools.clear();
  state.toolUseIds.clear();
}

function validateAnthropicProviderToolCorrelationBlock(
  block: Record<string, unknown>,
  state: AnthropicProviderToolCorrelationState,
): void {
  if (block.type === "tool_use") {
    const toolUse = toCanonicalAnthropicToolCall(block, false);
    const toolCallId = String(toolUse.toolCallId);
    if (state.toolUseIds.has(toolCallId)) {
      invalidCheckpoint("checkpoint tool-use id is duplicated");
    }
    state.toolUseIds.add(toolCallId);
    return;
  }
  if (block.type === "server_tool_use" || block.type === "mcp_tool_use") {
    const toolUse = toCanonicalAnthropicToolCall(block, true);
    const toolCallId = String(toolUse.toolCallId);
    if (state.toolUseIds.has(toolCallId)) {
      invalidCheckpoint("checkpoint provider tool-use id is duplicated");
    }
    state.toolUseIds.add(toolCallId);
    state.pendingProviderTools.set(toolCallId, {
      name: String(toolUse.toolName),
      type: block.type,
    });
    return;
  }
  if (!isAnthropicProviderToolResultBlock(block)) {
    return;
  }
  validateAnthropicProviderToolResultBlock(block);
  const toolCallId = String(block.tool_use_id);
  const pendingProviderTool = state.pendingProviderTools.get(toolCallId);
  if (!pendingProviderTool) {
    invalidCheckpoint(
      "checkpoint provider tool-result has no matching preceding provider tool-use",
    );
  }
  if (block.type === "mcp_tool_result") {
    if (pendingProviderTool.type !== "mcp_tool_use") {
      invalidCheckpoint("checkpoint MCP tool-result type does not match its tool-use");
    }
    if (!hasValidAnthropicMcpContent(block.content)) {
      invalidCheckpoint("checkpoint MCP tool-result content is malformed");
    }
    state.pendingProviderTools.delete(toolCallId);
    return;
  }
  const toolName = pendingProviderTool.name;
  if (!isExpectedAnthropicResultTypeForTool(block.type, toolName)) {
    invalidCheckpoint("checkpoint provider tool-result type does not match its tool-use");
  }
  if (!hasValidAnthropicProviderToolResultContentForTool(block, toolName)) {
    invalidCheckpoint("checkpoint provider tool-result content is malformed");
  }
  state.pendingProviderTools.delete(toolCallId);
}

function assertAnthropicProviderToolResultsMatchTranscript(
  messages: readonly Message[],
  checkpoints: readonly ProviderReplayCheckpoint[],
): void {
  const checkpointsByMessageId = new Map<string, ProviderReplayCheckpoint>();
  for (const checkpoint of checkpoints) {
    checkpointsByMessageId.set(checkpoint.messageId, checkpoint);
  }
  const state = createAnthropicProviderToolCorrelationState();
  const visitedCheckpointMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "user" || message.role === "system") {
      resetAnthropicProviderToolCorrelationState(state);
      continue;
    }
    if (visitedCheckpointMessageIds.has(message.id)) continue;
    const checkpoint = checkpointsByMessageId.get(message.id);
    if (!checkpoint) continue;
    visitedCheckpointMessageIds.add(message.id);
    for (const replayBlock of checkpoint.providerBlocks) {
      validateAnthropicProviderToolCorrelationBlock(replayBlock.block, state);
    }
  }
}

function toTranscriptVisibleAnthropicReplayPart(
  block: Record<string, unknown>,
): Record<string, unknown> | undefined {
  validateAnthropicReplayBlock(block);
  switch (block.type) {
    case "text": {
      return { type: "text", text: block.text };
    }
    case "thinking": {
      return isNonEmptyString(block.thinking)
        ? { type: "reasoning", text: block.thinking }
        : undefined;
    }
    case "redacted_thinking":
      return undefined;
    case "tool_use":
      return toCanonicalAnthropicToolCall(block, false);
    case "server_tool_use":
    case "mcp_tool_use":
      return toCanonicalAnthropicToolCall(block, true);
    default: {
      if (isAnthropicProviderToolResultBlock(block)) {
        const result = normalizeAnthropicProviderToolResultContent(block);
        return {
          type: "tool-result",
          toolCallId: block.tool_use_id,
          providerExecuted: true,
          result,
          ...(block.is_error === true || isNormalizedAnthropicProviderErrorResult(result)
            ? { isError: true }
            : {}),
        };
      }
      invalidCheckpoint("checkpoint provider block cannot be projected for validation");
    }
  }
}

function isNormalizedAnthropicProviderErrorResult(value: unknown): boolean {
  return isRecord(value) &&
    value.name === "AnthropicServerToolResultError" &&
    value.provider === "anthropic" &&
    typeof value.code === "string" &&
    typeof value.toolCallId === "string" &&
    typeof value.toolName === "string";
}

function getProviderExecutedToolCallIds(target: Message): Set<string> {
  return new Set(
    target.parts.flatMap((part) => {
      const value: unknown = part;
      return isRecord(value) && value.type === "tool-call" &&
          value.providerExecuted === true &&
          isNonEmptyString(value.toolCallId)
        ? [value.toolCallId]
        : [];
    }),
  );
}

function toTranscriptVisibleProviderPart(
  part: unknown,
  providerExecutedToolCallIds: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (!isRecord(part)) {
    invalidCheckpoint("checkpoint anchor contains an invalid provider part");
  }
  switch (part.type) {
    case "text":
      return typeof part.text === "string" ? { type: "text", text: part.text } : undefined;
    case "reasoning":
      return isNonEmptyString(part.text) ? { type: "reasoning", text: part.text } : undefined;
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input ?? part.args,
        ...(typeof part.toolCallId === "string" &&
            providerExecutedToolCallIds.has(part.toolCallId)
          ? { providerExecuted: true }
          : {}),
      };
    case "tool-result": {
      if (!isNonEmptyString(part.toolCallId)) {
        invalidCheckpoint("checkpoint anchor tool result is malformed");
      }
      const hasResult = "result" in part || "output" in part;
      const rawResult = "result" in part ? part.result : part.output;
      const isPreparedError = isRecord(rawResult) && rawResult.type === "error-text";
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        ...(providerExecutedToolCallIds.has(part.toolCallId) ? { providerExecuted: true } : {}),
        ...(hasResult ? { result: unwrapPreparedProviderResult(rawResult) } : {}),
        ...(part.isError === true || isPreparedError ? { isError: true } : {}),
      };
    }
    default:
      invalidCheckpoint("checkpoint anchor contains an unsupported provider part");
  }
}

function unwrapPreparedProviderResult(value: unknown): unknown {
  if (!isRecord(value) || !Object.hasOwn(value, "value")) return value;
  if (value.type === "json") return value.value;
  if (value.type !== "error-text" || typeof value.value !== "string") return value;
  const parsed = safeJsonParse(value.value);
  return parsed.ok ? parsed.value : value.value;
}

// A persisted assistant turn carries at most one leading text part, so provider
// text blocks split around tool blocks collapse into that leading transcript
// entry before either side is compared. Raw replay order stays untouched.
function normalizeTranscriptVisibleProjection(
  parts: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const normalized: Record<string, unknown>[] = [];
  let text = "";

  for (const part of parts) {
    if (part.type === "text") {
      if (typeof part.text !== "string") {
        invalidCheckpoint("checkpoint transcript text projection is malformed");
      }
      text += part.text;
      continue;
    }
    normalized.push(part);
  }
  if (text.trim().length > 0) {
    normalized.unshift({ type: "text", text });
  }

  return normalized;
}

function projectCheckpointVisibleParts(
  checkpoint: ProviderReplayCheckpoint,
): Record<string, unknown>[] {
  return checkpoint.providerBlocks.flatMap((block) => {
    const part = toTranscriptVisibleAnthropicReplayPart(block.block);
    return part ? [part] : [];
  });
}

function getProviderExecutedToolCallIdsFromMessages(
  messages: readonly Message[],
): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const id of getProviderExecutedToolCallIds(message)) {
      ids.add(id);
    }
  }
  return ids;
}

function getMessageSegmentForTarget(
  messages: readonly Message[],
  target: Message,
): readonly Message[] {
  const targetIndex = messages.indexOf(target);
  if (targetIndex === -1) return [target];
  let start = targetIndex;
  while (start > 0) {
    const previous = messages[start - 1]!;
    if (previous.role === "user" || previous.role === "system") break;
    start -= 1;
  }
  let end = targetIndex + 1;
  while (end < messages.length) {
    const next = messages[end]!;
    if (next.role === "user" || next.role === "system") break;
    end += 1;
  }
  return messages.slice(start, end);
}

function getProviderExecutedToolCallIdsForTargetSegment(
  messages: readonly Message[],
  target: Message,
  checkpoint: ProviderReplayCheckpoint,
): Set<string> {
  const ids = getProviderExecutedToolCallIdsFromMessages(
    getMessageSegmentForTarget(messages, target),
  );
  for (
    const id of collectAnthropicProviderToolCallIds([
      checkpoint.providerBlocks.map((block) => block.block),
    ])
  ) {
    ids.add(id);
  }
  return ids;
}

function projectProviderToolResults(
  messages: readonly Message[],
  providerExecutedToolCallIds: ReadonlySet<string>,
): Record<string, unknown>[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      const value: unknown = part;
      if (!isRecord(value) || value.type !== "tool-result") return [];
      const projected = toTranscriptVisibleProviderPart(value, providerExecutedToolCallIds);
      return projected?.providerExecuted === true ? [projected] : [];
    })
  );
}

function assertCheckpointMatchesProjection(
  checkpoint: ProviderReplayCheckpoint,
  targetProjection: readonly Record<string, unknown>[],
  targetProviderToolResults: readonly Record<string, unknown>[],
): void {
  const checkpointProjection = projectCheckpointVisibleParts(checkpoint);
  const checkpointProviderToolResults = checkpointProjection.filter((part) =>
    part.type === "tool-result"
  );
  const checkpointVisibleProjection = normalizeTranscriptVisibleProjection(
    checkpointProjection.filter((part) => part.type !== "tool-result"),
  );
  const normalizedTargetProjection = normalizeTranscriptVisibleProjection(targetProjection);
  if (
    stringifyChatJson(checkpointVisibleProjection) !==
      stringifyChatJson(normalizedTargetProjection) ||
    stringifyChatJson(checkpointProviderToolResults) !==
      stringifyChatJson(targetProviderToolResults)
  ) {
    invalidCheckpoint("checkpoint provider blocks do not match the anchored assistant turn");
  }
}

function assertCheckpointMatchesAssistantTurn(
  target: Message,
  checkpoint: ProviderReplayCheckpoint,
  toolSiblings: readonly Message[] = [],
  providerExecutedToolCallIds = getProviderExecutedToolCallIds(target),
): void {
  const providerProjection = convertAgentRuntimeMessagesToProviderMessages([target])
    .filter((message) => message.role === "assistant");
  if (providerProjection.length > 1) {
    if (checkpoint.providerMessageBlockCounts?.length !== providerProjection.length) {
      invalidCheckpoint("checkpoint anchor projects to more than one assistant message", {
        assistantSegmentCount: providerProjection.length,
      });
    }
    const splitTargetProjection = providerProjection.flatMap((message) => {
      if (!Array.isArray(message.content)) {
        invalidCheckpoint("checkpoint anchor does not carry structured assistant content");
      }
      return message.content.flatMap((part) => {
        const projected = toTranscriptVisibleProviderPart(part, providerExecutedToolCallIds);
        return projected ? [projected] : [];
      });
    });
    assertCheckpointMatchesProjection(
      checkpoint,
      splitTargetProjection,
      projectProviderToolResults([target, ...toolSiblings], providerExecutedToolCallIds),
    );
    return;
  }
  const targetContent = providerProjection[0]?.content ?? [];
  if (!Array.isArray(targetContent)) {
    invalidCheckpoint("checkpoint anchor does not carry structured assistant content");
  }
  const targetProjection = targetContent.flatMap((part) => {
    const projected = toTranscriptVisibleProviderPart(part, providerExecutedToolCallIds);
    return projected ? [projected] : [];
  });
  assertCheckpointMatchesProjection(
    checkpoint,
    targetProjection,
    projectProviderToolResults([target, ...toolSiblings], providerExecutedToolCallIds),
  );
}

function createCheckpointForRawBlocks(
  source: ProviderReplayCheckpoint,
  rawBlocks: readonly Record<string, unknown>[],
): ProviderReplayCheckpoint {
  return {
    ...source,
    providerBlocks: rawBlocks.map((block) => ({
      type: "provider-block",
      provider: source.provider,
      block,
    })),
    providerBlockPositions: rawBlocks.map((_, index) => index),
    totalPartCount: rawBlocks.length,
  };
}

function getRawAssistantMessagesForCheckpoint(
  checkpoint: ProviderReplayCheckpoint,
): Record<string, unknown>[][] {
  if (checkpoint.providerMessageBlockCounts === undefined) {
    return [checkpoint.providerBlocks.map((block) => block.block)];
  }
  const rawAssistantMessages: Record<string, unknown>[][] = [];
  let offset = 0;
  for (const count of checkpoint.providerMessageBlockCounts) {
    rawAssistantMessages.push(
      checkpoint.providerBlocks.slice(offset, offset + count).map((block) => block.block),
    );
    offset += count;
  }
  return rawAssistantMessages;
}

function splitAnthropicAssistantReplayBlocks(
  checkpoint: ProviderReplayCheckpoint,
  anchorCount: number,
): Record<string, unknown>[][][] {
  if (checkpoint.providerMessageBlockCounts !== undefined) {
    const grouped = groupAnthropicRawAssistantMessagesByAnchor(
      getRawAssistantMessagesForCheckpoint(checkpoint),
      anchorCount,
    );
    if (grouped === undefined) {
      invalidCheckpoint("checkpoint split assistant segment count does not match its anchor");
    }
    return grouped;
  }
  const segments: Record<string, unknown>[][] = [];
  let current: Record<string, unknown>[] = [];
  for (const replayBlock of checkpoint.providerBlocks) {
    if (isAnthropicProviderToolResultBlock(replayBlock.block)) {
      if (current.some((block) => !isAnthropicProviderToolResultBlock(block))) {
        segments.push(current);
        current = [];
      }
      current.push(replayBlock.block);
      continue;
    }
    current.push(replayBlock.block);
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments.map((segment) => [segment]);
}

function assertCheckpointMatchesSplitAssistantTurns(
  sameSourceMessages: readonly Message[],
  assistantMatches: readonly Message[],
  checkpoint: ProviderReplayCheckpoint,
): Record<string, unknown>[][][] {
  const providerExecutedToolCallIds = getProviderExecutedToolCallIdsFromMessages(
    sameSourceMessages,
  );
  for (
    const id of collectAnthropicProviderToolCallIds([
      checkpoint.providerBlocks.map((block) => block.block),
    ])
  ) {
    providerExecutedToolCallIds.add(id);
  }
  const targetProjection = assistantMatches.flatMap((message) =>
    message.parts.flatMap((part) => {
      const projected = toTranscriptVisibleProviderPart(part, providerExecutedToolCallIds);
      return projected ? [projected] : [];
    })
  );
  assertCheckpointMatchesProjection(
    checkpoint,
    targetProjection,
    projectProviderToolResults(sameSourceMessages, providerExecutedToolCallIds),
  );

  const rawSegments = splitAnthropicAssistantReplayBlocks(checkpoint, assistantMatches.length);
  if (rawSegments.length !== assistantMatches.length) {
    invalidCheckpoint("checkpoint split assistant segment count does not match its anchor");
  }
  for (const [index, rawSegment] of rawSegments.entries()) {
    const rawSegmentProjection = projectCheckpointVisibleParts(
      createCheckpointForRawBlocks(checkpoint, rawSegment.flat()),
    );
    const rawSegmentAssistantProjection = normalizeTranscriptVisibleProjection(
      rawSegmentProjection.filter((part) => part.type !== "tool-result"),
    );
    const assistantProjection = normalizeTranscriptVisibleProjection(
      assistantMatches[index]!.parts.flatMap((part) => {
        const projected = toTranscriptVisibleProviderPart(part, providerExecutedToolCallIds);
        return projected ? [projected] : [];
      }),
    );
    if (
      stringifyChatJson(rawSegmentAssistantProjection) !==
        stringifyChatJson(assistantProjection)
    ) {
      invalidCheckpoint("checkpoint split assistant segment does not match its anchor");
    }
  }
  return rawSegments;
}

function parseProviderReplayBlock(
  value: unknown,
  provider: ProviderReplayProvider,
  index: number,
): ProviderReplayBlock {
  if (!isRecord(value)) {
    invalidCheckpoint("provider block must be an object", { index });
  }
  // Unknown key NAMES are attacker-controlled text and may smuggle signed
  // material, so rejections report the index only, never the key.
  for (const key of Object.keys(value)) {
    if (!BLOCK_KEYS.has(key)) {
      invalidCheckpoint("provider block carries an unknown key", { index });
    }
  }
  if (value.type !== "provider-block") {
    invalidCheckpoint('provider block type must be "provider-block"', { index });
  }
  if (value.provider !== provider) {
    invalidCheckpoint("provider block must match the checkpoint provider", { index });
  }
  if (!isRecord(value.block)) {
    invalidCheckpoint("provider block content must be an object", { index });
  }
  if (provider === "anthropic") {
    assertRawProviderMetadataBounds(value.block, { index });
  }
  if (provider === "anthropic" && value.block.type === "thinking") {
    validateAnthropicThinkingReplayBlock(value.block, { index });
  }
  if (
    provider === "anthropic" &&
    isAnthropicProviderToolResultBlock(value.block)
  ) {
    validateAnthropicProviderToolResultBlock(value.block, { index });
  }
  if (provider === "anthropic") {
    validateAnthropicReplayBlock(value.block, { index });
  }
  return { type: "provider-block", provider, block: value.block };
}

/** Parse untrusted checkpoint state; malformed state fails explicitly. */
export function parseProviderReplayCheckpoint(value: unknown): ProviderReplayCheckpoint {
  if (!isRecord(value)) {
    invalidCheckpoint("checkpoint must be an object");
  }
  // As with block keys: never echo an unknown key name.
  for (const key of Object.keys(value)) {
    if (!CHECKPOINT_KEYS.has(key)) {
      invalidCheckpoint("checkpoint carries an unknown key");
    }
  }
  if (value.version !== 1) {
    invalidCheckpoint("checkpoint version is unsupported");
  }
  if (
    typeof value.messageId !== "string" ||
    value.messageId.length === 0 ||
    value.messageId.length > MAX_PROVIDER_REPLAY_MESSAGE_ID_LENGTH
  ) {
    invalidCheckpoint("checkpoint messageId must be a bounded non-empty string");
  }
  if (!isProviderReplayProvider(value.provider)) {
    invalidCheckpoint("checkpoint provider is not a replay-capable provider");
  }
  if (
    !Array.isArray(value.providerBlocks) ||
    value.providerBlocks.length === 0 ||
    value.providerBlocks.length > MAX_PROVIDER_REPLAY_BLOCKS
  ) {
    invalidCheckpoint(
      `checkpoint providerBlocks must contain 1-${MAX_PROVIDER_REPLAY_BLOCKS} blocks`,
    );
  }
  const provider = value.provider;
  const providerBlocks = value.providerBlocks.map((block, index) =>
    parseProviderReplayBlock(block, provider, index)
  );
  if (
    typeof value.totalPartCount !== "number" ||
    !Number.isSafeInteger(value.totalPartCount) ||
    value.totalPartCount < 1 ||
    value.totalPartCount > MAX_PROVIDER_REPLAY_TOTAL_PARTS
  ) {
    invalidCheckpoint(
      `checkpoint totalPartCount must be an integer between 1 and ${MAX_PROVIDER_REPLAY_TOTAL_PARTS}`,
    );
  }
  if (value.totalPartCount < providerBlocks.length) {
    invalidCheckpoint("checkpoint totalPartCount cannot be lower than the block count");
  }
  if (
    !Array.isArray(value.providerBlockPositions) ||
    value.providerBlockPositions.length !== providerBlocks.length
  ) {
    invalidCheckpoint("checkpoint providerBlockPositions must align one-to-one with blocks");
  }
  const positions: number[] = [];
  for (const [index, position] of value.providerBlockPositions.entries()) {
    if (
      typeof position !== "number" ||
      !Number.isSafeInteger(position) ||
      position < 0 ||
      position >= value.totalPartCount
    ) {
      invalidCheckpoint("checkpoint block position must be an integer below totalPartCount", {
        index,
      });
    }
    const previous = positions.at(-1);
    if (previous !== undefined && position <= previous) {
      invalidCheckpoint("checkpoint block positions must be strictly increasing", { index });
    }
    positions.push(position);
  }
  let providerMessageBlockCounts: number[] | undefined;
  if (value.providerMessageBlockCounts !== undefined) {
    if (
      !Array.isArray(value.providerMessageBlockCounts) ||
      value.providerMessageBlockCounts.length === 0
    ) {
      invalidCheckpoint("checkpoint providerMessageBlockCounts must be a non-empty array");
    }
    providerMessageBlockCounts = [];
    let groupedBlockCount = 0;
    for (const [index, count] of value.providerMessageBlockCounts.entries()) {
      if (
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count <= 0
      ) {
        invalidCheckpoint("checkpoint providerMessageBlockCounts entries must be positive", {
          index,
        });
      }
      groupedBlockCount += count;
      providerMessageBlockCounts.push(count);
    }
    if (groupedBlockCount !== providerBlocks.length) {
      invalidCheckpoint("checkpoint providerMessageBlockCounts must cover every block");
    }
  }
  if (
    value.elapsedMs !== undefined &&
    (typeof value.elapsedMs !== "number" || !Number.isFinite(value.elapsedMs) ||
      value.elapsedMs < 0)
  ) {
    invalidCheckpoint("checkpoint elapsedMs must be a finite non-negative number");
  }
  if (
    value.emittedAt !== undefined &&
    (typeof value.emittedAt !== "number" || !Number.isSafeInteger(value.emittedAt) ||
      value.emittedAt < 0)
  ) {
    invalidCheckpoint("checkpoint emittedAt must be a non-negative integer");
  }
  const checkpoint: ProviderReplayCheckpoint = {
    version: 1,
    messageId: value.messageId,
    provider,
    providerBlocks,
    providerBlockPositions: positions,
    ...(providerMessageBlockCounts ? { providerMessageBlockCounts } : {}),
    totalPartCount: value.totalPartCount,
    ...(value.elapsedMs !== undefined ? { elapsedMs: value.elapsedMs } : {}),
    ...(value.emittedAt !== undefined ? { emittedAt: value.emittedAt } : {}),
  };
  if (provider === "anthropic") {
    assertRawProviderMetadataBounds(
      getRawAssistantMessagesForCheckpoint(checkpoint),
      { field: "rawAssistantMessages" },
      "checkpoint raw assistant messages exceeds raw metadata bounds",
    );
  }
  return checkpoint;
}

/**
 * Parse a server-resolved checkpoint delivery. The whole delivery fails when
 * any entry is malformed: applying only the well-formed subset would silently
 * degrade replay for the rest.
 */
export function parseServerResolvedProviderReplayCheckpoints(
  value: unknown,
): ProviderReplayCheckpoint[] {
  if (!Array.isArray(value)) {
    invalidCheckpoint("server-resolved provider replay checkpoints must be an array");
  }
  if (value.length > MAX_PROVIDER_REPLAY_CHECKPOINTS) {
    invalidCheckpoint(
      `server-resolved provider replay checkpoints must contain at most ${MAX_PROVIDER_REPLAY_CHECKPOINTS} entries`,
    );
  }
  const checkpoints = value.map((entry) => parseProviderReplayCheckpoint(entry));
  // The server resolves at most one checkpoint per assistant turn. Duplicates
  // would make replay state depend on array order, so they fail closed.
  const messageIds = new Set<string>();
  for (const checkpoint of checkpoints) {
    if (messageIds.has(checkpoint.messageId)) {
      invalidCheckpoint("delivery carries more than one checkpoint for one message anchor");
    }
    messageIds.add(checkpoint.messageId);
  }
  return checkpoints;
}

/**
 * Assert this runtime version can reconstruct the checkpoint's assistant turn.
 *
 * Two contract-valid shapes are rejected until their reconstruction exists,
 * because accepting them and replaying anything else would silently alter the
 * assistant turn: non-anthropic providers (stage 1 reconstructs anthropic
 * replay only) and sparse checkpoints (blocks at unrepresented positions are
 * unknown to this runtime).
 */
export function assertReconstructibleProviderReplayCheckpoint(
  checkpoint: ProviderReplayCheckpoint,
): void {
  if (checkpoint.provider !== "anthropic") {
    invalidCheckpoint(
      "this runtime version reconstructs anthropic provider replay only",
      { provider: checkpoint.provider },
    );
  }
  if (
    checkpoint.totalPartCount !== checkpoint.providerBlocks.length ||
    checkpoint.providerBlockPositions.some((position, index) => position !== index)
  ) {
    invalidCheckpoint(
      "sparse provider replay checkpoints are not reconstructible by this runtime version",
      {
        blockCount: checkpoint.providerBlocks.length,
        totalPartCount: checkpoint.totalPartCount,
      },
    );
  }
}

/**
 * Attach delivered replay state to the assistant turns it anchors to.
 *
 * Metadata rides the same internal side channel as in-process raw replay
 * (`attachProviderMetadata`), so signed blocks never appear on the public
 * message objects and cannot reach transcripts or logs that serialize them.
 * A checkpoint whose turn is no longer in context is skipped: a turn that is
 * not replayed to the provider has no replay obligation. Every other mismatch
 * fails explicitly.
 */
export function applyProviderReplayCheckpointsToMessages(
  messages: readonly Message[],
  checkpoints: readonly ProviderReplayCheckpoint[] | undefined,
  options: ApplyProviderReplayCheckpointsOptions = {},
): void {
  if (checkpoints === undefined || checkpoints.length === 0) return;
  const attachmentPlan: Array<{
    target: Message;
    rawAssistantMessages: Record<string, unknown>[][];
  }> = [];
  // Runtime support is a property of the delivery, not of which turns are
  // still in context: an unsupported checkpoint fails the run even when its
  // turn is absent, so deployment skew surfaces immediately.
  for (const checkpoint of checkpoints) {
    assertReconstructibleProviderReplayCheckpoint(checkpoint);
    if (options.activeProvider === "unsupported") {
      invalidCheckpoint("active model provider cannot replay provider checkpoints");
    }
    if (options.activeProvider !== undefined && checkpoint.provider !== options.activeProvider) {
      invalidCheckpoint("checkpoint provider does not match the active model provider", {
        checkpointProvider: checkpoint.provider,
        activeProvider: options.activeProvider,
      });
    }
  }
  assertAnthropicProviderToolResultsMatchTranscript(messages, checkpoints);
  for (const checkpoint of checkpoints) {
    const matches = messages.filter((message) => message.id === checkpoint.messageId);
    if (matches.length === 0) continue;
    const assistantMatches = matches.filter((message) => message.role === "assistant");
    const toolSiblings = matches.filter((message) => message.role === "tool");
    const target = assistantMatches[0];
    if (!target) {
      const role = matches[0]?.role;
      invalidCheckpoint("checkpoint messageId must anchor to an assistant message", {
        ...(role ? { role } : {}),
      });
    }
    if (assistantMatches.length === 1) {
      const providerExecutedToolCallIds = getProviderExecutedToolCallIdsForTargetSegment(
        messages,
        target,
        checkpoint,
      );
      assertCheckpointMatchesAssistantTurn(
        target,
        checkpoint,
        toolSiblings,
        providerExecutedToolCallIds,
      );
      attachmentPlan.push({
        target,
        rawAssistantMessages: getRawAssistantMessagesForCheckpoint(checkpoint),
      });
      continue;
    }
    const rawSegments = assertCheckpointMatchesSplitAssistantTurns(
      matches,
      assistantMatches,
      checkpoint,
    );
    for (const [index, rawBlocks] of rawSegments.entries()) {
      attachmentPlan.push({ target: assistantMatches[index]!, rawAssistantMessages: rawBlocks });
    }
  }
  for (const { target, rawAssistantMessages } of attachmentPlan) {
    // In-process metadata attached during this run is the same replay state at
    // first hand; the durable checkpoint never overrides it.
    if (readAttachedProviderMetadata(target) !== undefined) continue;
    markProviderReplayDelivered(attachProviderMetadata(target, {
      anthropic: {
        rawAssistantMessages,
      },
    }));
  }
}
