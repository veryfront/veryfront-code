import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findMissingFileDependenciesInCode,
  hasIncompatibleFrameworkPaths,
} from "./framework-validator.ts";

// Minimal logger stub
const noopLog = {
  debug: () => {},
  warn: () => {},
  info: () => {},
  error: () => {},
  child: () => noopLog,
} as never;

describe("transforms/mdx/esm-module-loader/module-fetcher/framework-validator", () => {
  describe("hasIncompatibleFrameworkPaths", () => {
    it("returns false for code without file:// paths", async () => {
      const result = await hasIncompatibleFrameworkPaths("const x = 1;", noopLog);
      assertEquals(result, false);
    });

    it("returns false for empty string", async () => {
      const result = await hasIncompatibleFrameworkPaths("", noopLog);
      assertEquals(result, false);
    });

    it("returns true for code with esm.sh/_vf_modules URL", async () => {
      const code = `import foo from "https://esm.sh/_vf_modules/lib.js";`;
      const result = await hasIncompatibleFrameworkPaths(code, noopLog);
      assertEquals(result, true);
    });

    it("returns true for code with esm.sh/vf_modules URL", async () => {
      const code = `import foo from "https://esm.sh/vf_modules/lib.js";`;
      const result = await hasIncompatibleFrameworkPaths(code, noopLog);
      assertEquals(result, true);
    });

    it("returns true for incompatible HTTP bundle cache paths", async () => {
      // Uses a path that won't match local cache dir
      const code =
        `import foo from "file:///nonexistent-machine/veryfront-http-bundle/http-123.mjs";`;
      const result = await hasIncompatibleFrameworkPaths(code, noopLog);
      assertEquals(result, true);
    });

    it("returns true for incompatible MDX ESM cache paths", async () => {
      const code = `import foo from "file:///nonexistent-machine/veryfront-mdx-esm/proj/mod.mjs";`;
      const result = await hasIncompatibleFrameworkPaths(code, noopLog);
      assertEquals(result, true);
    });
  });

  describe("findMissingFileDependenciesInCode", () => {
    it("returns empty for code without file:// paths", async () => {
      const result = await findMissingFileDependenciesInCode("const x = 1;", noopLog);
      assertEquals(result.length, 0);
    });

    it("returns empty for empty string", async () => {
      const result = await findMissingFileDependenciesInCode("", noopLog);
      assertEquals(result.length, 0);
    });

    it("returns missing paths for nonexistent .mjs files", async () => {
      const code = `import foo from "file:///tmp/nonexistent-12345-test.mjs";`;
      const result = await findMissingFileDependenciesInCode(code, noopLog);
      assertEquals(result.length, 1);
      assertEquals(result[0]!.includes("nonexistent-12345-test.mjs"), true);
    });

    it("deduplicates paths", async () => {
      const code = `
import foo from "file:///tmp/nonexistent-dup-test.mjs";
import bar from "file:///tmp/nonexistent-dup-test.mjs";
      `;
      const result = await findMissingFileDependenciesInCode(code, noopLog);
      assertEquals(result.length, 1);
    });

    it("strips query parameters from paths", async () => {
      const code = `import foo from "file:///tmp/nonexistent-query-test.mjs?v=1";`;
      const result = await findMissingFileDependenciesInCode(code, noopLog);
      assertEquals(result.length, 1);
      assertEquals(result[0]!.includes("?"), false);
    });

    it("only matches .mjs files", async () => {
      const code = `import foo from "file:///tmp/nonexistent.js";`;
      const result = await findMissingFileDependenciesInCode(code, noopLog);
      // .js files are not matched by the pattern (only .mjs)
      assertEquals(result.length, 0);
    });
  });
});
