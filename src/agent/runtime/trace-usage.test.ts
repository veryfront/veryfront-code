import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildRuntimeUsageTraceAttributes } from "./trace-usage.ts";

describe("runtime trace usage attributes", () => {
  it("maps model token usage to GenAI semantic attributes", () => {
    assertEquals(
      buildRuntimeUsageTraceAttributes({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cacheCreationInputTokens: 3,
        cacheReadInputTokens: 7,
        reasoningTokens: 2,
      }),
      {
        "gen_ai.usage.input_tokens": 10,
        "gen_ai.usage.output_tokens": 5,
        "gen_ai.usage.total_tokens": 15,
        "gen_ai.usage.cache_creation.input_tokens": 3,
        "gen_ai.usage.cache_read.input_tokens": 7,
        "gen_ai.usage.reasoning.output_tokens": 2,
      },
    );
  });

  it("accepts accumulated runtime usage aliases", () => {
    assertEquals(
      buildRuntimeUsageTraceAttributes({
        promptTokens: 11,
        completionTokens: 9,
        cachedInputTokens: 4,
        billableInputTokens: 10,
        billableOutputTokens: 8,
        providerCostUsd: 0.003,
        veryfrontChargeUsd: 0.004,
        costCredits: 2,
        costSource: "gateway",
        billingMode: "deferred",
        usageCaptureStatus: "complete",
      }),
      {
        "gen_ai.usage.input_tokens": 11,
        "gen_ai.usage.output_tokens": 9,
        "gen_ai.usage.total_tokens": 20,
        "gen_ai.usage.cache_read.input_tokens": 4,
        "agent.usage.billable_input_tokens": 10,
        "agent.usage.billable_output_tokens": 8,
        "agent.usage.provider_cost_usd": 0.003,
        "agent.usage.veryfront_charge_usd": 0.004,
        "agent.usage.cost_credits": 2,
        "agent.usage.cost_source": "gateway",
        "agent.usage.billing_mode": "deferred",
        "agent.usage.capture_status": "complete",
      },
    );
  });

  it("drops missing and non-finite values", () => {
    assertEquals(
      buildRuntimeUsageTraceAttributes({
        inputTokens: Number.NaN,
        outputTokens: Number.POSITIVE_INFINITY,
        costSource: "",
      }),
      {},
    );
  });
});
