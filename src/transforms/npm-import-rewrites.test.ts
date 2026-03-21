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
    it("generates static and dynamic import rules for each package", () => {
      const importMap = {
        ai: "npm:ai@6.0.33",
        zod: "npm:zod@3.25.76",
      };

      const rules = buildRules(importMap);

      // 2 packages × 2 rules (static + dynamic) = 4 rules
      assertEquals(rules.length, 4);
    });

    it("skips packages not in the import map", () => {
      const rules = buildRules({ ai: "npm:ai@6.0.33" });
      // Only "ai" is present — 2 rules (static + dynamic)
      assertEquals(rules.length, 2);
    });
  });

  describe("rewriteNpmImports", () => {
    it("rewrites static imports to pinned versions", () => {
      const input = 'import { generateText } from "ai"';
      const result = rewriteNpmImports(input);
      assertEquals(result.includes("npm:ai@"), true);
      assertEquals(result.includes("@latest"), false);
    });

    it("rewrites dynamic imports to pinned versions", () => {
      const input = 'const mod = await import("ai")';
      const result = rewriteNpmImports(input);
      assertEquals(result.includes("npm:ai@"), true);
    });

    it("rewrites scoped packages", () => {
      const input = 'import { anthropic } from "@ai-sdk/anthropic"';
      const result = rewriteNpmImports(input);
      assertEquals(result.includes("npm:@ai-sdk/anthropic@"), true);
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
        const input = 'import { generateText } from "ai"';
        assertEquals(rewriteNpmImports(input), input);
      } finally {
        Deno.chdir(originalCwd);
        _resetCache();
        Deno.removeSync(tmpDir);
      }
    });
  });
});
