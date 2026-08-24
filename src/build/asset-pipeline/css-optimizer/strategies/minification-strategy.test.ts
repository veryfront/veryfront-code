import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MinificationStrategy } from "./minification-strategy.ts";
import type { CSSOptimizationRequest } from "#veryfront/extensions/css/index.ts";
import { createTestCSSOptimizationEngine } from "../../../../../tests/_helpers/css-optimization-engine.ts";

describe("build/asset-pipeline/css-optimizer/strategies/minification-strategy", () => {
  describe("MinificationStrategy", () => {
    let request: CSSOptimizationRequest | undefined;
    const strategy = new MinificationStrategy(
      createTestCSSOptimizationEngine((received) => {
        request = received;
        return { css: received.css.replaceAll(/\s+/g, "") };
      }),
    );

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
        assertEquals(
          result.code,
          "body{color:red;background:blue;}",
          "strategy returns the engine output verbatim",
        );
        assertEquals(request?.minify, true, "strategy must request minification");
        assertEquals(
          request?.sourcePath,
          "test.css",
          "strategy must forward the filename as sourcePath",
        );
        assertEquals(request?.sourceMap, false, "strategy must not request a source map");
        assertEquals(result.sourceMap, undefined, "minification emits no source map");
      });

      it("should return a resolved promise", async () => {
        const result = await strategy.process("a { b: c; }", "file.css", {});
        assertEquals(typeof result.code, "string");
      });
    });
  });
});
