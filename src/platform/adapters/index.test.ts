import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

async function assertExport(
  name: string,
  expectedType?: "function" | "object",
): Promise<void> {
  const mod = await import("./index.ts");
  const value = (mod as Record<string, unknown>)[name];

  assertExists(value);

  if (!expectedType) return;

  assertEquals(typeof value, expectedType);
}

describe("adapters/index.ts exports", () => {
  describe("runtime detection", () => {
    it("should export runtime", async () => {
      await assertExport("runtime");
    });

    it("should export getLocalAdapter", async () => {
      await assertExport("getLocalAdapter", "function");
    });
  });

  describe("FS Adapters", () => {
    it("should export createFSAdapter", async () => {
      await assertExport("createFSAdapter", "function");
    });

    it("should export createFSAdapterFromConfig", async () => {
      await assertExport("createFSAdapterFromConfig", "function");
    });

    it("should export FSAdapterWrapper", async () => {
      await assertExport("FSAdapterWrapper", "function");
    });

    it("should export VeryfrontFSAdapter", async () => {
      await assertExport("VeryfrontFSAdapter", "function");
    });

    it("should export getFSAdapterType", async () => {
      await assertExport("getFSAdapterType", "function");
    });

    it("should export isFSAdapterConfigured", async () => {
      await assertExport("isFSAdapterConfigured", "function");
    });
  });

  describe("API Client", () => {
    it("should export VeryfrontApiClient", async () => {
      await assertExport("VeryfrontApiClient", "function");
    });

    it("should export API_CLIENT_ERROR", async () => {
      await assertExport("API_CLIENT_ERROR", "object");
    });

    it("should export VeryfrontError", async () => {
      await assertExport("VeryfrontError", "function");
    });
  });

  describe("Token Storage", () => {
    it("should export createTokenStorageAdapter", async () => {
      await assertExport("createTokenStorageAdapter", "function");
    });

    it("should export MemoryTokenAdapter", async () => {
      await assertExport("MemoryTokenAdapter", "function");
    });

    it("should export VeryfrontTokenAdapter", async () => {
      await assertExport("VeryfrontTokenAdapter", "function");
    });

    it("should export TOKEN_STORAGE_ERROR", async () => {
      await assertExport("TOKEN_STORAGE_ERROR", "object");
    });
  });

  describe("Fallback utilities", () => {
    it("should export createAdapterFallback", async () => {
      await assertExport("createAdapterFallback", "function");
    });

    it("should export withFallback", async () => {
      await assertExport("withFallback", "function");
    });

    it("should export FALLBACK_EXHAUSTED", async () => {
      await assertExport("FALLBACK_EXHAUSTED", "object");
    });
  });

  describe("Security", () => {
    it("should export security namespace", async () => {
      await assertExport("security", "object");
    });
  });
});
