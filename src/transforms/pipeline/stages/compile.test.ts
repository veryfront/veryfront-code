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
    // esbuild lowers to es2020, which pre-dates import attributes. Without an
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

    // `assert { type: "json" }` is the withdrawn spelling of the same clause.
    // esbuild treats it as its own feature and drops it even when import
    // attributes are enabled, so the compiler upgrades it to `with` instead.
    // Emitting `assert` verbatim is not an option: Node 22 and Deno 2 reject
    // the keyword outright.
    it("upgrades a legacy static assertion to an import attribute", async () => {
      const result = await compilePlugin.transform(
        createContext(
          `import manifest from "./manifest.json" assert { type: "json" };\nexport const x = manifest;`,
        ),
      );

      assertStringIncludes(result, 'with { type: "json" }');
      assertEquals(result.includes("assert"), false);
    });

    it("upgrades a legacy assertion on a re-export", async () => {
      const result = await compilePlugin.transform(
        createContext(`export { name } from "./manifest.json" assert { type: "json" };`),
      );

      assertStringIncludes(result, 'with { type: "json" }');
      assertEquals(result.includes("assert"), false);
    });

    it("upgrades a legacy assertion on a dynamic import", async () => {
      const result = await compilePlugin.transform(
        createContext(
          `export async function load() { return await import("./manifest.json", { assert: { type: "json" } }); }`,
        ),
      );

      assertStringIncludes(result, 'with: { type: "json" }');
      assertEquals(result.includes("assert"), false);
    });

    it("leaves import-like text inside a string literal alone", async () => {
      const source = 'export const TPL = `import d from "./a.json" assert { type: "json" };`;\n';
      const result = await compilePlugin.transform(createContext(source));

      assertStringIncludes(result, 'import d from "./a.json" assert { type: "json" };');
    });
  });

  describe("modern ESM syntax", () => {
    it("accepts top-level await in framework server modules", async () => {
      const result = await compilePlugin.transform(
        createContext(
          `const serverMode = await Promise.resolve("production");\nexport { serverMode };`,
          "/project/src/server/production-server.ts",
        ),
      );

      assertStringIncludes(result, 'await Promise.resolve("production")');
    });
  });
});
