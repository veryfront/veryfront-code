import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mergeUsage, type RuntimeUsage, sanitizeRuntimeUsage } from "./provider-usage.ts";
import { readGatewayUsageCosts, readRuntimeAmount, readRuntimeCost } from "../runtime-usage.ts";

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
      cachedInputTokens: 4,
      reasoningTokens: 2,
    });
  });

  it("canonicalizes the legacy cached-input alias while preserving the alias", () => {
    assertEquals(
      sanitizeRuntimeUsage({ cachedInputTokens: 7 }),
      {
        cacheReadInputTokens: 7,
        cachedInputTokens: 7,
      },
    );
  });

  it("prefers the canonical cached-input counter over the compatibility alias", () => {
    assertEquals(
      sanitizeRuntimeUsage({
        cacheReadInputTokens: 2,
        cachedInputTokens: 99,
      }),
      {
        cacheReadInputTokens: 2,
        cachedInputTokens: 2,
      },
    );
  });

  it("treats the compatibility alias as the latest cached-input counter when merging", () => {
    assertEquals(
      mergeUsage(
        { cacheReadInputTokens: 2 },
        { cachedInputTokens: 4 },
      ),
      {
        cacheReadInputTokens: 4,
        cachedInputTokens: 4,
      },
    );
  });

  it("does not invoke cached-input alias accessors", () => {
    let getterCalls = 0;
    const usage = Object.defineProperty(
      { cacheReadInputTokens: 2 },
      "cachedInputTokens",
      {
        enumerable: true,
        get() {
          getterCalls++;
          return 99;
        },
      },
    ) as RuntimeUsage;

    assertEquals(sanitizeRuntimeUsage(usage), {
      cacheReadInputTokens: 2,
      cachedInputTokens: 2,
    });
    assertEquals(getterCalls, 0);
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
      cachedInputTokens: 4,
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

  it("normalizes one-sided usage through the same total invariant", () => {
    assertEquals(
      mergeUsage(undefined, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 120,
      }),
      {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
    );
  });

  it("does not invent zero tokens for metadata-only usage", () => {
    assertEquals(
      mergeUsage({ billingMode: "direct" }, { usageCaptureStatus: "missing" }),
      {
        billingMode: "direct",
        usageCaptureStatus: "missing",
      },
    );
  });

  it("preserves the legacy public costUsd field", () => {
    assertEquals(
      mergeUsage(
        { inputTokens: 1, costUsd: 0.5 },
        { outputTokens: 2 },
      ),
      {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        costUsd: 0.5,
      },
    );
  });

  it("omits non-finite, negative, fractional, and unsafe token counters", () => {
    assertEquals(
      mergeUsage(undefined, {
        inputTokens: -1,
        outputTokens: Number.POSITIVE_INFINITY,
        totalTokens: 1.5,
        billableInputTokens: Number.MAX_SAFE_INTEGER + 1,
        providerCostUsd: Number.NaN,
      }),
      {},
    );
  });

  it("does not derive an unsafe total from individually safe token counters", () => {
    assertEquals(
      mergeUsage(undefined, {
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 1,
        totalTokens: Number.MAX_SAFE_INTEGER,
      }),
      {
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 1,
      },
    );
  });

  it("ignores own accessors without invoking them while preserving valid fallback usage", () => {
    let getterCalls = 0;
    const accessor = (value: unknown): PropertyDescriptor => ({
      enumerable: true,
      get() {
        getterCalls += 1;
        return value;
      },
    });
    const current = Object.defineProperty(
      {
        inputTokens: 1,
        providerCostUsd: 0.25,
        costSource: "partial",
        billingMode: "direct",
        usageCaptureStatus: "partial",
      },
      "costCredits",
      accessor(1),
    ) as RuntimeUsage;
    const incoming = Object.defineProperties(
      { outputTokens: 2 },
      {
        inputTokens: accessor(100),
        providerCostUsd: accessor(9.99),
        costSource: accessor("gateway"),
        billingMode: accessor("deferred"),
        usageCaptureStatus: accessor("complete"),
      },
    ) as RuntimeUsage;

    assertEquals(
      mergeUsage(current, incoming),
      {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        providerCostUsd: 0.25,
        costSource: "partial",
        billingMode: "direct",
        usageCaptureStatus: "partial",
      },
    );
    assertEquals(getterCalls, 0);
  });

  it("sanitizes only own data fields without invoking own or inherited accessors", () => {
    let getterCalls = 0;
    const accessor = (value: unknown): PropertyDescriptor => ({
      enumerable: true,
      get() {
        getterCalls += 1;
        return value;
      },
    });
    const prototype = Object.defineProperties(
      {},
      {
        inputTokens: accessor(100),
        costUsd: {
          value: 4.5,
        },
        billingMode: accessor("deferred"),
      },
    );
    const usage = Object.defineProperties(
      Object.create(prototype),
      {
        outputTokens: {
          enumerable: true,
          value: 2,
        },
        providerCostUsd: accessor(9.99),
        costSource: accessor("gateway"),
        usageCaptureStatus: accessor("complete"),
      },
    );

    assertEquals(sanitizeRuntimeUsage(usage), {
      outputTokens: 2,
      totalTokens: 2,
    });
    assertEquals(getterCalls, 0);
  });

  it("returns undefined for accessor-only or inherited-only external usage", () => {
    let getterCalls = 0;
    const accessor = (value: unknown): PropertyDescriptor => ({
      get() {
        getterCalls += 1;
        return value;
      },
    });
    const inheritedOnly = Object.create({
      inputTokens: 10,
      billingMode: "deferred",
    });
    const accessorOnly = Object.defineProperties(
      {},
      {
        costCredits: accessor(1),
        usageCaptureStatus: accessor("complete"),
      },
    );

    assertEquals(mergeUsage(undefined, inheritedOnly as RuntimeUsage), {});
    assertEquals(sanitizeRuntimeUsage(inheritedOnly), undefined);
    assertEquals(sanitizeRuntimeUsage(accessorOnly), undefined);
    assertEquals(getterCalls, 0);
  });

  it("treats malformed merge operands as empty usage records", () => {
    assertEquals(
      mergeUsage(
        42 as unknown as RuntimeUsage,
        { outputTokens: 2 },
      ),
      {
        outputTokens: 2,
        totalTokens: 2,
      },
    );
    assertEquals(
      mergeUsage(undefined, [] as unknown as RuntimeUsage),
      {},
    );
  });

  it("treats revoked proxy operands as empty without leaking reflection errors", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    assertEquals(
      mergeUsage(
        revoked.proxy as RuntimeUsage,
        { outputTokens: 2 },
      ),
      {
        outputTokens: 2,
        totalTokens: 2,
      },
    );
    assertEquals(
      mergeUsage(undefined, revoked.proxy as RuntimeUsage),
      {},
    );
    assertEquals(sanitizeRuntimeUsage(revoked.proxy), undefined);
  });

  it("discards a malformed proxy operand without consulting its get trap", () => {
    let getCalls = 0;
    const malformed = new Proxy(
      { inputTokens: 100 } as RuntimeUsage,
      {
        get() {
          getCalls++;
          return 100;
        },
        getOwnPropertyDescriptor() {
          throw new TypeError("malformed usage descriptor");
        },
      },
    );

    assertEquals(
      mergeUsage(malformed, { outputTokens: 2 }),
      {
        outputTokens: 2,
        totalTokens: 2,
      },
    );
    assertEquals(sanitizeRuntimeUsage(malformed), undefined);
    assertEquals(getCalls, 0);
  });

  it("does not turn accessors into data through a polluted descriptor prototype", () => {
    let inputGetterCalls = 0;
    let prototypeGetterCalls = 0;
    const usage = Object.defineProperty({}, "inputTokens", {
      configurable: true,
      enumerable: true,
      get() {
        inputGetterCalls++;
        return 4;
      },
    }) as RuntimeUsage;
    const originalValueDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "value",
    );

    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get() {
        prototypeGetterCalls++;
        return 4;
      },
    });
    try {
      assertEquals(mergeUsage(undefined, usage), {});
      assertEquals(sanitizeRuntimeUsage(usage), undefined);
    } finally {
      if (originalValueDescriptor) {
        Object.defineProperty(
          Object.prototype,
          "value",
          originalValueDescriptor,
        );
      } else {
        delete (Object.prototype as { value?: unknown }).value;
      }
    }

    assertEquals(inputGetterCalls, 0);
    assertEquals(prototypeGetterCalls, 0);
  });

  it("returns canonical records that cannot surface polluted usage fields", () => {
    for (
      const field of [
        "cacheReadInputTokens",
        "outputTokens",
        "veryfrontBilledUsd",
      ] as const
    ) {
      let getterCalls = 0;
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        Object.prototype,
        field,
      );
      Object.defineProperty(Object.prototype, field, {
        configurable: true,
        get() {
          getterCalls++;
          return 99;
        },
      });

      try {
        const merged = mergeUsage(undefined, { inputTokens: 1 });
        const sanitized = sanitizeRuntimeUsage({ inputTokens: 1 });

        assertEquals(merged, {
          inputTokens: 1,
          totalTokens: 1,
        });
        assertEquals(sanitized, {
          inputTokens: 1,
          totalTokens: 1,
        });
        assertEquals(Object.getPrototypeOf(merged!), null);
        assertEquals(Object.getPrototypeOf(sanitized!), null);
        assertEquals((merged as unknown as Record<string, unknown>)[field], undefined);
        assertEquals((sanitized as unknown as Record<string, unknown>)[field], undefined);
        assertEquals(
          JSON.stringify(merged),
          '{"inputTokens":1,"totalTokens":1}',
        );
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(
            Object.prototype,
            field,
            originalDescriptor,
          );
        } else {
          delete (Object.prototype as Record<string, unknown>)[field];
        }
      }

      assertEquals(getterCalls, 0);
    }
  });
});

describe("provider/runtime-usage amount readers", () => {
  it("reads amounts sent as numbers or decimal strings", () => {
    assertEquals(readRuntimeAmount(0.25), 0.25);
    assertEquals(readRuntimeAmount("0.2500000000"), 0.25);
    assertEquals(readRuntimeAmount("12"), 12);
    assertEquals(readRuntimeAmount("-3.5"), -3.5);
    for (
      const value of [
        "",
        " 1",
        "1e3",
        "0x10",
        "1.",
        ".5",
        "1,250",
        "abc",
        Number.NaN,
        Number.POSITIVE_INFINITY,
        null,
        true,
        ["1"],
      ]
    ) {
      assertEquals(readRuntimeAmount(value), undefined, String(value));
    }
  });

  it("rejects negative costs in either shape", () => {
    assertEquals(readRuntimeCost("0.0000000000"), 0);
    assertEquals(readRuntimeCost("57.2500000000"), 57.25);
    assertEquals(readRuntimeCost(-1), undefined);
    assertEquals(readRuntimeCost("-0.0000000001"), undefined);
  });

  it("reads a gateway usage envelope in either shape and skips invalid amounts", () => {
    assertEquals(readGatewayUsageCosts(undefined), {});
    assertEquals(
      readGatewayUsageCosts({
        cost_usd: 0.002,
        provider_input_cost_usd: "0.0004000000",
        provider_output_cost_usd: "0.0006000000",
        provider_cost_usd: "0.0010000000",
        veryfront_input_charge_usd: 0.001,
        veryfront_output_charge_usd: "0.0015000000",
        veryfront_charge_usd: "0.0025000000",
        veryfront_billed_usd: "0.1000000000",
        cost_credits: "1.0000000000",
        billable_input_tokens: "8",
        pricing_source: "catalog",
      }),
      {
        costUsd: 0.002,
        providerInputCostUsd: 0.0004,
        providerOutputCostUsd: 0.0006,
        providerCostUsd: 0.001,
        veryfrontInputChargeUsd: 0.001,
        veryfrontOutputChargeUsd: 0.0015,
        veryfrontChargeUsd: 0.0025,
        veryfrontBilledUsd: 0.1,
        costCredits: 1,
      },
    );
    assertEquals(
      readGatewayUsageCosts({
        provider_cost_usd: "-1",
        cost_credits: "1 credit",
        veryfront_billed_usd: Number.NaN,
      }),
      {},
    );
  });

  it("defines gateway costs as own data without consulting a polluted prototype", () => {
    let setterCalls = 0;
    let getterCalls = 0;
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "providerCostUsd",
    );
    Object.defineProperty(Object.prototype, "providerCostUsd", {
      configurable: true,
      get() {
        getterCalls++;
        return 99;
      },
      set() {
        setterCalls++;
      },
    });
    Object.defineProperty(Object.prototype, "cost_usd", {
      configurable: true,
      get() {
        getterCalls++;
        return "0.5";
      },
    });

    try {
      const costs = readGatewayUsageCosts({ provider_cost_usd: "0.0010000000" });

      assertEquals(Object.getPrototypeOf(costs), null);
      assertEquals(Object.hasOwn(costs, "providerCostUsd"), true);
      assertEquals(costs.providerCostUsd, 0.001);
      assertEquals(costs.costUsd, undefined);
      assertEquals(JSON.stringify(costs), '{"providerCostUsd":0.001}');
      assertEquals(Object.getPrototypeOf(readGatewayUsageCosts(undefined)), null);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Object.prototype, "providerCostUsd", originalDescriptor);
      } else {
        delete (Object.prototype as Record<string, unknown>).providerCostUsd;
      }
      delete (Object.prototype as Record<string, unknown>).cost_usd;
    }

    assertEquals(setterCalls, 0);
    assertEquals(getterCalls, 0);
  });
});
