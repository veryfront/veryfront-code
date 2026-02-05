/**
 * Tests for CLI colors
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  bold,
  brand,
  dim,
  error,
  muted,
  reset,
  resetColorCache,
  setTestColorLevel,
  success,
  warning,
} from "./colors.ts";

describe("colors", () => {
  beforeEach(() => {
    // Force truecolor mode for consistent test behavior across environments
    setTestColorLevel("truecolor");
  });

  afterEach(() => {
    // Reset to normal behavior
    resetColorCache();
  });

  describe("brand color", () => {
    it("wraps text with ANSI escape codes", () => {
      const result = brand("test");
      assertStringIncludes(result, "test");
      assertStringIncludes(result, "\x1b[38;2;252;143;93m");
      assertStringIncludes(result, "\x1b[0m");
    });

    it("returns empty string for empty input", () => {
      assertEquals(brand(""), "\x1b[38;2;252;143;93m\x1b[0m");
    });
  });

  describe("semantic colors", () => {
    it("success applies green color", () => {
      const result = success("ok");
      assertStringIncludes(result, "ok");
      assertStringIncludes(result, "\x1b[38;2;34;197;94m");
    });

    it("error applies red color", () => {
      const result = error("fail");
      assertStringIncludes(result, "fail");
      assertStringIncludes(result, "\x1b[38;2;239;68;68m");
    });

    it("warning applies yellow color", () => {
      const result = warning("warn");
      assertStringIncludes(result, "warn");
      assertStringIncludes(result, "\x1b[38;2;234;179;8m");
    });

    it("muted applies gray color", () => {
      const result = muted("dim");
      assertStringIncludes(result, "dim");
      assertStringIncludes(result, "\x1b[38;2;113;113;122m");
    });
  });

  describe("text styles", () => {
    it("bold wraps with bold codes", () => {
      assertEquals(bold("strong"), "\x1b[1mstrong\x1b[0m");
    });

    it("dim wraps with dim codes", () => {
      assertEquals(dim("faint"), "\x1b[2mfaint\x1b[0m");
    });
  });

  describe("reset", () => {
    it("is the reset escape code", () => {
      assertEquals(reset, "\x1b[0m");
    });
  });
});
