import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { finalizePlugin } from "./finalize.ts";
import { TransformStage } from "../types.ts";

describe("transforms/pipeline/stages/finalize", () => {
  describe("finalizePlugin metadata", () => {
    it("has name 'finalize'", () => {
      assertEquals(finalizePlugin.name, "finalize");
    });

    it("runs at FINALIZE stage", () => {
      assertEquals(finalizePlugin.stage, TransformStage.FINALIZE);
    });

    it("has a transform function", () => {
      assertExists(finalizePlugin.transform);
      assertEquals(typeof finalizePlugin.transform, "function");
    });

    it("has no condition", () => {
      assertEquals(finalizePlugin.condition, undefined);
    });
  });
});
