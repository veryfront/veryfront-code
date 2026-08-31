import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import {
  buildImmutableL1Scope,
  createImmutableFileCacheL1,
  IMMUTABLE_L1_DEFAULT_MAX_ENTRIES,
  IMMUTABLE_L1_DEFAULT_MAX_TOTAL_BYTES,
  IMMUTABLE_L1_DEFAULT_MAX_VALUE_BYTES,
  IMMUTABLE_L1_DEFAULT_TTL_MS,
  IMMUTABLE_L1_MAX_ENTRIES_ENV_VAR,
  IMMUTABLE_L1_MAX_TOTAL_BYTES_ENV_VAR,
  IMMUTABLE_L1_MAX_TTL_MS,
  IMMUTABLE_L1_MAX_VALUE_BYTES_ENV_VAR,
  IMMUTABLE_L1_TTL_ENV_VAR,
  isImmutableReleaseFileCacheKey,
  resolveImmutableL1MaxEntries,
  resolveImmutableL1MaxTotalBytes,
  resolveImmutableL1MaxValueBytes,
  resolveImmutableL1Scope,
  resolveImmutableL1TtlMs,
  resolveOptionalImmutableL1Scope,
} from "./immutable-l1.ts";
import type { ResolvedCacheAuthority } from "./request-authority.ts";
import { runWithCacheKeyContext } from "./cache-key-builder.ts";

const RELEASE_KEY = "file:release:acme:rel_123:/app/page.tsx";
const HOUR_MS = 3_600_000;

function authority(token: string | null, projectRef: string | null): ResolvedCacheAuthority {
  return { token, projectRef, tokenSource: token ? "request" : "none" };
}

describe("isImmutableReleaseFileCacheKey", () => {
  it("admits a concrete release-scoped file key", () => {
    assertEquals(
      isImmutableReleaseFileCacheKey(RELEASE_KEY),
      true,
      "a release-scoped file key is immutable and must be admitted",
    );
    assertEquals(
      isImmutableReleaseFileCacheKey("file:release:acme:rel_123:a:b"),
      true,
      "a path carrying its own colons must not stop the key being recognized",
    );
  });

  it("refuses branch-scoped keys, which are the mutable ones", () => {
    assertEquals(
      isImmutableReleaseFileCacheKey("file:branch:acme:main:/app/page.tsx"),
      false,
      "branch-scoped content changes on every save and must always reach the backend",
    );
  });

  it("refuses a branch key that merely mentions release", () => {
    assertEquals(
      isImmutableReleaseFileCacheKey("file:branch:release:main:/app/page.tsx"),
      false,
      "the predicate must be anchored, not a scan for a release segment anywhere",
    );
    assertEquals(
      isImmutableReleaseFileCacheKey("file:branch:acme:main:/releases/page.tsx"),
      false,
      "a file path mentioning release must not qualify a mutable key",
    );
  });

  it("refuses every key shape outside the one it was built for", () => {
    const refused = [
      "file:env:acme:production:rel_123:/app/page.tsx",
      "stat:release:acme:rel_123:/app/page.tsx",
      "dir:release:acme:rel_123:/app",
      "files:release:acme:rel_123",
      "github:content:acme:rel_123:/app/page.tsx",
      "file:unknown",
      "resolve:acme:rel_123:/app/page.tsx",
      "",
      "file:release",
    ];

    for (const key of refused) {
      assertEquals(
        isImmutableReleaseFileCacheKey(key),
        false,
        `an unrecognized key shape must fail closed, but ${JSON.stringify(key)} was admitted`,
      );
    }
  });

  it("refuses an incomplete release key", () => {
    assertEquals(
      isImmutableReleaseFileCacheKey("file:release:acme:rel_123"),
      false,
      "a key with no path is a prefix, not a value, and must be refused",
    );
    assertEquals(
      isImmutableReleaseFileCacheKey("file:release:acme:rel_123:"),
      false,
      "an empty path must be refused",
    );
    assertEquals(
      isImmutableReleaseFileCacheKey("file:release::rel_123:/app/page.tsx"),
      false,
      "a missing project slug must be refused",
    );
    assertEquals(
      isImmutableReleaseFileCacheKey("file:release:acme::/app/page.tsx"),
      false,
      "a missing release id must be refused",
    );
  });

  it("refuses a key that could forge a scope boundary", () => {
    assertEquals(
      isImmutableReleaseFileCacheKey("file:release:acme:rel\u0000123:/app/page.tsx"),
      false,
      "a key carrying the scope separator must never be admitted",
    );
  });
});

describe("buildImmutableL1Scope", () => {
  it("refuses a scope with no project reference", () => {
    assertEquals(
      buildImmutableL1Scope("redis", authority("token-one", null)),
      null,
      "without a project reference an entry could be handed to any tenant",
    );
    assertEquals(
      buildImmutableL1Scope("redis", authority("token-one", "proj\u0000b")),
      null,
      "a project reference carrying the scope separator must be refused",
    );
  });

  it("separates two projects", () => {
    assertNotEquals(
      buildImmutableL1Scope("redis", authority("token-one", "proj-a")),
      buildImmutableL1Scope("redis", authority("token-one", "proj-b")),
      "two projects must never share a process-local scope",
    );
  });

  it("refuses an api-backed scope when no credential is present", () => {
    assertEquals(
      buildImmutableL1Scope("api", authority(null, "proj-a")),
      null,
      "a read the api backend would refuse for want of a credential must not be served from memory",
    );
    assertNotEquals(
      buildImmutableL1Scope("redis", authority(null, "proj-a")),
      null,
      "a redis backend authorizes by process-held credentials, so it still resolves a scope",
    );
  });

  it("separates two credentials on the same project", () => {
    const first = buildImmutableL1Scope("api", authority("credential-one", "proj-a"));
    const second = buildImmutableL1Scope("api", authority("credential-two", "proj-a"));

    assertNotEquals(first, null, "a present credential must produce a scope");
    assertNotEquals(first, second, "two credentials must never share a process-local scope");
    assertEquals(
      String(first).includes("credential-one"),
      false,
      "the scope must not carry the raw credential",
    );
  });
});

describe("resolveImmutableL1Scope", () => {
  it("refuses a scope when the request resolves no project reference", () => {
    assertEquals(
      resolveImmutableL1Scope("redis"),
      null,
      "an unattributable read must not touch the process-local tier",
    );
  });

  it("uses the project reference the current request resolves", () => {
    const scope = runWithCacheKeyContext(
      { projectId: "proj-a", mode: "production", versionId: "rel_1" },
      () => resolveImmutableL1Scope("redis"),
    );

    assertEquals(
      scope,
      buildImmutableL1Scope("redis", authority(null, "proj-a")),
      "the resolved scope must match the one built from the same authority",
    );
  });
});

describe("resolveOptionalImmutableL1Scope", () => {
  it("fails open when optional request authority resolution throws", () => {
    assertEquals(
      resolveOptionalImmutableL1Scope("redis", () => {
        throw new Error("request context unavailable");
      }),
      null,
      "an optional L1 scope failure must not suppress the backend read",
    );
  });
});

describe("resolveImmutableL1TtlMs", () => {
  const resolveTtl = (raw: string | undefined): number => resolveImmutableL1TtlMs(() => raw);

  it("uses the default when nothing is configured", () => {
    assertEquals(
      resolveTtl(undefined),
      IMMUTABLE_L1_DEFAULT_TTL_MS,
      "an unset override must leave the default lifetime in place",
    );
  });

  it("honors a configured lifetime at or below the maximum", () => {
    assertEquals(
      resolveTtl(String(IMMUTABLE_L1_MAX_TTL_MS)),
      IMMUTABLE_L1_MAX_TTL_MS,
      "a lifetime exactly at the maximum must be honored rather than clamped away",
    );
    assertEquals(
      resolveTtl("1500"),
      1500,
      "a lifetime below the maximum must be honored unchanged",
    );
  });

  it("clamps a configured lifetime above the maximum", () => {
    // 5000000 is the 5000 typo the clamp exists for: unclamped it buys 83
    // minutes of BOTH the credential-revocation window and the cross-pod
    // publish-visibility window.
    assertEquals(
      resolveTtl("5000000"),
      IMMUTABLE_L1_MAX_TTL_MS,
      "a lifetime above the maximum must be clamped to the maximum, not honored",
    );
    assertEquals(
      resolveTtl("999999999"),
      IMMUTABLE_L1_MAX_TTL_MS,
      "an 11-day lifetime must be clamped rather than widening both windows",
    );
  });

  it("falls back on an unsafe integer written in exponential notation", () => {
    assertEquals(
      resolveTtl("1e21"),
      IMMUTABLE_L1_DEFAULT_TTL_MS,
      "an unsafe integer lifetime must be rejected rather than rounded or clamped",
    );
  });

  it("rejects fractional overrides instead of rounding them", () => {
    const cases = [
      {
        name: IMMUTABLE_L1_TTL_ENV_VAR,
        fallback: IMMUTABLE_L1_DEFAULT_TTL_MS,
        resolve: resolveImmutableL1TtlMs,
      },
      {
        name: IMMUTABLE_L1_MAX_ENTRIES_ENV_VAR,
        fallback: IMMUTABLE_L1_DEFAULT_MAX_ENTRIES,
        resolve: resolveImmutableL1MaxEntries,
      },
      {
        name: IMMUTABLE_L1_MAX_VALUE_BYTES_ENV_VAR,
        fallback: IMMUTABLE_L1_DEFAULT_MAX_VALUE_BYTES,
        resolve: resolveImmutableL1MaxValueBytes,
      },
      {
        name: IMMUTABLE_L1_MAX_TOTAL_BYTES_ENV_VAR,
        fallback: IMMUTABLE_L1_DEFAULT_MAX_TOTAL_BYTES,
        resolve: resolveImmutableL1MaxTotalBytes,
      },
    ];

    for (const testCase of cases) {
      assertEquals(
        testCase.resolve(() => "0.5"),
        testCase.fallback,
        `${testCase.name} must not round a fractional override`,
      );
    }
  });

  it("still lets zero disable the tier outright", () => {
    assertEquals(
      resolveTtl("0"),
      0,
      "zero must keep disabling the tier, since the clamp is an upper bound only",
    );
  });

  it("still falls back on a value that is not a usable lifetime", () => {
    for (const raw of ["-1", "abc", "NaN", "Infinity", ""]) {
      assertEquals(
        resolveTtl(raw),
        IMMUTABLE_L1_DEFAULT_TTL_MS,
        `an unusable override (${JSON.stringify(raw)}) must fall back to the default lifetime`,
      );
    }
  });
});

describe("createImmutableFileCacheL1", () => {
  it("serves an admitted value back under the same scope", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    store.admit("scope-a", RELEASE_KEY, "held", store.beginRead(RELEASE_KEY), HOUR_MS);

    assertEquals(store.lookup("scope-a", RELEASE_KEY), "held", "an admitted value must be served");
    assertEquals(
      store.lookup("scope-b", RELEASE_KEY),
      null,
      "another scope must not reach the entry",
    );
  });

  it("stops serving an entry once its TTL has passed", async () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    store.admit("scope-a", RELEASE_KEY, "held", store.beginRead(RELEASE_KEY), 1);

    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      null,
      "an entry older than the TTL must not be served",
    );
  });

  it("expires an entry when the wall clock moves backward", () => {
    let elapsedNow = 100;
    let wallClockNow = 1_000;
    const store = createImmutableFileCacheL1({
      maxEntries: 8,
      elapsedNow: () => elapsedNow,
      wallClockNow: () => wallClockNow,
    });
    store.admit("scope-a", RELEASE_KEY, "held", store.beginRead(RELEASE_KEY), 1);

    wallClockNow -= HOUR_MS;
    elapsedNow += 2;
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      null,
      "a backward wall-clock adjustment must not extend the authorization window",
    );
  });

  it("admits nothing when the TTL is zero", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    store.admit("scope-a", RELEASE_KEY, "held", store.beginRead(RELEASE_KEY), 0);

    assertEquals(store.size, 0, "a zero TTL must disable the tier");
    assertEquals(store.lookup("scope-a", RELEASE_KEY), null, "a disabled tier must never serve");
  });

  it("refuses a non-finite TTL at admission", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });

    store.admit(
      "scope-a",
      RELEASE_KEY,
      "held",
      store.beginRead(RELEASE_KEY),
      Number.POSITIVE_INFINITY,
    );
    assertEquals(store.size, 0, "an Infinity TTL would stamp an entry that never expires");

    store.admit("scope-a", RELEASE_KEY, "held", store.beginRead(RELEASE_KEY), Number.NaN);
    assertEquals(store.size, 0, "a NaN TTL defeats the expiry comparison and must admit nothing");
  });

  it("refuses admission when the backend read consumed the whole TTL", async () => {
    // The TTL bounds staleness relative to a revocation or a publish, and both
    // can land while the read is still in flight, so expiry is anchored to the
    // read start the token recorded rather than to the response arrival.
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    const token = store.beginRead(RELEASE_KEY);

    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    store.admit("scope-a", RELEASE_KEY, "held", token, 1);

    assertEquals(
      store.size,
      0,
      "a read in flight past the whole TTL must admit nothing, or a slow read plus the TTL would exceed the documented staleness bound",
    );
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      null,
      "nothing may be served from a refused admission",
    );
  });

  it("counts time the read spent in flight against the entry's lifetime", async () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    const token = store.beginRead(RELEASE_KEY);

    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    store.admit("scope-a", RELEASE_KEY, "held", token, HOUR_MS);

    assertEquals(
      store.lookup("scope-a", RELEASE_KEY, 20),
      null,
      "a caller's maximum age must be measured from the read start, which is already past it",
    );
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY, HOUR_MS),
      "held",
      "the entry still serves callers whose lifetime covers the in-flight time",
    );
  });

  it("enforces the caller's own maximum age at lookup", async () => {
    // The store is process-global while TTLs are configured per FileCache
    // instance, so a caller with a shorter lifetime than the admitting
    // instance must not be served an entry past its own bound.
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    store.admit("scope-a", RELEASE_KEY, "held", store.beginRead(RELEASE_KEY), HOUR_MS);

    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY, 1),
      null,
      "a caller whose lifetime is 1ms must not be served a 25ms-old entry",
    );
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY, HOUR_MS),
      "held",
      "the entry itself must survive for callers whose lifetime still allows it",
    );
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      "held",
      "without a caller bound the admission-time expiry alone governs",
    );
  });

  it("evicts the least recently used entry once the count bound is passed", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 2 });
    const keyFor = (index: number): string => `file:release:acme:rel_1:/app/page-${index}.tsx`;

    store.admit("scope-a", keyFor(1), "one", store.beginRead(keyFor(1)), HOUR_MS);
    store.admit("scope-a", keyFor(2), "two", store.beginRead(keyFor(2)), HOUR_MS);
    // Touching entry 1 makes entry 2 the least recently used.
    assertEquals(store.lookup("scope-a", keyFor(1)), "one", "entry 1 must still be held");
    store.admit("scope-a", keyFor(3), "three", store.beginRead(keyFor(3)), HOUR_MS);

    assertEquals(store.size, 2, "the store must not grow past its entry bound");
    assertEquals(
      store.lookup("scope-a", keyFor(2)),
      null,
      "the least recently used entry is evicted",
    );
    assertEquals(store.lookup("scope-a", keyFor(1)), "one", "a recently used entry survives");
    assertEquals(store.lookup("scope-a", keyFor(3)), "three", "the newest entry is held");
  });

  it("refuses a value fetched before an invalidation of the same key", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    const token = store.beginRead(RELEASE_KEY);
    store.dropKey(RELEASE_KEY);
    store.admit("scope-a", RELEASE_KEY, "stale", token, HOUR_MS);

    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      null,
      "a read already in flight must not reinstate a value that was just invalidated",
    );
  });

  it("drops entries under an invalidated prefix and leaves the rest", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    const other = "file:release:acme:rel_2:/app/page.tsx";
    store.admit("scope-a", RELEASE_KEY, "held", store.beginRead(RELEASE_KEY), HOUR_MS);
    store.admit("scope-a", other, "other", store.beginRead(other), HOUR_MS);

    store.dropPrefix("file:release:acme:rel_123:");

    assertEquals(store.lookup("scope-a", RELEASE_KEY), null, "the matching entry is dropped");
    assertEquals(store.lookup("scope-a", other), "other", "an unrelated entry survives");
  });

  it("drops everything on clear", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    store.admit("scope-a", RELEASE_KEY, "held", store.beginRead(RELEASE_KEY), HOUR_MS);
    store.clear();

    assertEquals(store.size, 0, "clear must empty the store");
    assertEquals(store.lookup("scope-a", RELEASE_KEY), null, "nothing survives a clear");
  });

  it("evicts the entries a dropped key names, not just its generation", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    const other = "file:release:acme:rel_123:/app/layout.tsx";
    store.admit("scope-a", RELEASE_KEY, "held", store.beginRead(RELEASE_KEY), HOUR_MS);
    store.admit("scope-b", RELEASE_KEY, "held-b", store.beginRead(RELEASE_KEY), HOUR_MS);
    store.admit("scope-a", other, "other", store.beginRead(other), HOUR_MS);

    store.dropKey(RELEASE_KEY);

    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      null,
      "dropKey must evict the entry itself, not only bump the generation counter",
    );
    assertEquals(
      store.lookup("scope-b", RELEASE_KEY),
      null,
      "dropKey must evict that key under every scope holding it",
    );
    assertEquals(store.lookup("scope-a", other), "other", "an unrelated key survives dropKey");
  });

  it("refuses a value fetched before a prefix invalidation swept the store", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    const token = store.beginRead(RELEASE_KEY);
    // A prefix invalidation advances the sweep counter rather than one key's
    // generation, so only the sweep half of the token can refuse this.
    store.dropPrefix("file:release:acme:rel_123:");
    store.admit("scope-a", RELEASE_KEY, "stale", token, HOUR_MS);

    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      null,
      "a read in flight across a prefix invalidation must not be admitted",
    );
  });

  it("refuses a value fetched before a clear swept the store", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    const token = store.beginRead(RELEASE_KEY);
    store.clear();
    store.admit("scope-a", RELEASE_KEY, "stale", token, HOUR_MS);

    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      null,
      "a read in flight across a clear must not be admitted",
    );
  });

  it("refuses a value larger than the per-value ceiling", () => {
    // The ceiling is in bytes and a value is charged 2 bytes per code unit.
    const store = createImmutableFileCacheL1({ maxEntries: 8, maxValueBytes: 20 });

    store.admit("scope-a", RELEASE_KEY, "x".repeat(11), store.beginRead(RELEASE_KEY), HOUR_MS);
    assertEquals(
      store.size,
      0,
      "a value over the per-value ceiling must never be held, not even briefly",
    );
    assertEquals(store.retainedBytes, 0, "a refused value must charge no bytes");

    const fits = "y".repeat(10);
    store.admit("scope-a", RELEASE_KEY, fits, store.beginRead(RELEASE_KEY), HOUR_MS);
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      fits,
      "a value exactly at the per-value ceiling must still be admitted",
    );
    assertEquals(store.retainedBytes, 20, "a held value must charge its own byte count");
  });

  it("evicts in LRU order until the total-bytes ceiling is met", () => {
    // Four entries would fit the count bound but not the byte bound.
    const store = createImmutableFileCacheL1({
      maxEntries: 8,
      maxValueBytes: 20,
      maxTotalBytes: 40,
    });
    const keyFor = (index: number): string => `file:release:acme:rel_123:/asset-${index}.bin`;
    const value = "z".repeat(10);

    for (const index of [1, 2]) {
      store.admit("scope-a", keyFor(index), value, store.beginRead(keyFor(index)), HOUR_MS);
    }
    // Re-reading entry 1 moves it to the LRU tail, so entry 2 is the victim.
    assertEquals(store.lookup("scope-a", keyFor(1)), value, "the entry is warm before eviction");
    assertEquals(store.retainedBytes, 40, "two held values charge both their byte counts");

    store.admit("scope-a", keyFor(3), value, store.beginRead(keyFor(3)), HOUR_MS);

    assertEquals(store.retainedBytes, 40, "the byte total must stay at the ceiling");
    assertEquals(store.size, 2, "the byte bound must evict rather than grow the store");
    assertEquals(store.lookup("scope-a", keyFor(2)), null, "the least recently used entry goes");
    assertEquals(store.lookup("scope-a", keyFor(1)), value, "a recently used entry survives");
    assertEquals(store.lookup("scope-a", keyFor(3)), value, "the newest entry is held");
  });

  it("returns retained bytes to the total on every way an entry leaves", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8, maxValueBytes: 20 });
    const other = "file:release:acme:rel_2:/app/page.tsx";
    const value = "w".repeat(10);

    store.admit("scope-a", RELEASE_KEY, value, store.beginRead(RELEASE_KEY), HOUR_MS);
    store.admit("scope-a", other, value, store.beginRead(other), HOUR_MS);
    assertEquals(store.retainedBytes, 40, "both entries are charged");

    store.dropKey(RELEASE_KEY);
    assertEquals(store.retainedBytes, 20, "dropKey must return the entry's bytes");

    store.dropPrefix("file:release:acme:rel_2:");
    assertEquals(store.retainedBytes, 0, "dropPrefix must return the entry's bytes");

    store.admit("scope-a", RELEASE_KEY, value, store.beginRead(RELEASE_KEY), HOUR_MS);
    store.clear();
    assertEquals(store.retainedBytes, 0, "clear must reset the byte total");
  });

  it("admits nothing when a byte ceiling is zero", () => {
    const noValueBytes = createImmutableFileCacheL1({ maxEntries: 8, maxValueBytes: 0 });
    noValueBytes.admit(
      "scope-a",
      RELEASE_KEY,
      "held",
      noValueBytes.beginRead(RELEASE_KEY),
      HOUR_MS,
    );
    assertEquals(noValueBytes.size, 0, "a zero per-value ceiling must disable the tier");

    const noTotalBytes = createImmutableFileCacheL1({ maxEntries: 8, maxTotalBytes: 0 });
    noTotalBytes.admit(
      "scope-a",
      RELEASE_KEY,
      "held",
      noTotalBytes.beginRead(RELEASE_KEY),
      HOUR_MS,
    );
    assertEquals(noTotalBytes.size, 0, "a zero total-bytes ceiling must disable the tier");
  });

  it("falls back to the default when a byte ceiling is not finite", () => {
    // NaN and Infinity compare their way past every bound check, so honoring
    // a non-finite ceiling would disable eviction rather than raise a limit.
    const nanValueCeiling = createImmutableFileCacheL1({
      maxEntries: 8,
      maxValueBytes: Number.NaN,
    });
    const oversized = "x".repeat(IMMUTABLE_L1_DEFAULT_MAX_VALUE_BYTES / 2 + 1);
    nanValueCeiling.admit(
      "scope-a",
      RELEASE_KEY,
      oversized,
      nanValueCeiling.beginRead(RELEASE_KEY),
      HOUR_MS,
    );
    assertEquals(
      nanValueCeiling.size,
      0,
      "a NaN per-value ceiling must fall back to the default, not admit everything",
    );

    const nanTotalCeiling = createImmutableFileCacheL1({
      maxEntries: 8,
      maxValueBytes: 20,
      maxTotalBytes: Number.NaN,
    });
    nanTotalCeiling.admit(
      "scope-a",
      RELEASE_KEY,
      "y".repeat(11),
      nanTotalCeiling.beginRead(RELEASE_KEY),
      HOUR_MS,
    );
    assertEquals(
      nanTotalCeiling.size,
      0,
      "a NaN total ceiling must not blank the per-value ceiling through Math.min",
    );
  });

  it("keeps the entry-count bound when it is configured non-finite", () => {
    const store = createImmutableFileCacheL1({ maxEntries: Number.POSITIVE_INFINITY });
    for (let index = 0; index <= IMMUTABLE_L1_DEFAULT_MAX_ENTRIES; index++) {
      const key = `file:release:acme:rel_1:/f-${index}`;
      store.admit("scope-a", key, "v", store.beginRead(key), HOUR_MS);
    }

    assertEquals(
      store.size,
      IMMUTABLE_L1_DEFAULT_MAX_ENTRIES,
      "an Infinity entry bound must fall back to the default instead of disabling eviction",
    );
  });

  it("reports its entry ceiling for profiler stats", () => {
    assertEquals(
      createImmutableFileCacheL1({ maxEntries: 8 }).maxEntries,
      8,
      "the configured ceiling must be the one reported",
    );
    assertEquals(
      createImmutableFileCacheL1().maxEntries,
      IMMUTABLE_L1_DEFAULT_MAX_ENTRIES,
      "an unconfigured store must report the default ceiling",
    );
  });

  it("reclaims an expired entry without waiting for it to be touched", () => {
    let elapsedMs = 0;
    const store = createImmutableFileCacheL1({
      maxEntries: 8,
      maxValueBytes: 20,
      elapsedNow: () => elapsedMs,
    });
    const other = "file:release:acme:rel_2:/app/page.tsx";
    store.admit("scope-a", RELEASE_KEY, "e".repeat(10), store.beginRead(RELEASE_KEY), 1);
    store.admit("scope-a", other, "f".repeat(10), store.beginRead(other), HOUR_MS);

    elapsedMs = 1;
    assertEquals(store.evictExpired(), 1, "the sweep must reclaim exactly the expired entry");
    assertEquals(store.size, 1, "only the live entry may remain");
    assertEquals(
      store.retainedBytes,
      20,
      "the expired entry's bytes must be returned without a lookup ever touching it",
    );
    assertEquals(store.lookup("scope-a", other), "f".repeat(10), "the live entry still serves");
  });

  it("reclaims expired entries on admission instead of evicting live ones", () => {
    let elapsedMs = 0;
    const store = createImmutableFileCacheL1({
      maxEntries: 2,
      elapsedNow: () => elapsedMs,
    });
    const live = "file:release:acme:rel_2:/app/live.tsx";
    const incoming = "file:release:acme:rel_2:/app/incoming.tsx";
    // The live entry sits at the LRU head, so a purely LRU eviction would
    // take it while the expired entry behind it stays charged.
    store.admit("scope-a", live, "live", store.beginRead(live), HOUR_MS);
    store.admit("scope-a", RELEASE_KEY, "dying", store.beginRead(RELEASE_KEY), 1);

    elapsedMs = 1;
    store.admit("scope-a", incoming, "incoming", store.beginRead(incoming), HOUR_MS);

    assertEquals(store.size, 2, "the expired entry is reclaimed by the admission itself");
    assertEquals(
      store.lookup("scope-a", live),
      "live",
      "a live entry must not be evicted while an expired one still occupies the store",
    );
    assertEquals(store.lookup("scope-a", incoming), "incoming", "the new entry is held");
  });

  it("keeps enforcing the TTL when the wall clock steps backward", () => {
    // The TTL is the credential-revocation and publish-visibility bound, so a
    // wall clock stepped backward by NTP, a VM correction, or a manual
    // adjustment must not extend a held entry by the size of the step. The
    // store measures lifetimes on its monotonic elapsed clock; here that
    // clock is driven directly while admission happens under a wall clock an
    // hour ahead, whose restoration IS the backward step.
    let elapsedMs = 0;
    const store = createImmutableFileCacheL1({
      maxEntries: 8,
      elapsedNow: () => elapsedMs,
    });
    {
      using _time = new FakeTime(Date.now() + HOUR_MS);
      store.admit("scope-a", RELEASE_KEY, "held", store.beginRead(RELEASE_KEY), 5_000);
    }

    elapsedMs = 4_999;
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      "held",
      "a backward wall step must not stop the entry serving inside its TTL",
    );

    elapsedMs = 5_000;
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      null,
      "the entry must expire on its elapsed-time schedule although the wall clock stepped back an hour, or the step would widen the revocation window by its own size",
    );
  });

  it("expires on real elapsed time across a backward step of the default clock", async () => {
    // Same property through the default clock, with no seam: admission
    // happens while the wall clock reads an hour ahead, and restoring the
    // real clock IS the backward step. A wall-clock expiry would then hold
    // the entry for an hour plus its TTL; the monotonic default must expire
    // it after its TTL of real time.
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    {
      using _time = new FakeTime(Date.now() + HOUR_MS);
      store.admit("scope-a", RELEASE_KEY, "held", store.beginRead(RELEASE_KEY), 50);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      null,
      "the entry must expire after its TTL of real time although the wall clock stepped back an hour below its admission time",
    );
  });

  it("enforces a caller's maximum age on the monotonic elapsed clock", () => {
    let elapsedMs = 0;
    const store = createImmutableFileCacheL1({
      maxEntries: 8,
      elapsedNow: () => elapsedMs,
    });
    {
      using _time = new FakeTime(Date.now() + HOUR_MS);
      store.admit("scope-a", RELEASE_KEY, "held", store.beginRead(RELEASE_KEY), HOUR_MS);
    }

    elapsedMs = 2_500;
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY, 1_000),
      null,
      "a caller's own lifetime must be enforced on the elapsed clock, not on a wall clock now reading an hour before the admission",
    );
    assertEquals(
      store.lookup("scope-a", RELEASE_KEY, 10_000),
      "held",
      "the entry itself stays for callers whose lifetime still allows it",
    );
  });

  it("counts in-flight time on the elapsed clock at admission", () => {
    let elapsedMs = 0;
    const store = createImmutableFileCacheL1({
      maxEntries: 8,
      elapsedNow: () => elapsedMs,
    });
    // The wall clock stands still for the whole test; only the elapsed
    // clock records the read's five in-flight seconds.
    using _time = new FakeTime();
    const token = store.beginRead(RELEASE_KEY);
    elapsedMs = 5_000;
    store.admit("scope-a", RELEASE_KEY, "held", token, 5_000);

    assertEquals(
      store.size,
      0,
      "a read whose in-flight time consumed the whole TTL must admit nothing, however still the wall clock stood",
    );
  });

  it("drops only the branch a prefix reaches into, leaving sibling paths", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    const sibling = "file:release:acme:rel_123:/lib/util.ts";
    const otherRelease = "file:release:acme:rel_2:/app/page.tsx";
    store.admit("scope-a", RELEASE_KEY, "page", store.beginRead(RELEASE_KEY), HOUR_MS);
    store.admit("scope-a", sibling, "util", store.beginRead(sibling), HOUR_MS);
    store.admit("scope-a", otherRelease, "other", store.beginRead(otherRelease), HOUR_MS);

    // Longer than the release-qualified bucket, so this reaches INTO one
    // bucket and must check members instead of dropping the bucket whole.
    store.dropPrefix("file:release:acme:rel_123:/app/");

    assertEquals(
      store.lookup("scope-a", RELEASE_KEY),
      null,
      "the entry under the dropped path prefix goes",
    );
    assertEquals(
      store.lookup("scope-a", sibling),
      "util",
      "a sibling path in the same release survives a prefix reaching into it",
    );
    assertEquals(store.lookup("scope-a", otherRelease), "other", "another release is untouched");
  });

  it("drops every release under a prefix shorter than one release", () => {
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    const otherRelease = "file:release:acme:rel_2:/app/page.tsx";
    const otherProject = "file:release:zenith:rel_9:/app/page.tsx";
    store.admit("scope-a", RELEASE_KEY, "one", store.beginRead(RELEASE_KEY), HOUR_MS);
    store.admit("scope-a", otherRelease, "two", store.beginRead(otherRelease), HOUR_MS);
    store.admit("scope-a", otherProject, "three", store.beginRead(otherProject), HOUR_MS);

    // Shorter than any release-qualified bucket, so whole buckets fall.
    store.dropPrefix("file:release:acme:");

    assertEquals(store.lookup("scope-a", RELEASE_KEY), null, "the first release is dropped");
    assertEquals(
      store.lookup("scope-a", otherRelease),
      null,
      "every release of the project under the prefix is dropped",
    );
    assertEquals(
      store.lookup("scope-a", otherProject),
      "three",
      "another project's releases survive",
    );
    assertEquals(
      store.retainedBytes,
      "three".length * 2,
      "the dropped releases must return their bytes",
    );
  });

  it("drops a key too short to carry a release-qualified prefix", () => {
    // The store never sees such a key from FileCache, but the drop path must
    // not depend on the key shape admission happens to enforce today.
    const store = createImmutableFileCacheL1({ maxEntries: 8 });
    const short = "file:release";
    store.admit("scope-a", short, "short", store.beginRead(short), HOUR_MS);

    store.dropPrefix("file:");

    assertEquals(
      store.lookup("scope-a", short),
      null,
      "a key that is its own bucket must still fall under a shorter prefix",
    );
  });

  it("refuses a value larger than the whole store could hold", () => {
    // A per-value ceiling above the total ceiling must not let one admission
    // evict every other entry and then fail to fit anyway.
    const store = createImmutableFileCacheL1({
      maxEntries: 8,
      maxValueBytes: 1_000,
      maxTotalBytes: 40,
    });
    const other = "file:release:acme:rel_2:/app/page.tsx";
    store.admit("scope-a", other, "k".repeat(10), store.beginRead(other), HOUR_MS);

    store.admit("scope-a", RELEASE_KEY, "m".repeat(100), store.beginRead(RELEASE_KEY), HOUR_MS);

    assertEquals(store.lookup("scope-a", RELEASE_KEY), null, "the oversized value is refused");
    assertEquals(
      store.lookup("scope-a", other),
      "k".repeat(10),
      "refusing an oversized value must not churn the rest of the store out",
    );
  });
});
