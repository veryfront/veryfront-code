// This security boundary test intentionally mutates shared-realm prototypes,
// so it belongs in the semantic integration suite rather than a unit module.
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RunStopRegistry } from "#veryfront/internal-agents/run-stop-registry.ts";

describe("run stop registry intrinsic boundary", () => {
  it("still aborts and acknowledges an owned execution after project poisoning", () => {
    const registry = new RunStopRegistry();
    let aborts = 0;
    const settle = registry.register("run_poisoned", () => {
      aborts++;
    });
    const nativeMapGet = Map.prototype.get;
    const nativeMapHas = Map.prototype.has;
    const nativeMapSet = Map.prototype.set;
    const nativeSetHas = Set.prototype.has;
    const nativeSetAdd = Set.prototype.add;
    const nativeSetDelete = Set.prototype.delete;
    const nativeSetIterator = Set.prototype[Symbol.iterator];
    const nativeMapIterator = Map.prototype[Symbol.iterator];
    const nativeNow = Date.now;
    let first: ReturnType<RunStopRegistry["requestStop"]> | undefined;
    let second: ReturnType<RunStopRegistry["requestStop"]> | undefined;
    let pastExpiry: ReturnType<RunStopRegistry["requestStop"]> | undefined;
    let observed = 0;

    try {
      Map.prototype.get = function () {
        observed++;
        return undefined;
      };
      Map.prototype.has = function () {
        observed++;
        return false;
      };
      Map.prototype.set = function () {
        observed++;
        throw new Error("poisoned Map.prototype.set");
      };
      Set.prototype.has = function () {
        observed++;
        return false;
      };
      Set.prototype.add = function () {
        observed++;
        throw new Error("poisoned Set.prototype.add");
      };
      Set.prototype.delete = function () {
        observed++;
        return false;
      };
      Set.prototype[Symbol.iterator] = function () {
        observed++;
        return [][Symbol.iterator]();
      };
      Map.prototype[Symbol.iterator] = function () {
        observed++;
        return [][Symbol.iterator]();
      };
      // A clock moved far ahead must not expire the tombstone early.
      Date.now = () => nativeNow() + 48 * 60 * 60 * 1_000;

      first = registry.requestStop("run_poisoned");
      settle();
      second = registry.requestStop("run_poisoned");
      pastExpiry = registry.requestStop("run_poisoned");
    } finally {
      Map.prototype.get = nativeMapGet;
      Map.prototype.has = nativeMapHas;
      Map.prototype.set = nativeMapSet;
      Set.prototype.has = nativeSetHas;
      Set.prototype.add = nativeSetAdd;
      Set.prototype.delete = nativeSetDelete;
      Set.prototype[Symbol.iterator] = nativeSetIterator;
      Map.prototype[Symbol.iterator] = nativeMapIterator;
      Date.now = nativeNow;
    }

    assertEquals(first, { accepted: true, stopped: false });
    assertEquals(aborts, 1);
    assertEquals(second, { accepted: true, stopped: true });
    assertEquals(pastExpiry, { accepted: true, stopped: true });
    assertEquals(observed, 0);
  });
});
