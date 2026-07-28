import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildSourceMissCacheKey,
  clearSourceMissCache,
  clearSourceMissCacheForProject,
  hasSourceMiss,
  rememberSourceMiss,
} from "./module-source-resolution-cache.ts";

describe("modules/server/module-source-resolution-cache", () => {
  afterEach(() => clearSourceMissCache());

  it("frames identity fields injectively even when values contain NUL", () => {
    const first = buildSourceMissCacheKey({
      projectDir: "project\0nested",
      projectId: "tenant",
      basePath: "components/Card",
    });
    const second = buildSourceMissCacheKey({
      projectDir: "project",
      projectId: "nested\0tenant",
      basePath: "components/Card",
    });

    assertNotEquals(first, second);
  });

  it("rejects malformed keys instead of routing them to a default cache", () => {
    assertThrows(
      () => hasSourceMiss("malformed"),
      TypeError,
      "Invalid module source miss cache key",
    );
    assertThrows(
      () => rememberSourceMiss("malformed"),
      TypeError,
      "Invalid module source miss cache key",
    );
  });

  it("evicts only the exact encoded project identity", () => {
    const target = buildSourceMissCacheKey({
      projectDir: "/shared",
      projectId: "tenant\0one",
      basePath: "missing",
    });
    const other = buildSourceMissCacheKey({
      projectDir: "/shared",
      projectId: "tenant",
      projectSlug: "one",
      basePath: "missing",
    });
    rememberSourceMiss(target);
    rememberSourceMiss(other);

    assertEquals(clearSourceMissCacheForProject({ projectId: "tenant\0one" }), 1);
    assertEquals(hasSourceMiss(target), false);
    assertEquals(hasSourceMiss(other), true);
  });
});
