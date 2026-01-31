import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MinificationStrategy } from "./minification-strategy.ts";

describe("build/asset-pipeline/css-optimizer/strategies/minification-strategy", () => {
  describe("MinificationStrategy", () => {
    const strategy = new MinificationStrategy();

    it("should have correct name and priority", () => {
      assertEquals(strategy.name, "basic-minification");
      assertEquals(strategy.priority, 10);
    });

    describe("canProcess", () => {
      it("should return true when enabled and minify not disabled", () => {
        assertEquals(strategy.canProcess({}), true);
        assertEquals(strategy.canProcess({ enabled: true }), true);
      });

      it("should return false when disabled", () => {
        assertEquals(strategy.canProcess({ enabled: false }), false);
      });

      it("should return false when minify is false", () => {
        assertEquals(strategy.canProcess({ minify: false }), false);
      });
    });

    describe("process", () => {
      it("should minify CSS content", async () => {
        const input = `body {
  color: red;
  background: blue;
}`;
        const result = await strategy.process(input, "test.css", {});
        assertEquals(typeof result.code, "string");
        assertEquals(result.code.length <= input.length, true);
        assertEquals(result.sourceMap, undefined);
      });

      it("should return a resolved promise", async () => {
        const result = await strategy.process("a { b: c; }", "file.css", {});
        assertEquals(typeof result.code, "string");
      });
    });
  });
});
