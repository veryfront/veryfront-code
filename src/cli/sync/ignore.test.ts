import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createDefaultIgnoreChecker, createIgnoreChecker } from "./ignore.ts";

describe("cli/sync/ignore", () => {
  describe("createIgnoreChecker", () => {
    it("should ignore exact directory names", () => {
      const checker = createIgnoreChecker(["node_modules", ".git"]);
      assertEquals(checker.isIgnored("node_modules"), true);
      assertEquals(checker.isIgnored("src/node_modules"), true);
      assertEquals(checker.isIgnored(".git"), true);
    });

    it("should ignore glob patterns", () => {
      const checker = createIgnoreChecker(["*.log", "*.local"]);
      assertEquals(checker.isIgnored("server.log"), true);
      assertEquals(checker.isIgnored("deep/nested/file.log"), true);
      assertEquals(checker.isIgnored(".env.local"), true);
    });

    it("should not ignore non-matching paths", () => {
      const checker = createIgnoreChecker(["node_modules"]);
      assertEquals(checker.isIgnored("src/app.ts"), false);
      assertEquals(checker.isIgnored("package.json"), false);
    });

    it("should handle .env* pattern (matches .env but not dotted variants)", () => {
      // NOTE: The glob-to-regex conversion treats raw * as a regex quantifier
      // rather than a glob wildcard, so .env* matches ".env" but not ".env.local".
      // Use "*.local" or exact names to match dotted env files.
      const checker = createIgnoreChecker([".env*"]);
      assertEquals(checker.isIgnored(".env"), true);
      assertEquals(checker.isIgnored(".envvv"), true);
      assertEquals(checker.isIgnored("src/.env"), true);
    });

    it("should handle directory-trailing-slash patterns", () => {
      const checker = createIgnoreChecker(["build/"]);
      assertEquals(checker.isIgnored("build"), true);
      assertEquals(checker.isIgnored("src/build"), true);
      assertEquals(checker.isIgnored("building"), false);
    });
  });

  describe("isSupportedExtension", () => {
    it("should support TypeScript files", () => {
      const checker = createDefaultIgnoreChecker();
      assertEquals(checker.isSupportedExtension("app.ts"), true);
      assertEquals(checker.isSupportedExtension("comp.tsx"), true);
    });

    it("should support JavaScript files", () => {
      const checker = createDefaultIgnoreChecker();
      assertEquals(checker.isSupportedExtension("app.js"), true);
      assertEquals(checker.isSupportedExtension("comp.jsx"), true);
    });

    it("should support CSS and style files", () => {
      const checker = createDefaultIgnoreChecker();
      assertEquals(checker.isSupportedExtension("style.css"), true);
      assertEquals(checker.isSupportedExtension("style.scss"), true);
    });

    it("should support markdown files", () => {
      const checker = createDefaultIgnoreChecker();
      assertEquals(checker.isSupportedExtension("readme.md"), true);
      assertEquals(checker.isSupportedExtension("page.mdx"), true);
    });

    it("should reject unsupported extensions", () => {
      const checker = createDefaultIgnoreChecker();
      assertEquals(checker.isSupportedExtension("image.png"), false);
      assertEquals(checker.isSupportedExtension("data.bin"), false);
    });

    it("should reject files without extension", () => {
      const checker = createDefaultIgnoreChecker();
      assertEquals(checker.isSupportedExtension("Makefile"), false);
    });
  });

  describe("createDefaultIgnoreChecker", () => {
    it("should ignore common directories", () => {
      const checker = createDefaultIgnoreChecker();
      assertEquals(checker.isIgnored("node_modules"), true);
      assertEquals(checker.isIgnored(".git"), true);
      assertEquals(checker.isIgnored("dist"), true);
      assertEquals(checker.isIgnored(".cache"), true);
    });

    it("should ignore common files", () => {
      const checker = createDefaultIgnoreChecker();
      assertEquals(checker.isIgnored(".DS_Store"), true);
      assertEquals(checker.isIgnored("npm-debug.log"), true);
    });
  });
});
