import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseProxyEnvironment } from "./proxy-environment.ts";

describe("parseProxyEnvironment", () => {
  it("returns 'preview' for valid preview value", () => {
    assertEquals(parseProxyEnvironment("preview"), "preview");
  });

  it("returns 'production' for valid production value", () => {
    assertEquals(parseProxyEnvironment("production"), "production");
  });

  it("returns undefined for null", () => {
    assertEquals(parseProxyEnvironment(null), undefined);
  });

  it("returns undefined for empty string", () => {
    assertEquals(parseProxyEnvironment(""), undefined);
  });

  it("returns undefined for invalid values", () => {
    for (const value of ["staging", "dev", "PREVIEW", "PRODUCTION"] as const) {
      assertEquals(parseProxyEnvironment(value), undefined);
    }
  });
});
