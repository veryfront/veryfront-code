import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  _resetCache,
  buildRules,
  getNpmRewriteRules,
  REWRITABLE_PACKAGES,
  rewriteNpmImports,
} from "./npm-import-rewrites.ts";
import { join } from "#veryfront/compat/path/index.ts";
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
  });

  describe("missing deno.json fallback", () => {
    it("returns no rules when deno.json is missing", () => {
      const originalCwd = Deno.cwd();
      const tmpDir = Deno.makeTempDirSync();
      try {
        // Move to a directory without deno.json
        Deno.chdir(tmpDir);
        _resetCache();

        const rules = getNpmRewriteRules();
        assertEquals(rules.length, 0);

        // rewriteNpmImports should be a no-op
        const input = 'import { z } from "zod"';
        assertEquals(rewriteNpmImports(input), input);
      } finally {
        Deno.chdir(originalCwd);
        _resetCache();
        Deno.removeSync(tmpDir);
      }
    });
  });
});
