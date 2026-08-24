import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset } from "../../extensions/contracts.ts";
import type { DocumentExtractor } from "../../extensions/compat/native-services.ts";
import {
  importClaudeAgentSDK,
  importKreuzberg,
  injectedClaudeAgentSdkMock,
} from "./opaque-deps.ts";

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

    it("only accepts an injected mock that exposes query", () => {
      for (const bad of [{ notQuery: true }, "not-an-object", 0, null, undefined, []]) {
        assertEquals(
          injectedClaudeAgentSdkMock(bad),
          undefined,
          `${JSON.stringify(bad)} must not be accepted as an injected SDK mock`,
        );
      }
      const good = { query: () => "mock" };
      assertStrictEquals(
        injectedClaudeAgentSdkMock(good),
        good,
        "a mock with query is returned as-is",
      );
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
