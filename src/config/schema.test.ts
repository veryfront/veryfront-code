import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd.ts";
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
      () => validateVeryfrontConfig({ security: { cors: { origin: 123 } as any } }),
      Error,
      "Invalid veryfront.config at security.cors:",
    );
  });
});
