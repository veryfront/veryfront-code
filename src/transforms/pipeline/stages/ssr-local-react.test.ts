import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isNode } from "#veryfront/platform/compat/runtime.ts";
import { getLocalReactPath } from "#veryfront/platform/compat/react-paths.ts";
import { rewriteSSRImportsCompatAsync } from "../../import-rewriter/ssr-adapter.ts";
import { buildReplacements, rewriteModuleImports } from "../../esm/specifier-resolver.ts";
import { resolveReactSpecifier } from "./ssr-vf-modules/specifier-resolver.ts";
import { buildHttpCacheIdentity, resolveBareSpecifier } from "../../esm/http-cache-helpers.ts";
import { resolveReactImports } from "../../esm/react-imports.ts";
import {
  getProjectReact,
  getReactDOMServer,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";

describe("Node SSR local React graph", () => {
  it("keeps browser release dependency resolution on the CDN graph", () => {
    assertEquals(
      resolveBareSpecifier("react", { imports: {} }, "19.2.4").startsWith("https://esm.sh/"),
      true,
    );
  });
  it("renders page and framework imports without the HTTP cache fetching React", async () => {
    if (!isNode) return;
    const source = `import React from "react";
      import { jsx } from "react/jsx-runtime";
      export function Page() { const [value] = React.useState("offline-render"); return jsx("main", {children: value}); }
      export { React };`;
    const options = { cacheDir: "/unused", importMap: { imports: {} }, localReact: true };
    const deniedCache = () => {
      throw new Error("React must not require HTTP access");
    };
    // esbuild injects JSX imports after the import-rewriter stage, so test the
    // cache resolver independently as well as the complete rewritten graph.
    const raw = await buildReplacements(source, undefined, options, deniedCache);
    assertEquals(raw.replacements.get("react/jsx-runtime"), getLocalReactPath("react/jsx-runtime"));
    const explicit = await buildReplacements(
      'import React from "https://esm.sh/react@19.2.4";',
      undefined,
      options,
      deniedCache,
    );
    assertEquals(
      explicit.replacements.get("https://esm.sh/react@19.2.4"),
      getLocalReactPath("react"),
    );
    const rewritten = await rewriteSSRImportsCompatAsync(source);
    assertEquals(rewritten.includes("esm.sh"), false);
    assertEquals((await resolveReactImports(source, true)).includes("esm.sh"), false);
    assertEquals((await resolveReactImports(source, false)).includes("esm.sh"), true);
    const transformed = await rewriteModuleImports(
      rewritten,
      "file:///allocation-cache/page.js",
      options,
      deniedCache,
    );
    const page = await import(`data:text/javascript,${encodeURIComponent(transformed.code)}`);
    const react = await getProjectReact();
    const server = await getReactDOMServer();
    assertEquals(page.React === react, true);
    assertEquals(
      server.renderToStaticMarkup(react.createElement(page.Page)),
      "<main>offline-render</main>",
    );
    for (
      const specifier of ["react", "react-dom/server", "react/jsx-runtime", "react/jsx-dev-runtime"]
    ) {
      assertEquals(resolveReactSpecifier(specifier, "19.2.4"), getLocalReactPath(specifier));
    }
  });

  it("fails closed for unavailable local React subpaths", async () => {
    if (!isNode) return;
    assertThrows(() => getLocalReactPath("react/unavailable-platform-test"));
    await assertRejects(() =>
      rewriteSSRImportsCompatAsync('import value from "react/unavailable-platform-test";')
    );
    await assertRejects(() =>
      buildReplacements(
        'import value from "react/unavailable-platform-test";',
        undefined,
        { cacheDir: "/unused", importMap: { imports: {} }, localReact: true },
        () => {
          throw new Error("Missing peers must not fall back to HTTP");
        },
      )
    );
  });

  it("rejects a requested React version absent from the local dependency graph", async () => {
    if (!isNode) return;
    assertThrows(() => resolveReactSpecifier("react/jsx-runtime", "18.3.1"));
    await assertRejects(() => getProjectReact("18.3.1"));
    await assertRejects(() => getReactDOMServer("18.3.1"));
    for (
      const specifier of ["https://esm.sh/*react@18.3.1", "https://esm.sh/react@18", "npm:react@18"]
    ) {
      await assertRejects(
        () =>
          buildReplacements(`import React from ${JSON.stringify(specifier)};`, undefined, {
            cacheDir: "/unused",
            importMap: { imports: {} },
            localReact: true,
          }, () => {
            throw new Error("Wrong React version must not be fetched");
          }),
        TypeError,
        "does not match",
      );
    }
    await assertRejects(() =>
      buildReplacements('import React from "https://esm.sh/react@18.3.1";', undefined, {
        cacheDir: "/unused",
        importMap: { imports: {} },
        localReact: true,
      }, () => {
        throw new Error("Wrong React version must not be fetched");
      })
    );
  });

  it("keeps captured dependencies on an ESM graph with separate cache identity", async () => {
    const options = { cacheDir: "/unused", importMap: { imports: {} }, reactVersion: "19.2.4" };
    let fetched = "";
    const resolved = await buildReplacements(
      'import { jsx } from "react/jsx-runtime";',
      undefined,
      options,
      (url) => {
        fetched = url;
        return Promise.resolve("/capture/jsx.mjs");
      },
    );
    assertEquals(fetched.startsWith("https://esm.sh/react@19.2.4/jsx-runtime"), true);
    assertEquals(resolved.replacements.get("react/jsx-runtime"), "file:///capture/jsx.mjs");
    const remote = await buildHttpCacheIdentity("https://example.com/page.mjs", options);
    const local = await buildHttpCacheIdentity("https://example.com/page.mjs", {
      ...options,
      localReact: true,
    });
    assertEquals(remote === local, !isNode && !isBun);
  });

  it("uses local React for relative CDN dependency imports", async () => {
    if (!isNode) return;
    const source =
      'import React from "/react@19.2.4/es2022/react.mjs"; import { jsx } from "../../react@19.2.4/es2022/jsx-runtime.mjs";';
    const result = await buildReplacements(
      source,
      "https://esm.sh/component@1/es2022/component.mjs",
      { cacheDir: "/unused", importMap: { imports: {} }, localReact: true },
      () => {
        throw new Error("Relative React dependencies must not require HTTP access");
      },
    );
    assertEquals(
      result.replacements.get("/react@19.2.4/es2022/react.mjs"),
      getLocalReactPath("react"),
    );
    assertEquals(
      result.replacements.get("../../react@19.2.4/es2022/jsx-runtime.mjs"),
      getLocalReactPath("react/jsx-runtime"),
    );
  });
});
