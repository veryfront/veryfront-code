import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { stub } from "#std/testing/mock";
import { scanLocalFiles } from "../commands/push/command.ts";
import { setJsonMode } from "../shared/json-output.ts";
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

    it("keeps secrets ignored when .vfignore negates the defaults", async () => {
      const projectDir = await Deno.makeTempDir();
      try {
        await Deno.writeTextFile(
          `${projectDir}/.vfignore`,
          "!.env*.json\n!.veryfront\n!.veryfront/**\n",
        );
        const checker = createIgnoreChecker(await loadIgnorePatterns(projectDir));

        assertEquals(checker.isIgnored(".env.production.json"), true);
        assertEquals(checker.isIgnored(".veryfront/state.json"), true);
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

    it("should not let negations re-include secrets or CLI state", () => {
      const checker = createIgnoreChecker([
        ".env*",
        ".veryfront",
        ".git",
        "!.env*.json",
        "!.env/**",
        "!.veryfront",
        "!.veryfront/**",
        "!.git/**",
      ]);

      assertEquals(checker.isIgnored(".env.production.json"), true);
      assertEquals(checker.isIgnored("config/.env.staging.yaml"), true);
      assertEquals(checker.isIgnored(".env/credentials.json"), true);
      assertEquals(checker.isIgnored(".env.d/production.json"), true);
      assertEquals(checker.isIgnored(".ENV.PRODUCTION.JSON"), true);
      assertEquals(checker.isIgnored(".ENV/credentials.json"), true);
      assertEquals(checker.isIgnored(".veryfront"), true);
      assertEquals(checker.isIgnored(".veryfront/state.json"), true);
      assertEquals(checker.isIgnored(".git/config"), true);
      assertEquals(checker.isProtected(".env/credentials.json"), true);
      assertEquals(checker.isProtected("src/app.ts"), false);
    });

    it("should keep negations working for names that only start with .env", () => {
      const checker = createIgnoreChecker([
        ".env*",
        "!.envoy",
        "!.envoy/**",
        "!.environments",
        "!.environments/**",
      ]);

      assertEquals(checker.isIgnored(".envoy/config.json"), false);
      assertEquals(checker.isIgnored(".environments/prod.json"), false);
      assertEquals(checker.isProtected(".envoy/config.json"), false);
      assertEquals(checker.isProtected(".environments/prod.json"), false);
    });

    it("keeps negated .env-prefixed directories traversable by push", async () => {
      await withTempDir(async (projectDir) => {
        await Deno.mkdir(`${projectDir}/.envoy`, { recursive: true });
        await Deno.mkdir(`${projectDir}/.environments`, { recursive: true });
        await Deno.writeTextFile(`${projectDir}/.envoy/config.json`, "{}\n");
        await Deno.writeTextFile(`${projectDir}/.environments/prod.json`, "{}\n");
        const checker = createIgnoreChecker([
          ".env*",
          "!.envoy",
          "!.envoy/**",
          "!.environments",
          "!.environments/**",
        ]);

        const files = await scanLocalFiles(projectDir, checker);

        assertEquals(files.map((file) => file.path).sort(), [
          ".environments/prod.json",
          ".envoy/config.json",
        ]);
      });
    });

    it("warns only for a negated protected path and keeps JSON output clean", () => {
      const warnings: string[] = [];
      const warningStub = stub(console, "warn", (...values: unknown[]) => {
        warnings.push(values.map(String).join(" "));
      });
      const path = ".env/credentials\u001b[31mforged.json";

      try {
        assertEquals(createIgnoreChecker([]).isIgnored(path), true);
        assertEquals(warnings, [], "protection without a negation must stay silent");

        const checker = createIgnoreChecker([`!${path}`]);
        assertEquals(checker.isIgnored(path), true);
        assertEquals(checker.isIgnored(path), true);
        assertEquals(warnings.length, 1, "one dropped negation must emit one warning");
        assertEquals(
          warnings[0]?.includes("\u001b"),
          false,
          "warning text must not carry terminal controls",
        );

        assertEquals(createIgnoreChecker(["!keep.ts"]).isIgnored(".env.production.json"), true);
        assertEquals(warnings.length, 1, "a protected file must not be treated as a directory");

        const descendantChecker = createIgnoreChecker([".env*", "!.env/**"]);
        assertEquals(descendantChecker.isIgnored(".env", { isDirectory: true }), true);
        assertEquals(
          warnings.length,
          2,
          "a protected parent must warn before traversal drops a descendant negation",
        );

        const divergentDescendantChecker = createIgnoreChecker(["!.env**", ".env*"]);
        assertEquals(divergentDescendantChecker.isIgnored(".env", { isDirectory: true }), true);
        assertEquals(
          warnings.length,
          3,
          "a later parent match must not hide a negation still effective for descendants",
        );

        const wildcardChecker = createIgnoreChecker([".env*", "!**/.env/**"]);
        assertEquals(wildcardChecker.isIgnored(".env", { isDirectory: true }), true);
        assertEquals(warnings.length, 4, "a recursive prefix must not hide the warning");

        const internalWildcardChecker = createIgnoreChecker([
          "src/.env*",
          "!src/**/.env/**",
        ]);
        assertEquals(internalWildcardChecker.isIgnored("src/.env", { isDirectory: true }), true);
        assertEquals(warnings.length, 5, "an internal wildcard must not hide the warning");

        const anchoredRootFileChecker = createIgnoreChecker([".git", "!/*.ts"]);
        assertEquals(anchoredRootFileChecker.isIgnored(".git", { isDirectory: true }), true);
        assertEquals(warnings.length, 5, "a root file rule must not warn for protected children");

        const anchoredRecursiveFileChecker = createIgnoreChecker([".env*", "!/**.json"]);
        assertEquals(anchoredRecursiveFileChecker.isIgnored(".env", { isDirectory: true }), true);
        assertEquals(warnings.length, 6, "an anchored double-star must retain its warning");

        const unanchoredNestedChecker = createIgnoreChecker([".env*", "!foo/bar.json"]);
        assertEquals(unanchoredNestedChecker.isIgnored(".env", { isDirectory: true }), true);
        assertEquals(warnings.length, 7, "an unanchored nested rule must retain its warning");

        const anchoredOtherPrefixChecker = createIgnoreChecker([".env*", "!/foo**.json"]);
        assertEquals(anchoredOtherPrefixChecker.isIgnored(".env", { isDirectory: true }), true);
        assertEquals(warnings.length, 7, "an unrelated anchored prefix must not warn");

        const embeddedDoubleStarChecker = createIgnoreChecker([
          ".env*",
          "!/foo**/bar.json",
        ]);
        assertEquals(
          embeddedDoubleStarChecker.isIgnored("foo/.env", { isDirectory: true }),
          true,
        );
        assertEquals(warnings.length, 8, "an embedded double-star must retain its warning");

        const canceledNegationChecker = createIgnoreChecker([
          ".env*",
          "!.env/**",
          ".env/**",
        ]);
        assertEquals(canceledNegationChecker.isIgnored(".env", { isDirectory: true }), true);
        assertEquals(warnings.length, 8, "a later matching ignore rule cancels the warning");

        const broadlyCanceledChecker = createIgnoreChecker(["!.env/**", ".env"]);
        assertEquals(broadlyCanceledChecker.isIgnored(".env", { isDirectory: true }), true);
        assertEquals(
          warnings.length,
          8,
          "a later parent-directory ignore cancels descendant negations",
        );

        const wildcardCanceledChecker = createIgnoreChecker([
          "!.env/foo.ts",
          ".env/*.ts",
        ]);
        assertEquals(wildcardCanceledChecker.isIgnored(".env", { isDirectory: true }), true);
        assertEquals(
          warnings.length,
          8,
          "a later wildcard that covers a fixed negation cancels the warning",
        );

        const differentlyAnchoredChecker = createIgnoreChecker([
          "!secret.json",
          "/secret.json",
        ]);
        assertEquals(differentlyAnchoredChecker.isIgnored(".env", { isDirectory: true }), true);
        assertEquals(
          warnings.length,
          9,
          "a root-anchored positive cannot cancel an unanchored descendant negation",
        );

        const parentOnlyChecker = createIgnoreChecker([
          "!.env",
          ".env*",
        ]);
        assertEquals(parentOnlyChecker.isIgnored(".env", { isDirectory: true }), true);
        assertEquals(
          warnings.length,
          10,
          "a parent-only positive cannot cancel a negation that also matches descendants",
        );

        const anchoredParentOnlyChecker = createIgnoreChecker([
          "!/.env",
          ".env*",
        ]);
        assertEquals(
          anchoredParentOnlyChecker.isIgnored(".env", { isDirectory: true }),
          true,
        );
        assertEquals(
          warnings.length,
          11,
          "an anchored literal negation must include its implicit descendants",
        );

        setJsonMode(true);
        assertEquals(createIgnoreChecker(["!.env/**"]).isIgnored(".env/other.json"), true);
        assertEquals(warnings.length, 11, "JSON mode must not emit human warning text");
      } finally {
        setJsonMode(false);
        warningStub.restore();
      }
    });

    it("should handle directory-trailing-slash patterns", () => {
      const checker = createIgnoreChecker(["build/"]);

      assertEquals(checker.isIgnored("build"), true);
      assertEquals(checker.isIgnored("src/build"), true);
      assertEquals(checker.isIgnored("building"), false);
    });

    it("bounds repository-controlled ignore rule complexity", () => {
      assertThrows(
        () => createIgnoreChecker([`${"segment/".repeat(128)}file.ts`]),
        Error,
        ".vfignore patterns must not exceed",
      );
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
