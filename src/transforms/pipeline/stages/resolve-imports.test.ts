import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveImportsPlugin } from "./resolve-imports.ts";
import { TransformStage } from "../types.ts";

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
});
