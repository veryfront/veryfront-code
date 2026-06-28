import type { Message } from "../types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry.ts";

export function normalizeInput(input: string | Message[]): Message[] {
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
    usageCaptureStatus?: "complete" | "partial" | "missing";
  },
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
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
