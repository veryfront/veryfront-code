import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("runtime/index.ts exports", () => {
  it("should export DenoAdapter", async () => {
    const mod = await import("./index.ts");
    assertExists(mod.DenoAdapter);
    assertEquals(typeof mod.DenoAdapter, "function");
  });

  it("should export denoAdapter singleton", async () => {
    const mod = await import("./index.ts");
    assertExists(mod.denoAdapter);
    assertEquals(mod.denoAdapter.id, "deno");
  });

  it("should export NodeAdapter", async () => {
    const mod = await import("./index.ts");
    assertExists(mod.NodeAdapter);
    assertEquals(typeof mod.NodeAdapter, "function");
  });

  it("should export nodeAdapter singleton", async () => {
    const mod = await import("./index.ts");
    assertExists(mod.nodeAdapter);
    assertEquals(mod.nodeAdapter.id, "node");
  });

  it("should export BunAdapter", async () => {
    const mod = await import("./index.ts");
    assertExists(mod.BunAdapter);
    assertEquals(typeof mod.BunAdapter, "function");
  });

  it("should export bunAdapter singleton", async () => {
    const mod = await import("./index.ts");
    assertExists(mod.bunAdapter);
    assertEquals(mod.bunAdapter.id, "bun");
  });

  it("should export CloudflareAdapter class", async () => {
    const mod = await import("./index.ts");
    assertExists(mod.CloudflareAdapter);
    assertEquals(typeof mod.CloudflareAdapter, "function");
  });

  it("should export NodeBasedShellAdapter", async () => {
    const mod = await import("./index.ts");
    assertExists(mod.NodeBasedShellAdapter);
    assertEquals(typeof mod.NodeBasedShellAdapter, "function");
  });
});
