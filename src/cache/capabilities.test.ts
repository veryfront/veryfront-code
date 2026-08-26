import "#veryfront/schemas/_test-setup.ts";

import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import * as backendBarrel from "./backend.ts";
import * as backendsBarrel from "./backends/index.ts";
import {
  buildRevisionedCacheKey,
  isRevisionedCacheBackend,
  isRevisionedCacheKey,
  MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH,
  requireCacheExchangeResult,
  REVISIONED_CACHE_KEY_PREFIX,
  snapshotCacheRevisionResult,
} from "./capabilities.ts";
import type { CacheBackend, RevisionedCacheBackend } from "./types.ts";
import type {
  CacheReadOptions as PublicCacheReadOptions,
  ResolvedCacheAuthority as PublicResolvedCacheAuthority,
} from "veryfront/extensions/distributed/cache-support";
import * as distributedCacheSupport from "../extensions/distributed/cache-support.ts";

const verifyPublicCacheSupportTypes = (
  options: PublicCacheReadOptions,
  authority: PublicResolvedCacheAuthority,
): void => options.onAuthority?.(authority);
void verifyPublicCacheSupportTypes;

function createOrdinaryBackend(): CacheBackend {
  return {
    type: "memory",
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    del: () => Promise.resolve(),
  };
}

function createRevisionedBackend(): RevisionedCacheBackend {
  return {
    ...createOrdinaryBackend(),
    getWithRevision: () => Promise.resolve({ value: null, revision: "r1" }),
    compareExchange: () => Promise.resolve(true),
  };
}

function narrowRevisionedBackend(
  backend: CacheBackend,
): RevisionedCacheBackend | null {
  return isRevisionedCacheBackend(backend) ? backend : null;
}

const verifyGuardRejectsUnknownAtCompileTime = (backend: unknown): void => {
  // @ts-expect-error The public guard accepts only a CacheBackend.
  isRevisionedCacheBackend(backend);
};
void verifyGuardRejectsUnknownAtCompileTime;

describe("revisioned cache capability", () => {
  it("keeps ordinary CacheBackend implementations valid", () => {
    const ordinary: CacheBackend = createOrdinaryBackend();

    assertEquals(isRevisionedCacheBackend(ordinary), false);
    assertStrictEquals(narrowRevisionedBackend(ordinary), null);
  });

  it("accepts a complete callable capability on own properties", () => {
    const backend: CacheBackend = {
      ...createOrdinaryBackend(),
      getWithRevision: async () => ({ value: null, revision: "r1" }),
      compareExchange: async () => true,
    };

    assertEquals(isRevisionedCacheBackend(backend), true);
  });

  it("accepts a complete callable capability inherited from a prototype", () => {
    class PrototypeBackend implements RevisionedCacheBackend {
      readonly type = "memory" as const;

      get(): Promise<string | null> {
        return Promise.resolve(null);
      }

      set(): Promise<void> {
        return Promise.resolve();
      }

      del(): Promise<void> {
        return Promise.resolve();
      }

      getWithRevision() {
        return Promise.resolve({ value: null, revision: "r1" });
      }

      compareExchange() {
        return Promise.resolve(true);
      }
    }

    assertEquals(isRevisionedCacheBackend(new PrototypeBackend()), true);
  });

  it("rejects missing, partial, and non-function capability groups", () => {
    const ordinary = createOrdinaryBackend();
    const cacheBackendCandidates: CacheBackend[] = [
      ordinary,
      { ...ordinary, getWithRevision: async () => ({ value: null, revision: "r1" }) },
      { ...ordinary, compareExchange: async () => true },
    ];
    const hostileRuntimeCandidates: CacheBackend[] = [
      {
        ...ordinary,
        getWithRevision: true,
        compareExchange: async () => true,
      } as unknown as CacheBackend,
      {
        ...ordinary,
        getWithRevision: async () => ({ value: null, revision: "r1" }),
        compareExchange: "yes",
      } as unknown as CacheBackend,
      null as unknown as CacheBackend,
      "cache" as unknown as CacheBackend,
    ];

    for (const candidate of [...cacheBackendCandidates, ...hostileRuntimeCandidates]) {
      assertEquals(isRevisionedCacheBackend(candidate), false);
    }
  });

  it("does not invoke capability accessors", () => {
    const backend = createOrdinaryBackend() as CacheBackend & Record<string, unknown>;
    let accessorReads = 0;
    Object.defineProperty(backend, "getWithRevision", {
      configurable: true,
      get() {
        accessorReads += 1;
        throw new Error("must not run");
      },
    });
    Object.defineProperty(backend, "compareExchange", {
      configurable: true,
      value: async () => true,
    });

    assertEquals(isRevisionedCacheBackend(backend), false);
    assertEquals(accessorReads, 0);
  });

  it("does not read capability properties through a proxy get trap", () => {
    const backend = createRevisionedBackend();
    let propertyReads = 0;
    const proxy = new Proxy(backend, {
      get(target, property, receiver) {
        if (property === "getWithRevision" || property === "compareExchange") {
          propertyReads += 1;
          throw new Error("must not run");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    assertEquals(isRevisionedCacheBackend(proxy), true);
    assertEquals(propertyReads, 0);
  });

  it("fails closed when proxy descriptor or prototype inspection throws", () => {
    const descriptorTrap = new Proxy(createRevisionedBackend(), {
      getOwnPropertyDescriptor() {
        throw new Error("descriptor trap");
      },
    });
    const prototypeTrap = new Proxy(createOrdinaryBackend(), {
      getPrototypeOf() {
        throw new Error("prototype trap");
      },
    });

    assertEquals(isRevisionedCacheBackend(descriptorTrap), false);
    assertEquals(isRevisionedCacheBackend(prototypeTrap), false);
  });

  it("fails closed when a proxy violates descriptor invariants", () => {
    const backend = createRevisionedBackend();
    Object.defineProperty(backend, "getWithRevision", {
      configurable: false,
      value: backend.getWithRevision,
    });
    const proxy = new Proxy(backend, {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property === "getWithRevision" && descriptor) {
          return { ...descriptor, configurable: true };
        }
        return descriptor;
      },
    });

    assertEquals(isRevisionedCacheBackend(proxy), false);
  });

  it("bounds prototype traversal when proxies manufacture fresh prototypes", () => {
    const expectedMaximumPrototypeDepth = 64;
    const testFuse = expectedMaximumPrototypeDepth * 4;
    let prototypeTrapCalls = 0;
    const createFreshProxy = (): CacheBackend =>
      new Proxy(createOrdinaryBackend(), {
        getPrototypeOf() {
          prototypeTrapCalls += 1;
          if (prototypeTrapCalls > testFuse) {
            throw new Error("test fuse stopped unbounded prototype traversal");
          }
          return createFreshProxy();
        },
      });

    assertEquals(isRevisionedCacheBackend(createFreshProxy()), false);
    assertEquals(prototypeTrapCalls, expectedMaximumPrototypeDepth);
  });
});

describe("cache revision result validation", () => {
  it("returns a detached frozen snapshot of exact own data properties", () => {
    const source = { value: "serialized\0bytes", revision: "r!~" };

    const snapshot = snapshotCacheRevisionResult(source);
    source.value = "changed";
    source.revision = "changed";

    assertEquals(snapshot, { value: "serialized\0bytes", revision: "r!~" });
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(snapshot === source, false);
  });

  it("accepts non-enumerable own data properties and revision boundaries", () => {
    const source = Object.create(null);
    Object.defineProperties(source, {
      value: { value: null },
      revision: { value: "!".repeat(256) },
    });

    assertEquals(snapshotCacheRevisionResult(source), {
      value: null,
      revision: "!".repeat(256),
    });
    assertEquals(snapshotCacheRevisionResult({ value: null, revision: "~" }), {
      value: null,
      revision: "~",
    });
  });

  it("rejects inherited, extra, and malformed fields", () => {
    const inherited = Object.create({ value: null, revision: "r1" });
    const invalidValues: unknown[] = [
      inherited,
      { value: null, revision: "r1", extra: true },
      { value: 1, revision: "r1" },
      { value: null, revision: "" },
      { value: null, revision: "contains space" },
      { value: null, revision: "line\nfeed" },
      { value: null, revision: "\x7f" },
      { value: null, revision: "r".repeat(257) },
      null,
      [],
    ];

    for (const value of invalidValues) {
      assertThrows(() => snapshotCacheRevisionResult(value), TypeError);
    }
  });

  it("rejects accessors without invoking them", () => {
    let accessorReads = 0;
    const source = { revision: "r1" } as Record<string, unknown>;
    Object.defineProperty(source, "value", {
      enumerable: true,
      get() {
        accessorReads += 1;
        throw new Error("must not run");
      },
    });

    assertThrows(() => snapshotCacheRevisionResult(source), TypeError);
    assertEquals(accessorReads, 0);
  });

  it("rejects trapping and invariant-violating proxies", () => {
    const ownKeysTrap = new Proxy({ value: null, revision: "r1" }, {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
    });
    const descriptorTrap = new Proxy({ value: null, revision: "r1" }, {
      getOwnPropertyDescriptor() {
        throw new Error("descriptor trap");
      },
    });
    const fixed = Object.preventExtensions({ value: null, revision: "r1" });
    const invariantTrap = new Proxy(fixed, {
      ownKeys() {
        return ["value"];
      },
    });

    for (const value of [ownKeysTrap, descriptorTrap, invariantTrap]) {
      assertThrows(() => snapshotCacheRevisionResult(value), TypeError);
    }
  });

  it("accepts a transparent proxy because it is observationally transparent", () => {
    const source = new Proxy({ value: "payload", revision: "r1" }, {});

    assertEquals(snapshotCacheRevisionResult(source), {
      value: "payload",
      revision: "r1",
    });
  });

  it("accepts only boolean exchange results", () => {
    assertStrictEquals(requireCacheExchangeResult(true), true);
    assertStrictEquals(requireCacheExchangeResult(false), false);

    for (const value of [0, 1, "true", null, undefined, {}, []]) {
      assertThrows(() => requireCacheExchangeResult(value), TypeError);
    }
  });
});

describe("revisioned cache key namespace", () => {
  it("builds injective versioned keys and identifies only built keys", () => {
    const first = buildRevisionedCacheKey("a");
    const second = buildRevisionedCacheKey("aa");

    assertEquals(first, "vf:revisioned:v1:a");
    assertEquals(second, "vf:revisioned:v1:aa");
    assertEquals(first === second, false);
    assertEquals(isRevisionedCacheKey(first), true);
    assertEquals(isRevisionedCacheKey(second), true);
    assertEquals(REVISIONED_CACHE_KEY_PREFIX, "vf:revisioned:v1:");
  });

  it("accepts the exact source-key length boundary", () => {
    const source = "x".repeat(MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH);
    const key = buildRevisionedCacheKey(source);

    assertEquals(key, `${REVISIONED_CACHE_KEY_PREFIX}${source}`);
    assertEquals(isRevisionedCacheKey(key), true);
  });

  it("rejects empty, control-bearing, oversized, non-string, and reserved input", () => {
    const invalid: unknown[] = [
      "",
      "nul\0key",
      "line\nkey",
      "delete\x7fkey",
      "x".repeat(MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH + 1),
      `${REVISIONED_CACHE_KEY_PREFIX}already-reserved`,
      null,
      1,
    ];

    for (const value of invalid) {
      assertThrows(() => buildRevisionedCacheKey(value as string));
    }
  });

  it("rejects strings outside the builder image in the key predicate", () => {
    const invalid: unknown[] = [
      "ordinary:key",
      REVISIONED_CACHE_KEY_PREFIX,
      `${REVISIONED_CACHE_KEY_PREFIX}line\nkey`,
      `${REVISIONED_CACHE_KEY_PREFIX}${"x".repeat(MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH + 1)}`,
      `${REVISIONED_CACHE_KEY_PREFIX}${REVISIONED_CACHE_KEY_PREFIX}nested`,
      null,
    ];

    for (const value of invalid) {
      assertEquals(isRevisionedCacheKey(value), false);
    }
  });
});

describe("revisioned cache exports", () => {
  it("re-exports runtime capability support from internal and extension barrels", () => {
    for (const barrel of [backendBarrel, backendsBarrel, distributedCacheSupport]) {
      assertStrictEquals(barrel.buildRevisionedCacheKey, buildRevisionedCacheKey);
      assertStrictEquals(barrel.isRevisionedCacheBackend, isRevisionedCacheBackend);
      assertStrictEquals(barrel.isRevisionedCacheKey, isRevisionedCacheKey);
      assertStrictEquals(barrel.requireCacheExchangeResult, requireCacheExchangeResult);
      assertStrictEquals(barrel.snapshotCacheRevisionResult, snapshotCacheRevisionResult);
      assertEquals(barrel.REVISIONED_CACHE_KEY_PREFIX, REVISIONED_CACHE_KEY_PREFIX);
      assertEquals(
        barrel.MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH,
        MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH,
      );
      assertEquals(barrel.MAX_CACHE_REVISION_LENGTH, 256);
    }
  });
});
