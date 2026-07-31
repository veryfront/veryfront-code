import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
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
  it("carries the exact acknowledged graph authority with transformed code", async () => {
    const calls: string[] = [];
    const adapter = {} as RuntimeAdapter;
    const manifestAuthority = Object.freeze({
      manifestId: "a".repeat(64),
      bundleHashes: Object.freeze(["aaa111", "bbb222"]),
    });

    const result = await transformResolvedModuleSource({
      sourceCode: `import Head from "veryfront/head";\nexport default Head;`,
      actualFilePath: "/project/app/page.tsx",
      projectDir: "/project",
      projectId: "project-1",
      normalizedPath: "_vf_modules/app/page.tsx",
      projectSlug: "docs",
      reactVersion: "19.1.1",
      moduleServerOrigin: "https://preview.example",
      dependencyPinningCacheKey: "on:pins",
      adapter,
      log: noopLog,
      transformToEsm: async (source, actualFilePath, projectDir, receivedAdapter, options) => {
        calls.push("transform");
        assertEquals(
          source.includes(`from "/_vf_modules/_veryfront/react/runtime/core.js?ssr=true"`),
          true,
        );
        assertEquals(source.includes(`from "veryfront/head"`), false);
        assertEquals(actualFilePath, "/project/app/page.tsx");
        assertEquals(projectDir, "/project");
        assertEquals(receivedAdapter, adapter);
        assertEquals(options.projectId, "project-1");
        assertEquals(options.dev, true);
        assertEquals(options.ssr, true);
        assertEquals(options.reactVersion, "19.1.1");
        assertEquals(options.moduleServerOrigin, "https://preview.example");
        assertEquals(options.dependencyPinningCacheKey, "on:pins");
        assertEquals(await options.loadImportMap?.(), { imports: {} });
        return Promise.resolve(`import React from "https://esm.sh/react";\nexport default React;`);
      },
      loadImportMap: (projectDir, receivedAdapter) => {
        calls.push("loadImportMap");
        assertEquals(projectDir, "/project");
        assertEquals(receivedAdapter, adapter);
        return Promise.resolve({ imports: {} });
      },
      cacheHttpImportsToLocal: (code, options) => {
        calls.push("cacheHttpImportsToLocal");
        assertEquals(code, `import React from "https://esm.sh/react";\nexport default React;`);
        assertEquals(options.reactVersion, "19.1.1");
        return Promise.resolve({
          code: `import React from "file:///cache/react.mjs";\nexport default React;`,
          bundleManifestId: "a".repeat(64),
          bundleManifestAuthority: manifestAuthority,
        });
      },
    });

    assertEquals(calls, ["loadImportMap", "transform", "cacheHttpImportsToLocal"]);
    assertEquals(
      result.code,
      `import React from "file:///cache/react.mjs";\nexport default React;`,
    );
    assertStrictEquals(result.bundleManifestAuthority, manifestAuthority);
  });

  it("returns null manifest authority when HTTP manifest storage was not acknowledged", async () => {
    const code = 'import value from "file:///cache/http-deadbeef.mjs"; export default value;';

    const result = await transformResolvedModuleSource({
      sourceCode: "export default 1;",
      actualFilePath: "/project/app/page.tsx",
      projectDir: "/project",
      projectId: "project-1",
      normalizedPath: "_vf_modules/app/page.tsx",
      projectSlug: "docs",
      adapter: {} as RuntimeAdapter,
      importMap: { imports: {} },
      log: noopLog,
      transformToEsm: () => Promise.resolve(code),
      cacheHttpImportsToLocal: () => Promise.resolve({ code }),
    });

    assertEquals(result, { code, bundleManifestAuthority: null });
  });

  it("does not log source or absolute paths and rethrows an unknown value unchanged", async () => {
    const sourceCode = "export const proprietaryToken = 's3cr3t-value';";
    const actualFilePath = "/private/tenant/project/app/secret.tsx";
    const coercionFailure = new Error("coercion hook must not run");
    const thrownValue = {
      [Symbol.toPrimitive]() {
        throw coercionFailure;
      },
    };
    const entries: Array<{ message: string; metadata?: unknown }> = [];
    const log = {
      debug(message: string, metadata?: unknown) {
        entries.push({ message, metadata });
      },
      error(message: string, metadata?: unknown) {
        entries.push({ message, metadata });
      },
    };

    let caught: unknown;
    try {
      await transformResolvedModuleSource({
        sourceCode,
        actualFilePath,
        projectDir: "/private/tenant/project",
        projectId: "project-1",
        normalizedPath: "_vf_modules/app/secret.tsx",
        projectSlug: "docs",
        adapter: {} as RuntimeAdapter,
        importMap: { imports: {} },
        log,
        transformToEsm: () => Promise.reject(thrownValue),
      });
    } catch (error) {
      caught = error;
    }

    assertStrictEquals(caught, thrownValue);
    const serializedEntries = JSON.stringify(entries);
    assertEquals(serializedEntries.includes(sourceCode), false);
    assertEquals(serializedEntries.includes("s3cr3t-value"), false);
    assertEquals(serializedEntries.includes(actualFilePath), false);
    assertEquals(
      entries.find((entry) => entry.message.includes("Transform failed"))?.metadata,
      {
        sourceLength: sourceCode.length,
        errorName: "object",
      },
    );
  });

  it("reuses a request-scoped import map without an ambient reload", async () => {
    let loadCalls = 0;
    const importMap = {
      imports: { package: "data:text/javascript,export default 1" },
      scopes: {},
    };

    await transformResolvedModuleSource({
      sourceCode: `export default 1;`,
      actualFilePath: "/project/app/page.tsx",
      projectDir: "/project",
      projectId: "project-1",
      normalizedPath: "_vf_modules/app/page.tsx",
      projectSlug: "docs",
      adapter: {} as RuntimeAdapter,
      importMap,
      log: noopLog,
      loadImportMap: () => {
        loadCalls += 1;
        return Promise.reject(new Error("ambient import-map load must not run"));
      },
      transformToEsm: async (_source, _path, _dir, _adapter, options) => {
        assertEquals(await options.loadImportMap?.(), importMap);
        return "export default 1;";
      },
      cacheHttpImportsToLocal: (code, options) => {
        assertEquals(options.importMap, importMap);
        return Promise.resolve({ code });
      },
    });

    assertEquals(loadCalls, 0);
  });

  it("keeps the request-scoped import map after post-import Promise.resolve poisoning", async () => {
    const importMap = {
      imports: { package: "data:text/javascript,export default 'request'" },
      scopes: {},
    };
    const substitutedMap = {
      imports: { package: "data:text/javascript,export default 'poisoned'" },
      scopes: {},
    };
    const substitutedPromise = Promise.resolve(substitutedMap);
    const resolveDescriptor = Object.getOwnPropertyDescriptor(Promise, "resolve");

    if (resolveDescriptor === undefined) {
      throw new Error("Promise.resolve descriptor is unavailable");
    }

    await transformResolvedModuleSource({
      sourceCode: `export default 1;`,
      actualFilePath: "/project/app/page.tsx",
      projectDir: "/project",
      projectId: "project-1",
      normalizedPath: "_vf_modules/app/page.tsx",
      projectSlug: "docs",
      adapter: {} as RuntimeAdapter,
      importMap,
      log: noopLog,
      transformToEsm: async (_source, _path, _dir, _adapter, options) => {
        Object.defineProperty(Promise, "resolve", {
          ...resolveDescriptor,
          value: () => substitutedPromise,
        });
        try {
          assertEquals(await options.loadImportMap?.(), importMap);
        } finally {
          Object.defineProperty(Promise, "resolve", resolveDescriptor);
        }
        return "export default 1;";
      },
      cacheHttpImportsToLocal: (code, options) => {
        assertEquals(options.importMap, importMap);
        return Promise.resolve({ code });
      },
    });
  });
});
