/**
 * Runtime Detection Tests
 *
 * These tests verify the cross-runtime detection utilities work correctly.
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { isBun, isCloudflare, isDeno, isNode, isNodeRuntime } from "./runtime.ts";

describe("Runtime Detection", () => {
  describe("runtime constants", () => {
    it("should export boolean constants", () => {
      assertEquals(typeof isDeno, "boolean");
      assertEquals(typeof isNode, "boolean");
      assertEquals(typeof isBun, "boolean");
      assertEquals(typeof isCloudflare, "boolean");
    });

    it("should have exactly one main runtime active (excluding Cloudflare)", () => {
      // Only one of isDeno, isNode, isBun should be true
      // (Cloudflare can be detected alongside another runtime in some edge cases)
      const mainRuntimes = [isDeno, isNode, isBun];
      const activeCount = mainRuntimes.filter(Boolean).length;
      assertEquals(activeCount, 1, "Exactly one main runtime should be detected");
    });
  });

  describe("isDeno", () => {
    it("should be true when running in Deno", () => {
      // This test runs in Deno, so isDeno should be true
      assertEquals(isDeno, true);
    });
  });

  describe("isNode", () => {
    it("should be false when running in Deno", () => {
      // This test runs in Deno, so isNode should be false
      assertEquals(isNode, false);
    });
  });

  describe("isBun", () => {
    it("should be false when running in Deno", () => {
      // This test runs in Deno, so isBun should be false
      assertEquals(isBun, false);
    });
  });

  describe("isNodeRuntime function", () => {
    it("should return same result as isNode constant", () => {
      assertEquals(isNodeRuntime(), isNode);
    });

    it("should be callable as a function", () => {
      const result = isNodeRuntime();
      assertEquals(typeof result, "boolean");
    });
  });
});
