import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { fingerprintImportMap } from "#veryfront/transforms/esm/http-cache-helpers.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
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
    const expectedImportMapFingerprint = await fingerprintImportMap(importMap);
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
        importMapFingerprint,
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
        assertEquals(importMapFingerprint, expectedImportMapFingerprint);
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

  it("recognizes bare framework paths and defaults the React version", async () => {
    const reactVersions: string[] = [];
    await transformResolvedModuleSource({
      sourceCode: `export const value = 1;`,
      actualFilePath: "/node_modules/veryfront/esm/src/react/runtime/core.js",
      projectDir: "/project",
      projectId: "project-1",
      normalizedPath: "_veryfront/react/runtime/core.js",
      projectSlug: "docs",
      dev: false,
      adapter: {} as RuntimeAdapter,
      log: noopLog,
      loadImportMap: () => Promise.resolve({ imports: {} }),
      transformFrameworkSource: (_source, _path, reactVersion) => {
        reactVersions.push(reactVersion);
        return Promise.resolve(`export const value = 1;`);
      },
      transformToEsm: () => {
        throw new Error("generic tenant transform must not handle framework entries");
      },
    });

    assertEquals(reactVersions, [REACT_DEFAULT_VERSION]);
  });

  it("keeps other framework entries on the dependency-pinned generic path", async () => {
    const calls: string[] = [];
    const result = await transformResolvedModuleSource({
      sourceCode: `import { createOpenAIProviderModel } from "@veryfront/ext-llm-openai";`,
      actualFilePath: "/node_modules/veryfront/esm/src/provider/index.js",
      projectDir: "/project",
      projectId: "project-1",
      normalizedPath: "_vf_modules/_veryfront/provider/index.js",
      projectSlug: "docs",
      dependencyPinningCacheKey: "on:snapshot-a",
      dependencyPinningDependencies: { "@veryfront/ext-llm-openai": "0.1.1200" },
      dev: false,
      adapter: {} as RuntimeAdapter,
      log: noopLog,
      transformToEsm: (_source, _path, _projectDir, _adapter, options) => {
        calls.push("transformToEsm");
        assertEquals(options.dependencyPinningCacheKey, "on:snapshot-a");
        assertEquals(options.dependencyPinningDependencies, {
          "@veryfront/ext-llm-openai": "0.1.1200",
        });
        return Promise.resolve(`export const provider = true;`);
      },
      loadImportMap: () => Promise.resolve({ imports: {} }),
      cacheHttpImportsToLocal: (code) => Promise.resolve({ code }),
      transformFrameworkSource: () => {
        throw new Error("non-runtime framework entries must retain dependency pinning");
      },
    });

    assertEquals(calls, ["transformToEsm"]);
    assertEquals(result, `export const provider = true;`);
  });

  it("logs module context when a framework transform fails", async () => {
    const errorCalls: unknown[] = [];
    const sourceCode = `export const broken = true;`;
    const failure = new Error("framework transform failed");

    await assertRejects(
      () =>
        transformResolvedModuleSource({
          sourceCode,
          actualFilePath: "/node_modules/veryfront/esm/src/react/runtime/core.js",
          projectDir: "/project",
          projectId: "project-1",
          normalizedPath: "_vf_modules/_veryfront/react/runtime/core.js",
          projectSlug: "docs",
          dev: false,
          adapter: {} as RuntimeAdapter,
          log: {
            ...noopLog,
            error: (message, context) => errorCalls.push([message, context]),
          },
          loadImportMap: () => Promise.resolve({ imports: {} }),
          transformFrameworkSource: () => Promise.reject(failure),
        }),
      Error,
      failure.message,
    );

    assertEquals(errorCalls, [[
      "[mdx-loader] Transform failed for module",
      {
        normalizedPath: "_vf_modules/_veryfront/react/runtime/core.js",
        actualFilePath: "/node_modules/veryfront/esm/src/react/runtime/core.js",
        sourceLength: sourceCode.length,
        sourcePreview: sourceCode,
        error: failure.message,
      },
    ]]);
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
