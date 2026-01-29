import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { accumulateUsage, getMaxSteps, normalizeInput } from "./input-utils.ts";

describe("input-utils", () => {
  describe("normalizeInput", () => {
    it("wraps a plain string into a user message array", () => {
      const result = normalizeInput("hello");
      assertEquals(result.length, 1);
      assertEquals(result[0].role, "user");
      assertEquals(result[0].parts.length, 1);
      assertEquals(result[0].parts[0].type, "text");
      assertEquals((result[0].parts[0] as { text: string }).text, "hello");
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
      assertEquals(result[0].id, "msg_1");
      assertEquals(result[0].timestamp, 1000);
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
      assertEquals(typeof result[0].id, "string");
      assertEquals(result[0].id.startsWith("msg_"), true);
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
      assertEquals(typeof result[0].timestamp, "number");
      assertEquals(result[0].timestamp > 0, true);
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
      const total = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      accumulateUsage(total, { promptTokens: 5 });
      assertEquals(total.promptTokens, 5);
      assertEquals(total.completionTokens, 0);
      assertEquals(total.totalTokens, 0);
    });
  });

  describe("getMaxSteps", () => {
    it("returns configured max steps clamped to platform limit", () => {
      assertEquals(getMaxSteps(10, undefined, 50), 10);
    });

    it("returns default when no config provided", () => {
      assertEquals(getMaxSteps(undefined, undefined, 50), 20);
    });

    it("clamps to platform limit when configured exceeds it", () => {
      assertEquals(getMaxSteps(100, undefined, 30), 30);
    });

    it("prefers edge max steps over configured", () => {
      assertEquals(getMaxSteps(10, 5, 50), 5);
    });

    it("edge max steps still clamped to platform limit", () => {
      assertEquals(getMaxSteps(10, 100, 30), 30);
    });

    it("uses custom default when provided", () => {
      assertEquals(getMaxSteps(undefined, undefined, 50, 15), 15);
    });
  });
});
