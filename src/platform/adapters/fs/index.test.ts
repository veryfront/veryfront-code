import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";

describe("fs/index.ts exports", () => {
  it("should export VeryfrontFSAdapter", async () => {
    const { VeryfrontFSAdapter } = await import("./index.ts");
    assertExists(VeryfrontFSAdapter);
    assertEquals(typeof VeryfrontFSAdapter, "function");
  });

  it("should export GitHubFSAdapter", async () => {
    const { GitHubFSAdapter } = await import("./index.ts");
    assertExists(GitHubFSAdapter);
    assertEquals(typeof GitHubFSAdapter, "function");
  });

  it("should export createFSAdapter", async () => {
    const { createFSAdapter } = await import("./index.ts");
    assertExists(createFSAdapter);
    assertEquals(typeof createFSAdapter, "function");
  });

  it("should export FSAdapterWrapper", async () => {
    const { FSAdapterWrapper } = await import("./index.ts");
    assertExists(FSAdapterWrapper);
    assertEquals(typeof FSAdapterWrapper, "function");
  });

  it("should export wrapFSAdapter", async () => {
    const { wrapFSAdapter } = await import("./index.ts");
    assertExists(wrapFSAdapter);
    assertEquals(typeof wrapFSAdapter, "function");
  });

  it("should export isExtendedFSAdapter", async () => {
    const { isExtendedFSAdapter } = await import("./index.ts");
    assertExists(isExtendedFSAdapter);
    assertEquals(typeof isExtendedFSAdapter, "function");
  });

  it("should export NotSupportedError", async () => {
    const { NotSupportedError } = await import("./index.ts");
    assertExists(NotSupportedError);
    assertEquals(typeof NotSupportedError, "function");
  });

  it("should export integration functions", async () => {
    const {
      createFSAdapterFromConfig,
      enhanceAdapterWithFS,
      getFSAdapterType,
      isFSAdapterConfigured,
    } = await import("./index.ts");
    assertExists(createFSAdapterFromConfig);
    assertExists(enhanceAdapterWithFS);
    assertExists(getFSAdapterType);
    assertExists(isFSAdapterConfigured);
  });

  it("should export MultiProjectFSAdapter", async () => {
    const { MultiProjectFSAdapter } = await import("./index.ts");
    assertExists(MultiProjectFSAdapter);
    assertEquals(typeof MultiProjectFSAdapter, "function");
  });

  it("should export ProxyFSAdapterManager", async () => {
    const { ProxyFSAdapterManager } = await import("./index.ts");
    assertExists(ProxyFSAdapterManager);
    assertEquals(typeof ProxyFSAdapterManager, "function");
  });

  it("should export FileCache", async () => {
    const { FileCache } = await import("./index.ts");
    assertExists(FileCache);
    assertEquals(typeof FileCache, "function");
  });
});
