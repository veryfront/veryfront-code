import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { detectRuntime } from "./runtime-detection.ts";
import type { RuntimeId } from "./base.ts";

describe("runtime-detection", () => {
  describe("detectRuntime", () => {
    it("should return a string", () => {
      const result = detectRuntime();
      assertEquals(typeof result, "string");
    });

    it("should return a valid runtime identifier", () => {
      const result = detectRuntime();
      const validValues: Array<RuntimeId | "unknown"> = [
        "deno",
        "node",
        "bun",
        "cloudflare",
        "unknown",
      ];
      assertEquals(validValues.includes(result), true);
    });

    it("should detect deno in this test environment", () => {
      const result = detectRuntime();
      assertEquals(result, "deno");
    });
  });
});
