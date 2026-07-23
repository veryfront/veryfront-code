import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { compilePlugin } from "./compile.ts";
import { TransformStage } from "../types.ts";
import type { TransformContext } from "../types.ts";

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

  it("does not expose source text or absolute paths in compilation errors", async () => {
    const sourceSecret = "source-secret-value";
    const code = `const token = "${sourceSecret}";\nconst broken = ;`;
    const ctx = {
      code,
      originalSource: code,
      filePath: "/private/project/pages/private.ts",
      projectDir: "/private/project",
      projectId: "project",
      target: "ssr",
      dev: true,
      contentHash: "hash",
      jsxImportSource: "react",
      timing: new Map(),
      debug: false,
      metadata: new Map(),
      reactVersion: "19.2.4",
    } as TransformContext;

    let thrown: unknown;
    try {
      await compilePlugin.transform(ctx);
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof Error);
    const serialized = `${String(thrown)} ${JSON.stringify(thrown)}`;
    assertEquals(serialized.includes(sourceSecret), false);
    assertEquals(serialized.includes("/private/project"), false);
    assertEquals(serialized.includes("pages/private.ts"), true);
  });
});
