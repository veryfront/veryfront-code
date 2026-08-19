import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isImmutableFileCacheKey } from "./immutable-keys.ts";

// This predicate is the entire safety argument for the process-local L1 in
// FileCache: a false positive means serving stale content forever, because
// immutable entries have no invalidation path. A false negative only costs a
// round trip. The asymmetry is why these cases are pinned directly rather than
// through FileCache behaviour.
describe("isImmutableFileCacheKey", () => {
  it("accepts release-scoped keys for every file-operation prefix", () => {
    for (const prefix of ["file", "stat", "dir", "files"]) {
      assertEquals(isImmutableFileCacheKey(`${prefix}:release:acme:rel_123`), true, prefix);
    }
  });

  it("accepts environment-scoped keys, whose qualifier embeds the releaseId", () => {
    for (const prefix of ["file", "stat", "dir", "files"]) {
      assertEquals(isImmutableFileCacheKey(`${prefix}:env:acme:production+rel_123`), true, prefix);
    }
  });

  it("rejects every branch-scoped key — branch content changes on save", () => {
    for (const prefix of ["file", "stat", "dir", "files"]) {
      assertEquals(isImmutableFileCacheKey(`${prefix}:branch:acme:main`), false, prefix);
    }
  });

  it("rejects the no-context fallback keys", () => {
    for (const key of ["file:unknown", "stat:unknown", "dir:unknown", "files:unknown"]) {
      assertEquals(isImmutableFileCacheKey(key), false, key);
    }
  });

  it("rejects prefixes that do not route through buildFileOperationPrefix", () => {
    assertEquals(isImmutableFileCacheKey("github:dir:release:acme:rel_123"), false);
    assertEquals(isImmutableFileCacheKey("github:stat:env:acme:production+rel_1"), false);
  });

  it("is anchored: a source type appearing later in the key does not qualify it", () => {
    // A project literally named "release" or "env" must not make a branch key
    // look immutable.
    assertEquals(isImmutableFileCacheKey("file:branch:release:main"), false);
    assertEquals(isImmutableFileCacheKey("file:branch:env:main"), false);
    assertEquals(isImmutableFileCacheKey("other:file:release:acme:rel_1"), false);
  });

  it("requires the separator, so a longer source type does not match by prefix", () => {
    assertEquals(isImmutableFileCacheKey("file:releases:acme:rel_1"), false);
    assertEquals(isImmutableFileCacheKey("file:environment:acme:rel_1"), false);
  });
});
