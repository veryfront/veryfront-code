import {
  mergeRuntimeUsage,
  readRuntimeTokenCount as readTokenCount,
  type RuntimeUsage,
  sumRuntimeTokenCounts as sumTokenCounts,
} from "../runtime-usage.ts";
import { readRecord } from "./provider-records.ts";

export {
  mergeRuntimeUsage,
  readGatewayBillingMode,
  sanitizeRuntimeUsage,
} from "../runtime-usage.ts";
export type { GatewayBillingMode, RuntimeUsage } from "../runtime-usage.ts";

export function extractAnthropicUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  if (!usage) {
    return undefined;
  }

  const inputTokens = readTokenCount(usage.input_tokens);
  const outputTokens = readTokenCount(usage.output_tokens);
  const cacheCreationInputTokens = readTokenCount(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = readTokenCount(usage.cache_read_input_tokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens: sumTokenCounts(inputTokens, outputTokens),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
  };
}

export function extractGoogleUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usageMetadata);
  if (!usage) {
    return undefined;
  }

  const inputTokens = readTokenCount(usage.promptTokenCount);
  const outputTokens = readTokenCount(usage.candidatesTokenCount);
  const totalTokens = readTokenCount(usage.totalTokenCount);
  const cachedContentTokenCount = readTokenCount(usage.cachedContentTokenCount);
  const thoughtsTokenCount = readTokenCount(usage.thoughtsTokenCount);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cachedContentTokenCount !== undefined
      ? { cacheReadInputTokens: cachedContentTokenCount }
      : {}),
    ...(thoughtsTokenCount !== undefined ? { reasoningTokens: thoughtsTokenCount } : {}),
  };
}

export function extractOpenAIUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  if (!usage) {
    return undefined;
  }

  const inputTokens = readTokenCount(usage.prompt_tokens);
  const outputTokens = readTokenCount(usage.completion_tokens);
  const totalTokens = readTokenCount(usage.total_tokens);
  const promptTokensDetails = readRecord(usage.prompt_tokens_details);
  const cachedTokens = readTokenCount(promptTokensDetails?.cached_tokens);
  const completionTokensDetails = readRecord(usage.completion_tokens_details);
  const reasoningTokens = readTokenCount(completionTokensDetails?.reasoning_tokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cachedTokens !== undefined ? { cacheReadInputTokens: cachedTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}

/**
 * The Responses API uses `input_tokens` / `output_tokens` field names
 * instead of Chat Completions' `prompt_tokens` / `completion_tokens`.
 * It also nests cached input tokens under `input_tokens_details` and
 * exposes reasoning tokens via `output_tokens_details.reasoning_tokens`.
 */
export function extractOpenAIResponsesUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  // Streaming usage lives on response.completed inside `response.usage`;
  // non-streaming has it at the top level.
  const responseRecord = readRecord(record?.response);
  const usage = readRecord(responseRecord?.usage) ?? readRecord(record?.usage);
  if (!usage) return undefined;

  const inputTokens = readTokenCount(usage.input_tokens);
  const outputTokens = readTokenCount(usage.output_tokens);
  const reportedTotalTokens = readTokenCount(usage.total_tokens);
  const totalTokens = reportedTotalTokens !== undefined
    ? reportedTotalTokens
    : sumTokenCounts(inputTokens, outputTokens);
  const inputDetails = readRecord(usage.input_tokens_details);
  const cachedTokens = readTokenCount(inputDetails?.cached_tokens);
  const outputDetails = readRecord(usage.output_tokens_details);
  const reasoningTokens = readTokenCount(outputDetails?.reasoning_tokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cachedTokens !== undefined ? { cacheReadInputTokens: cachedTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}

/** Merge provider usage counters. */
export function mergeUsage(
  current: RuntimeUsage | undefined,
  next: RuntimeUsage | undefined,
): RuntimeUsage | undefined {
  return mergeRuntimeUsage(current, next);
}
