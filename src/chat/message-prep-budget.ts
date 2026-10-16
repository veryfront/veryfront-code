import type { ProviderModelMessage } from "./types.ts";
import { stringifyChatJson } from "./json-value.ts";
import { DEFAULT_MESSAGE_PREP_LIMITS } from "./message-prep-types.ts";

const TOKENS_PER_TOOL = 250;
const BUDGET_RATIO = 0.85;
const DEFAULT_CONTEXT_WINDOW = 200_000;
export const DEFAULT_TOKEN_BUDGET = Math.floor(DEFAULT_CONTEXT_WINDOW * BUDGET_RATIO);

const CHARS_PER_TOKEN = DEFAULT_MESSAGE_PREP_LIMITS.charsPerToken;

/** Estimate tokens. */
export function estimateTokens(value: unknown): number {
  return Math.ceil(stringifyChatJson(value ?? "").length / CHARS_PER_TOKEN);
}

/** Reject provider messages that exceed the shared prepared context budget. */
export function assertPreparedMessageBudget(
  messages: readonly ProviderModelMessage[],
  overhead: number,
): void {
  if (
    messages.reduce((total, message) => total + estimateTokens(message.content), overhead) >
      DEFAULT_TOKEN_BUDGET
  ) {
    throw new RangeError("Prepared messages exceed the context budget");
  }
}

/** Estimate overhead. */
export function estimateOverhead(instructions: unknown, toolCount: number): number {
  const instructionTokens = estimateTokens(instructions);
  return instructionTokens + toolCount * TOKENS_PER_TOOL;
}
