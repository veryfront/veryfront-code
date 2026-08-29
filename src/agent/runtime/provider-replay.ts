import { PROVIDER_REPLAY_CHECKPOINT_INVALID } from "#veryfront/errors";
import {
  attachProviderMetadata,
  readAttachedProviderMetadata,
} from "#veryfront/agent/runtime/provider-metadata.ts";
import { stringifyChatJson } from "#veryfront/chat/json-value.ts";
import type { Message } from "../types.ts";
import { convertAgentRuntimeMessagesToProviderMessages } from "./message-adapter.ts";

const MAX_PROVIDER_REPLAY_BLOCKS = 100;
const MAX_PROVIDER_REPLAY_CHECKPOINTS = 100;
const MAX_PROVIDER_REPLAY_TOTAL_PARTS = 10_000;
const MAX_PROVIDER_REPLAY_MESSAGE_ID_LENGTH = 256;

const CHECKPOINT_KEYS = new Set([
  "version",
  "messageId",
  "provider",
  "providerBlocks",
  "providerBlockPositions",
  "totalPartCount",
  "elapsedMs",
  "emittedAt",
]);
const BLOCK_KEYS = new Set(["type", "provider", "block"]);
const ANTHROPIC_PROVIDER_TOOL_RESULT_TYPES = new Set([
  "web_search_tool_result",
  "web_fetch_tool_result",
  "code_execution_tool_result",
  "bash_code_execution_tool_result",
  "text_editor_code_execution_tool_result",
  "mcp_tool_result",
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
  totalPartCount: number;
  elapsedMs?: number;
  emittedAt?: number;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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

function toTranscriptVisibleAnthropicReplayPart(
  block: Record<string, unknown>,
): Record<string, unknown> | undefined {
  switch (block.type) {
    case "text": {
      if (typeof block.text !== "string") {
        invalidCheckpoint("checkpoint text block is malformed");
      }
      return { type: "text", text: block.text };
    }
    case "thinking": {
      validateAnthropicThinkingReplayBlock(block);
      return isNonEmptyString(block.thinking)
        ? { type: "reasoning", text: block.thinking }
        : undefined;
    }
    case "redacted_thinking":
      if (!isNonEmptyString(block.data)) {
        invalidCheckpoint("checkpoint redacted thinking block is malformed");
      }
      return undefined;
    case "tool_use":
      return toCanonicalAnthropicToolCall(block, false);
    case "server_tool_use":
    case "mcp_tool_use":
      return toCanonicalAnthropicToolCall(block, true);
    default: {
      if (
        typeof block.type === "string" &&
        ANTHROPIC_PROVIDER_TOOL_RESULT_TYPES.has(block.type)
      ) {
        if (!isNonEmptyString(block.tool_use_id)) {
          invalidCheckpoint("checkpoint provider tool-result block is malformed");
        }
        return {
          type: "tool-result",
          toolCallId: block.tool_use_id,
          providerExecuted: true,
        };
      }
      invalidCheckpoint("checkpoint provider block cannot be projected for validation");
    }
  }
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
        input: part.input,
        ...(typeof part.toolCallId === "string" &&
            providerExecutedToolCallIds.has(part.toolCallId)
          ? { providerExecuted: true }
          : {}),
      };
    case "tool-result":
      if (!isNonEmptyString(part.toolCallId)) {
        invalidCheckpoint("checkpoint anchor tool result is malformed");
      }
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        ...(providerExecutedToolCallIds.has(part.toolCallId) ? { providerExecuted: true } : {}),
      };
    default:
      invalidCheckpoint("checkpoint anchor contains an unsupported provider part");
  }
}

function normalizeTranscriptVisibleProjection(
  parts: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const normalized: Record<string, unknown>[] = [];
  let pendingText = "";

  const flushText = () => {
    if (pendingText.trim().length === 0) {
      pendingText = "";
      return;
    }
    normalized.push({ type: "text", text: pendingText });
    pendingText = "";
  };

  for (const part of parts) {
    if (part.type === "text") {
      if (typeof part.text !== "string") {
        invalidCheckpoint("checkpoint transcript text projection is malformed");
      }
      pendingText += part.text;
      continue;
    }
    flushText();
    normalized.push(part);
  }
  flushText();

  return normalized;
}

function assertCheckpointMatchesAssistantTurn(
  target: Message,
  checkpoint: ProviderReplayCheckpoint,
  toolSiblings: readonly Message[] = [],
): void {
  const providerProjection = convertAgentRuntimeMessagesToProviderMessages([target])
    .filter((message) => message.role === "assistant");
  if (providerProjection.length > 1) {
    invalidCheckpoint("checkpoint anchor projects to more than one assistant message", {
      assistantSegmentCount: providerProjection.length,
    });
  }
  const checkpointProjection = checkpoint.providerBlocks.flatMap((block) => {
    const part = toTranscriptVisibleAnthropicReplayPart(block.block);
    return part ? [part] : [];
  });
  const providerExecutedToolCallIds = getProviderExecutedToolCallIds(target);
  const targetContent = providerProjection[0]?.content ?? [];
  if (!Array.isArray(targetContent)) {
    invalidCheckpoint("checkpoint anchor does not carry structured assistant content");
  }
  const targetProjection = targetContent.flatMap((part) => {
    const projected = toTranscriptVisibleProviderPart(part, providerExecutedToolCallIds);
    return projected ? [projected] : [];
  });
  const checkpointProviderToolResults = checkpointProjection.filter((part) =>
    part.type === "tool-result"
  );
  const checkpointVisibleProjection = normalizeTranscriptVisibleProjection(
    checkpointProjection.filter((part) => part.type !== "tool-result"),
  );
  const normalizedTargetProjection = normalizeTranscriptVisibleProjection(targetProjection);
  const targetProviderToolResults = [target, ...toolSiblings].flatMap((message) =>
    message.parts.flatMap((part) => {
      const value: unknown = part;
      if (!isRecord(value) || value.type !== "tool-result") return [];
      const projected = toTranscriptVisibleProviderPart(value, providerExecutedToolCallIds);
      return projected?.providerExecuted === true ? [projected] : [];
    })
  );
  if (
    stringifyChatJson(checkpointVisibleProjection) !==
      stringifyChatJson(normalizedTargetProjection) ||
    stringifyChatJson(checkpointProviderToolResults) !==
      stringifyChatJson(targetProviderToolResults)
  ) {
    invalidCheckpoint("checkpoint provider blocks do not match the anchored assistant turn");
  }
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
  if (provider === "anthropic" && value.block.type === "thinking") {
    validateAnthropicThinkingReplayBlock(value.block, { index });
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
  return {
    version: 1,
    messageId: value.messageId,
    provider,
    providerBlocks,
    providerBlockPositions: positions,
    totalPartCount: value.totalPartCount,
    ...(value.elapsedMs !== undefined ? { elapsedMs: value.elapsedMs } : {}),
    ...(value.emittedAt !== undefined ? { emittedAt: value.emittedAt } : {}),
  };
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
): void {
  if (checkpoints === undefined || checkpoints.length === 0) return;
  // Runtime support is a property of the delivery, not of which turns are
  // still in context: an unsupported checkpoint fails the run even when its
  // turn is absent, so deployment skew surfaces immediately.
  for (const checkpoint of checkpoints) {
    assertReconstructibleProviderReplayCheckpoint(checkpoint);
  }
  for (const checkpoint of checkpoints) {
    const matches = messages.filter((message) => message.id === checkpoint.messageId);
    if (matches.length === 0) continue;
    const assistantMatches = matches.filter((message) => message.role === "assistant");
    if (assistantMatches.length > 1) {
      invalidCheckpoint("checkpoint messageId matches more than one assistant message");
    }
    const target = assistantMatches[0];
    if (!target) {
      const role = matches[0]?.role;
      invalidCheckpoint("checkpoint messageId must anchor to an assistant message", {
        ...(role ? { role } : {}),
      });
    }
    assertCheckpointMatchesAssistantTurn(
      target,
      checkpoint,
      matches.filter((message) => message.role === "tool"),
    );
    // In-process metadata attached during this run is the same replay state at
    // first hand; the durable checkpoint never overrides it.
    if (readAttachedProviderMetadata(target) !== undefined) continue;
    attachProviderMetadata(target, {
      anthropic: {
        rawAssistantMessages: [checkpoint.providerBlocks.map((block) => block.block)],
      },
    });
  }
}
