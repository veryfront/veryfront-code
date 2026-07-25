import { readRecord } from "./provider-records.ts";

/** Gateway billing mode attached by Veryfront Cloud usage envelopes. */
export type GatewayBillingMode = "direct" | "deferred";

/** Read a trusted gateway billing mode from provider metadata. */
export function readGatewayBillingMode(value: unknown): GatewayBillingMode | undefined {
  return value === "direct" || value === "deferred" ? value : undefined;
}

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
  costUsd?: number;
  providerCostUsd?: number;
  providerInputCostUsd?: number;
  providerOutputCostUsd?: number;
  veryfrontChargeUsd?: number;
  veryfrontInputChargeUsd?: number;
  veryfrontOutputChargeUsd?: number;
  veryfrontBilledUsd?: number;
  costCredits?: number;
  costSource?: "gateway" | "missing" | "partial";
  billingMode?: GatewayBillingMode;
  usageCaptureStatus?: "complete" | "partial" | "missing";
};

function readTokenCount(value: unknown): number | undefined {
  return typeof value === "number" &&
      Number.isFinite(value) &&
      Number.isSafeInteger(value) &&
      value >= 0
    ? value
    : undefined;
}

function sumTokenCounts(
  first: number | undefined,
  second: number | undefined,
): number | undefined {
  if (first === undefined && second === undefined) {
    return undefined;
  }
  return readTokenCount((first ?? 0) + (second ?? 0));
}

function readNonNegativeFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function latestValidNumber(
  next: number | undefined,
  current: number | undefined,
  read: (value: unknown) => number | undefined,
): number | undefined {
  return read(next) ?? read(current);
}

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
  if (!current && !next) return undefined;
  const previous = current ?? {};
  const incoming = next ?? {};

  const inputTokens = latestValidNumber(incoming.inputTokens, previous.inputTokens, readTokenCount);
  const outputTokens = latestValidNumber(
    incoming.outputTokens,
    previous.outputTokens,
    readTokenCount,
  );
  const cacheCreationInputTokens = latestValidNumber(
    incoming.cacheCreationInputTokens,
    previous.cacheCreationInputTokens,
    readTokenCount,
  );
  const cacheReadInputTokens = latestValidNumber(
    incoming.cacheReadInputTokens,
    previous.cacheReadInputTokens,
    readTokenCount,
  );
  const reasoningTokens = latestValidNumber(
    incoming.reasoningTokens,
    previous.reasoningTokens,
    readTokenCount,
  );
  const billableInputTokens = latestValidNumber(
    incoming.billableInputTokens,
    previous.billableInputTokens,
    readTokenCount,
  );
  const billableOutputTokens = latestValidNumber(
    incoming.billableOutputTokens,
    previous.billableOutputTokens,
    readTokenCount,
  );
  const costUsd = latestValidNumber(
    incoming.costUsd,
    previous.costUsd,
    readNonNegativeFiniteNumber,
  );
  const providerCostUsd = latestValidNumber(
    incoming.providerCostUsd,
    previous.providerCostUsd,
    readNonNegativeFiniteNumber,
  );
  const providerInputCostUsd = latestValidNumber(
    incoming.providerInputCostUsd,
    previous.providerInputCostUsd,
    readNonNegativeFiniteNumber,
  );
  const providerOutputCostUsd = latestValidNumber(
    incoming.providerOutputCostUsd,
    previous.providerOutputCostUsd,
    readNonNegativeFiniteNumber,
  );
  const veryfrontChargeUsd = latestValidNumber(
    incoming.veryfrontChargeUsd,
    previous.veryfrontChargeUsd,
    readNonNegativeFiniteNumber,
  );
  const veryfrontInputChargeUsd = latestValidNumber(
    incoming.veryfrontInputChargeUsd,
    previous.veryfrontInputChargeUsd,
    readNonNegativeFiniteNumber,
  );
  const veryfrontOutputChargeUsd = latestValidNumber(
    incoming.veryfrontOutputChargeUsd,
    previous.veryfrontOutputChargeUsd,
    readNonNegativeFiniteNumber,
  );
  const veryfrontBilledUsd = latestValidNumber(
    incoming.veryfrontBilledUsd,
    previous.veryfrontBilledUsd,
    readNonNegativeFiniteNumber,
  );
  const costCredits = latestValidNumber(
    incoming.costCredits,
    previous.costCredits,
    readNonNegativeFiniteNumber,
  );
  const costSource = incoming.costSource === "gateway" ||
      incoming.costSource === "missing" ||
      incoming.costSource === "partial"
    ? incoming.costSource
    : previous.costSource === "gateway" ||
        previous.costSource === "missing" ||
        previous.costSource === "partial"
    ? previous.costSource
    : undefined;
  const billingMode = incoming.billingMode === "deferred" ||
      previous.billingMode === "deferred"
    ? "deferred"
    : readGatewayBillingMode(incoming.billingMode) ?? readGatewayBillingMode(previous.billingMode);
  const usageCaptureStatus = incoming.usageCaptureStatus === "complete" ||
      incoming.usageCaptureStatus === "partial" ||
      incoming.usageCaptureStatus === "missing"
    ? incoming.usageCaptureStatus
    : previous.usageCaptureStatus === "complete" ||
        previous.usageCaptureStatus === "partial" ||
        previous.usageCaptureStatus === "missing"
    ? previous.usageCaptureStatus
    : undefined;

  // Prefer the provider-reported total (latest non-undefined wins, matching the
  // ?? semantics used for input/output above). Providers like Gemini 2.5
  // thinking models and OpenAI reasoning models report a total that exceeds
  // input + output because it includes reasoning/thoughts tokens. Recomputing
  // the sum would discard those, undercounting usage. Take the larger of the
  // provider total and the recomputed sum so we never undercount.
  const reportedTotal = latestValidNumber(
    incoming.totalTokens,
    previous.totalTokens,
    readTokenCount,
  );
  const hasInputOrOutput = inputTokens !== undefined || outputTokens !== undefined;
  const recomputedTotal = sumTokenCounts(inputTokens, outputTokens);
  const totalTokens = hasInputOrOutput && recomputedTotal === undefined
    ? undefined
    : reportedTotal !== undefined && recomputedTotal !== undefined
    ? Math.max(reportedTotal, recomputedTotal)
    : reportedTotal ?? recomputedTotal;

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(billableInputTokens !== undefined ? { billableInputTokens } : {}),
    ...(billableOutputTokens !== undefined ? { billableOutputTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(providerCostUsd !== undefined ? { providerCostUsd } : {}),
    ...(providerInputCostUsd !== undefined ? { providerInputCostUsd } : {}),
    ...(providerOutputCostUsd !== undefined ? { providerOutputCostUsd } : {}),
    ...(veryfrontChargeUsd !== undefined ? { veryfrontChargeUsd } : {}),
    ...(veryfrontInputChargeUsd !== undefined ? { veryfrontInputChargeUsd } : {}),
    ...(veryfrontOutputChargeUsd !== undefined ? { veryfrontOutputChargeUsd } : {}),
    ...(veryfrontBilledUsd !== undefined ? { veryfrontBilledUsd } : {}),
    ...(costCredits !== undefined ? { costCredits } : {}),
    ...(costSource !== undefined ? { costSource } : {}),
    ...(billingMode !== undefined ? { billingMode } : {}),
    ...(usageCaptureStatus !== undefined ? { usageCaptureStatus } : {}),
  };
}
