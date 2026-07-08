type RuntimeTraceAttributeValue = string | number | boolean;

export type RuntimeUsageTraceInput = {
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cachedInputTokens?: number;
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
  costSource?: "gateway" | "missing" | "partial" | string;
  billingMode?: "direct" | "deferred" | string;
  usageCaptureStatus?: "complete" | "partial" | "missing" | string;
};

function isTraceAttributeValue(value: unknown): value is RuntimeTraceAttributeValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function usageNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function usageString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Builds OTel/Datadog-safe token and billing attributes for runtime spans.
 *
 * Token counts use OpenTelemetry GenAI semantic names. Veryfront billing and
 * cost fields stay under an agent-owned namespace because they are platform
 * metadata, not model-provider usage semantics.
 */
export function buildRuntimeUsageTraceAttributes(
  usage: RuntimeUsageTraceInput | null | undefined,
): Record<string, RuntimeTraceAttributeValue> {
  const inputTokens = usageNumber(usage?.inputTokens ?? usage?.promptTokens);
  const outputTokens = usageNumber(usage?.outputTokens ?? usage?.completionTokens);
  const totalTokens = usageNumber(usage?.totalTokens) ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  const cacheReadInputTokens = usageNumber(usage?.cacheReadInputTokens ?? usage?.cachedInputTokens);

  return Object.fromEntries(
    Object.entries({
      "gen_ai.usage.input_tokens": inputTokens,
      "gen_ai.usage.output_tokens": outputTokens,
      "gen_ai.usage.total_tokens": totalTokens,
      "gen_ai.usage.cache_creation.input_tokens": usageNumber(
        usage?.cacheCreationInputTokens,
      ),
      "gen_ai.usage.cache_read.input_tokens": cacheReadInputTokens,
      "gen_ai.usage.reasoning.output_tokens": usageNumber(usage?.reasoningTokens),
      "agent.usage.billable_input_tokens": usageNumber(usage?.billableInputTokens),
      "agent.usage.billable_output_tokens": usageNumber(usage?.billableOutputTokens),
      "agent.usage.cost_usd": usageNumber(usage?.costUsd),
      "agent.usage.provider_input_cost_usd": usageNumber(usage?.providerInputCostUsd),
      "agent.usage.provider_output_cost_usd": usageNumber(usage?.providerOutputCostUsd),
      "agent.usage.provider_cost_usd": usageNumber(usage?.providerCostUsd),
      "agent.usage.veryfront_input_charge_usd": usageNumber(usage?.veryfrontInputChargeUsd),
      "agent.usage.veryfront_output_charge_usd": usageNumber(usage?.veryfrontOutputChargeUsd),
      "agent.usage.veryfront_charge_usd": usageNumber(usage?.veryfrontChargeUsd),
      "agent.usage.veryfront_billed_usd": usageNumber(usage?.veryfrontBilledUsd),
      "agent.usage.cost_credits": usageNumber(usage?.costCredits),
      "agent.usage.cost_source": usageString(usage?.costSource),
      "agent.usage.billing_mode": usageString(usage?.billingMode),
      "agent.usage.capture_status": usageString(usage?.usageCaptureStatus),
    }).filter(([, value]) => isTraceAttributeValue(value)),
  ) as Record<string, RuntimeTraceAttributeValue>;
}
