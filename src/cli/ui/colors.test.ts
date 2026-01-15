/**
 * Tests for CLI colors
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { afterAll, beforeAll, describe, it } from "jsr:@std/testing@1/bdd";
import {
  bold,
  brand,
  dim,
  error,
  muted,
  reset,
  resetColorCache,
  success,
  warning,
} from "./colors.ts";

describe("colors", () => {
  // Force TrueColor mode for testing
  let originalForceColor: string | undefined;
  beforeAll(() => {
    originalForceColor = Deno.env.get("FORCE_COLOR");
    Deno.env.set("FORCE_COLOR", "3");
    resetColorCache(); // Clear cache so new setting takes effect
  });
  afterAll(() => {
    if (originalForceColor !== undefined) {
      Deno.env.set("FORCE_COLOR", originalForceColor);
    } else {
      Deno.env.delete("FORCE_COLOR");
    }
    resetColorCache(); // Clear cache after tests
  });
  describe("brand color", () => {
    it("wraps text with ANSI escape codes", () => {
      const result = brand("test");
      assertStringIncludes(result, "test");
      assertStringIncludes(result, "\x1b[38;2;0;163;244m"); // RGB(0,163,244) = #00A3F4
      assertStringIncludes(result, "\x1b[0m"); // Reset
    });

    it("returns empty string for empty input", () => {
      const result = brand("");
      assertEquals(result, "\x1b[38;2;0;163;244m\x1b[0m");
    });
  });

  describe("semantic colors", () => {
    it("success applies green color", () => {
      const result = success("ok");
      assertStringIncludes(result, "ok");
      assertStringIncludes(result, "\x1b[38;2;34;197;94m"); // Green
    });

    it("error applies red color", () => {
      const result = error("fail");
      assertStringIncludes(result, "fail");
      assertStringIncludes(result, "\x1b[38;2;239;68;68m"); // Red
    });

    it("warning applies yellow color", () => {
      const result = warning("warn");
      assertStringIncludes(result, "warn");
      assertStringIncludes(result, "\x1b[38;2;234;179;8m"); // Yellow
    });

    it("muted applies gray color", () => {
      const result = muted("dim");
      assertStringIncludes(result, "dim");
      assertStringIncludes(result, "\x1b[38;2;113;113;122m"); // Gray
    });
  });

  describe("text styles", () => {
    it("bold wraps with bold codes", () => {
      const result = bold("strong");
      assertEquals(result, "\x1b[1mstrong\x1b[0m");
    });

    it("dim wraps with dim codes", () => {
      const result = dim("faint");
      assertEquals(result, "\x1b[2mfaint\x1b[0m");
    });
  });

  describe("reset", () => {
    it("is the reset escape code", () => {
      assertEquals(reset, "\x1b[0m");
    });
  });
});
