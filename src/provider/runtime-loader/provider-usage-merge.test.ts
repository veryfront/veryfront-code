import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mergeUsage } from "./provider-usage.ts";

describe("provider/runtime-loader/provider-usage mergeUsage", () => {
  it("preserves a provider-reported totalTokens that exceeds input + output (reasoning tokens)", () => {
    const merged = mergeUsage(undefined, {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 200,
    });

    assertEquals(merged?.inputTokens, 100);
    assertEquals(merged?.outputTokens, 50);
    // Provider-authoritative total must NOT be recomputed to 150.
    assertEquals(merged?.totalTokens, 200);
  });

  it("prefers the next provider-reported total over a recomputed sum when merging two usages", () => {
    // mergeUsage takes the latest non-undefined input/output (?? semantics),
    // so input=80, output=40, recomputed sum=120 — but the provider total of
    // 150 (carries reasoning tokens) must win.
    const merged = mergeUsage(
      { inputTokens: 100, outputTokens: 50, totalTokens: 200 },
      { inputTokens: 80, outputTokens: 40, totalTokens: 150 },
    );

    assertEquals(merged?.inputTokens, 80);
    assertEquals(merged?.outputTokens, 40);
    assertEquals(merged?.totalTokens, 150);
  });

  it("falls back to recomputed sum when no provider total is present", () => {
    const merged = mergeUsage(
      { inputTokens: 10, outputTokens: 5 },
      { inputTokens: 20, outputTokens: 7 },
    );

    // latest input=20, output=7 -> 27
    assertEquals(merged?.totalTokens, 27);
  });

  it("prefers the larger of provider total vs recomputed sum during a merge", () => {
    const merged = mergeUsage(
      { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      { inputTokens: 100, outputTokens: 50, totalTokens: 120 },
    );

    // recomputed sum (150) is larger than the reported total (120),
    // so keep the larger to avoid undercounting.
    assertEquals(merged?.totalTokens, 150);
  });

  it("preserves cached and reasoning token details while merging partial usage", () => {
    const merged = mergeUsage(
      { inputTokens: 10, cacheReadInputTokens: 4 },
      { outputTokens: 5, reasoningTokens: 2 },
    );

    assertEquals(merged, {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadInputTokens: 4,
      reasoningTokens: 2,
    });
  });

  it("preserves gateway billing metadata from a final usage event", () => {
    const merged = mergeUsage(
      { inputTokens: 10, cacheReadInputTokens: 4 },
      {
        outputTokens: 5,
        billableInputTokens: 10,
        billableOutputTokens: 5,
        providerInputCostUsd: 0.0004,
        providerOutputCostUsd: 0.0006,
        providerCostUsd: 0.001,
        veryfrontInputChargeUsd: 0.001,
        veryfrontOutputChargeUsd: 0.0015,
        veryfrontChargeUsd: 0.0025,
        veryfrontBilledUsd: 0.1,
        costCredits: 1,
        costSource: "gateway",
        usageCaptureStatus: "complete",
      },
    );

    assertEquals(merged, {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadInputTokens: 4,
      billableInputTokens: 10,
      billableOutputTokens: 5,
      providerInputCostUsd: 0.0004,
      providerOutputCostUsd: 0.0006,
      providerCostUsd: 0.001,
      veryfrontInputChargeUsd: 0.001,
      veryfrontOutputChargeUsd: 0.0015,
      veryfrontChargeUsd: 0.0025,
      veryfrontBilledUsd: 0.1,
      costCredits: 1,
      costSource: "gateway",
      usageCaptureStatus: "complete",
    });
  });

  it("keeps deferred billing when merging internal gateway turns", () => {
    const merged = mergeUsage(
      { inputTokens: 10, billingMode: "direct" },
      { outputTokens: 5, billingMode: "deferred" },
    );

    assertEquals(merged?.billingMode, "deferred");
  });
});
