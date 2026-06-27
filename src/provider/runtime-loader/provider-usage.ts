import { readRecord } from "./provider-records.ts";

/** Public API contract for runtime usage. */
export type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningTokens?: number;
  billableInputTokens?: number;
  billableOutputTokens?: number;
  providerCostUsd?: number;
  veryfrontChargeUsd?: number;
  veryfrontBilledUsd?: number;
  costCredits?: number;
  costSource?: "gateway" | "missing" | "partial";
  usageCaptureStatus?: "complete" | "partial" | "missing";
};

export function extractAnthropicUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheCreationInputTokens = usage.cache_creation_input_tokens;
  const cacheReadInputTokens = usage.cache_read_input_tokens;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof inputTokens === "number" || typeof outputTokens === "number"
      ? (typeof inputTokens === "number" ? inputTokens : 0) +
        (typeof outputTokens === "number" ? outputTokens : 0)
      : undefined,
    ...(typeof cacheCreationInputTokens === "number" ? { cacheCreationInputTokens } : {}),
    ...(typeof cacheReadInputTokens === "number" ? { cacheReadInputTokens } : {}),
  };
}

export function extractGoogleUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usageMetadata);
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.promptTokenCount;
  const outputTokens = usage.candidatesTokenCount;
  const totalTokens = usage.totalTokenCount;
  const cachedContentTokenCount = usage.cachedContentTokenCount;
  const thoughtsTokenCount = usage.thoughtsTokenCount;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof totalTokens === "number" ? totalTokens : undefined,
    ...(typeof cachedContentTokenCount === "number"
      ? { cacheReadInputTokens: cachedContentTokenCount }
      : {}),
    ...(typeof thoughtsTokenCount === "number" ? { reasoningTokens: thoughtsTokenCount } : {}),
  };
}

export function extractOpenAIUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  const totalTokens = usage.total_tokens;
  const promptTokensDetails = readRecord(usage.prompt_tokens_details);
  const cachedTokens = promptTokensDetails?.cached_tokens;
  const completionTokensDetails = readRecord(usage.completion_tokens_details);
  const reasoningTokens = completionTokensDetails?.reasoning_tokens;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof totalTokens === "number" ? totalTokens : undefined,
    ...(typeof cachedTokens === "number" ? { cacheReadInputTokens: cachedTokens } : {}),
    ...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
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

  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  const totalTokens = typeof usage.total_tokens === "number"
    ? usage.total_tokens
    : (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  const inputDetails = readRecord(usage.input_tokens_details);
  const cachedTokens = inputDetails?.cached_tokens;
  const outputDetails = readRecord(usage.output_tokens_details);
  const reasoningTokens = outputDetails?.reasoning_tokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(typeof cachedTokens === "number" ? { cacheReadInputTokens: cachedTokens } : {}),
    ...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
  };
}

/** Merge provider usage counters. */
export function mergeUsage(
  current: RuntimeUsage | undefined,
  next: RuntimeUsage | undefined,
): RuntimeUsage | undefined {
  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  const inputTokens = next.inputTokens ?? current.inputTokens;
  const outputTokens = next.outputTokens ?? current.outputTokens;
  const cacheCreationInputTokens = next.cacheCreationInputTokens ??
    current.cacheCreationInputTokens;
  const cacheReadInputTokens = next.cacheReadInputTokens ?? current.cacheReadInputTokens;
  const reasoningTokens = next.reasoningTokens ?? current.reasoningTokens;
  const billableInputTokens = next.billableInputTokens ?? current.billableInputTokens;
  const billableOutputTokens = next.billableOutputTokens ?? current.billableOutputTokens;
  const providerCostUsd = next.providerCostUsd ?? current.providerCostUsd;
  const veryfrontChargeUsd = next.veryfrontChargeUsd ?? current.veryfrontChargeUsd;
  const veryfrontBilledUsd = next.veryfrontBilledUsd ?? current.veryfrontBilledUsd;
  const costCredits = next.costCredits ?? current.costCredits;
  const costSource = next.costSource ?? current.costSource;
  const usageCaptureStatus = next.usageCaptureStatus ?? current.usageCaptureStatus;

  // Prefer the provider-reported total (latest non-undefined wins, matching the
  // ?? semantics used for input/output above). Providers like Gemini 2.5
  // thinking models and OpenAI reasoning models report a total that exceeds
  // input + output because it includes reasoning/thoughts tokens. Recomputing
  // the sum would discard those, undercounting usage. Take the larger of the
  // provider total and the recomputed sum so we never undercount.
  const reportedTotal = next.totalTokens ?? current.totalTokens;
  const recomputedTotal = (inputTokens ?? 0) + (outputTokens ?? 0);
  const totalTokens = reportedTotal !== undefined
    ? Math.max(reportedTotal, recomputedTotal)
    : recomputedTotal;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(billableInputTokens !== undefined ? { billableInputTokens } : {}),
    ...(billableOutputTokens !== undefined ? { billableOutputTokens } : {}),
    ...(providerCostUsd !== undefined ? { providerCostUsd } : {}),
    ...(veryfrontChargeUsd !== undefined ? { veryfrontChargeUsd } : {}),
    ...(veryfrontBilledUsd !== undefined ? { veryfrontBilledUsd } : {}),
    ...(costCredits !== undefined ? { costCredits } : {}),
    ...(costSource !== undefined ? { costSource } : {}),
    ...(usageCaptureStatus !== undefined ? { usageCaptureStatus } : {}),
  };
}
