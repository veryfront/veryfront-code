import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset } from "../../extensions/contracts.ts";
import type { DocumentExtractor } from "../../extensions/compat/native-services.ts";
import { importClaudeAgentSDK, importKreuzberg, importTransformers } from "./opaque-deps.ts";

const stubKreuzbergModule = {
  extractBytes: async (_data: Uint8Array, _mimeType: string) => ({ content: "stub-content" }),
};

const stubDocumentExtractor: DocumentExtractor = {
  importKreuzberg: async () => stubKreuzbergModule,
};

describe("platform/compat/opaque-deps", () => {
  afterEach(() => {
    reset();
  });

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

    it("throws an actionable error when DocumentExtractor is not registered", async () => {
      // No extension registered — expect a helpful install message.
      await assertRejects(
        () => importKreuzberg(),
        Error,
        "ext-document-kreuzberg",
      );
    });

    it("delegates to DocumentExtractor.importKreuzberg when the extension is registered", async () => {
      register<DocumentExtractor>("DocumentExtractor", stubDocumentExtractor);
      const mod = await importKreuzberg();
      assertExists(mod);
      assertEquals(typeof mod.extractBytes, "function");
    });

    it("does not resolve deprecated aggregate compatibility contracts", async () => {
      register<DocumentExtractor>("DocumentExtractorLegacy", stubDocumentExtractor);
      await assertRejects(
        () => importKreuzberg(),
        Error,
        "DocumentExtractor",
      );
    });
  });
});
