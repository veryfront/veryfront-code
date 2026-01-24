/**
 * Tests for MDX compiler validator functions
 */

import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { pathExists, validateCompileParams, validateFileExists } from "./validator.ts";
import type { CompileOptions } from "./types.ts";
import {
  makeTempDir,
  makeTempFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";

describe("MDX compiler validator", () => {
  const validOptions: CompileOptions = {
    projectDir: "/test/project",
    outputDir: "/test/output",
    mode: "development",
  };

  describe("validateCompileParams", () => {
    it("should accept valid parameters", () => {
      expect(() => validateCompileParams("test.mdx", "# Hello", validOptions)).not.toThrow();
    });

    it("should reject empty filePath", () => {
      expect(() => validateCompileParams("", "# Hello", validOptions)).toThrow(
        "filePath must be a non-empty string",
      );
    });

    it("should reject non-string filePath", () => {
      expect(() => validateCompileParams(null as unknown as string, "# Hello", validOptions))
        .toThrow("filePath must be a non-empty string");

      expect(() => validateCompileParams(123 as unknown as string, "# Hello", validOptions))
        .toThrow("filePath must be a non-empty string");
    });

    it("should reject non-string content", () => {
      expect(() => validateCompileParams("test.mdx", null as unknown as string, validOptions))
        .toThrow("content must be a string");

      expect(() => validateCompileParams("test.mdx", 123 as unknown as string, validOptions))
        .toThrow("content must be a string");
    });

    it("should accept empty string content", () => {
      expect(() => validateCompileParams("test.mdx", "", validOptions)).not.toThrow();
    });

    it("should reject null options", () => {
      expect(() => validateCompileParams("test.mdx", "# Hello", null as unknown as CompileOptions))
        .toThrow("options must be an object");
    });

    it("should reject non-object options", () => {
      expect(() =>
        validateCompileParams("test.mdx", "# Hello", "string" as unknown as CompileOptions)
      ).toThrow("options must be an object");
    });

    it("should reject missing projectDir", () => {
      const opts = { ...validOptions, projectDir: "" };
      expect(() => validateCompileParams("test.mdx", "# Hello", opts)).toThrow(
        "options.projectDir must be a non-empty string",
      );
    });

    it("should reject non-string projectDir", () => {
      const opts = { ...validOptions, projectDir: 123 as unknown as string };
      expect(() => validateCompileParams("test.mdx", "# Hello", opts)).toThrow(
        "options.projectDir must be a non-empty string",
      );
    });

    it("should reject missing outputDir", () => {
      const opts = { ...validOptions, outputDir: "" };
      expect(() => validateCompileParams("test.mdx", "# Hello", opts)).toThrow(
        "options.outputDir must be a non-empty string",
      );
    });

    it("should reject non-string outputDir", () => {
      const opts = { ...validOptions, outputDir: null as unknown as string };
      expect(() => validateCompileParams("test.mdx", "# Hello", opts)).toThrow(
        "options.outputDir must be a non-empty string",
      );
    });

    it("should reject invalid mode", () => {
      const opts = { ...validOptions, mode: "invalid" as "development" };
      expect(() => validateCompileParams("test.mdx", "# Hello", opts)).toThrow(
        'options.mode must be either "development" or "production"',
      );
    });

    it("should accept development mode", () => {
      const opts = { ...validOptions, mode: "development" as const };
      expect(() => validateCompileParams("test.mdx", "# Hello", opts)).not.toThrow();
    });

    it("should accept production mode", () => {
      const opts = { ...validOptions, mode: "production" as const };
      expect(() => validateCompileParams("test.mdx", "# Hello", opts)).not.toThrow();
    });
  });

  describe("validateFileExists", () => {
    let tempFile = "";

    beforeEach(async () => {
      tempFile = await makeTempFile({ prefix: "mdx-test-" });
      await writeTextFile(tempFile, "# Test content");
    });

    afterEach(async () => {
      try {
        await remove(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should not throw for non-empty content", async () => {
      await expect(validateFileExists("/nonexistent/file.mdx", "# Hello")).resolves.toBeUndefined();
    });

    it("should not throw if file exists and content is empty", async () => {
      await expect(validateFileExists(tempFile, "")).resolves.toBeUndefined();
    });

    it("should throw if file does not exist and content is empty", async () => {
      await expect(validateFileExists("/nonexistent/file.mdx", "")).rejects.toThrow(
        "MDX file not found",
      );
    });

    it("should throw if file does not exist and content is whitespace only", async () => {
      await expect(validateFileExists("/nonexistent/file.mdx", "   ")).rejects.toThrow(
        "MDX file not found",
      );
    });

    it("should not throw for content with just spaces (not trimmed to empty)", async () => {
      await expect(validateFileExists("/nonexistent/file.mdx", " \n \t ")).rejects.toThrow(
        "MDX file not found",
      );
    });
  });

  describe("pathExists", () => {
    let tempFile = "";
    let tempDir = "";

    beforeEach(async () => {
      tempFile = await makeTempFile({ prefix: "path-test-" });
      tempDir = await makeTempDir({ prefix: "path-test-" });
    });

    afterEach(async () => {
      try {
        await remove(tempFile);
        await remove(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should return true for existing file", async () => {
      expect(await pathExists(tempFile)).toBe(true);
    });

    it("should return true for existing directory", async () => {
      expect(await pathExists(tempDir)).toBe(true);
    });

    it("should return false for non-existent path", async () => {
      expect(await pathExists("/nonexistent/path/to/file")).toBe(false);
    });

    it("should return false for invalid path", async () => {
      expect(await pathExists("")).toBe(false);
    });

    it("should handle relative paths", async () => {
      expect(await pathExists("./src")).toBe(true);
    });

    it("should handle absolute paths", async () => {
      expect(await pathExists(tempFile)).toBe(true);
    });
  });
});
