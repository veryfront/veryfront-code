/**
 * Tests for CLI colors
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
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
  let originalForceColor: string | undefined;
  let originalNoColor: string | undefined;

  beforeAll(() => {
    originalForceColor = getEnv("FORCE_COLOR");
    originalNoColor = getEnv("NO_COLOR");

    if (originalNoColor !== undefined) deleteEnv("NO_COLOR");

    setEnv("FORCE_COLOR", "3");
    resetColorCache();
  });

  afterAll(() => {
    if (originalForceColor !== undefined) {
      setEnv("FORCE_COLOR", originalForceColor);
    } else {
      deleteEnv("FORCE_COLOR");
    }

    if (originalNoColor !== undefined) {
      setEnv("NO_COLOR", originalNoColor);
    } else {
      deleteEnv("NO_COLOR");
    }

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
