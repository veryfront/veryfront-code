import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseProxyEnvironment } from "./index.ts";

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

  it("returns undefined for invalid value", () => {
    assertEquals(parseProxyEnvironment("staging"), undefined);
    assertEquals(parseProxyEnvironment("dev"), undefined);
    assertEquals(parseProxyEnvironment("PREVIEW"), undefined);
    assertEquals(parseProxyEnvironment("PRODUCTION"), undefined);
  });
});
