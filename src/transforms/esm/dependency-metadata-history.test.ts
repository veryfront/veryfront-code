import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureDependencyMetadataHistory,
  selectCapturedHistoricalDependencySnapshot,
  selectHistoricalDependencySnapshot,
} from "./dependency-metadata-history.ts";
import {
  applyConfiguredDependencyOverrides,
  DEPENDENCY_SNAPSHOT_MAX_BYTES,
  hashDependencyPins,
} from "./dependency-snapshot.ts";

const now = 100_000;
const scope = { projectId: "synthetic-project", branch: null };
const emptyKey = `on:${hashDependencyPins({})}`;
function history(dependencies: Record<string, string> = {}, expiresAt = now + 60_000) {
  return { version: 1, ...scope, entries: [{ dependencies, expiresAt }] };
}
function select(value: unknown, key = emptyKey) {
  return selectHistoricalDependencySnapshot(value, scope, key, undefined, now);
}

describe("API-derived dependency metadata history", () => {
  it("retains only immutable validated fields instead of the provider response", () => {
    const source = { ...history({ react: "19.2.4" }), ignored: "x".repeat(2 * 1024 * 1024) };
    const captured = captureDependencyMetadataHistory(source, scope, now);
    source.entries[0]!.dependencies.react = "18.3.1";
    source.entries.length = 0;
    assertEquals(captured.value.entries[0]?.dependencies.react, "19.2.4");
    assertEquals(Object.hasOwn(captured.value, "ignored"), false);
    assertEquals(captured.bytes < 1024, true);
    assertEquals(Object.isFrozen(captured.value), true);
    assertEquals(Object.isFrozen(captured.value.entries), true);
    assertEquals(Object.isFrozen(captured.value.entries[0]), true);
    assertEquals(Object.isFrozen(captured.value.entries[0]?.dependencies), true);
  });

  it("rechecks cached scope and expiry without extending acknowledged retention", () => {
    const captured = captureDependencyMetadataHistory(history({}, now + 500), scope, now);
    assertEquals(
      selectCapturedHistoricalDependencySnapshot(
        captured.value,
        scope,
        emptyKey,
        undefined,
        now,
      )?.snapshot.cacheKey,
      emptyKey,
    );
    assertEquals(
      selectCapturedHistoricalDependencySnapshot(
        captured.value,
        scope,
        emptyKey,
        undefined,
        now + 500,
      ),
      undefined,
    );
    assertThrows(() =>
      selectCapturedHistoricalDependencySnapshot(
        captured.value,
        { ...scope, projectId: "another-project" },
        emptyKey,
        undefined,
        now,
      )
    );
  });

  it("reconstructs the exact prior empty map with its acknowledged expiry", () => {
    const result = select(history());
    assertEquals(result?.snapshot.cacheKey, "on:54uvgwr2ih7p");
    assertEquals({ ...result?.snapshot.dependencies }, {});
    assertEquals(result?.expiresAt, now + 60_000);
  });

  it("combines raw history with captured configuration before matching", () => {
    const dependencies = { react: "^18", veryfront: "~0.1.1", other: "^2" };
    const config = {
      react: { declaration: "^19.2.4", effective: "19.2.4" },
      veryfront: { declaration: "^0.1.1258", effective: "0.1.1258" },
    };
    const effective = applyConfiguredDependencyOverrides(dependencies, config);
    const key = `on:${hashDependencyPins(effective, config)}`;
    const result = selectHistoricalDependencySnapshot(
      history(dependencies),
      scope,
      key,
      config,
      now,
    );
    assertEquals(result?.snapshot.cacheKey, key);
    assertEquals({ ...result?.snapshot.dependencies }, effective);
    assertEquals(result?.snapshot.configuredVersions, config);
    assertEquals(
      selectHistoricalDependencySnapshot(history(dependencies), scope, key, undefined, now),
      undefined,
      "a config change must not reinterpret the old key",
    );
  });

  it("does not use the newest map when no historical map matches", () => {
    assertEquals(select(history({ react: "19.2.4" })), undefined);
    assertEquals(select({ version: 1, ...scope, entries: [] }), undefined);
  });

  it("does not resurrect expired history", () => {
    assertEquals(select(history({}, now)), undefined);
  });

  for (
    const bad of [
      null,
      { ...history(), version: 2 },
      { ...history(), projectId: "another-project" },
      { ...history(), branch: "feature" },
      { ...history(), entries: Array.from({ length: 17 }, () => history().entries[0]) },
      history({}, Number.NaN),
      history({}, now + 24 * 60 * 60 * 1000 + 1),
      history({}, 1.5),
      { ...history(), entries: [{ dependencies: { react: 123 }, expiresAt: now + 1000 }] },
      { ...history(), entries: [{ dependencies: [], expiresAt: now + 1000 }] },
    ]
  ) {
    it("rejects invalid or cross-scope metadata without a fallback", () => {
      assertThrows(() => select(bad), Error);
    });
  }

  it("requires the exact named branch", () => {
    const branchScope = { ...scope, branch: "feature-one" };
    const value = { ...history(), branch: "feature-one" };
    assertEquals(
      selectHistoricalDependencySnapshot(value, branchScope, emptyKey, undefined, now)?.snapshot
        .cacheKey,
      emptyKey,
    );
    assertThrows(() => select(value));
  });

  it("bounds total UTF-8 metadata before hashing candidate maps", () => {
    assertThrows(() => select(history({ huge: "界".repeat(DEPENDENCY_SNAPSHOT_MAX_BYTES / 2) })));
    assertThrows(() => select(history({ huge: "x".repeat(DEPENDENCY_SNAPSHOT_MAX_BYTES + 1) })));
  });

  it("does not invoke accessors or proxy traps on metadata", () => {
    let invoked = false;
    const value = history();
    Object.defineProperty(value, "entries", {
      get() {
        invoked = true;
        return [];
      },
    });
    assertThrows(() => select(value));
    assertEquals(invoked, false);
    const proxy = new Proxy(history(), {
      getOwnPropertyDescriptor() {
        invoked = true;
        return undefined;
      },
    });
    assertThrows(() => select(proxy));
    assertEquals(invoked, false);
  });

  it("preserves prototype-shaped dependency names as inert data", () => {
    const dependencies = JSON.parse('{"__proto__":"one","constructor":"two","toJSON":"three"}');
    const key = `on:${hashDependencyPins(dependencies)}`;
    const result = select(history(dependencies), key);
    assertEquals(Object.getPrototypeOf(result?.snapshot.dependencies), null);
    assertEquals(result?.snapshot.dependencies?.["__proto__"], "one");
    const constructorKey: string = "constructor";
    assertEquals(result?.snapshot.dependencies?.[constructorKey], "two");
  });
});
