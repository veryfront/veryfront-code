import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { detectRuntime, getAdapter } from "./detect.ts";
import type { RuntimeId } from "./base.ts";

describe("detect.ts", () => {
  describe("detectRuntime", () => {
    it("should return a valid runtime identifier", () => {
      const runtime = detectRuntime();
      const validRuntimes: (RuntimeId | "unknown")[] = [
        "deno",
        "node",
        "bun",
        "cloudflare",
        "unknown",
      ];

      assertEquals(validRuntimes.includes(runtime), true);
    });

    it("should detect deno runtime in this test environment", () => {
      // Since tests run in Deno, this should return "deno"
      const runtime = detectRuntime();
      assertEquals(runtime, "deno");
    });

    it("should return string type", () => {
      const runtime = detectRuntime();
      assertEquals(typeof runtime, "string");
    });
  });

  describe("getAdapter", () => {
    it("should return a valid RuntimeAdapter", async () => {
      const adapter = await getAdapter();

      assertExists(adapter);
      assertExists(adapter.id);
      assertExists(adapter.name);
      assertExists(adapter.fs);
      assertExists(adapter.env);
      assertExists(adapter.capabilities);
      assertExists(adapter.serve);
    });

    it("should return denoAdapter in Deno environment", async () => {
      const adapter = await getAdapter();
      assertEquals(adapter.id, "deno");
      assertEquals(adapter.name, "deno");
    });

    it("should return adapter with correct capabilities", async () => {
      const adapter = await getAdapter();

      assertEquals(typeof adapter.capabilities.typescript, "boolean");
      assertEquals(typeof adapter.capabilities.jsx, "boolean");
      assertEquals(typeof adapter.capabilities.http2, "boolean");
      assertEquals(typeof adapter.capabilities.websocket, "boolean");
      assertEquals(typeof adapter.capabilities.workers, "boolean");
    });
  });

  describe("re-exports", () => {
    it("should export denoAdapter", async () => {
      const { denoAdapter } = await import("./detect.ts");
      assertExists(denoAdapter);
      assertEquals(denoAdapter.id, "deno");
    });

    it("should export nodeAdapter", async () => {
      const { nodeAdapter } = await import("./detect.ts");
      assertExists(nodeAdapter);
      assertEquals(nodeAdapter.id, "node");
    });

    it("should export bunAdapter", async () => {
      const { bunAdapter } = await import("./detect.ts");
      assertExists(bunAdapter);
      assertEquals(bunAdapter.id, "bun");
    });

    it("should export runtime registry", async () => {
      const { runtime } = await import("./detect.ts");
      assertExists(runtime);
      assertExists(runtime.get);
      assertExists(runtime.set);
    });
  });
});
