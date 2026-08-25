import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createTestCSSOptimizationEngine,
  createTestCSSSourceMap,
} from "../../../../tests/_helpers/css-optimization-engine.ts";
import type { CSSOptimizationRequest } from "#veryfront/extensions/css/index.ts";
import { processWithCSSOptimization } from "./optimization-processor.ts";

describe("legacy batch CSS optimization boundary", () => {
  it("delegates the original stylesheet without regex preprocessing", () => {
    const css = '@import "tailwindcss";\n.btn { color: red; }';
    const engine = createTestCSSOptimizationEngine((request) => {
      assertEquals(request, {
        css,
        sourcePath: "styles/main.css",
        minify: false,
        sourceMap: false,
      });
      assertEquals(Object.isFrozen(request), true);
      return { css: request.css };
    });

    assertEquals(
      processWithCSSOptimization(css, {
        sourcePath: "styles/main.css",
        minify: false,
      }, engine),
      { css },
    );
  });

  it("preserves requested source maps through the neutral contract", () => {
    const sourceMap = createTestCSSSourceMap("styles/main.css");
    const engine = createTestCSSOptimizationEngine(() => ({
      css: ".btn{}",
      sourceMap,
    }));

    assertEquals(
      processWithCSSOptimization(".btn {}", {
        sourcePath: "styles/main.css",
        sourceMap: true,
      }, engine),
      { css: ".btn{}", sourceMap },
    );
  });

  it("defaults minify to true and sourceMap to false", () => {
    let observed: CSSOptimizationRequest | undefined;
    const engine = createTestCSSOptimizationEngine((request) => {
      observed = request;
      return { css: request.css };
    });

    processWithCSSOptimization(".btn {}", { sourcePath: "styles/main.css" }, engine);

    assertEquals(observed?.minify, true, "minify defaults to true when the caller omits it");
    assertEquals(
      observed?.sourceMap,
      false,
      "sourceMap defaults to false when the caller omits it",
    );
  });

  it("surfaces provider failures without a fallback", () => {
    const failure = new Error("provider failed");
    const engine = createTestCSSOptimizationEngine(() => {
      throw failure;
    });
    let thrown: unknown;
    try {
      processWithCSSOptimization(".btn {}", {
        sourcePath: "styles/main.css",
      }, engine);
    } catch (error) {
      thrown = error;
    }
    assertEquals(thrown, failure);

    assertThrows(
      () =>
        processWithCSSOptimization(".btn {}", {
          sourcePath: "../outside.css",
        }, createTestCSSOptimizationEngine()),
      TypeError,
      "safe canonical",
    );
  });
});
