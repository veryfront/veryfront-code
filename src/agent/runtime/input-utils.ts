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
  },
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    reasoningTokens?: number;
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
