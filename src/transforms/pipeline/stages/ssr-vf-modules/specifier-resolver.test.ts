import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildReactUrl } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { createFrameworkSpecifierResolver, resolveReactSpecifier } from "./specifier-resolver.ts";

describe("ssr-vf-modules/specifier-resolver", () => {
  it("resolves framework transform specifiers from explicit replacement maps first", () => {
    const resolveSpecifier = createFrameworkSpecifierResolver({
      denoConfigStubUrl: "file:///cache/deno-config.mjs",
      veryfrontReplacements: new Map([["#veryfront/utils", "file:///cache/utils.mjs"]]),
      relativeReplacements: new Map([["./helper.js", "file:///cache/helper.mjs"]]),
      reactVersion: "19.2.4",
    });

    assertEquals(resolveSpecifier("#deno-config"), "file:///cache/deno-config.mjs");
    assertEquals(resolveSpecifier("#veryfront/utils"), "file:///cache/utils.mjs");
    assertEquals(resolveSpecifier("./helper.js"), "file:///cache/helper.mjs");
    assertEquals(resolveSpecifier("../missing.js"), null);
  });

  it("resolves React specifiers through the shared React import map fallback", () => {
    assertEquals(resolveReactSpecifier("react", "19.2.4"), buildReactUrl("react", "19.2.4"));
    assertEquals(
      resolveReactSpecifier("react-dom/client", "19.2.4"),
      buildReactUrl("react-dom", "19.2.4", "/client", true),
    );

    const jsxRuntime = resolveReactSpecifier("react/jsx-runtime", "19.2.4");
    assertStringIncludes(jsxRuntime ?? "", "react@19.2.4/jsx-runtime");
    assertEquals(resolveReactSpecifier("lodash", "19.2.4"), null);
  });
});
