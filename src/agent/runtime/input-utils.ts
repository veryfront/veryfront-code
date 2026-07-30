import type { Message } from "../types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { RuntimeProviderBlock } from "#veryfront/provider/runtime-loader.ts";

const TRUSTED_PROVIDER_BLOCK_INPUT = Symbol("veryfront.trustedProviderBlockInput");
const PROVIDER_REPLAY_BLOCK_PERSISTER = Symbol("veryfront.providerReplayBlockPersister");

export type ProviderReplayPersistenceInput = {
  providerBlocks: readonly RuntimeProviderBlock[];
  providerBlockPositions: readonly number[];
  totalPartCount: number;
};

export type ProviderReplayBlockPersister = (
  input: ProviderReplayPersistenceInput,
) => void | Promise<void>;

/** Mark server-loaded message history as trusted provider replay state. */
export function markTrustedProviderBlockInput(
  context: Record<string, unknown>,
  persistProviderReplayBlocks?: ProviderReplayBlockPersister,
): Record<string, unknown> {
  return {
    ...context,
    [TRUSTED_PROVIDER_BLOCK_INPUT]: true,
    ...(persistProviderReplayBlocks
      ? { [PROVIDER_REPLAY_BLOCK_PERSISTER]: persistProviderReplayBlocks }
      : {}),
  };
}

/** Test whether an internal runtime context permits provider replay blocks. */
export function hasTrustedProviderBlockInput(
  context: Record<string, unknown> | undefined,
): boolean {
  return (context as Record<PropertyKey, unknown> | undefined)?.[
    TRUSTED_PROVIDER_BLOCK_INPUT
  ] === true;
}

/** Read the private host-installed provider replay persistence callback. */
export function getProviderReplayBlockPersister(
  context: Record<string, unknown> | undefined,
): ProviderReplayBlockPersister | undefined {
  const value = (context as Record<PropertyKey, unknown> | undefined)?.[
    PROVIDER_REPLAY_BLOCK_PERSISTER
  ];
  return typeof value === "function" ? value as ProviderReplayBlockPersister : undefined;
}

export function normalizeInput(
  input: string | Message[],
  options: { preserveProviderBlocks?: boolean } = {},
): Message[] {
  const now = Date.now();

  if (typeof input === "string") {
    return [
      {
        id: `msg_${now}`,
        role: "user",
        parts: [{ type: "text", text: input }],
        timestamp: now,
      },
    ];
  }

  return input.map((msg, index) => {
    if (typeof msg.id === "string" && msg.id.trim().length === 0) {
      throw INVALID_ARGUMENT.create({ detail: "Message id cannot be empty." });
    }

    return {
      ...msg,
      parts: options.preserveProviderBlocks
        ? msg.parts
        : msg.parts.filter((part) => (part as { type?: unknown }).type !== "provider-block"),
      id: msg.id ?? `msg_${now}_${index}`,
      timestamp: msg.timestamp ?? now,
    };
  });
}

export function accumulateUsage(
  total: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheWriteInputTokens?: number;
    cacheReadInputTokens?: number;
    reasoningTokens?: number;
    billableInputTokens?: number;
    billableOutputTokens?: number;
    costUsd?: number;
    providerInputCostUsd?: number;
    providerOutputCostUsd?: number;
    providerCostUsd?: number;
    veryfrontInputChargeUsd?: number;
    veryfrontOutputChargeUsd?: number;
    veryfrontChargeUsd?: number;
    veryfrontBilledUsd?: number;
    costCredits?: number;
    costSource?: "gateway" | "missing" | "partial";
    billingMode?: "direct" | "deferred";
    usageCaptureStatus?: "complete" | "partial" | "missing";
  },
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheWriteInputTokens?: number;
    cacheReadInputTokens?: number;
    reasoningTokens?: number;
    billableInputTokens?: number;
    billableOutputTokens?: number;
    costUsd?: number;
    providerInputCostUsd?: number;
    providerOutputCostUsd?: number;
    providerCostUsd?: number;
    veryfrontInputChargeUsd?: number;
    veryfrontOutputChargeUsd?: number;
    veryfrontChargeUsd?: number;
    veryfrontBilledUsd?: number;
    costCredits?: number;
    costSource?: "gateway" | "missing" | "partial";
    billingMode?: "direct" | "deferred";
    usageCaptureStatus?: "complete" | "partial" | "missing";
  },
): void {
  total.promptTokens += usage.promptTokens ?? 0;
  total.completionTokens += usage.completionTokens ?? 0;
  total.totalTokens += usage.totalTokens ?? 0;
  if (typeof usage.cachedInputTokens === "number") {
    total.cachedInputTokens = (total.cachedInputTokens ?? 0) + usage.cachedInputTokens;
  }
  if (typeof usage.cacheCreationInputTokens === "number") {
    total.cacheCreationInputTokens = (total.cacheCreationInputTokens ?? 0) +
      usage.cacheCreationInputTokens;
  }
  if (typeof usage.cacheWriteInputTokens === "number") {
    total.cacheWriteInputTokens = (total.cacheWriteInputTokens ?? 0) +
      usage.cacheWriteInputTokens;
  }
  if (typeof usage.cacheReadInputTokens === "number") {
    total.cacheReadInputTokens = (total.cacheReadInputTokens ?? 0) + usage.cacheReadInputTokens;
  }
  if (typeof usage.reasoningTokens === "number") {
    total.reasoningTokens = (total.reasoningTokens ?? 0) + usage.reasoningTokens;
  }
  if (typeof usage.billableInputTokens === "number") {
    total.billableInputTokens = (total.billableInputTokens ?? 0) + usage.billableInputTokens;
  }
  if (typeof usage.billableOutputTokens === "number") {
    total.billableOutputTokens = (total.billableOutputTokens ?? 0) + usage.billableOutputTokens;
  }
  if (typeof usage.costUsd === "number") {
    total.costUsd = (total.costUsd ?? 0) + usage.costUsd;
  }
  if (typeof usage.providerCostUsd === "number") {
    total.providerCostUsd = (total.providerCostUsd ?? 0) + usage.providerCostUsd;
  }
  if (typeof usage.providerInputCostUsd === "number") {
    total.providerInputCostUsd = (total.providerInputCostUsd ?? 0) + usage.providerInputCostUsd;
  }
  if (typeof usage.providerOutputCostUsd === "number") {
    total.providerOutputCostUsd = (total.providerOutputCostUsd ?? 0) + usage.providerOutputCostUsd;
  }
  if (typeof usage.veryfrontChargeUsd === "number") {
    total.veryfrontChargeUsd = (total.veryfrontChargeUsd ?? 0) + usage.veryfrontChargeUsd;
  }
  if (typeof usage.veryfrontInputChargeUsd === "number") {
    total.veryfrontInputChargeUsd = (total.veryfrontInputChargeUsd ?? 0) +
      usage.veryfrontInputChargeUsd;
  }
  if (typeof usage.veryfrontOutputChargeUsd === "number") {
    total.veryfrontOutputChargeUsd = (total.veryfrontOutputChargeUsd ?? 0) +
      usage.veryfrontOutputChargeUsd;
  }
  if (typeof usage.veryfrontBilledUsd === "number") {
    total.veryfrontBilledUsd = (total.veryfrontBilledUsd ?? 0) + usage.veryfrontBilledUsd;
  }
  if (typeof usage.costCredits === "number") {
    total.costCredits = (total.costCredits ?? 0) + usage.costCredits;
  }
  if (usage.costSource) {
    total.costSource = total.costSource && total.costSource !== usage.costSource
      ? "partial"
      : usage.costSource;
  }
  if (usage.billingMode) {
    total.billingMode = total.billingMode === "deferred" || usage.billingMode === "deferred"
      ? "deferred"
      : usage.billingMode;
  }
  if (usage.usageCaptureStatus) {
    total.usageCaptureStatus =
      total.usageCaptureStatus && total.usageCaptureStatus !== usage.usageCaptureStatus
        ? "partial"
        : usage.usageCaptureStatus;
  }
}

export function getMaxSteps(
  configuredMaxSteps: number | undefined,
  edgeMaxSteps: number | undefined,
  platformLimit: number,
  defaultMaxSteps: number = 20,
): number {
  const effectiveMaxSteps = edgeMaxSteps ?? configuredMaxSteps ?? defaultMaxSteps;
  return Math.min(effectiveMaxSteps, platformLimit);
}
