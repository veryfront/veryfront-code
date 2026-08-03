import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertCSSCandidateToken, normalizeCSSCandidates } from "./css-candidate-admission.ts";
import { MAX_CSS_SELECTOR_TOKEN_CHARACTERS, MAX_CSS_SELECTOR_TOKENS } from "./constants/css.ts";

describe("CSS candidate admission", () => {
  it("snapshots dense arrays without invoking accessors or custom iteration", () => {
    let reads = 0;
    const accessor = ["alpha"];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        reads++;
        return "hostile";
      },
    });
    assertThrows(
      () => normalizeCSSCandidates(accessor),
      TypeError,
      "dense data-property array",
    );
    assertEquals(reads, 0);

    const customIterator = ["alpha", "beta"] as string[] & {
      [Symbol.iterator]: () => ArrayIterator<string>;
    };
    Object.defineProperty(customIterator, Symbol.iterator, {
      value: () => {
        reads++;
        return ["hostile"].values();
      },
    });
    assertThrows(
      () => normalizeCSSCandidates(customIterator),
      TypeError,
      "dense data-property array",
    );
    assertEquals(reads, 0);
  });

  it("rejects sparse arrays and Proxies before executing their hooks", () => {
    assertThrows(
      () => normalizeCSSCandidates(new Array(1)),
      TypeError,
      "dense data-property array",
    );

    let proxyHooks = 0;
    const proxy = new Proxy(["alpha"], {
      getOwnPropertyDescriptor() {
        proxyHooks++;
        throw new Error("must not run");
      },
      ownKeys() {
        proxyHooks++;
        throw new Error("must not run");
      },
    });
    assertThrows(() => normalizeCSSCandidates(proxy), TypeError, "must not be a Proxy");
    assertEquals(proxyHooks, 0);
  });

  it("reads genuine Sets through native slots and ignores overridden iteration", () => {
    let reads = 0;
    const candidates = new Set(["beta", "alpha"]);
    Object.defineProperty(candidates, "values", {
      get() {
        reads++;
        return () => ["hostile"].values();
      },
    });
    Object.defineProperty(candidates, Symbol.iterator, {
      get() {
        reads++;
        return () => ["hostile"].values();
      },
    });

    assertEquals(normalizeCSSCandidates(candidates), ["beta", "alpha"]);
    assertEquals(reads, 0);
  });

  it("rejects invalid tokens and bounded snapshots before retaining them", () => {
    for (const candidate of ["", "two words", "line\nbreak", "nul\0byte"]) {
      assertThrows(() => assertCSSCandidateToken(candidate), TypeError, "non-empty token");
    }
    assertThrows(
      () => assertCSSCandidateToken("x".repeat(MAX_CSS_SELECTOR_TOKEN_CHARACTERS + 1)),
      TypeError,
      "non-empty token",
    );
    assertThrows(
      () => normalizeCSSCandidates(new Array(MAX_CSS_SELECTOR_TOKENS + 1)),
      TypeError,
      "cannot exceed",
    );
  });

  it("uses captured admission intrinsics after global prototypes are poisoned", () => {
    const arrayInput = ["alpha", "beta", "alpha"];
    const setInput = new Set(["gamma"]);
    const originalApply = Reflect.apply;
    const originalIsArray = Array.isArray;
    const originalSafeInteger = Number.isSafeInteger;
    const originalRegExpTest = RegExp.prototype.test;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalSetAdd = Set.prototype.add;
    const originalSetHas = Set.prototype.has;
    const originalSetValues = Set.prototype.values;
    let normalizedArray: string[] | undefined;
    let normalizedSet: string[] | undefined;
    let invalidError: unknown;
    try {
      Reflect.apply = () => {
        throw new Error("poisoned Reflect.apply");
      };
      Array.isArray = (() => false) as unknown as typeof Array.isArray;
      Number.isSafeInteger = () => false;
      RegExp.prototype.test = () => false;
      String.prototype.charCodeAt = () => 0;
      Set.prototype.add = () => {
        throw new Error("poisoned Set.add");
      };
      Set.prototype.has = () => false;
      Set.prototype.values = () => {
        throw new Error("poisoned Set.values");
      };

      normalizedArray = normalizeCSSCandidates(arrayInput);
      normalizedSet = normalizeCSSCandidates(setInput);
      try {
        assertCSSCandidateToken("two words");
      } catch (error) {
        invalidError = error;
      }
    } finally {
      Reflect.apply = originalApply;
      Array.isArray = originalIsArray;
      Number.isSafeInteger = originalSafeInteger;
      RegExp.prototype.test = originalRegExpTest;
      String.prototype.charCodeAt = originalCharCodeAt;
      Set.prototype.add = originalSetAdd;
      Set.prototype.has = originalSetHas;
      Set.prototype.values = originalSetValues;
    }

    assertEquals(normalizedArray, ["alpha", "beta"]);
    assertEquals(normalizedSet, ["gamma"]);
    assertEquals(invalidError instanceof TypeError, true);
  });
});
