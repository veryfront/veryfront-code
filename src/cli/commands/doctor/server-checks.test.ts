/**
 * Tests for doctor server checks
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { checkRSCCounters, checkRSCEndpoints, checkRSCFlag } from "./server-checks.ts";

describe("doctor/server-checks", () => {
  describe("checkRSCFlag", () => {
    it("is a function", () => {
      assertEquals(typeof checkRSCFlag, "function");
    });

    it("returns a DiagnosticResult object", async () => {
      const result = await checkRSCFlag();

      assertExists(result);
      assertExists(result.name);
      assertExists(result.status);
      assertExists(result.message);
      assertEquals(result.name, "RSC Flag");
      assertEquals(["pass", "warn", "fail"].includes(result.status), true);
    });
  });

  describe("checkRSCEndpoints", () => {
    it("is a function", () => {
      assertEquals(typeof checkRSCEndpoints, "function");
    });

    it("returns array of DiagnosticResult objects", async () => {
      // Note: This test will likely fail to connect since no server is running
      // The function should handle this gracefully with warnings
      const results = await checkRSCEndpoints();

      assertExists(results);
      assertEquals(Array.isArray(results), true);
      assertEquals(results.length > 0, true);

      // Each result should have required properties
      for (const result of results) {
        assertExists(result.name);
        assertExists(result.status);
        assertExists(result.message);
        assertEquals(["pass", "warn", "fail"].includes(result.status), true);
      }
    });

    it("handles unreachable server gracefully", async () => {
      // With no server running, should return warnings
      const results = await checkRSCEndpoints();
      const hasWarning = results.some((r) => r.status === "warn");
      assertEquals(hasWarning, true);
    });
  });

  describe("checkRSCCounters", () => {
    it("is a function", () => {
      assertEquals(typeof checkRSCCounters, "function");
    });

    it("returns a DiagnosticResult object", async () => {
      // Note: This test will likely fail to connect since no server is running
      const result = await checkRSCCounters();

      assertExists(result);
      assertExists(result.name);
      assertExists(result.status);
      assertExists(result.message);
      assertEquals(result.name, "RSC Counters");
      assertEquals(["pass", "warn", "fail"].includes(result.status), true);
    });

    it("handles unreachable server gracefully", async () => {
      const result = await checkRSCCounters();
      // Should be warn when server is not running
      assertEquals(["pass", "warn"].includes(result.status), true);
    });
  });
});
