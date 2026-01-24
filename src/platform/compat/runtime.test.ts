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
      const activeCount = [isDeno, isNode, isBun].filter(Boolean).length;
      assertEquals(activeCount, 1, "Exactly one main runtime should be detected");
    });
  });

  describe("isDeno", () => {
    it("should correctly detect Deno runtime", () => {
      if (!isDeno) return;
      assertEquals(isNode, false);
      assertEquals(isBun, false);
    });
  });

  describe("isNode", () => {
    it("should correctly detect Node.js runtime", () => {
      if (!isNode) return;
      assertEquals(isDeno, false);
      assertEquals(isBun, false);
    });
  });

  describe("isBun", () => {
    it("should correctly detect Bun runtime", () => {
      if (!isBun) return;
      assertEquals(isDeno, false);
      assertEquals(isNode, false);
    });
  });

  describe("isNodeRuntime function", () => {
    it("should return same result as isNode constant", () => {
      assertEquals(isNodeRuntime(), isNode);
    });

    it("should be callable as a function", () => {
      assertEquals(typeof isNodeRuntime(), "boolean");
    });
  });
});
