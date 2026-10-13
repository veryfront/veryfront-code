import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isNode } from "#veryfront/platform/compat/runtime.ts";
import { getLocalReactPath } from "#veryfront/platform/compat/react-paths.ts";
import {
  rewriteSSRImportsCompat,
  rewriteSSRImportsCompatAsync,
} from "#veryfront/transforms/import-rewriter/ssr-adapter.ts";
import {
  buildReplacements,
  rewriteModuleImports,
} from "#veryfront/transforms/esm/specifier-resolver.ts";
import { resolveReactSpecifier } from "#veryfront/transforms/pipeline/stages/ssr-vf-modules/specifier-resolver.ts";
import {
  buildHttpCacheIdentity,
  resolveBareSpecifier,
} from "#veryfront/transforms/esm/http-cache-helpers.ts";
import { resolveReactImports } from "#veryfront/transforms/esm/react-imports.ts";
import fs from "node:fs";
import { createRequire } from "node:module";
import { getSSRReactRuntimeCacheScope } from "#veryfront/transforms/esm/http-cache-helpers.ts";
import { cacheHttpImportsToLocal } from "#veryfront/transforms/esm/http-cache.ts";
import {
  getProjectReact,
  getReactDOMServer,
  resolveSSRRuntime,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";

describe("Node SSR local React graph", () => {
  it("renders a configured compatible range through SSRRenderer", async () => {
    if (!isBun) return;
    const { SSRRenderer } = await import("#veryfront/rendering/ssr-renderer.ts");
    const react = await getProjectReact();
    const renderer = new SSRRenderer(
      "development",
      undefined,
      undefined,
      undefined,
      { react: { version: "^19.2.0" } } as never,
    );
    const result = await renderer.renderToHTML(
      react.createElement("main", null, "configured-range"),
      { mode: "development", wantsStream: false },
    );
    assertEquals(result.html?.includes("<main>configured-range</main>"), true);
  });
  it("defaults public local-cache and SSR rewriting entrypoints to installed peers", async () => {
    if (!isNode) return;
    const require = createRequire(import.meta.url);
    const react = require("react/package.json");
    const dom = require("react-dom/package.json");
    const originalReact = react.version;
    const originalDom = dom.version;
    try {
      react.version = "19.2.5";
      dom.version = "19.2.5";
      const code = 'import { jsx } from "react/jsx-runtime"; export const value = jsx;';
      assertEquals(rewriteSSRImportsCompat(code).includes("esm.sh"), false);
      assertEquals((await rewriteSSRImportsCompatAsync(code)).includes("esm.sh"), false);
      const cached = await cacheHttpImportsToLocal(code, {
        cacheDir: "/unused",
        importMap: { imports: {} },
        localReact: true,
      });
      assertEquals(cached.code.includes("esm.sh"), false);
      assertEquals((await resolveReactImports(code, true)).includes("esm.sh"), false);
    } finally {
      react.version = originalReact;
      dom.version = originalDom;
    }
  });
  it("validates an explicitly supplied runtime against its own version", async () => {
    const runtime = {
      react: { version: "19.2.0" },
      server: { renderToString: () => "supplied", renderToStaticMarkup: () => "supplied" },
    };
    const selected = await resolveSSRRuntime({
      reactRuntime: runtime as never,
      reactVersion: "^19.2.0",
    });
    assertEquals(selected.react, runtime.react);
    assertEquals(selected.server, runtime.server);
  });
  it("accepts compatible ranges on the public renderer entrypoints", async () => {
    if (!isNode) return;
    const react = await getProjectReact("^19.2.0");
    const server = await getReactDOMServer("^19.2.0");
    assertEquals(
      server.renderToStaticMarkup(react.createElement("main", null, "compatible")),
      "<main>compatible</main>",
    );
  });
  it("invalidates the scope when installed versions change at unchanged peer paths", async () => {
    if (!isNode) return;
    const { syncBuiltinESMExports } = await import("node:module");
    const before = await getSSRReactRuntimeCacheScope();
    const manifestPath = createRequire(import.meta.url).resolve("react/package.json");
    const originalRead = fs.readFileSync;
    try {
      fs.readFileSync = ((path: unknown, options: unknown) => {
        const content = Reflect.apply(originalRead, fs, [path, options]);
        if (path === manifestPath && typeof content === "string") {
          const manifest = JSON.parse(content);
          manifest.version = "19.2.5";
          return JSON.stringify(manifest);
        }
        return content;
      }) as typeof fs.readFileSync;
      syncBuiltinESMExports();
      assertEquals(await getSSRReactRuntimeCacheScope() === before, false);
    } finally {
      fs.readFileSync = originalRead;
      syncBuiltinESMExports();
    }
    assertEquals(await getSSRReactRuntimeCacheScope(), before);
  });
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
