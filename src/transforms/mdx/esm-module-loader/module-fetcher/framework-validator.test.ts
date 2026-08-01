import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { getCacheBaseDir, getMdxEsmCacheDir, runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import {
  findMissingFileDependenciesInCode,
  hasIncompatibleFrameworkPaths,
} from "./framework-validator.ts";
import { getLocalFs } from "../cache/index.ts";
import { FRAMEWORK_ROOT } from "../constants.ts";

// Minimal logger stub
const noopLog = {
  debug: () => {},
  warn: () => {},
  info: () => {},
  error: () => {},
  child: () => noopLog,
} as never;

function nonCanonicalNotFoundFailures(): ReadonlyArray<readonly [string, unknown]> {
  return [
    ["a plain ENOENT-shaped rejection", Object.freeze({ code: "ENOENT" })],
    [
      "a native Error with a plain ENOENT-shaped cause",
      new Error("wrapped framework validation failure", {
        cause: Object.freeze({ code: "ENOENT" }),
      }),
    ],
  ];
}

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

    it("propagates framework stat failures unchanged", async () => {
      const frameworkPath = join(
        FRAMEWORK_ROOT,
        "src",
        `framework-stat-${crypto.randomUUID()}.ts`,
      );
      const localFs = getLocalFs();
      const originalStat = localFs.stat.bind(localFs);
      const permissionError = Object.assign(new Error("framework stat denied"), {
        code: "EACCES",
      });

      try {
        localFs.stat = (path: string) =>
          path === frameworkPath ? Promise.reject(permissionError) : originalStat(path);

        const error = await assertRejects(() =>
          hasIncompatibleFrameworkPaths(
            `import value from "file://${frameworkPath}";`,
            noopLog,
          )
        );

        assertStrictEquals(error, permissionError);
      } finally {
        localFs.stat = originalStat;
      }
    });

    for (const [label, failure] of nonCanonicalNotFoundFailures()) {
      it(`propagates ${label} from framework stat instead of invalidating`, async () => {
        const frameworkPath = join(
          FRAMEWORK_ROOT,
          "src",
          `framework-shaped-stat-${crypto.randomUUID()}.ts`,
        );
        const localFs = getLocalFs();
        const originalStat = localFs.stat.bind(localFs);
        let statCalls = 0;

        try {
          localFs.stat = (path: string) => {
            if (path !== frameworkPath) return originalStat(path);
            statCalls++;
            return Promise.reject(failure);
          };

          const error = await assertRejects(() =>
            hasIncompatibleFrameworkPaths(
              `import value from "file://${frameworkPath}";`,
              noopLog,
            )
          );

          assertStrictEquals(error, failure);
          assertEquals(statCalls, 1);
        } finally {
          localFs.stat = originalStat;
        }
      });
    }

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

    it("propagates file dependency stat failures unchanged", async () => {
      const dependencyPath = join(
        getCacheBaseDir(),
        `dependency-stat-${crypto.randomUUID()}.mjs`,
      );
      const localFs = getLocalFs();
      const originalStat = localFs.stat.bind(localFs);
      const ioError = Object.assign(new Error("dependency stat failed"), { code: "EIO" });

      try {
        localFs.stat = (path: string) =>
          path === dependencyPath ? Promise.reject(ioError) : originalStat(path);

        const error = await assertRejects(() =>
          findMissingFileDependenciesInCode(
            `import value from "file://${dependencyPath}";`,
            noopLog,
          )
        );

        assertStrictEquals(error, ioError);
      } finally {
        localFs.stat = originalStat;
      }
    });

    for (const [label, failure] of nonCanonicalNotFoundFailures()) {
      it(`propagates ${label} from dependency stat instead of reporting it missing`, async () => {
        const dependencyPath = join(
          getCacheBaseDir(),
          `dependency-shaped-stat-${crypto.randomUUID()}.mjs`,
        );
        const localFs = getLocalFs();
        const originalStat = localFs.stat.bind(localFs);
        let statCalls = 0;

        try {
          localFs.stat = (path: string) => {
            if (path !== dependencyPath) return originalStat(path);
            statCalls++;
            return Promise.reject(failure);
          };

          const error = await assertRejects(() =>
            findMissingFileDependenciesInCode(
              `import value from "file://${dependencyPath}";`,
              noopLog,
            )
          );

          assertStrictEquals(error, failure);
          assertEquals(statCalls, 1);
        } finally {
          localFs.stat = originalStat;
        }
      });
    }

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

      try {
        await runWithCacheDir(tempDir, async () => {
          const vfmodDir = join(
            getMdxEsmCacheDir(),
            "project-a",
            "preview-main",
          );
          const childPath = join(vfmodDir, "vfmod-child.mjs");
          await mkdir(vfmodDir, { recursive: true });
          await writeTextFile(
            childPath,
            `import foo from "file:///app/.cache/markdown.tsx"; export default foo;`,
          );

          const code = `import child from "file://${childPath}"; export default child;`;
          const result = await findMissingFileDependenciesInCode(code, noopLog);

          assertEquals(result.includes("/app/.cache/markdown.tsx"), true);
        });
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });
  });
});
