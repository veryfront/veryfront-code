import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeProxyRuntimeVersion } from "./version.ts";

describe("proxy runtime version", () => {
  it("normalizes bounded release versions and rejects log-unsafe values", () => {
    assertEquals(normalizeProxyRuntimeVersion("v1.2.3-beta.1+build"), "1.2.3-beta.1+build");
    assertEquals(normalizeProxyRuntimeVersion("release candidate\nsecret=value"), undefined);
    assertEquals(normalizeProxyRuntimeVersion("x".repeat(129)), undefined);
    assertEquals(normalizeProxyRuntimeVersion(undefined), undefined);
  });
});
