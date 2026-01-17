import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

describe("runtime/index.ts exports", () => {
  it("should export DenoAdapter", async () => {
    const { DenoAdapter } = await import("./index.ts");
    assertExists(DenoAdapter);
    assertEquals(typeof DenoAdapter, "function");
  });

  it("should export denoAdapter singleton", async () => {
    const { denoAdapter } = await import("./index.ts");
    assertExists(denoAdapter);
    assertEquals(denoAdapter.id, "deno");
  });

  it("should export NodeAdapter", async () => {
    const { NodeAdapter } = await import("./index.ts");
    assertExists(NodeAdapter);
    assertEquals(typeof NodeAdapter, "function");
  });

  it("should export nodeAdapter singleton", async () => {
    const { nodeAdapter } = await import("./index.ts");
    assertExists(nodeAdapter);
    assertEquals(nodeAdapter.id, "node");
  });

  it("should export BunAdapter", async () => {
    const { BunAdapter } = await import("./index.ts");
    assertExists(BunAdapter);
    assertEquals(typeof BunAdapter, "function");
  });

  it("should export bunAdapter singleton", async () => {
    const { bunAdapter } = await import("./index.ts");
    assertExists(bunAdapter);
    assertEquals(bunAdapter.id, "bun");
  });

  it("should export CloudflareAdapter class", async () => {
    const { CloudflareAdapter } = await import("./index.ts");
    assertExists(CloudflareAdapter);
    assertEquals(typeof CloudflareAdapter, "function");
  });

  it("should export NodeBasedShellAdapter", async () => {
    const { NodeBasedShellAdapter } = await import("./index.ts");
    assertExists(NodeBasedShellAdapter);
    assertEquals(typeof NodeBasedShellAdapter, "function");
  });
});
