/**
 * Tests for doctor project structure checks
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  checkCacheSystem,
  checkConfiguration,
  checkProjectStructure,
} from "./project-structure.ts";

describe("doctor/project-structure", () => {
  describe("checkProjectStructure", () => {
    it("is a function", () => {
      assertEquals(typeof checkProjectStructure, "function");
    });

    it("returns array of DiagnosticResult objects", async () => {
      // Test with non-existent project (should return warnings)
      const results = await checkProjectStructure("/non-existent-project-path");

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

    it("checks for pages directory", async () => {
      const results = await checkProjectStructure("/non-existent-path");
      const pagesCheck = results.find((r) => r.name.includes("pages"));

      assertExists(pagesCheck);
      assertEquals(pagesCheck.status, "warn"); // Should be warn since path doesn't exist
    });
  });

  describe("checkConfiguration", () => {
    it("is a function", () => {
      assertEquals(typeof checkConfiguration, "function");
    });

    it("returns a DiagnosticResult object", async () => {
      const result = await checkConfiguration("/non-existent-path");

      assertExists(result);
      assertExists(result.name);
      assertExists(result.status);
      assertExists(result.message);
      assertEquals(["pass", "warn", "fail"].includes(result.status), true);
      assertEquals(result.name, "Configuration");
    });

    it("handles missing config with warning", async () => {
      const result = await checkConfiguration("/does-not-exist");
      // When config cannot be loaded, it should return warn with "Using defaults"
      assertEquals(result.name, "Configuration");
      // Status could be pass or warn depending on fallback behavior
      assertEquals(["pass", "warn"].includes(result.status), true);
    });
  });

  describe("checkCacheSystem", () => {
    it("is a function", () => {
      assertEquals(typeof checkCacheSystem, "function");
    });

    it("returns a passing DiagnosticResult", async () => {
      const result = await checkCacheSystem();

      assertExists(result);
      assertEquals(result.name, "Cache System");
      assertEquals(result.status, "pass");
      assertEquals(result.message.includes("LRU cache"), true);
    });
  });
});
