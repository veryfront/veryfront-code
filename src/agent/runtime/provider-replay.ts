import { PROVIDER_REPLAY_CHECKPOINT_INVALID } from "#veryfront/errors";
import {
  attachProviderMetadata,
  readAttachedProviderMetadata,
} from "#veryfront/agent/runtime/provider-metadata.ts";
import type { Message } from "../types.ts";

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
    if (matches.length > 1) {
      invalidCheckpoint("checkpoint messageId matches more than one message");
    }
    const target = matches[0]!;
    if (target.role !== "assistant") {
      invalidCheckpoint("checkpoint messageId must anchor to an assistant message", {
        role: target.role,
      });
    }
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
