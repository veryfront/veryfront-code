import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { transformResolvedModuleSource } from "./source-transform.ts";

const noopLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as const;

describe("module-fetcher/source-transform", () => {
  it("recursively transforms public framework entries before caching them", async () => {
    const calls: string[] = [];
    const importMap = { imports: {} };
    const result = await transformResolvedModuleSource({
      sourceCode: `import { useServerRenderContext } from "../server-render-context.js";`,
      actualFilePath: "/node_modules/veryfront/esm/src/react/runtime/core.js",
      projectDir: "/project",
      projectId: "project-1",
      normalizedPath: "_vf_modules/_veryfront/react/runtime/core.js",
      projectSlug: "docs",
      reactVersion: "19.2.4",
      dev: false,
      adapter: {} as RuntimeAdapter,
      log: noopLog,
      loadImportMap: (projectDir) => {
        calls.push("loadImportMap");
        assertEquals(projectDir, "/project");
        return Promise.resolve(importMap);
      },
      transformFrameworkSource: (
        source,
        sourcePath,
        reactVersion,
        projectDir,
        _fs,
        _onProgress,
        receivedImportMap,
      ) => {
        calls.push("transformFrameworkSource");
        assertEquals(
          { source, sourcePath, reactVersion, projectDir },
          {
            source: `import { useServerRenderContext } from "../server-render-context.js";`,
            sourcePath: "/node_modules/veryfront/esm/src/react/runtime/core.js",
            reactVersion: "19.2.4",
            projectDir: "/project",
          },
        );
        assertEquals(receivedImportMap, importMap);
        return Promise.resolve(
          `import { useServerRenderContext } from "file:///cache/server-render-context.mjs";`,
        );
      },
      transformToEsm: () => {
        throw new Error("generic tenant transform must not handle framework entries");
      },
    });

    assertEquals(calls, ["loadImportMap", "transformFrameworkSource"]);
    assertEquals(
      result,
      `import { useServerRenderContext } from "file:///cache/server-render-context.mjs";`,
    );
  });

  it("preprocesses veryfront imports before transform and caches HTTP imports after transform", async () => {
    const calls: string[] = [];
    const adapter = {} as RuntimeAdapter;

    const result = await transformResolvedModuleSource({
      sourceCode: `import Head from "veryfront/head";\nexport default Head;`,
      actualFilePath: "/project/app/page.tsx",
      projectDir: "/project",
      projectId: "project-1",
      normalizedPath: "_vf_modules/app/page.tsx",
      projectSlug: "docs",
      reactVersion: "19.1.1",
      serverExternalPackages: ["knex"],
      moduleServerOrigin: "https://preview.example",
      dependencyPinningCacheKey: "on:pins",
      dev: false,
      adapter,
      log: noopLog,
      transformToEsm: (source, actualFilePath, projectDir, receivedAdapter, options) => {
        calls.push("transform");
        assertEquals(
          source.includes(`from "/_vf_modules/_veryfront/react/runtime/core.js?ssr=true"`),
          true,
        );
        assertEquals(source.includes(`from "veryfront/head"`), false);
        assertEquals(actualFilePath, "/project/app/page.tsx");
        assertEquals(projectDir, "/project");
        assertEquals(receivedAdapter, adapter);
        assertEquals(options, {
          projectId: "project-1",
          dev: false,
          ssr: true,
          reactVersion: "19.1.1",
          serverExternalPackages: ["knex"],
          moduleServerOrigin: "https://preview.example",
          dependencyPinningCacheKey: "on:pins",
        });
        return Promise.resolve(`import React from "https://esm.sh/react";\nexport default React;`);
      },
      loadImportMap: (projectDir) => {
        calls.push("loadImportMap");
        assertEquals(projectDir, "/project");
        return Promise.resolve({ imports: {} });
      },
      cacheHttpImportsToLocal: (code, options) => {
        calls.push("cacheHttpImportsToLocal");
        assertEquals(code, `import React from "https://esm.sh/react";\nexport default React;`);
        assertEquals(options.reactVersion, "19.1.1");
        assertEquals(options.serverExternalPackages, ["knex"]);
        return Promise.resolve({
          code: `import React from "file:///cache/react.mjs";\nexport default React;`,
        });
      },
    });

    assertEquals(calls, ["transform", "loadImportMap", "cacheHttpImportsToLocal"]);
    assertEquals(result, `import React from "file:///cache/react.mjs";\nexport default React;`);
  });

  it("compiles in the requested mode", async () => {
    const observed: Array<boolean | undefined> = [];
    const transform = (dev: boolean) =>
      transformResolvedModuleSource({
        sourceCode: `export default 1;`,
        actualFilePath: "/project/lib/util.ts",
        projectDir: "/project",
        projectId: "project-1",
        normalizedPath: "_vf_modules/lib/util.js",
        projectSlug: "docs",
        dev,
        adapter: {} as RuntimeAdapter,
        log: noopLog,
        transformToEsm: (_source, _actualFilePath, _projectDir, _adapter, options) => {
          observed.push(options.dev);
          return Promise.resolve(`export default 1;`);
        },
        loadImportMap: () => Promise.resolve({ imports: {} }),
        cacheHttpImportsToLocal: (code) => Promise.resolve({ code }),
      });

    await transform(false);
    await transform(true);

    assertEquals(observed, [false, true]);
  });
});
