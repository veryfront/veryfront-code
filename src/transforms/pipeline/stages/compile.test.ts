import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { compilePlugin } from "./compile.ts";
import { TransformStage } from "../types.ts";
import type { TransformContext } from "../types.ts";

function createContext(code: string, filePath = "/project/lib/x.ts"): TransformContext {
  return {
    code,
    originalSource: code,
    filePath,
    projectDir: "/project",
    projectId: "project",
    target: "ssr",
    dev: true,
    contentHash: "hash",
    jsxImportSource: "react",
    timing: new Map(),
    debug: false,
    metadata: new Map(),
    reactVersion: "19.1.1",
  } as TransformContext;
}

describe("transforms/pipeline/stages/compile", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  describe("compilePlugin metadata", () => {
    it("has name 'esbuild-compile'", () => {
      assertEquals(compilePlugin.name, "esbuild-compile");
    });

    it("runs at COMPILE stage", () => {
      assertEquals(compilePlugin.stage, TransformStage.COMPILE);
    });

    it("has a transform function", () => {
      assertExists(compilePlugin.transform);
      assertEquals(typeof compilePlugin.transform, "function");
    });

    it("has no condition (always runs)", () => {
      assertEquals(compilePlugin.condition, undefined);
    });
  });

  describe("import attributes", () => {
    // esbuild lowers to es2020, which pre-dates import attributes — without an
    // explicit `supported` override it silently drops `with { type: "json" }`,
    // and the runtime then refuses the module with "Attempted to load JSON
    // module without specifying \"type\": \"json\"".
    it('preserves `with { type: "json" }` on a static import', async () => {
      const result = await compilePlugin.transform(
        createContext(
          `import manifest from "./manifest.json" with { type: "json" };\nexport const x = manifest;`,
        ),
      );

      assertStringIncludes(result, 'with { type: "json" }');
    });

    it("preserves the attribute on a dynamic import", async () => {
      const result = await compilePlugin.transform(
        createContext(
          `export async function load() { return await import("./manifest.json", { with: { type: "json" } }); }`,
        ),
      );

      assertStringIncludes(result, 'type: "json"');
    });
  });
});
