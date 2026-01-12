/**
 * Input Utilities
 *
 * Utilities for normalizing agent input to messages.
 *
 * @module ai/agent/runtime/input-utils
 */

import type { Message } from "../../types/agent.ts";

/**
 * Normalize input to messages array (v5 format with parts).
 * Converts string input to a user message.
 */
export function normalizeInput(input: string | Message[]): Message[] {
  if (typeof input === "string") {
    return [
      {
        id: `msg_${Date.now()}`,
        role: "user",
        parts: [{ type: "text", text: input }],
        timestamp: Date.now(),
      },
    ];
  }

  return input.map((msg) => ({
    ...msg,
    id: msg.id || `msg_${Date.now()}`,
    timestamp: msg.timestamp || Date.now(),
  }));
}

/**
 * Accumulate usage statistics from a response into the total.
 */
export function accumulateUsage(
  total: { promptTokens: number; completionTokens: number; totalTokens: number },
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
): void {
  total.promptTokens += usage.promptTokens ?? 0;
  total.completionTokens += usage.completionTokens ?? 0;
  total.totalTokens += usage.totalTokens ?? 0;
}

/**
 * Get max steps considering edge config and platform limits.
 * Priority: edge config > agent config > default (20).
 */
export function getMaxSteps(
  configuredMaxSteps: number | undefined,
  edgeMaxSteps: number | undefined,
  platformLimit: number,
  defaultMaxSteps: number = 20,
): number {
  const effectiveMaxSteps = edgeMaxSteps ?? configuredMaxSteps ?? defaultMaxSteps;
  return Math.min(effectiveMaxSteps, platformLimit);
}
