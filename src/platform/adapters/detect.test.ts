import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals, assertRejects } from "std/assert/mod.ts";
import { detectRuntime, getAdapter } from "./detect.ts";

describe("platform/adapters/detect", () => {
  describe("detectRuntime", () => {
    it("should return a runtime identifier", () => {
      const runtime = detectRuntime();
      assert(
        ["deno", "bun", "node", "cloudflare", "unknown"].includes(runtime),
        `detectRuntime should return valid runtime, got: ${runtime}`,
      );
    });

    it("should detect Deno runtime", () => {
      // This test runs in Deno, so it should detect Deno
      const runtime = detectRuntime();
      assertEquals(runtime, "deno", "should detect Deno runtime");
    });

    it("should return consistent results", () => {
      const first = detectRuntime();
      const second = detectRuntime();
      assertEquals(first, second, "detectRuntime should return consistent results");
    });
  });

  describe("getAdapter", () => {
    it("should return a RuntimeAdapter", async () => {
      const adapter = await getAdapter();

      assert(adapter !== null, "adapter should not be null");
      assert(adapter.id !== undefined, "adapter should have id");
      assert(adapter.name !== undefined, "adapter should have name");
      assert(adapter.platform !== undefined, "adapter should have platform");
      assert(adapter.capabilities !== undefined, "adapter should have capabilities");
      assert(adapter.features !== undefined, "adapter should have features");
      assert(adapter.fs !== undefined, "adapter should have fs");
      assert(adapter.env !== undefined, "adapter should have env");
      assert(adapter.server !== undefined, "adapter should have server");
    });

    it("should return Deno adapter when running in Deno", async () => {
      const adapter = await getAdapter();
      assertEquals(adapter.id, "deno", "should return Deno adapter");
      assertEquals(adapter.platform, "deno", "platform should be deno");
    });

    it("should return adapter with correct capabilities", async () => {
      const adapter = await getAdapter();

      assert(typeof adapter.capabilities.typescript === "boolean");
      assert(typeof adapter.capabilities.jsx === "boolean");
      assert(typeof adapter.capabilities.http2 === "boolean");
      assert(typeof adapter.capabilities.websocket === "boolean");
      assert(typeof adapter.capabilities.workers === "boolean");
      assert(typeof adapter.capabilities.fileWatching === "boolean");
      assert(typeof adapter.capabilities.shell === "boolean");
      assert(typeof adapter.capabilities.kvStore === "boolean");
      assert(typeof adapter.capabilities.writableFs === "boolean");
    });

    it("should return adapter with serve method", async () => {
      const adapter = await getAdapter();
      assert(typeof adapter.serve === "function", "adapter should have serve method");
    });
  });
});
