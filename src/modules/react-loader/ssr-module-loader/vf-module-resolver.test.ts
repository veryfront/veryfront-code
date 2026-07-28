import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { transformResolvedModuleSource } from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/source-transform.ts";
import { findVfModuleImports, resolveVfModuleImports } from "./vf-module-resolver.ts";
import { createSSRImportMapIdentity } from "./import-map-identity.ts";

const noopLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as const;

describe("modules/react-loader/ssr-module-loader/vf-module-resolver", () => {
  describe("findVfModuleImports", () => {
    it("finds /_vf_modules imports and normalizes paths", async () => {
      const code = [
        `import a from "/_vf_modules/react@18/index.js";`,
        `import b from "file:///_vf_modules/lodash@4/chunk.js";`,
      ].join("\n");

      assertEquals(await findVfModuleImports(code), [
        {
          specifier: "/_vf_modules/react@18/index.js",
          path: "_vf_modules/react@18/index.js",
        },
        {
          specifier: "file:///_vf_modules/lodash@4/chunk.js",
          path: "_vf_modules/lodash@4/chunk.js",
        },
      ]);
    });

    it("strips query params from normalized paths", async () => {
      const code = `import a from "/_vf_modules/react@18/index.js?ssr=true";`;
      assertEquals(await findVfModuleImports(code), [
        {
          specifier: "/_vf_modules/react@18/index.js?ssr=true",
          path: "_vf_modules/react@18/index.js",
        },
      ]);
    });

    it("does not match import-looking text in strings or comments", async () => {
      const code = `
        const text = 'from "/_vf_modules/react@18/index.js"';
        // import a from "/_vf_modules/commented.js";
      `;
      assertEquals(await findVfModuleImports(code), []);
    });

    it("returns empty array when code has no /_vf_modules imports", async () => {
      const code = `import x from "./local.js";`;
      assertEquals(await findVfModuleImports(code), []);
    });
  });

  it("propagates one hosted import-map snapshot through nested transforms without ambient reloads", async () => {
    const adapter = {} as RuntimeAdapter;
    const importMaps = [
      {
        imports: { package: "https://modules.example/map-a.ts" },
        scopes: {},
      },
      {
        imports: { package: "https://modules.example/map-b.ts" },
        scopes: {},
      },
    ];
    const observedFingerprints: Array<string | undefined> = [];
    let ambientLoadCalls = 0;

    for (let index = 0; index < importMaps.length; index++) {
      const importMap = importMaps[index]!;
      const importMapIdentity = await createSSRImportMapIdentity(importMap);
      const rewritten = await resolveVfModuleImports(
        `import nested from "/_vf_modules/components/Nested.js";`,
        {
          filePath: "/project/app/page.tsx",
          projectId: "project-1",
          contentSourceId: "preview-main",
          adapter,
          projectDir: "/project",
          importMapIdentity,
        },
        {
          fetchAndCacheModule: async (_path, context) => {
            observedFingerprints.push(context.importMapFingerprint);
            assertEquals(context.importMap, importMapIdentity.importMap);

            await transformResolvedModuleSource({
              sourceCode: `import value from "package";\nexport default value;`,
              actualFilePath: "/project/components/Nested.tsx",
              projectDir: "/project",
              projectId: "project-1",
              normalizedPath: "_vf_modules/components/Nested.js",
              projectSlug: "project-1",
              adapter,
              importMap: context.importMap,
              log: noopLog,
              loadImportMap: () => {
                ambientLoadCalls += 1;
                return Promise.reject(new Error("ambient import-map load must not run"));
              },
              transformToEsm: async (_source, _path, _dir, _adapter, options) => {
                assertEquals(await options.loadImportMap?.(), importMapIdentity.importMap);
                return "export default 1;";
              },
              cacheHttpImportsToLocal: (code, options) => {
                assertEquals(options.importMap, importMapIdentity.importMap);
                return Promise.resolve({ code });
              },
            });

            return `/cache/${context.importMapFingerprint}.mjs`;
          },
        },
      );

      assertEquals(
        rewritten.includes(`file:///cache/${importMapIdentity.fingerprint}.mjs`),
        true,
      );
    }

    assertEquals(ambientLoadCalls, 0);
    assertEquals(
      observedFingerprints,
      await Promise.all(
        importMaps.map((importMap) =>
          createSSRImportMapIdentity(importMap).then((identity) => identity.fingerprint)
        ),
      ),
    );
  });

  it("fails closed when a vf module cannot be resolved", async () => {
    await assertRejects(
      () =>
        resolveVfModuleImports(
          `import missing from "/_vf_modules/components/Missing.js";`,
          {
            filePath: "/project/app/page.tsx",
            projectId: "project-1",
            contentSourceId: "preview-main",
            adapter: {} as RuntimeAdapter,
            projectDir: "/project",
          },
          {
            fetchAndCacheModule: () => Promise.resolve(null),
          },
        ),
      Error,
      "Failed to resolve 1 _vf_modules import",
    );
  });

  it("preserves resolver failure details instead of returning unresolved code", async () => {
    await assertRejects(
      () =>
        resolveVfModuleImports(
          `import missing from "/_vf_modules/components/Missing.js";`,
          {
            filePath: "/project/app/page.tsx",
            projectId: "project-1",
            contentSourceId: "preview-main",
            adapter: {} as RuntimeAdapter,
            projectDir: "/project",
          },
          {
            fetchAndCacheModule: () => Promise.reject(new Error("registry unavailable")),
          },
        ),
      Error,
      "registry unavailable",
    );
  });

  it("fetches one cache artifact for duplicate paths and rewrites every specifier", async () => {
    let fetchCalls = 0;
    const rewritten = await resolveVfModuleImports(
      [
        `import first from "/_vf_modules/components/Button.js?one";`,
        `import second from "/_vf_modules/components/Button.js?two";`,
        `export { first, second };`,
      ].join("\n"),
      {
        filePath: "/project/app/page.tsx",
        projectId: "project-1",
        contentSourceId: "preview-main",
        adapter: {} as RuntimeAdapter,
        projectDir: "/project",
      },
      {
        fetchAndCacheModule: () => {
          fetchCalls++;
          return Promise.resolve("/cache/Button.mjs");
        },
      },
    );

    assertEquals(fetchCalls, 1);
    assertEquals(
      rewritten.match(/file:\/\/\/cache\/Button\.mjs/g)?.length,
      2,
    );
    assertEquals(rewritten.includes("/_vf_modules/"), false);
  });

  it("rejects encoded path traversal before invoking the module fetcher", async () => {
    let fetchCalls = 0;

    await assertRejects(
      () =>
        resolveVfModuleImports(
          `import value from "/_vf_modules/%2e%2e/secrets.js";`,
          {
            filePath: "/project/app/page.tsx",
            projectId: "project-1",
            contentSourceId: "preview-main",
            adapter: {} as RuntimeAdapter,
            projectDir: "/project",
          },
          {
            fetchAndCacheModule: () => {
              fetchCalls++;
              return Promise.resolve("/cache/unexpected.mjs");
            },
          },
        ),
      TypeError,
      "Unsafe _vf_modules import path segment",
    );

    assertEquals(fetchCalls, 0);
  });
});
