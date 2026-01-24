import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findUnknownTopLevelKeys, validateVeryfrontConfig } from "./schema.ts";

describe("configSchema", () => {
  it("validates valid config and finds unknown keys", () => {
    const cfg = validateVeryfrontConfig({
      router: "app",
      security: { cors: true, remoteHosts: ["https://esm.sh"] },
    });

    assertEquals(cfg.router, "app");
    assertEquals(findUnknownTopLevelKeys({ foo: 1, router: "pages" }), ["foo"]);
  });

  it("gives helpful error for invalid cors", () => {
    assertThrows(
      () => validateVeryfrontConfig({ security: { cors: { origin: 123 } } }),
      Error,
      "Invalid veryfront.config at security.cors:",
    );
  });
});
