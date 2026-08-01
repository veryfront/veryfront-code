import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertCSSOptimizationEngine,
  captureCSSOptimizationEngine,
  type CSSOptimizationEngine,
  MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
} from "./css-optimization-engine.ts";

interface StatefulCSSOptimizationEngine extends CSSOptimizationEngine {
  marker: string;
}

function engine(): StatefulCSSOptimizationEngine {
  return {
    cacheIdentity: "test-css-optimization-engine@1",
    marker: "bound",
    optimize(request) {
      return { css: `${this.marker}:${request.css}` };
    },
  };
}

describe("CSSOptimizationEngine contract", () => {
  it("captures identity, method, implementation, and this binding once", () => {
    const value = engine();
    const captured = captureCSSOptimizationEngine(value);
    (value as { cacheIdentity: string }).cacheIdentity = "mutated";
    value.optimize = () => ({ css: "replacement" });

    assertEquals(captured.cacheIdentity, "test-css-optimization-engine@1");
    assertEquals(
      captured.optimize({
        css: "input",
        sourcePath: "input.css",
        minify: true,
        sourceMap: false,
      }).css,
      "bound:input",
    );
  });

  it("accepts inherited data methods without invoking adjacent accessors", () => {
    let reads = 0;
    const prototype = Object.create(null);
    Object.defineProperty(prototype, "optimize", {
      value: (request: { css: string }) => ({ css: request.css }),
    });
    Object.defineProperty(prototype, "unrelated", {
      get() {
        reads++;
        return "hostile";
      },
    });
    const value = Object.assign(Object.create(prototype), {
      cacheIdentity: "prototype-engine@1",
    });

    assertCSSOptimizationEngine(value);
    assertEquals(reads, 0);
  });

  it("rejects accessors and proxy inspection failures without invoking getters", () => {
    let identityReads = 0;
    const accessor = Object.defineProperty({}, "cacheIdentity", {
      get() {
        identityReads++;
        return "hostile";
      },
    });
    Object.defineProperty(accessor, "optimize", { value: engine().optimize });

    assertThrows(() => assertCSSOptimizationEngine(accessor), TypeError, "own data property");
    assertEquals(identityReads, 0);

    const proxy = new Proxy(engine(), {
      getOwnPropertyDescriptor() {
        throw new Error("blocked");
      },
    });
    assertThrows(
      () => assertCSSOptimizationEngine(proxy),
      TypeError,
      "properties could not be read",
    );
  });

  it("rejects accessor descriptors even when Object.prototype is polluted", () => {
    let inheritedValueReads = 0;
    let identityReads = 0;
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    const restoreDescriptor = previous === undefined
      ? undefined
      : Object.assign(Object.create(null), previous) as PropertyDescriptor;
    const accessor = Object.defineProperty({}, "cacheIdentity", {
      get() {
        identityReads++;
        return "hostile";
      },
    });
    Object.defineProperty(accessor, "optimize", { value: engine().optimize });
    try {
      Object.defineProperty(Object.prototype, "value", {
        configurable: true,
        get() {
          inheritedValueReads++;
          return "forged-data-descriptor";
        },
      });

      assertThrows(
        () => assertCSSOptimizationEngine(accessor),
        TypeError,
        "own data property",
      );
      assertEquals(inheritedValueReads, 0);
      assertEquals(identityReads, 0);
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(Object.prototype, "value");
      } else {
        Object.defineProperty(Object.prototype, "value", restoreDescriptor!);
      }
    }
  });

  it("rejects unstable or oversized identities", () => {
    for (
      const cacheIdentity of [
        "",
        " padded ",
        "line\nbreak",
        "line\u2028break",
        "unpaired\uD800surrogate",
        "e\u0301",
        "x".repeat(MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS + 1),
      ]
    ) {
      assertThrows(
        () => assertCSSOptimizationEngine({ ...engine(), cacheIdentity }),
        TypeError,
        "bounded stable cacheIdentity",
      );
    }
  });

  it("uses captured validation and invocation intrinsics", () => {
    const originalTrim = String.prototype.trim;
    const originalApply = Reflect.apply;
    let paddedIdentityError: unknown;
    let optimizedCSS: string | undefined;
    try {
      String.prototype.trim = function () {
        return String(this);
      };
      Reflect.apply = () => {
        throw new Error("poisoned Reflect.apply");
      };

      try {
        assertCSSOptimizationEngine({
          ...engine(),
          cacheIdentity: " padded ",
        });
      } catch (error) {
        paddedIdentityError = error;
      }
      optimizedCSS = captureCSSOptimizationEngine(engine()).optimize({
        css: "input",
        sourcePath: "input.css",
        minify: false,
        sourceMap: false,
      }).css;
    } finally {
      String.prototype.trim = originalTrim;
      Reflect.apply = originalApply;
    }

    assertEquals(paddedIdentityError instanceof TypeError, true);
    assertEquals(optimizedCSS, "bound:input");
  });
});
