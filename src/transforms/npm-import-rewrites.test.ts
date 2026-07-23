import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotStrictEquals, assertStrictEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  _resetCache,
  buildRules,
  getNpmRewriteRules,
  REWRITABLE_PACKAGES,
  rewriteNpmImports,
} from "./npm-import-rewrites.ts";
import { join, resolve } from "#veryfront/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";

describe("npm-import-rewrites", () => {
  describe("REWRITABLE_PACKAGES all exist in deno.json", () => {
    const denoJsonPath = join(cwd(), "deno.json");
    const config = JSON.parse(Deno.readTextFileSync(denoJsonPath));
    const importMap: Record<string, string> = config.imports ?? {};

    for (const pkg of REWRITABLE_PACKAGES) {
      it(`"${pkg}" has a pinned npm: entry in deno.json`, () => {
        const value = importMap[pkg];
        assertEquals(typeof value, "string", `Missing import map entry for "${pkg}"`);
        if (typeof value !== "string") {
          throw new Error(`Missing import map entry for "${pkg}"`);
        }
        assertEquals(
          value.startsWith("npm:"),
          true,
          `Expected npm: specifier for "${pkg}", got "${value}"`,
        );
        assertEquals(
          /npm:.+@\d+\.\d+\.\d+/.test(value),
          true,
          `Expected pinned version for "${pkg}", got "${value}"`,
        );
      });
    }
  });

  describe("buildRules", () => {
    it("returns empty rules when REWRITABLE_PACKAGES is empty", () => {
      const rules = buildRules({});
      assertEquals(rules.length, 0);
    });
  });

  describe("rewriteNpmImports", () => {
    it("returns input unchanged when no rewritable packages exist", () => {
      const input = 'import { unified } from "unified"';
      const result = rewriteNpmImports(input);
      assertEquals(result, input);
    });

    it("does not rewrite unrelated imports", () => {
      const input = 'import { foo } from "some-other-package"';
      const result = rewriteNpmImports(input);
      assertEquals(result, input);
    });

    it("keeps cached rewrite rules isolated by canonical project directory", async () => {
      const firstProject = await Deno.makeTempDir();
      const secondProject = await Deno.makeTempDir();

      try {
        _resetCache();
        const firstRules = getNpmRewriteRules(firstProject);
        const secondRules = getNpmRewriteRules(secondProject);

        assertNotStrictEquals(firstRules, secondRules);
        assertStrictEquals(getNpmRewriteRules(firstProject), firstRules);
        assertStrictEquals(getNpmRewriteRules(secondProject), secondRules);
      } finally {
        _resetCache();
        await Deno.remove(firstProject, { recursive: true });
        await Deno.remove(secondProject, { recursive: true });
      }
    });

    it("loads deno.json from the same canonical directory used for relative baseDir caching", () => {
      const relativeBaseDir = "relative-project";
      const resolvedProjectDir = resolve(relativeBaseDir);
      const canonicalProjectDir = "/canonical/project";
      const originalRealPathSync = Deno.realPathSync;
      const originalReadTextFileSync = Deno.readTextFileSync;
      let readPath: string | undefined;

      try {
        _resetCache();
        Deno.realPathSync = ((path: string | URL) => {
          assertEquals(path, resolvedProjectDir);
          return canonicalProjectDir;
        }) as typeof Deno.realPathSync;
        Deno.readTextFileSync = ((path: string | URL) => {
          readPath = String(path);
          return JSON.stringify({ imports: {} });
        }) as typeof Deno.readTextFileSync;

        const rules = getNpmRewriteRules(relativeBaseDir);

        assertEquals(rules, []);
        assertEquals(readPath, join(canonicalProjectDir, "deno.json"));
      } finally {
        Deno.realPathSync = originalRealPathSync;
        Deno.readTextFileSync = originalReadTextFileSync;
        _resetCache();
      }
    });
  });

  describe("missing deno.json fallback", () => {
    it("returns no rules when deno.json is missing", () => {
      const tmpDir = Deno.makeTempDirSync();
      try {
        _resetCache();

        const rules = getNpmRewriteRules(tmpDir);
        assertEquals(rules.length, 0);

        // rewriteNpmImports should be a no-op
        const input = 'import { z } from "zod"';
        assertEquals(rewriteNpmImports(input, tmpDir), input);
      } finally {
        _resetCache();
        Deno.removeSync(tmpDir);
      }
    });
  });
});
