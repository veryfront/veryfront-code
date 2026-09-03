import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  accumulateUsage,
  getMaxSteps,
  normalizeInput,
  resolveValidatedTurnInput,
} from "./input-utils.ts";

type UsageTotal = Parameters<typeof accumulateUsage>[0];
import {
  isRuntimeGeneratedUserMessage,
  markRuntimeGeneratedUserMessage,
} from "./runtime-message-origin.ts";

describe("input-utils", () => {
  describe("normalizeInput", () => {
    it("wraps a plain string into a user message array", () => {
      const result = normalizeInput("hello");
      assertEquals(result.length, 1);

      const message = result[0];
      assertExists(message);
      assertEquals(message.role, "user");
      assertEquals(message.parts.length, 1);

      const part = message.parts[0];
      assertExists(part);
      assertEquals(part.type, "text");
      assertEquals((part as { text: string }).text, "hello");
    });

    it("preserves existing message array with ids", () => {
      const messages = [
        {
          id: "msg_1",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "hi" }],
          timestamp: 1000,
        },
      ];
      const result = normalizeInput(messages);
      assertEquals(result.length, 1);

      const message = result[0];
      assertExists(message);
      assertEquals(message.id, "msg_1");
      assertEquals(message.timestamp, 1000);
    });

    it("preserves in-process runtime continuation origin while normalizing", () => {
      const runtimeMessage = markRuntimeGeneratedUserMessage({
        id: "runtime-note",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Continue with available tools." }],
      });

      const [normalized] = normalizeInput([runtimeMessage]);

      assertEquals(isRuntimeGeneratedUserMessage(normalized!), true);
      assertEquals(normalized === runtimeMessage, false);
    });

    it("assigns generated ids when message has no id", () => {
      const messages = [
        {
          role: "user" as const,
          parts: [{ type: "text" as const, text: "hi" }],
        },
      ];
      const result = normalizeInput(messages as Parameters<typeof normalizeInput>[0]);
      assertEquals(result.length, 1);

      const message = result[0];
      assertExists(message);
      assertEquals(typeof message.id, "string");
      assertEquals(message.id.startsWith("msg_"), true);
    });

    it("throws on empty string id", () => {
      const messages = [
        {
          id: "  ",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "hi" }],
        },
      ];
      assertThrows(
        () => normalizeInput(messages as Parameters<typeof normalizeInput>[0]),
        Error,
        "Message id cannot be empty",
      );
    });

    it("assigns timestamp when missing", () => {
      const messages = [
        {
          id: "msg_test",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "hi" }],
        },
      ];
      const result = normalizeInput(messages as Parameters<typeof normalizeInput>[0]);

      const message = result[0];
      assertExists(message);
      assertExists(message.timestamp);
      assertEquals(typeof message.timestamp, "number");
      assertEquals(message.timestamp > 0, true);
    });
  });

  describe("accumulateUsage", () => {
    it("accumulates token counts", () => {
      const total = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
      accumulateUsage(total, { promptTokens: 20, completionTokens: 10, totalTokens: 30 });
      assertEquals(total.promptTokens, 30);
      assertEquals(total.completionTokens, 15);
      assertEquals(total.totalTokens, 45);
    });

    it("handles missing usage fields by defaulting to zero", () => {
      const total = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
      accumulateUsage(total, {});
      assertEquals(total.promptTokens, 10);
      assertEquals(total.completionTokens, 5);
      assertEquals(total.totalTokens, 15);
    });

    it("handles partial usage fields", () => {
      const total: UsageTotal = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      accumulateUsage(total, { promptTokens: 5 });
      assertEquals(total.promptTokens, 5);
      assertEquals(total.completionTokens, 0);
      assertEquals(total.totalTokens, 0);
    });

    it("accumulates provider cost and billing amounts", () => {
      const total: UsageTotal = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      accumulateUsage(total, {
        costUsd: 0.002,
        providerCostUsd: 0.0015,
        veryfrontBilledUsd: 0.002,
        costCredits: 2,
      });
      accumulateUsage(total, {
        costUsd: 0.003,
        providerCostUsd: 0.001,
        veryfrontBilledUsd: 0.004,
        costCredits: 3,
      });
      assertEquals(total.costUsd, 0.005, "per-step costUsd must aggregate into the run total");
      assertEquals(
        total.providerCostUsd,
        0.0025,
        "per-step providerCostUsd must aggregate into the run total",
      );
      assertEquals(
        total.veryfrontBilledUsd,
        0.006,
        "per-step veryfrontBilledUsd must aggregate into the run total",
      );
      assertEquals(total.costCredits, 5, "per-step costCredits must aggregate into the run total");
    });

    it("collapses disagreeing cost attribution and keeps deferred billing sticky", () => {
      const total: UsageTotal = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      accumulateUsage(total, {
        costSource: "gateway",
        billingMode: "deferred",
        usageCaptureStatus: "complete",
      });
      accumulateUsage(total, {
        costSource: "missing",
        billingMode: "direct",
        usageCaptureStatus: "partial",
      });
      assertEquals(
        total.costSource,
        "partial",
        "a run mixing priced and unpriced steps must report partial attribution",
      );
      assertEquals(
        total.billingMode,
        "deferred",
        "deferred billing must stay sticky once any step defers",
      );
      assertEquals(
        total.usageCaptureStatus,
        "partial",
        "disagreeing capture status must collapse to partial",
      );

      const agreeing: UsageTotal = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      accumulateUsage(agreeing, {
        costSource: "gateway",
        billingMode: "direct",
        usageCaptureStatus: "complete",
      });
      accumulateUsage(agreeing, {
        costSource: "gateway",
        billingMode: "direct",
        usageCaptureStatus: "complete",
      });
      assertEquals(agreeing.costSource, "gateway", "matching cost sources must be preserved");
      assertEquals(agreeing.billingMode, "direct", "direct billing must stay direct");
      assertEquals(
        agreeing.usageCaptureStatus,
        "complete",
        "matching capture status must be preserved",
      );
    });
  });

  describe("resolveValidatedTurnInput", () => {
    const normalized = [
      {
        id: "msg_1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "hi" }],
        timestamp: 1000,
      },
    ];

    it("reuses the normalized messages when middleware left the input untouched", () => {
      const original = "hi";
      assertEquals(resolveValidatedTurnInput(original, original, normalized), normalized);
    });

    it("re-normalizes when middleware rewrote the input", () => {
      const rewritten = [
        {
          id: "msg_2",
          role: "system" as const,
          parts: [{ type: "text" as const, text: "sanitized" }],
          timestamp: 2000,
        },
      ];

      const result = resolveValidatedTurnInput(rewritten, "hi", normalized);

      assertEquals(result.length, 1);
      assertEquals(result[0]?.id, "msg_2");
      assertEquals(result[0]?.role, "system");
    });

    it("normalizes a middleware-supplied string back into messages", () => {
      const result = resolveValidatedTurnInput("sanitized", "raw", normalized);

      assertEquals(result.length, 1);
      assertEquals(result[0]?.role, "user");
      assertEquals((result[0]?.parts[0] as { text: string }).text, "sanitized");
    });
  });

  describe("getMaxSteps", () => {
    it("returns configured max steps within an explicit execution-policy limit", () => {
      assertEquals(getMaxSteps(10, undefined, 50), 10);
    });

    it("returns default when no config provided", () => {
      assertEquals(getMaxSteps(undefined, undefined, 50), 20);
    });

    it("clamps to an explicit execution-policy limit", () => {
      assertEquals(getMaxSteps(100, undefined, 30), 30);
    });

    it("prefers edge max steps over configured", () => {
      assertEquals(getMaxSteps(10, 5, 50), 5);
    });

    it("edge max steps remain subject to an explicit execution-policy limit", () => {
      assertEquals(getMaxSteps(10, 100, 30), 30);
    });

    it("uses custom default when provided", () => {
      assertEquals(getMaxSteps(undefined, undefined, 50, 15), 15);
    });

    it("does not infer a deployment limit when none was configured", () => {
      assertEquals(getMaxSteps(100, undefined), 100);
      assertEquals(getMaxSteps(undefined, undefined), 20);
    });

    it("rejects invalid authored and execution-policy limits", () => {
      for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertThrows(
          () => getMaxSteps(invalid, undefined),
          Error,
          "positive safe integer",
        );
        assertThrows(
          () => getMaxSteps(undefined, invalid),
          Error,
          "positive safe integer",
        );
      }
      assertThrows(
        () => getMaxSteps(1, undefined, 0),
        Error,
        "positive safe integer",
      );
    });
  });
});
