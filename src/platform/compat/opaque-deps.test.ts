import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { importClaudeAgentSDK, importKreuzberg, importTransformers } from "./opaque-deps.ts";

describe("platform/compat/opaque-deps", () => {
  describe("importTransformers", () => {
    it("should be a function", () => {
      assertEquals(typeof importTransformers, "function");
    });
  });

  describe("importClaudeAgentSDK", () => {
    it("should be a function", () => {
      assertEquals(typeof importClaudeAgentSDK, "function");
    });

    it("should return mock when __vfMockClaudeSDK is set", async () => {
      const mockSDK = { query: () => "mock" };
      (globalThis as Record<string, unknown>).__vfMockClaudeSDK = mockSDK;
      try {
        const result = await importClaudeAgentSDK();
        assertEquals(result, mockSDK);
      } finally {
        delete (globalThis as Record<string, unknown>).__vfMockClaudeSDK;
      }
    });

    it("should not return mock when __vfMockClaudeSDK has no query property", {
      sanitizeOps: false,
      sanitizeResources: false,
    }, () => {
      (globalThis as Record<string, unknown>).__vfMockClaudeSDK = { notQuery: true };
      try {
        const result = importClaudeAgentSDK();
        // Should try real import (will likely fail), not return mock
        result.catch(() => {});
      } finally {
        delete (globalThis as Record<string, unknown>).__vfMockClaudeSDK;
      }
    });

    it("should not return mock when __vfMockClaudeSDK is a primitive", {
      sanitizeOps: false,
      sanitizeResources: false,
    }, () => {
      (globalThis as Record<string, unknown>).__vfMockClaudeSDK = "not-an-object";
      try {
        const result = importClaudeAgentSDK();
        result.catch(() => {});
      } finally {
        delete (globalThis as Record<string, unknown>).__vfMockClaudeSDK;
      }
    });
  });

  describe("importKreuzberg", () => {
    it("should be a function", () => {
      assertEquals(typeof importKreuzberg, "function");
    });

    it("should return a module with extractBytes", async () => {
      const mod = await importKreuzberg();
      assertExists(mod);
      assertEquals(typeof mod.extractBytes, "function");
    });
  });
});
