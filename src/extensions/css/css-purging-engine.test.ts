import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertCSSPurgingEngine,
  captureCSSPurgingEngine,
  type CSSPurgingEngine,
  MAX_CSS_PURGING_ENGINE_IDENTITY_CHARACTERS,
} from "./css-purging-engine.ts";

interface StatefulCSSPurgingEngine extends CSSPurgingEngine {
  marker: string;
}

function engine(): StatefulCSSPurgingEngine {
  return {
    cacheIdentity: "test-css-purging-engine@1",
    marker: "bound",
    purge(request) {
      return Promise.resolve({
        css: `${this.marker}:${request.css}`,
        ...(request.includeRejectedCSS ? { rejectedCSS: "rejected" } : {}),
      });
    },
  };
}

describe("CSSPurgingEngine contract", () => {
  it("captures identity, method, implementation, and this binding once", async () => {
    const value = engine();
    const captured = captureCSSPurgingEngine(value);
    (value as { cacheIdentity: string }).cacheIdentity = "mutated";
    value.purge = () => Promise.resolve({ css: "replacement" });

    assertEquals(captured.cacheIdentity, "test-css-purging-engine@1");
    assertEquals(
      Object.isFrozen(captured),
      true,
      "captured purging engine must be a frozen snapshot",
    );
    assertEquals(
      (await captured.purge({
        css: "input",
        content: [],
        safelist: [],
        includeRejectedCSS: false,
      })).css,
      "bound:input",
    );
  });

  it("rejects method accessors and cyclic prototypes without invoking getters", () => {
    let methodReads = 0;
    const accessor = { cacheIdentity: "accessor-engine@1" };
    Object.defineProperty(accessor, "purge", {
      get() {
        methodReads++;
        return engine().purge;
      },
    });

    assertThrows(() => assertCSSPurgingEngine(accessor), TypeError, "data property");
    assertEquals(methodReads, 0);

    const cyclic: object = new Proxy(
      { cacheIdentity: "cyclic-engine@1" },
      { getPrototypeOf: () => cyclic },
    );
    assertThrows(
      () => assertCSSPurgingEngine(cyclic),
      TypeError,
      "properties could not be read",
    );
  });

  it("rejects arrays, missing methods, and unstable identities", () => {
    assertThrows(() => assertCSSPurgingEngine([]), TypeError, "must be an object");
    assertThrows(
      () => assertCSSPurgingEngine({ cacheIdentity: "missing-method@1" }),
      TypeError,
      "purge must be a data property",
    );

    for (
      const cacheIdentity of [
        "",
        " padded ",
        "x".repeat(MAX_CSS_PURGING_ENGINE_IDENTITY_CHARACTERS + 1),
      ]
    ) {
      assertThrows(
        () => assertCSSPurgingEngine({ ...engine(), cacheIdentity }),
        TypeError,
        "bounded stable cacheIdentity",
      );
    }
  });
});
