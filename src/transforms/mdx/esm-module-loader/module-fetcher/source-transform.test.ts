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
          dev: true,
          ssr: true,
          reactVersion: "19.1.1",
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
        return Promise.resolve({
          code: `import React from "file:///cache/react.mjs";\nexport default React;`,
        });
      },
    });

    assertEquals(calls, ["transform", "loadImportMap", "cacheHttpImportsToLocal"]);
    assertEquals(result, `import React from "file:///cache/react.mjs";\nexport default React;`);
  });
});
