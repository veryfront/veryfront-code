import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parsePlugin } from "./parse.ts";
import { TransformStage } from "../types.ts";
import { isMDX } from "../context.ts";

describe("transforms/pipeline/stages/parse", () => {
  describe("parsePlugin metadata", () => {
    it("has name 'parse-mdx'", () => {
      assertEquals(parsePlugin.name, "parse-mdx");
    });

    it("runs at PARSE stage", () => {
      assertEquals(parsePlugin.stage, TransformStage.PARSE);
    });

    it("has a transform function", () => {
      assertExists(parsePlugin.transform);
      assertEquals(typeof parsePlugin.transform, "function");
    });

    it("has condition set to isMDX", () => {
      assertEquals(parsePlugin.condition, isMDX);
    });
  });
});
