import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildSourceMissCacheKey,
  clearSourceMissCache,
  hasSourceMiss,
  rememberSourceMiss,
} from "./module-source-resolution-cache.ts";

describe("modules/server/module-source-resolution-cache", () => {
  it("frames identity fields without delimiter collisions", () => {
    const base = {
      resolver: "module-server" as const,
      projectDir: "/project",
      basePath: "page",
    };
    const first = buildSourceMissCacheKey({ ...base, projectId: "tenant:branch" });
    const second = buildSourceMissCacheKey({
      ...base,
      projectId: "tenant",
      projectSlug: "branch",
    });

    assertEquals(first === second, false);
  });

  it("does not route malformed external keys into a resolver cache", () => {
    clearSourceMissCache();
    assertEquals(hasSourceMiss("malformed"), false);
    assertThrows(() => rememberSourceMiss("malformed"), TypeError);
  });
});
