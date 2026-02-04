/**
 * Tests for doctor version checks
 */

import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { checkDenoVersion, checkReactCompatibility } from "./version-checks.ts";

describe("doctor/version-checks", () => {
  describe("checkDenoVersion", () => {
    it("is a function", () => {
      assertEquals(typeof checkDenoVersion, "function");
    });

    it("returns a DiagnosticResult object", async () => {
      const result = await checkDenoVersion();

      assertExists(result);
      assertExists(result.name);
      assertExists(result.status);
      assertExists(result.message);
      assertEquals(result.name, "Runtime Version");
      assertEquals(["pass", "warn", "fail"].includes(result.status), true);
    });

    it("detects runtime version", async () => {
      const result = await checkDenoVersion();

      // Should detect either Deno or Node.js
      const hasKnownRuntime = result.message.includes("Deno") ||
        result.message.includes("Node.js") ||
        result.message.includes("Bun");

      assertEquals(hasKnownRuntime, true);
    });

    it("passes for supported versions", async () => {
      const result = await checkDenoVersion();

      // In test environment (Deno 2.x), should pass
      // If running in Node.js 18+, should also pass
      assertEquals(["pass", "warn"].includes(result.status), true);
    });
  });

  describe("checkReactCompatibility", () => {
    it("is a function", () => {
      assertEquals(typeof checkReactCompatibility, "function");
    });

    it("returns a DiagnosticResult object", async () => {
      const result = await checkReactCompatibility();

      assertExists(result);
      assertExists(result.name);
      assertExists(result.status);
      assertExists(result.message);
      assertEquals(result.name, "React Compatibility");
      assertEquals(["pass", "warn", "fail"].includes(result.status), true);
    });

    it("includes React version in message when passing", async () => {
      const result = await checkReactCompatibility();

      if (result.status === "pass") {
        // Should include React version number
        assertStringIncludes(result.message, "React");
      }
    });
  });
});
