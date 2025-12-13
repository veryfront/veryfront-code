import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import type { DiagnosticResult } from "./types.ts";

describe("ai-checks", () => {
  describe("checkAIConfig", () => {
    it("should export checkAIConfig function", async () => {
      const module = await import("./ai-checks.ts");
      assertExists(module.checkAIConfig);
      assertEquals(typeof module.checkAIConfig, "function");
    });
  });

  describe("DiagnosticResult type", () => {
    it("should have correct structure", () => {
      const result: DiagnosticResult = {
        name: "Test Check",
        status: "pass",
        message: "Test passed",
      };

      assertEquals(result.name, "Test Check");
      assertEquals(result.status, "pass");
      assertEquals(result.message, "Test passed");
    });

    it("should support all status types", () => {
      const statuses: Array<DiagnosticResult["status"]> = ["pass", "warn", "fail"];

      for (const status of statuses) {
        const result: DiagnosticResult = {
          name: "Test",
          status: status,
          message: "Message",
        };
        assertEquals(result.status, status);
      }
    });

    it("should allow optional details field", () => {
      const result: DiagnosticResult = {
        name: "Test Check",
        status: "warn",
        message: "Warning message",
        details: "Additional details",
      };

      assertEquals(result.details, "Additional details");
    });
  });
});
