/**
 * Runtime Detection Tests
 *
 * These tests verify the cross-runtime detection utilities work correctly.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
    it("should correctly detect Deno runtime", () => {
      // isDeno should be true only in Deno
      if (isDeno) {
        assertEquals(isNode, false);
        assertEquals(isBun, false);
      }
    });
  });

  describe("isNode", () => {
    it("should correctly detect Node.js runtime", () => {
      // isNode should be true only in Node.js
      if (isNode) {
        assertEquals(isDeno, false);
        assertEquals(isBun, false);
      }
    });
  });

  describe("isBun", () => {
    it("should correctly detect Bun runtime", () => {
      // isBun should be true only in Bun
      if (isBun) {
        assertEquals(isDeno, false);
        assertEquals(isNode, false);
      }
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
