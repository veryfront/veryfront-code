import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { generateDevFlagScript } from "./dev-flag.ts";

describe("generateDevFlagScript", () => {
  it("sets the client development signal", () => {
    assertStringIncludes(generateDevFlagScript(), "window.__VERYFRONT_DEV__=true");
  });

  it("carries the CSP nonce", () => {
    assertStringIncludes(generateDevFlagScript("n0nce"), 'nonce="n0nce"');
  });

  it("emits no nonce attribute when none is given", () => {
    assertEquals(generateDevFlagScript().includes("nonce="), false);
  });
});
