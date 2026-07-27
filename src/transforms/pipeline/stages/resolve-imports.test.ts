import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ensureDefaultBundlerContracts } from "#veryfront/extensions/bundler/defaults.ts";
import { resolveImportsPlugin } from "./resolve-imports.ts";
import { type TransformContext, TransformStage } from "../types.ts";

function makeTransformContext(
  code: string,
  dependencyPinningCacheKey?: string,
): TransformContext {
  return {
    code,
    originalSource: code,
    filePath: "/project/test.ts",
    projectDir: "/project",
    projectId: "project",
    target: "browser",
    dev: false,
    contentHash: "hash",
    jsxImportSource: "react",
    timing: new Map(),
    debug: false,
    metadata: new Map(),
    reactVersion: "19.2.4",
    dependencyPinningCacheKey,
  };
}

describe("transforms/pipeline/stages/resolve-imports", () => {
  describe("resolveImportsPlugin metadata", () => {
    it("has name 'resolve-imports'", () => {
      assertEquals(resolveImportsPlugin.name, "resolve-imports");
    });

    it("runs at RESOLVE_ALIASES stage", () => {
      assertEquals(resolveImportsPlugin.stage, TransformStage.RESOLVE_ALIASES);
    });

    it("has a transform function", () => {
      assertExists(resolveImportsPlugin.transform);
      assertEquals(typeof resolveImportsPlugin.transform, "function");
    });

    it("has no condition (always runs)", () => {
      assertEquals(resolveImportsPlugin.condition, undefined);
    });
  });

  it("removes JSON attributes from flag-off and snapshot-bound deno-config JS stubs", async () => {
    await ensureDefaultBundlerContracts();
    const code = `import denoConfig from "#deno-config" with { type: "json" };`;

    assertEquals(
      await resolveImportsPlugin.transform(makeTransformContext(code)),
      `import denoConfig from "/_vf_modules/_veryfront/_deno-config.js";`,
    );
    assertEquals(
      await resolveImportsPlugin.transform(makeTransformContext(code, "on:1")),
      `import denoConfig from "/_vf_modules/_pins/on%3A1/_veryfront/_deno-config.js";`,
    );
  });
});
