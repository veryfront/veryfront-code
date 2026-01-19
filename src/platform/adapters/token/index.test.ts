import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";

describe("token/index.ts exports", () => {
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

  it("should export TokenStorageAPIClient", async () => {
    const { TokenStorageAPIClient } = await import("./index.ts");
    assertExists(TokenStorageAPIClient);
    assertEquals(typeof TokenStorageAPIClient, "function");
  });

  it("should export TokenStorageError", async () => {
    const { TokenStorageError } = await import("./index.ts");
    assertExists(TokenStorageError);
    assertEquals(typeof TokenStorageError, "function");
  });

  it("should export createTokenStorageAdapter", async () => {
    const { createTokenStorageAdapter } = await import("./index.ts");
    assertExists(createTokenStorageAdapter);
    assertEquals(typeof createTokenStorageAdapter, "function");
  });

  it("should export integration functions", async () => {
    const {
      getTokenStorageAdapter,
      getTokenStorageType,
      isTokenStorageConfigured,
      resetTokenStorageAdapter,
    } = await import("./index.ts");
    assertExists(getTokenStorageAdapter);
    assertExists(getTokenStorageType);
    assertExists(isTokenStorageConfigured);
    assertExists(resetTokenStorageAdapter);
  });
});
