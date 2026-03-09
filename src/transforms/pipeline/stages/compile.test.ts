import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compilePlugin } from "./compile.ts";
import { TransformStage } from "../types.ts";

describe("transforms/pipeline/stages/compile", () => {
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
});
