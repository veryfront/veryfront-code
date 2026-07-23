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

    it("does not expose a production global mock bypass", async () => {
      const source = await Deno.readTextFile(new URL("./opaque-deps.ts", import.meta.url));
      assertEquals(source.includes("__vfMockClaudeSDK"), false);
    });
  });

  describe("importKreuzberg", () => {
    it("should be a function", () => {
      assertEquals(typeof importKreuzberg, "function");
    });

    it("throws an actionable error when DocumentExtractor is not registered", async () => {
      // No extension registered, expect a helpful install message.
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
