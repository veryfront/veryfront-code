import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { generateDevFlagScript } from "./dev-flag.ts";
import { getDevScripts } from "./dev-scripts.ts";

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

describe("getDevScripts development flag", () => {
  const config = { dev: { hmr: true } } as unknown as Parameters<typeof getDevScripts>[1];

  it("marks a development render", () => {
    assertStringIncludes(
      getDevScripts("slug", config, undefined, undefined, undefined, {}),
      "window.__VERYFRONT_DEV__=true",
    );
  });

  it("leaves preview output unmarked", () => {
    // Preview serves the dev scripts for HMR but is user-facing, so it must not
    // switch on development-only client behaviour.
    const html = getDevScripts("slug", config, undefined, undefined, undefined, {
      skipDevFlag: true,
      skipDevHMR: true,
      skipErrorLogger: true,
    });

    assertEquals(html.includes("__VERYFRONT_DEV__"), false);
  });
});
