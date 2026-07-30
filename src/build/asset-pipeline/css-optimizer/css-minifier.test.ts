import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { expect } from "#std/expect.ts";
import {
  createTestCSSOptimizationEngine,
  withTestCSSOptimizationEngine,
} from "../../../../tests/_helpers/css-optimization-engine.ts";
import { minifyCSS } from "./css-minifier.ts";

describe("build/asset-pipeline/css-optimizer/css-minifier", () => {
  describe("minifyCSS", () => {
    it("delegates valid CSS through the optimization contract", async () => {
      await withTestCSSOptimizationEngine(
        createTestCSSOptimizationEngine((request) => {
          expect(request.sourcePath).toBe("generated.css");
          expect(request.minify).toBe(true);
          expect(request.sourceMap).toBe(false);
          expect(request.css).toContain("data:image/svg+xml;utf8,<svg></svg>");
          return { css: " optimized " };
        }),
        async () => {
          const result = await minifyCSS(`
        /* Header styles */
        .header {
          background: url("data:image/svg+xml;utf8,<svg></svg>");
          width: calc(100% - var(--gap, 1rem));
        }
      `);

          expect(result).toBe("optimized");
        },
      );
    });

    it("handles empty CSS", async () => {
      await withTestCSSOptimizationEngine(
        createTestCSSOptimizationEngine(),
        async () => {
          expect(await minifyCSS("")).toBe("");
        },
      );
    });

    it("rejects malformed CSS instead of publishing a regex fallback", async () => {
      await assertRejects(
        () => minifyCSS(".broken { /*"),
        Error,
      );
    });
  });
});
