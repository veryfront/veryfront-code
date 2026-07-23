import { readRecord } from "./provider-records.ts";

/** Gateway billing mode attached by Veryfront Cloud usage envelopes. */
export type GatewayBillingMode = "direct" | "deferred";

/** Read a trusted gateway billing mode from provider metadata. */
export function readGatewayBillingMode(value: unknown): GatewayBillingMode | undefined {
  return value === "direct" || value === "deferred" ? value : undefined;
}

/** Public API contract for runtime usage. */
export type RuntimeUsage = {
  /** Input tokens consumed by the request. */
  inputTokens?: number;
  /** Output tokens produced by the request. */
  outputTokens?: number;
  /** Total tokens reported for the request. */
  totalTokens?: number;
  /** Input tokens written to a provider cache. */
  cacheCreationInputTokens?: number;
  /** Input tokens read from a provider cache. */
  cacheReadInputTokens?: number;
  /** Output tokens used for model reasoning. */
  reasoningTokens?: number;
  /** Input tokens billable by the gateway. */
  billableInputTokens?: number;
  /** Output tokens billable by the gateway. */
  billableOutputTokens?: number;
  /** Total request cost in US dollars. */
  costUsd?: number;
  /** Total upstream provider cost in US dollars. */
  providerCostUsd?: number;
  /** Upstream input-token cost in US dollars. */
  providerInputCostUsd?: number;
  /** Upstream output-token cost in US dollars. */
  providerOutputCostUsd?: number;
  /** Total Veryfront charge in US dollars. */
  veryfrontChargeUsd?: number;
  /** Veryfront input-token charge in US dollars. */
  veryfrontInputChargeUsd?: number;
  /** Veryfront output-token charge in US dollars. */
  veryfrontOutputChargeUsd?: number;
  /** Final amount billed by Veryfront in US dollars. */
  veryfrontBilledUsd?: number;
  /** Usage cost expressed in Veryfront credits. */
  costCredits?: number;
  /** Source and completeness of the cost metadata. */
  costSource?: "gateway" | "missing" | "partial";
  /** Gateway settlement mode for the request. */
  billingMode?: GatewayBillingMode;
  /** Completeness of the captured usage metadata. */
  usageCaptureStatus?: "complete" | "partial" | "missing";
};

function readTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function readNonNegativeFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Validate and snapshot provider usage metadata. */
export function normalizeRuntimeUsage(value: RuntimeUsage | undefined): RuntimeUsage | undefined {
  if (!value) return undefined;
  const usage = readRecord(value);
  if (!usage) return undefined;
  const normalized: RuntimeUsage = {
    inputTokens: readTokenCount(usage.inputTokens),
    outputTokens: readTokenCount(usage.outputTokens),
    totalTokens: readTokenCount(usage.totalTokens),
    cacheCreationInputTokens: readTokenCount(usage.cacheCreationInputTokens),
    cacheReadInputTokens: readTokenCount(usage.cacheReadInputTokens),
    reasoningTokens: readTokenCount(usage.reasoningTokens),
    billableInputTokens: readTokenCount(usage.billableInputTokens),
    billableOutputTokens: readTokenCount(usage.billableOutputTokens),
    costUsd: readNonNegativeFinite(usage.costUsd),
    providerCostUsd: readNonNegativeFinite(usage.providerCostUsd),
    providerInputCostUsd: readNonNegativeFinite(usage.providerInputCostUsd),
    providerOutputCostUsd: readNonNegativeFinite(usage.providerOutputCostUsd),
    veryfrontChargeUsd: readNonNegativeFinite(usage.veryfrontChargeUsd),
    veryfrontInputChargeUsd: readNonNegativeFinite(usage.veryfrontInputChargeUsd),
    veryfrontOutputChargeUsd: readNonNegativeFinite(usage.veryfrontOutputChargeUsd),
    veryfrontBilledUsd: readNonNegativeFinite(usage.veryfrontBilledUsd),
    costCredits: readNonNegativeFinite(usage.costCredits),
    costSource: usage.costSource === "gateway" || usage.costSource === "missing" ||
        usage.costSource === "partial"
      ? usage.costSource
      : undefined,
    billingMode: readGatewayBillingMode(usage.billingMode),
    usageCaptureStatus: usage.usageCaptureStatus === "complete" ||
        usage.usageCaptureStatus === "partial" || usage.usageCaptureStatus === "missing"
      ? usage.usageCaptureStatus
      : undefined,
  };
  for (const key of Object.keys(normalized) as Array<keyof RuntimeUsage>) {
    if (normalized[key] === undefined) delete normalized[key];
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function extractGatewayUsage(usage: Record<string, unknown>): RuntimeUsage {
  const veryfront = readRecord(usage.veryfront);
  if (!veryfront) return {};

  return normalizeRuntimeUsage({
    billableInputTokens: readTokenCount(veryfront.billable_input_tokens),
    billableOutputTokens: readTokenCount(veryfront.billable_output_tokens),
    costUsd: readNonNegativeFinite(veryfront.cost_usd),
    providerInputCostUsd: readNonNegativeFinite(veryfront.provider_input_cost_usd),
    providerOutputCostUsd: readNonNegativeFinite(veryfront.provider_output_cost_usd),
    providerCostUsd: readNonNegativeFinite(veryfront.provider_cost_usd),
    veryfrontInputChargeUsd: readNonNegativeFinite(veryfront.veryfront_input_charge_usd),
    veryfrontOutputChargeUsd: readNonNegativeFinite(veryfront.veryfront_output_charge_usd),
    veryfrontChargeUsd: readNonNegativeFinite(veryfront.veryfront_charge_usd),
    veryfrontBilledUsd: readNonNegativeFinite(veryfront.veryfront_billed_usd),
    costCredits: readNonNegativeFinite(veryfront.cost_credits),
    costSource: veryfront.cost_source === "gateway" || veryfront.cost_source === "missing" ||
        veryfront.cost_source === "partial"
      ? veryfront.cost_source
      : undefined,
    billingMode: readGatewayBillingMode(veryfront.billing_mode),
    usageCaptureStatus: veryfront.usage_capture_status === "complete" ||
        veryfront.usage_capture_status === "partial" ||
        veryfront.usage_capture_status === "missing"
      ? veryfront.usage_capture_status
      : undefined,
  }) ?? {};
}

/** Extract normalized token and gateway usage from an Anthropic response payload. */
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

  return normalizeRuntimeUsage({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined,
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...extractGatewayUsage(usage),
  });
}

/** Extract normalized token and gateway usage from a Google response payload. */
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

  return normalizeRuntimeUsage({
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cachedContentTokenCount !== undefined
      ? { cacheReadInputTokens: cachedContentTokenCount }
      : {}),
    ...(thoughtsTokenCount !== undefined ? { reasoningTokens: thoughtsTokenCount } : {}),
    ...extractGatewayUsage(usage),
  });
}

/** Extract normalized token and gateway usage from an OpenAI chat response payload. */
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

  return normalizeRuntimeUsage({
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cachedTokens !== undefined ? { cacheReadInputTokens: cachedTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...extractGatewayUsage(usage),
  });
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
  const totalTokens = readTokenCount(usage.total_tokens) ??
    (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  const inputDetails = readRecord(usage.input_tokens_details);
  const cachedTokens = readTokenCount(inputDetails?.cached_tokens);
  const outputDetails = readRecord(usage.output_tokens_details);
  const reasoningTokens = readTokenCount(outputDetails?.reasoning_tokens);

  return normalizeRuntimeUsage({
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cachedTokens !== undefined ? { cacheReadInputTokens: cachedTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...extractGatewayUsage(usage),
  });
}

/** Merge provider usage counters. */
export function mergeUsage(
  current: RuntimeUsage | undefined,
  next: RuntimeUsage | undefined,
): RuntimeUsage | undefined {
  current = normalizeRuntimeUsage(current);
  next = normalizeRuntimeUsage(next);
  if (!current) return next;
  if (!next) return current;

  const inputTokens = next.inputTokens ?? current.inputTokens;
  const outputTokens = next.outputTokens ?? current.outputTokens;
  const cacheCreationInputTokens = next.cacheCreationInputTokens ??
    current.cacheCreationInputTokens;
  const cacheReadInputTokens = next.cacheReadInputTokens ?? current.cacheReadInputTokens;
  const reasoningTokens = next.reasoningTokens ?? current.reasoningTokens;
  const billableInputTokens = next.billableInputTokens ?? current.billableInputTokens;
  const billableOutputTokens = next.billableOutputTokens ?? current.billableOutputTokens;
  const costUsd = next.costUsd ?? current.costUsd;
  const providerCostUsd = next.providerCostUsd ?? current.providerCostUsd;
  const providerInputCostUsd = next.providerInputCostUsd ?? current.providerInputCostUsd;
  const providerOutputCostUsd = next.providerOutputCostUsd ?? current.providerOutputCostUsd;
  const veryfrontChargeUsd = next.veryfrontChargeUsd ?? current.veryfrontChargeUsd;
  const veryfrontInputChargeUsd = next.veryfrontInputChargeUsd ?? current.veryfrontInputChargeUsd;
  const veryfrontOutputChargeUsd = next.veryfrontOutputChargeUsd ??
    current.veryfrontOutputChargeUsd;
  const veryfrontBilledUsd = next.veryfrontBilledUsd ?? current.veryfrontBilledUsd;
  const costCredits = next.costCredits ?? current.costCredits;
  const costSource = next.costSource ?? current.costSource;
  const billingMode = next.billingMode === "deferred" || current.billingMode === "deferred"
    ? "deferred"
    : next.billingMode ?? current.billingMode;
  const usageCaptureStatus = next.usageCaptureStatus ?? current.usageCaptureStatus;

  // Prefer the provider-reported total (latest non-undefined wins, matching the
  // ?? semantics used for input/output above). Providers like Gemini 2.5
  // thinking models and OpenAI reasoning models report a total that exceeds
  // input + output because it includes reasoning/thoughts tokens. Recomputing
  // the sum would discard those, undercounting usage. Take the larger of the
  // provider total and the recomputed sum so we never undercount.
  const reportedTotal = next.totalTokens ?? current.totalTokens;
  const recomputedTotal = inputTokens !== undefined || outputTokens !== undefined
    ? (inputTokens ?? 0) + (outputTokens ?? 0)
    : undefined;
  const totalTokens = reportedTotal !== undefined
    ? Math.max(reportedTotal, recomputedTotal ?? 0)
    : recomputedTotal;

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
