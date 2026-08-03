import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createDefaultIgnoreChecker, createIgnoreChecker, loadIgnorePatterns } from "./ignore.ts";

describe("cli/sync/ignore", () => {
  describe("loadIgnorePatterns", () => {
    it("uses default patterns when .vfignore is missing", async () => {
      const projectDir = await Deno.makeTempDir();
      try {
        const patterns = await loadIgnorePatterns(projectDir);
        assertEquals(patterns.includes("node_modules"), true);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("loads patterns from a regular .vfignore file", async () => {
      const projectDir = await Deno.makeTempDir();
      try {
        await Deno.writeTextFile(`${projectDir}/.vfignore`, "generated/**\n");
        const patterns = await loadIgnorePatterns(projectDir);
        assertEquals(patterns.includes("generated/**"), true);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects a non-file .vfignore", async () => {
      const projectDir = await Deno.makeTempDir();
      try {
        await Deno.mkdir(`${projectDir}/.vfignore`);
        await assertRejects(
          () => loadIgnorePatterns(projectDir),
          Error,
          "must be a regular file",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects a symlinked .vfignore", async () => {
      if (Deno.build.os === "windows") return;

      const projectDir = await Deno.makeTempDir();
      const externalFile = await Deno.makeTempFile();
      try {
        await Deno.writeTextFile(externalFile, "generated/**\n");
        await Deno.symlink(externalFile, `${projectDir}/.vfignore`);
        await assertRejects(
          () => loadIgnorePatterns(projectDir),
          Error,
          "cannot be a symbolic link",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
        await Deno.remove(externalFile);
      }
    });
  });

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

    it("should handle .env* pattern as a glob", () => {
      const checker = createIgnoreChecker([".env*"]);

      assertEquals(checker.isIgnored(".env"), true);
      assertEquals(checker.isIgnored(".env.local"), true);
      assertEquals(checker.isIgnored(".envvv"), true);
      assertEquals(checker.isIgnored("src/.env"), true);
    });

    it("should support double-star directory globs", () => {
      const checker = createIgnoreChecker(["src/**/fixtures/*.json"]);

      assertEquals(checker.isIgnored("src/fixtures/data.json"), true);
      assertEquals(checker.isIgnored("src/deep/fixtures/data.json"), true);
      assertEquals(checker.isIgnored("src/deep/fixtures/data.ts"), false);
    });

    it("should apply negated patterns in order", () => {
      const checker = createIgnoreChecker(["*.log", "!keep.log"]);

      assertEquals(checker.isIgnored("server.log"), true);
      assertEquals(checker.isIgnored("keep.log"), false);
      assertEquals(checker.isIgnored("logs/keep.log"), false);
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
