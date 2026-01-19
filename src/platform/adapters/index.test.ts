import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";

describe("adapters/index.ts exports", () => {
  describe("runtime detection", () => {
    it("should export runtime", async () => {
      const { runtime } = await import("./index.ts");
      assertExists(runtime);
    });

    it("should export getLocalAdapter", async () => {
      const { getLocalAdapter } = await import("./index.ts");
      assertExists(getLocalAdapter);
      assertEquals(typeof getLocalAdapter, "function");
    });
  });

  describe("FS Adapters", () => {
    it("should export createFSAdapter", async () => {
      const { createFSAdapter } = await import("./index.ts");
      assertExists(createFSAdapter);
      assertEquals(typeof createFSAdapter, "function");
    });

    it("should export createFSAdapterFromConfig", async () => {
      const { createFSAdapterFromConfig } = await import("./index.ts");
      assertExists(createFSAdapterFromConfig);
      assertEquals(typeof createFSAdapterFromConfig, "function");
    });

    it("should export FSAdapterWrapper", async () => {
      const { FSAdapterWrapper } = await import("./index.ts");
      assertExists(FSAdapterWrapper);
      assertEquals(typeof FSAdapterWrapper, "function");
    });

    it("should export VeryfrontFSAdapter", async () => {
      const { VeryfrontFSAdapter } = await import("./index.ts");
      assertExists(VeryfrontFSAdapter);
      assertEquals(typeof VeryfrontFSAdapter, "function");
    });

    it("should export getFSAdapterType", async () => {
      const { getFSAdapterType } = await import("./index.ts");
      assertExists(getFSAdapterType);
      assertEquals(typeof getFSAdapterType, "function");
    });

    it("should export isFSAdapterConfigured", async () => {
      const { isFSAdapterConfigured } = await import("./index.ts");
      assertExists(isFSAdapterConfigured);
      assertEquals(typeof isFSAdapterConfigured, "function");
    });
  });

  describe("API Client", () => {
    it("should export VeryfrontAPIClient", async () => {
      const { VeryfrontAPIClient } = await import("./index.ts");
      assertExists(VeryfrontAPIClient);
      assertEquals(typeof VeryfrontAPIClient, "function");
    });

    it("should export VeryfrontAPIError", async () => {
      const { VeryfrontAPIError } = await import("./index.ts");
      assertExists(VeryfrontAPIError);
      assertEquals(typeof VeryfrontAPIError, "function");
    });
  });

  describe("Token Storage", () => {
    it("should export createTokenStorageAdapter", async () => {
      const { createTokenStorageAdapter } = await import("./index.ts");
      assertExists(createTokenStorageAdapter);
      assertEquals(typeof createTokenStorageAdapter, "function");
    });

    it("should export MemoryTokenAdapter", async () => {
      const { MemoryTokenAdapter } = await import("./index.ts");
      assertExists(MemoryTokenAdapter);
      assertEquals(typeof MemoryTokenAdapter, "function");
    });

    it("should export VeryfrontTokenAdapter", async () => {
      const { VeryfrontTokenAdapter } = await import("./index.ts");
      assertExists(VeryfrontTokenAdapter);
      assertEquals(typeof VeryfrontTokenAdapter, "function");
    });

    it("should export TokenStorageError", async () => {
      const { TokenStorageError } = await import("./index.ts");
      assertExists(TokenStorageError);
      assertEquals(typeof TokenStorageError, "function");
    });
  });

  describe("Fallback utilities", () => {
    it("should export createAdapterFallback", async () => {
      const { createAdapterFallback } = await import("./index.ts");
      assertExists(createAdapterFallback);
      assertEquals(typeof createAdapterFallback, "function");
    });

    it("should export withFallback", async () => {
      const { withFallback } = await import("./index.ts");
      assertExists(withFallback);
      assertEquals(typeof withFallback, "function");
    });

    it("should export FallbackExecutionError", async () => {
      const { FallbackExecutionError } = await import("./index.ts");
      assertExists(FallbackExecutionError);
      assertEquals(typeof FallbackExecutionError, "function");
    });
  });

  describe("Security", () => {
    it("should export security namespace", async () => {
      const { security } = await import("./index.ts");
      assertExists(security);
      assertEquals(typeof security, "object");
    });
  });
});
