import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeCSSCandidates } from "./css-candidate-admission.ts";

describe("utils/css-candidate-admission", () => {
  it("snapshots dense data-property arrays and deduplicates them", () => {
    const input = ["flex", "grid", "flex"];

    assertEquals(normalizeCSSCandidates(input), ["flex", "grid"]);
  });

  it("rejects proxied, sparse, and accessor-backed arrays without invoking hooks", () => {
    let proxyTraps = 0;
    const proxied = new Proxy(["flex"], {
      get() {
        proxyTraps++;
        throw new Error("must not run");
      },
      ownKeys() {
        proxyTraps++;
        throw new Error("must not run");
      },
    });
    assertThrows(
      () => normalizeCSSCandidates(proxied),
      TypeError,
      "must not be a Proxy",
    );
    assertEquals(proxyTraps, 0);

    assertThrows(
      () => normalizeCSSCandidates(new Array(1)),
      TypeError,
      "dense data-property array",
    );

    let getterCalls = 0;
    const accessor = ["safe"];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        getterCalls++;
        return "unsafe";
      },
    });
    assertThrows(
      () => normalizeCSSCandidates(accessor),
      TypeError,
      "dense data-property array",
    );
    assertEquals(getterCalls, 0);
  });

  it("reads genuine Sets through captured intrinsics without subclass hooks", () => {
    let hookCalls = 0;
    class HookedSet extends Set<string> {
      override values(): SetIterator<string> {
        hookCalls++;
        throw new Error("must not run");
      }

      override [Symbol.iterator](): SetIterator<string> {
        hookCalls++;
        throw new Error("must not run");
      }
    }
    const input = new HookedSet(["flex", "grid"]);
    Object.defineProperty(input, "size", {
      get() {
        hookCalls++;
        throw new Error("must not run");
      },
    });

    assertEquals(normalizeCSSCandidates(input), ["flex", "grid"]);
    assertEquals(hookCalls, 0);
  });

  it("rejects proxied Sets without invoking their traps", () => {
    let trapCalls = 0;
    const proxied = new Proxy(new Set(["flex"]), {
      get() {
        trapCalls++;
        throw new Error("must not run");
      },
      getPrototypeOf() {
        trapCalls++;
        throw new Error("must not run");
      },
    });

    assertThrows(
      () => normalizeCSSCandidates(proxied),
      TypeError,
      "must not be a Proxy",
    );
    assertEquals(trapCalls, 0);
  });
});
