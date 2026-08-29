import { PROVIDER_REPLAY_CHECKPOINT_INVALID } from "#veryfront/errors";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import type { Message } from "../types.ts";
import { attachProviderMetadata, readAttachedProviderMetadata } from "./provider-metadata.ts";

/**
 * Durable run event type carrying provider-native replay state.
 *
 * Mirrors `AgentRunProviderReplayCheckpointPayloadSchema` in veryfront-api;
 * both sides validate the same shape so a payload accepted here is accepted
 * there and vice versa.
 */
export const AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE =
  "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT" as const;

/** Environment flag gating checkpoint emission; anything but "true" stays off. */
export const PROVIDER_REPLAY_CHECKPOINT_EMISSION_ENV_FLAG =
  "VERYFRONT_ENABLE_PROVIDER_REPLAY_CHECKPOINT_EMISSION" as const;

const MAX_PROVIDER_REPLAY_BLOCKS = 100;
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

/** Durable event form of a provider replay checkpoint. */
export type ProviderReplayCheckpointEvent = ProviderReplayCheckpoint & {
  type: typeof AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE;
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
  for (const key of Object.keys(value)) {
    if (!BLOCK_KEYS.has(key)) {
      invalidCheckpoint("provider block carries an unknown key", { index, key });
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
  for (const key of Object.keys(value)) {
    if (!CHECKPOINT_KEYS.has(key)) {
      invalidCheckpoint("checkpoint carries an unknown key", { key });
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
  return value.map((entry) => parseProviderReplayCheckpoint(entry));
}

/** Convert a validated checkpoint into its durable root-run event. */
export function createProviderReplayCheckpointEvent(
  checkpoint: ProviderReplayCheckpoint,
): ProviderReplayCheckpointEvent {
  return {
    type: AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE,
    ...parseProviderReplayCheckpoint(checkpoint),
  };
}

/** Return whether checkpoint emission is enabled; default off in every environment. */
export function isProviderReplayCheckpointEmissionEnabled(
  readEnv: (name: string) => string | undefined = getEnv,
): boolean {
  return readEnv(PROVIDER_REPLAY_CHECKPOINT_EMISSION_ENV_FLAG) === "true";
}

/**
 * Sole emission entry point for the durable checkpoint event.
 *
 * Returns null while the emission gate is off, so no runtime path can persist
 * a checkpoint before the API-side append support ships and the flag is turned
 * on deliberately (stage 4 of veryfront-issue-inbox#522).
 */
export function maybeCreateProviderReplayCheckpointEvent(input: {
  checkpoint: ProviderReplayCheckpoint;
  readEnv?: (name: string) => string | undefined;
}): ProviderReplayCheckpointEvent | null {
  if (!isProviderReplayCheckpointEmissionEnabled(input.readEnv ?? getEnv)) {
    return null;
  }
  return createProviderReplayCheckpointEvent(input.checkpoint);
}

/**
 * Build a checkpoint from the Anthropic raw-replay metadata the provider
 * already emits in-process (`providerMetadata.anthropic.rawAssistantMessages`).
 *
 * Returns null when the metadata carries no Anthropic replay state; malformed
 * replay state fails explicitly rather than emitting a partial checkpoint.
 */
export function createAnthropicProviderReplayCheckpoint(input: {
  messageId: string;
  providerMetadata: Record<string, unknown> | undefined;
}): ProviderReplayCheckpoint | null {
  const anthropic = input.providerMetadata?.anthropic;
  if (anthropic === undefined) return null;
  if (!isRecord(anthropic)) {
    invalidCheckpoint("anthropic provider metadata must be an object");
  }
  const rawAssistantMessages = anthropic.rawAssistantMessages;
  if (rawAssistantMessages === undefined) return null;
  if (!Array.isArray(rawAssistantMessages) || rawAssistantMessages.length === 0) {
    invalidCheckpoint("anthropic raw assistant messages must be a non-empty array");
  }
  const blocks: Record<string, unknown>[] = [];
  for (const [messageIndex, rawContent] of rawAssistantMessages.entries()) {
    if (!Array.isArray(rawContent)) {
      invalidCheckpoint("anthropic raw assistant content must be an array", { messageIndex });
    }
    for (const [blockIndex, block] of rawContent.entries()) {
      if (!isRecord(block) || typeof block.type !== "string") {
        invalidCheckpoint("anthropic raw assistant block must be a typed object", {
          messageIndex,
          blockIndex,
        });
      }
      blocks.push(block);
    }
  }
  if (blocks.length === 0 || blocks.length > MAX_PROVIDER_REPLAY_BLOCKS) {
    invalidCheckpoint(
      `anthropic raw assistant turn must carry 1-${MAX_PROVIDER_REPLAY_BLOCKS} blocks`,
      { blockCount: blocks.length },
    );
  }
  return parseProviderReplayCheckpoint({
    version: 1,
    messageId: input.messageId,
    provider: "anthropic",
    providerBlocks: blocks.map((block) => ({
      type: "provider-block",
      provider: "anthropic",
      block,
    })),
    providerBlockPositions: blocks.map((_, index) => index),
    totalPartCount: blocks.length,
  });
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
  for (const checkpoint of checkpoints) {
    const matches = messages.filter((message) => message.id === checkpoint.messageId);
    if (matches.length === 0) continue;
    if (matches.length > 1) {
      invalidCheckpoint("checkpoint messageId matches more than one message", {
        messageId: checkpoint.messageId,
      });
    }
    const target = matches[0]!;
    if (target.role !== "assistant") {
      invalidCheckpoint("checkpoint messageId must anchor to an assistant message", {
        messageId: checkpoint.messageId,
        role: target.role,
      });
    }
    if (checkpoint.provider !== "anthropic") {
      invalidCheckpoint("this runtime has no replay reconstruction for the checkpoint provider", {
        provider: checkpoint.provider,
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
