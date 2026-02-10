import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("token/index.ts exports", () => {
  async function getModule(): Promise<typeof import("./index.ts")> {
    return await import("./index.ts");
  }

  async function assertExportedFunction(name: string): Promise<void> {
    const mod = await getModule();
    const value = mod[name as keyof typeof mod];
    assertExists(value);
    assertEquals(typeof value, "function");
  }

  it("should export MemoryTokenAdapter", () => assertExportedFunction("MemoryTokenAdapter"));
  it("should export VeryfrontTokenAdapter", () => assertExportedFunction("VeryfrontTokenAdapter"));
  it("should export TokenStorageApiClient", () => assertExportedFunction("TokenStorageApiClient"));
  it("should export TOKEN_STORAGE_ERROR", async () => {
    const mod = await getModule();
    const value = mod["TOKEN_STORAGE_ERROR" as keyof typeof mod];
    assertExists(value);
    assertEquals(typeof value, "object");
  });
  it("should export createTokenStorageAdapter", () =>
    assertExportedFunction("createTokenStorageAdapter"));

  it("should export integration functions", async () => {
    const mod = await getModule();
    assertExists(mod.getTokenStorageAdapter);
    assertExists(mod.getTokenStorageType);
    assertExists(mod.isTokenStorageConfigured);
    assertExists(mod.resetTokenStorageAdapter);
  });
});
