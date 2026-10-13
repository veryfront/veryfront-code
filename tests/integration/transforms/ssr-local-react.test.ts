import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readProjectDependencyVersions,
  resolveProjectReactDeclaration,
} from "#veryfront/transforms/esm/package-registry.ts";
import type { ReactDOMServer } from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import type { VeryfrontConfig } from "#veryfront/config";
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
  it("selects the prepared peer before layout/page transforms and browser import-map construction", async () => {
    const { resolveProjectReactVersion } = await import(
      "#veryfront/transforms/esm/package-registry.ts"
    );
    const { buildImportMap } = await import("#veryfront/html/utils.ts");
    const React = await getProjectReact();
    const prepared = { ...React, version: "19.2.0" };
    const adapter = {
      moduleLoader: { importModule: () => Promise.resolve({ default: prepared }) },
    } as unknown as RuntimeAdapter;
    const options = { adapter, config: { react: { version: "^19.2.0" } } as VeryfrontConfig };
    assertEquals(await resolveProjectReactVersion(options), "19.2.0");
    const { LayoutOrchestrator } = await import("#veryfront/rendering/orchestrator/layout.ts");
    const layouts = new LayoutOrchestrator({ adapter, config: options.config } as never);
    assertEquals(
      await (layouts as unknown as { getReactVersion(): Promise<string> }).getReactVersion(),
      "19.2.0",
    );
    await assertRejects(
      () =>
        resolveProjectReactVersion({
          ...options,
          config: { react: { version: "19.2.4" } } as VeryfrontConfig,
        }),
      Error,
      "Prepared React runtime version",
    );
    assertEquals(
      await resolveProjectReactVersion({
        ...options,
        config: { react: { version: "18.3.1" } } as VeryfrontConfig,
        dependencyPinningCacheKey: "on:captured",
        dependencyPinningDependencies: { react: "^19.2.0" },
      }),
      "19.2.0",
    );
    const adapterOnlyMap = await buildImportMap({ adapter });
    assertEquals(JSON.parse(adapterOnlyMap.json).imports.adapter, undefined);
    assertEquals(JSON.parse(adapterOnlyMap.json).imports.react.includes("react@19.2.0"), true);
    const map = await buildImportMap(options);
    assertEquals(JSON.parse(map.json).imports.react.includes("react@19.2.0"), true);
    const { generateHTMLShellParts } = await import("#veryfront/html/html-shell-generator.ts");
    const shell = await generateHTMLShellParts({ slug: "prepared" }, {
      ...options,
      mode: "development",
      isLocalProject: true,
    });
    assertEquals(shell.start.includes("react@19.2.0"), true);
    assertEquals(shell.start.includes("react@19.2.4"), false);
    const defaultMap = await buildImportMap();
    assertEquals(
      JSON.parse(defaultMap.json).imports.react.includes(`react@${React.version}`),
      true,
    );
  });

  it("constructs prepared and supplied renderers without reading host peer manifests", async () => {
    if (!isNode) return;
    const { SSRRenderer } = await import("#veryfront/rendering/ssr-renderer.ts");
    const React = await getProjectReact();
    const react = { ...React, version: "19.2.0" } as typeof import("react");
    const server: ReactDOMServer = {
      renderToString: () => "prepared",
      renderToStaticMarkup: () => "prepared",
    };
    const adapter = {
      moduleLoader: {
        importModule: (reference: { specifier: string }) =>
          Promise.resolve(reference.specifier === "react" ? { default: react } : server),
      },
    } as unknown as RuntimeAdapter;
    const native = await import("node:module");
    const original = fs.readFileSync;
    fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      if (String(args[0]).endsWith("/react/package.json")) {
        throw new Error("host manifest unavailable");
      }
      return Reflect.apply(original, fs, args);
    }) as typeof fs.readFileSync;
    native.syncBuiltinESMExports();
    try {
      for (const supplied of [false, true]) {
        const renderer = new SSRRenderer(
          "development",
          supplied ? undefined : adapter,
          undefined,
          undefined,
          { react: { version: "^19.2.0" } } as VeryfrontConfig,
        );
        const result = await renderer.renderToHTML(React.createElement("p"), {
          mode: "development",
          wantsStream: false,
          ...(supplied ? { reactRuntime: { react, server } } : {}),
        });
        assertEquals(result.html, "prepared");
      }
    } finally {
      fs.readFileSync = original;
      native.syncBuiltinESMExports();
    }
  });

  it("uses the authenticated authored range from a recovered legacy snapshot", async () => {
    const { hashDependencyPins } = await import("#veryfront/transforms/esm/dependency-snapshot.ts");
    const { selectHistoricalDependencySnapshot } = await import(
      "#veryfront/transforms/esm/dependency-metadata-history.ts"
    );
    const { resolveProjectReactVersion } = await import(
      "#veryfront/transforms/esm/package-registry.ts"
    );
    const configuration = { react: { declaration: "^19.2.0", effective: "19.2.0" } };
    const key = `on:${hashDependencyPins({ react: "19.2.0" }, configuration)}`;
    const recovered = selectHistoricalDependencySnapshot(
      {
        version: 1,
        projectId: "legacy-project",
        branch: null,
        entries: [{ dependencies: {}, expiresAt: 160000 }],
      },
      { projectId: "legacy-project", branch: null },
      key,
      configuration,
      100000,
    );
    assertEquals(recovered !== undefined, true);
    const snapshot = recovered!.snapshot;
    const adapter = {
      moduleLoader: { importModule: () => Promise.resolve({ default: { version: "19.2.4" } }) },
    } as unknown as RuntimeAdapter;
    const options = {
      adapter,
      dependencyPinningCacheKey: snapshot.cacheKey,
      dependencyPinningDependencies: snapshot.dependencies,
      dependencyPinningConfiguredVersions: snapshot.configuredVersions,
    };
    assertEquals(await resolveProjectReactVersion(options), "19.2.4");
    assertEquals(snapshot.dependencies?.react, "19.2.0");
    await assertRejects(
      () =>
        resolveProjectReactVersion({
          ...options,
          dependencyPinningConfiguredVersions: { react: { declaration: "*", effective: "19.2.0" } },
        }),
      Error,
      "Captured dependency configuration",
    );
    const React = await getProjectReact("19.2.4");
    const server = await getReactDOMServer("19.2.4");
    const { SSRRenderer } = await import("#veryfront/rendering/ssr-renderer.ts");
    const renderer = new SSRRenderer(
      "development",
      undefined,
      undefined,
      undefined,
      { react: { version: "20.0.0" } } as VeryfrontConfig,
    );
    const Page = () => {
      const [count] = React.useState(3);
      return React.createElement("p", null, `legacy:${count}`);
    };
    assertEquals(
      (await renderer.renderToHTML(React.createElement(Page), {
        ...options,
        mode: "development",
        wantsStream: false,
        reactRuntime: { react: React, server },
      })).html,
      "<p>legacy:3</p>",
    );

    const { buildImportMap } = await import("#veryfront/html/utils.ts");
    assertEquals(
      JSON.parse((await buildImportMap(options)).json).imports.react.includes("react@19.2.4"),
      true,
    );
  });

  it("preserves configured React ranges when capturing prepared-runtime snapshots", async () => {
    const {
      createDependencyPinningSource,
      getDependencyPinningSnapshot,
      resolveProjectReactVersion,
    } = await import("#veryfront/transforms/esm/package-registry.ts");
    const { setEnv, getHostEnv } = await import("#veryfront/platform/compat/process.ts");
    const flag = "VERYFRONT_DEPENDENCY_PINNING";
    const previous = getHostEnv(flag);
    const dir = mkdtempSync(join(tmpdir(), "prepared-snapshot-"));
    try {
      setEnv(flag, "1");
      writeFileSync(join(dir, "package.json"), "{}");
      const config = { react: { version: "^19.2.0" } } as VeryfrontConfig;
      const snapshot = await getDependencyPinningSnapshot(
        createDependencyPinningSource({ projectDir: dir, config, isLocalProject: true }),
      );
      assertEquals(snapshot.cacheKey.startsWith("on:"), true);
      const adapter = {
        moduleLoader: { importModule: () => Promise.resolve({ default: { version: "19.2.0" } }) },
      } as unknown as RuntimeAdapter;
      assertEquals(
        await resolveProjectReactVersion({
          adapter,
          config,
          dependencyPinningCacheKey: snapshot.cacheKey,
          dependencyPinningDependencies: snapshot.dependencies,
        }),
        "19.2.0",
      );
    } finally {
      setEnv(flag, previous ?? "");
      rmSync(dir, { recursive: true });
    }
  });

  it("renders installed and supplied runtimes for tag declarations while preserving range rejection", async () => {
    if (!isNode && !isBun) return;
    const React = await getProjectReact("latest");
    const server = await getReactDOMServer("latest");
    assertEquals(server.renderToStaticMarkup(React.createElement("p", null, "tag")), "<p>tag</p>");
    const { SSRRenderer } = await import("#veryfront/rendering/ssr-renderer.ts");
    const renderer = new SSRRenderer(
      "development",
      undefined,
      undefined,
      undefined,
      { react: { version: "latest" } } as VeryfrontConfig,
    );
    const provided = { ...React, version: "19.2.0" };
    assertEquals(
      (await renderer.renderToHTML(React.createElement("div"), {
        mode: "development",
        wantsStream: false,
        reactRuntime: {
          react: provided,
          server: { renderToString: () => "tagged", renderToStaticMarkup: () => "tagged" },
        },
      })).html,
      "tagged",
    );
  });

  it("retains the package declaration when a supplied runtime follows a cached range", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "sdk-react-declaration-"));
    try {
      writeFileSync(
        join(projectDir, "package.json"),
        JSON.stringify({ dependencies: { react: "^19.2.0" } }),
      );
      await readProjectDependencyVersions(projectDir);
      assertEquals(await resolveProjectReactDeclaration({ projectDir }), "^19.2.0");
      assertEquals(
        await resolveProjectReactDeclaration({
          projectDir,
          dependencyPinningCacheKey: "on:empty",
          dependencyPinningDependencies: {},
        }),
        undefined,
      );
    } finally {
      rmSync(projectDir, { recursive: true });
    }
  });

  it("selects a prepared runtime's version without replacing it with a host peer", async () => {
    const { SSRRenderer } = await import("#veryfront/rendering/ssr-renderer.ts");
    const React = await getProjectReact();
    const react = { ...React, version: "19.2.0" };
    const server = { renderToString: () => "prepared", renderToStaticMarkup: () => "prepared" };
    const adapter = {
      moduleLoader: {
        importModule: (reference: { specifier: string }) =>
          Promise.resolve(reference.specifier === "react" ? { default: react } : server),
      },
    } as unknown as RuntimeAdapter;
    const renderer = new SSRRenderer(
      "development",
      adapter,
      undefined,
      undefined,
      { react: { version: "^19.2.0" } } as VeryfrontConfig,
    );
    assertEquals(
      (await renderer.renderToHTML(React.createElement("div"), {
        mode: "development",
        wantsStream: false,
      })).html,
      "prepared",
    );
  });

  it("validates supplied runtimes against authored ranges without selecting host peers", async () => {
    const { SSRRenderer } = await import("#veryfront/rendering/ssr-renderer.ts");
    const React = await getProjectReact();
    const react = { ...React, version: "19.2.0" } as typeof import("react");
    const server: ReactDOMServer = {
      renderToString: () => "provided",
      renderToStaticMarkup: () => "provided",
    };
    for (const snapshot of [false, true]) {
      const renderer = new SSRRenderer("development", undefined, undefined, undefined, {
        react: { version: snapshot ? "18.3.1" : "^19.2.0" },
      } as VeryfrontConfig);
      const result = await renderer.renderToHTML(React.createElement("div"), {
        mode: "development",
        wantsStream: false,
        reactRuntime: { react, server },
        ...(snapshot
          ? {
            dependencyPinningCacheKey: "on:captured",
            dependencyPinningDependencies: { react: "^19.2.0" },
          }
          : {}),
      });
      assertEquals(result.html, "provided");
    }
    const exact = new SSRRenderer("development", undefined, undefined, undefined, {
      react: { version: "19.2.4" },
    } as VeryfrontConfig);
    await assertRejects(
      () =>
        exact.renderToHTML(React.createElement("div"), {
          mode: "development",
          wantsStream: false,
          reactRuntime: { react, server },
        }),
      Error,
      "React runtime version",
    );
  });

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
