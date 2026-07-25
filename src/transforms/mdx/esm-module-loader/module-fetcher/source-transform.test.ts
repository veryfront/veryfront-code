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
        assertEquals(await options.loadImportMap?.(), { imports: {} });
        return `import React from "https://esm.sh/react";\nexport default React;`;
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
        });
      },
    });

    assertEquals(calls, ["loadImportMap", "transform", "cacheHttpImportsToLocal"]);
    assertEquals(result, `import React from "file:///cache/react.mjs";\nexport default React;`);
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
