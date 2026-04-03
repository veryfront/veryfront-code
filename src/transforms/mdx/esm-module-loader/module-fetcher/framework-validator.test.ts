import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
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

    it("returns true for legacy generic .cache TSX paths", async () => {
      const code = `import foo from "file:///app/.cache/markdown.tsx";`;
      const result = await hasIncompatibleFrameworkPaths(code, noopLog);
      assertEquals(result, true);
    });

    it("returns false for local generic .cache paths under the cache base dir", async () => {
      const localCachePath = join(getCacheBaseDir(), "project", "markdown.tsx");
      const code = `import foo from "file://${localCachePath}";`;
      const result = await hasIncompatibleFrameworkPaths(code, noopLog);
      assertEquals(result, false);
    });

    it("returns true for nested vf modules with esm.sh/_vf_modules URLs", async () => {
      const tempDir = await makeTempDir({ prefix: "vf-framework-validator-" });
      const vfmodDir = join(tempDir, "veryfront-mdx-esm", "project-a", "preview-main");
      const childPath = join(vfmodDir, "vfmod-child.mjs");

      try {
        await mkdir(vfmodDir, { recursive: true });
        await writeTextFile(
          childPath,
          `import foo from "https://esm.sh/_vf_modules/lib.js"; export default foo;`,
        );

        const code = `import child from "file://${childPath}"; export default child;`;
        const result = await hasIncompatibleFrameworkPaths(code, noopLog);

        assertEquals(result, true);
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });

    it("returns true for nested vf modules with non-portable legacy cache paths", async () => {
      const tempDir = await makeTempDir({ prefix: "vf-framework-validator-" });
      const vfmodDir = join(tempDir, "veryfront-mdx-esm", "project-a", "preview-main");
      const childPath = join(vfmodDir, "vfmod-child.mjs");

      try {
        await mkdir(vfmodDir, { recursive: true });
        await writeTextFile(
          childPath,
          `import foo from "file:///app/.cache/markdown.tsx"; export default foo;`,
        );

        const code = `import child from "file://${childPath}"; export default child;`;
        const result = await hasIncompatibleFrameworkPaths(code, noopLog);

        assertEquals(result, true);
      } finally {
        await remove(tempDir, { recursive: true });
      }
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

    it("matches .js files too", async () => {
      const code = `import foo from "file:///tmp/nonexistent.js";`;
      const result = await findMissingFileDependenciesInCode(code, noopLog);
      assertEquals(result.length, 1);
    });

    it("matches legacy .tsx cache paths", async () => {
      const code = `import foo from "file:///app/.cache/markdown.tsx";`;
      const result = await findMissingFileDependenciesInCode(code, noopLog);
      assertEquals(result.length, 1);
      assertEquals(result[0]!.includes("markdown.tsx"), true);
    });

    it("follows nested vf modules when checking file dependencies", async () => {
      const tempDir = await makeTempDir({ prefix: "vf-framework-validator-" });
      const vfmodDir = join(tempDir, "veryfront-mdx-esm", "project-a", "preview-main");
      const childPath = join(vfmodDir, "vfmod-child.mjs");

      try {
        await mkdir(vfmodDir, { recursive: true });
        await writeTextFile(
          childPath,
          `import foo from "file:///app/.cache/markdown.tsx"; export default foo;`,
        );

        const code = `import child from "file://${childPath}"; export default child;`;
        const result = await findMissingFileDependenciesInCode(code, noopLog);

        assertEquals(result.includes("/app/.cache/markdown.tsx"), true);
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });
  });
});
