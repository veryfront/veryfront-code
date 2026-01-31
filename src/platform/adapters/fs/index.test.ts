import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

async function assertExportedFunction(name: string): Promise<void> {
  const mod = await import("./index.ts");
  const value = (mod as Record<string, unknown>)[name];
  assertExists(value);
  assertEquals(typeof value, "function");
}

async function assertExportedValue(name: string): Promise<void> {
  const mod = await import("./index.ts");
  const value = (mod as Record<string, unknown>)[name];
  assertExists(value);
}

describe("fs/index.ts exports", () => {
  it("should export VeryfrontFSAdapter", () => assertExportedFunction("VeryfrontFSAdapter"));
  it("should export GitHubFSAdapter", () => assertExportedFunction("GitHubFSAdapter"));
  it("should export createFSAdapter", () => assertExportedFunction("createFSAdapter"));
  it("should export FSAdapterWrapper", () => assertExportedFunction("FSAdapterWrapper"));
  it("should export wrapFSAdapter", () => assertExportedFunction("wrapFSAdapter"));
  it("should export isExtendedFSAdapter", () => assertExportedFunction("isExtendedFSAdapter"));
  it("should export NotSupportedError", () => assertExportedFunction("NotSupportedError"));
  it("should export MultiProjectFSAdapter", () => assertExportedFunction("MultiProjectFSAdapter"));
  it("should export ProxyFSAdapterManager", () => assertExportedFunction("ProxyFSAdapterManager"));
  it("should export FileCache", () => assertExportedFunction("FileCache"));

  it("should export integration functions", async () => {
    await assertExportedValue("createFSAdapterFromConfig");
    await assertExportedValue("enhanceAdapterWithFS");
    await assertExportedValue("getFSAdapterType");
    await assertExportedValue("isFSAdapterConfigured");
  });
});
