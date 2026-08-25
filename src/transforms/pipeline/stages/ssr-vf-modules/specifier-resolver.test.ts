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

  it("falls through to the single-instance React bundle for bare React specifiers", () => {
    const resolveSpecifier = createFrameworkSpecifierResolver({
      denoConfigStubUrl: "file:///cache/deno-config.mjs",
      veryfrontReplacements: new Map(),
      relativeReplacements: new Map(),
      reactVersion: "19.2.4",
    });

    assertStringIncludes(
      resolveSpecifier("react") ?? "",
      "https://esm.sh/react@19.2.4?",
      "bare react must resolve to the shared esm.sh bundle, not stay a bare specifier",
    );
    assertStringIncludes(
      resolveSpecifier("react-dom/client") ?? "",
      "https://esm.sh/react-dom@19.2.4/client?external=react",
      "react-dom subpaths must keep react external so a single React instance is shared",
    );
    assertStringIncludes(
      resolveSpecifier("react/jsx-runtime") ?? "",
      "https://esm.sh/react@19.2.4/jsx-runtime?external=react",
      "the JSX runtime must resolve against the same React version",
    );
    assertEquals(
      resolveSpecifier("lodash"),
      null,
      "non-React bare specifiers are left for the caller to resolve",
    );
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
