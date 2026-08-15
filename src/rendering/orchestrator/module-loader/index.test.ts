import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { basename, dirname, join } from "#veryfront/compat/path/index.ts";
import { getMdxEsmCacheDir, runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { buildMdxEsmPathCacheKey } from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import {
  isMissingModuleError,
  isUnresolvedTenantImport,
  loadModule,
  type ModuleLoaderConfig,
  transformModuleWithDeps,
} from "./index.ts";
import { buildModuleTransformCacheVariant, getModuleCacheKey } from "./module-cache-lookup.ts";
import { isBuildFailure, isTenantBuildFailure } from "./build-failure.ts";

async function withModuleLoaderFixture<T>(
  files: Record<string, string>,
  test: (fixture: { projectDir: string; tmpDir: string; config: ModuleLoaderConfig }) => Promise<T>,
): Promise<T> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-module-loader-project-" });
  const tmpDir = await Deno.makeTempDir({ prefix: "vf-module-loader-out-" });
  const adapter = await getLocalAdapter();

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = join(projectDir, relativePath);
      await Deno.mkdir(dirname(absolutePath), { recursive: true });
      await Deno.writeTextFile(absolutePath, content);
    }

    return await test({
      projectDir,
      tmpDir,
      config: {
        projectDir,
        adapter,
        mode: "development",
        moduleCache: new Map(),
        esmCache: new Map(),
      },
    });
  } finally {
    await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
    await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined);
  }
}

function assertTransformedImportPath(code: string, expectedPathPart: string): string {
  const match = code.match(/from\s+"file:\/\/([^"]+)"/);
  assert(match, `expected transformed import in code:\n${code}`);
  const importPath = match[1]!;
  assertStringIncludes(importPath, expectedPathPart);
  return importPath;
}

describe("module-loader/transformModuleWithDeps", () => {
  // The `.ts` cycle case compiles real TypeScript, which starts esbuild's child
  // process; stop it so the test does not leak the handle into a later suite.
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("transforms @/ alias dependencies before rewriting the import to a file URL", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.json": [
          `import { label } from "@/components/Label";`,
          `export const pageLabel = label;`,
        ].join("\n"),
        "components/Label.json": `export const label = "alias-label";`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const fsWithJsonResolve = Object.assign(Object.create(config.adapter.fs), {
          async resolveFile(basePath: string): Promise<string | null> {
            const jsonPath = `${basePath}.json`;
            return await config.adapter.fs.exists(jsonPath) ? jsonPath : null;
          },
        });
        const resolveJsonAdapter = {
          ...config.adapter,
          fs: fsWithJsonResolve,
        };
        const jsonConfig = { ...config, adapter: resolveJsonAdapter };
        const transformedPath = await transformModuleWithDeps(
          join(projectDir, "app/page.json"),
          tmpDir,
          resolveJsonAdapter,
          jsonConfig,
        );
        const transformedCode = await Deno.readTextFile(transformedPath);
        const depPath = assertTransformedImportPath(transformedCode, "/components/Label.json");

        assertStringIncludes(transformedPath, "/app/page.json");
        assertEquals((await Deno.stat(depPath)).isFile, true);
      },
    );
  });

  it("isolates progress listener failures without weakening aborts", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.json": `export const value = "ready";`,
      },
      async ({ projectDir, tmpDir, config }) => {
        let listenerCalls = 0;
        const transformedPath = await transformModuleWithDeps(
          join(projectDir, "app/page.json"),
          tmpDir,
          config.adapter,
          {
            ...config,
            onProgress: () => {
              listenerCalls++;
              throw new Error("observer failure");
            },
          },
        );

        assert(listenerCalls > 0);
        assertEquals((await Deno.stat(transformedPath)).isFile, true);

        const controller = new AbortController();
        controller.abort(new Error("render cancelled"));
        let abortedListenerCalls = 0;
        await assertRejects(
          () =>
            transformModuleWithDeps(
              join(projectDir, "app/page.json"),
              tmpDir,
              config.adapter,
              {
                ...config,
                signal: controller.signal,
                onProgress: () => {
                  abortedListenerCalls++;
                },
              },
            ),
          Error,
          "render cancelled",
        );
        assertEquals(abortedListenerCalls, 0);
      },
    );
  });

  // A dynamic import is how a module graph legitimately breaks a cycle. Before
  // dynamic specifiers were followed, this shape terminated because the cycle
  // edge was invisible; following it eagerly recurses until the worker dies.
  // The race turns a regression into a failure rather than a hung suite.
  it("does not recurse forever when a dynamic import closes a cycle", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.json": [
          `import { a } from "../lib/a.json";`,
          `export const pageValue = a;`,
        ].join("\n"),
        "lib/a.json": [
          `export const a = "cycle";`,
          `export async function later() { return await import("../app/page.json"); }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        let timer = 0;
        const transformed = await Promise.race([
          transformModuleWithDeps(
            join(projectDir, "app/page.json"),
            tmpDir,
            config.adapter,
            config,
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("transform did not terminate")), 10_000);
          }),
        ]).finally(() => clearTimeout(timer));

        assertStringIncludes(transformed, "/app/page.json");

        // The cycle edge is left as the author wrote it, so the runtime
        // resolves it if that branch is ever taken.
        const depCode = await Deno.readTextFile(
          assertTransformedImportPath(
            await Deno.readTextFile(transformed),
            "/lib/a.json",
          ),
        );
        assertStringIncludes(depCode, `import("../app/page.json")`);
      },
    );
  });

  // The `.ts` counterpart of the cycle case, which the `.json` shape above does
  // not exercise: a `.ts` module is persisted as a *content-hashed* `.js`
  // artifact (`app/page.<hash>.js`), and the cycle edge — left un-transformed to
  // break the recursion — is normalised by esbuild to a relative `../app/page.js`
  // that does not match the hashed name. To make that edge resolvable, the cycle
  // target persists a stable non-hashed alias (`app/page.js`) that re-exports
  // its hashed artifact. This test pins both halves: the edge shape and the
  // alias that backs it. (The alias is not yet runtime-verified end to end; if
  // it does not resolve in a real runtime the branch stays broken, no worse than
  // before.)
  it("writes a resolvable alias when a dynamic import closes a .ts cycle", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import { a } from "../lib/a.ts";`,
          `export const pageValue = a;`,
        ].join("\n"),
        "lib/a.ts": [
          `export const a = "cycle";`,
          `export async function later() { return await import("../app/page.ts"); }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        let timer = 0;
        const transformed = await Promise.race([
          transformModuleWithDeps(
            join(projectDir, "app/page.ts"),
            tmpDir,
            config.adapter,
            config,
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("transform did not terminate")), 10_000);
          }),
        ]).finally(() => clearTimeout(timer));

        // The static import to lib/a resolves to its content-hashed artifact.
        const depArtifactPath = assertTransformedImportPath(
          await Deno.readTextFile(transformed),
          "/lib/a.",
        );
        assert(/\/lib\/a\.[0-9a-f]{1,8}\.js$/.test(depArtifactPath), depArtifactPath);

        // The cycle edge survives as the relative `.js` specifier esbuild leaves.
        const depCode = await Deno.readTextFile(depArtifactPath);
        assertStringIncludes(depCode, `import("../app/page.js")`);

        // The alias the edge points at exists next to the hashed artifact and
        // re-exports it, so `../app/page.js` resolves to the real module.
        const aliasPath = join(tmpDir, "app/page.js");
        const aliasCode = await Deno.readTextFile(aliasPath);
        assertStringIncludes(
          aliasCode,
          `export * from "./${basename(transformed)}";`,
        );
      },
    );
  });

  it("resolves relative imports before rewriting them to file URLs", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.json": [
          `import { value } from "../lib/value.json";`,
          `export const pageValue = value;`,
        ].join("\n"),
        "lib/value.json": `export const value = "relative-value";`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const transformedPath = await transformModuleWithDeps(
          join(projectDir, "app/page.json"),
          tmpDir,
          config.adapter,
          config,
        );
        const transformedCode = await Deno.readTextFile(transformedPath);
        const depPath = assertTransformedImportPath(transformedCode, "/lib/value.json");

        assertStringIncludes(transformedPath, "/app/page.json");
        assertEquals((await Deno.stat(depPath)).isFile, true);
      },
    );
  });
});

describe("module-loader/loadModule build-failure tagging", () => {
  it("ignores inherited build-failure tags", () => {
    const buildFailureTag = Symbol.for("veryfront.module-loader.build-failure");
    const tenantBuildFailureTag = Symbol.for("veryfront.module-loader.tenant-build-failure");
    const previousBuildDescriptor = Object.getOwnPropertyDescriptor(
      Error.prototype,
      buildFailureTag,
    );
    const previousTenantDescriptor = Object.getOwnPropertyDescriptor(
      Error.prototype,
      tenantBuildFailureTag,
    );
    Object.defineProperty(Error.prototype, buildFailureTag, { configurable: true, value: true });
    Object.defineProperty(Error.prototype, tenantBuildFailureTag, {
      configurable: true,
      value: true,
    });

    try {
      const frameworkError = new Error("framework failed");
      assertEquals(isBuildFailure(frameworkError), false);
      assertEquals(isTenantBuildFailure(frameworkError), false);

      const accessorTagError = new Error("framework failed");
      let buildGetterRead = false;
      let tenantGetterRead = false;
      Object.defineProperty(accessorTagError, buildFailureTag, {
        configurable: true,
        get() {
          buildGetterRead = true;
          return true;
        },
      });
      Object.defineProperty(accessorTagError, tenantBuildFailureTag, {
        configurable: true,
        get() {
          tenantGetterRead = true;
          return true;
        },
      });

      assertEquals(isBuildFailure(accessorTagError), false);
      assertEquals(isTenantBuildFailure(accessorTagError), false);
      assertEquals(buildGetterRead, false);
      assertEquals(tenantGetterRead, false);
    } finally {
      if (previousBuildDescriptor) {
        Object.defineProperty(Error.prototype, buildFailureTag, previousBuildDescriptor);
      } else {
        delete (Error.prototype as { [buildFailureTag]?: unknown })[buildFailureTag];
      }
      if (previousTenantDescriptor) {
        Object.defineProperty(Error.prototype, tenantBuildFailureTag, previousTenantDescriptor);
      } else {
        delete (Error.prototype as { [tenantBuildFailureTag]?: unknown })[tenantBuildFailureTag];
      }
    }
  });

  // Compiling a real page module starts esbuild's child process; stop it so the
  // test does not leak the handle rather than opting out of the sanitizer.
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  // A page whose module ran and threw is an application bug the project's own
  // error page should present. A page that never compiled is a developer-facing
  // build failure. Only the loader can tell them apart, so it tags the error.
  it("tags a failure from the transform step", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import logo from "@/assets/logo.svg";`,
          `export default function Page() { return logo; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), config),
            Error,
          );

          assertEquals(isBuildFailure(error), true);
        });
      },
    );
  });

  it("does not tag a module that compiled and threw at module scope", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `throw new Error("Missing API key");`,
          `export const value = "unreachable";`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.ts"), config),
            Error,
            "Missing API key",
          );

          assertEquals(isBuildFailure(error), false);
        });
      },
    );
  });

  // A relative import that resolves to nothing is dropped by
  // `resolveModuleDependencies` and survives into the built module as authored,
  // so the failure only surfaces at `import()` time as ERR_MODULE_NOT_FOUND —
  // after the self-heal rebuild has already retried it. That rejection used to
  // leave `loadModule` untagged, so a tenant typo in an import path was
  // reported at error level forever.
  it("tags a missing local static import as a tenant build failure", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "./missing";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), config),
            Error,
          );

          assertEquals(isMissingModuleError(error), true);
          assertEquals(isBuildFailure(error), true);
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  it("tags a missing bare side-effect import as a tenant build failure", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import "./missing";`,
          `export default function Page() { return null; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), config),
            Error,
          );

          assertEquals(isMissingModuleError(error), true);
          assertEquals(isBuildFailure(error), true);
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  it("tags a missing project alias import as a tenant build failure", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "@/components/Missing";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), config),
            Error,
          );

          assertEquals(isMissingModuleError(error), true);
          assertEquals(isBuildFailure(error), true);
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  it("tags a missing project alias import with an explicit source extension", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "@/components/Missing.tsx";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), config),
            Error,
          );

          assertEquals(isMissingModuleError(error), true);
          assertEquals(isBuildFailure(error), true);
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  it("tags missing side-effect imports in every legal declaration position", async () => {
    for (
      const source of [
        `const ready = true; import "./missing"; export default ready;`,
        `import /* preload */ "./missing"; export default null;`,
      ]
    ) {
      await withModuleLoaderFixture(
        { "app/page.tsx": source },
        async ({ projectDir, tmpDir, config }) => {
          await runWithCacheDir(tmpDir, async () => {
            const error = await assertRejects(
              () => loadModule(join(projectDir, "app/page.tsx"), config),
              Error,
            );

            assertEquals(isMissingModuleError(error), true);
            assertEquals(isBuildFailure(error), true);
            assertEquals(isTenantBuildFailure(error), true);
          });
        },
      );
    }
  });

  it("classifies retry failures from only the rebuilt dependency graph", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "./late";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        let createdLateDependency = false;
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () =>
              loadModule(join(projectDir, "app/page.tsx"), {
                ...config,
                onProgress: ({ phase, filePath }) => {
                  if (
                    createdLateDependency ||
                    phase !== "module:persisted" ||
                    filePath !== join(projectDir, "app/page.tsx")
                  ) return;

                  createdLateDependency = true;
                  Deno.writeTextFileSync(
                    join(projectDir, "app/late.ts"),
                    [
                      `import "./framework-missing";`,
                      `export const label = "late";`,
                    ].join("\n"),
                  );
                },
              }),
            Error,
          );

          assertEquals(createdLateDependency, true);
          assertEquals(isMissingModuleError(error), true);
          assertEquals(isBuildFailure(error), true);
          // The first transform dropped `./late`, but the rebuild resolved it.
          // Classification must come from the dependency's separate bare
          // side-effect failure, not stale evidence from build one.
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  // A transform cache hit skips dependency resolution, and the retry path
  // invalidates only the root module's cache entry — so on the rebuild the
  // dependency holding the typo is served from cache and contributes no
  // evidence. Combined with clearing the set before the rebuild, that would
  // leave a dependency-level typo permanently unattributed, including on the
  // very first load. The cache-hit branch replays each module's recorded
  // specifiers to close it. Both loads must classify identically.
  it("attributes a typo in a cached dependency on every load", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "./dep";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
        "app/dep.tsx": [
          `import { gone } from "./gone";`,
          `export const label = gone;`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const pagePath = join(projectDir, "app/page.tsx");

          const first = await assertRejects(() => loadModule(pagePath, config), Error);
          assertEquals(isBuildFailure(first), true);
          assertEquals(isTenantBuildFailure(first), true);

          // Same config, so `config.moduleCache` is warm for `app/dep.tsx`.
          const second = await assertRejects(() => loadModule(pagePath, config), Error);
          assertEquals(isBuildFailure(second), true);
          // Identical failure must not get weaker attribution just because a
          // dependency happened to be cached.
          assertEquals(isTenantBuildFailure(second), true);
        });
      },
    );
  });

  it("attributes a typo below a cached dependency on every load", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "./dep";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
        "app/dep.tsx": [
          `import { nested } from "./nested";`,
          `export const label = nested;`,
        ].join("\n"),
        "app/nested.tsx": [
          `import { gone } from "./gone";`,
          `export const nested = gone;`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const pagePath = join(projectDir, "app/page.tsx");

          const first = await assertRejects(() => loadModule(pagePath, config), Error);
          assertEquals(isBuildFailure(first), true);
          assertEquals(isTenantBuildFailure(first), true);

          const second = await assertRejects(() => loadModule(pagePath, config), Error);
          assertEquals(isBuildFailure(second), true);
          assertEquals(isTenantBuildFailure(second), true);
        });
      },
    );
  });

  it("attributes a typo replayed from a disk-cached dependency", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "./dep";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
        "app/dep.tsx": [
          `import { gone } from "./gone";`,
          `export const label = gone;`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const pagePath = join(projectDir, "app/page.tsx");
          const diskConfig = {
            ...config,
            projectId: "disk-cache-project",
            contentSourceId: "main",
          };

          const first = await assertRejects(() => loadModule(pagePath, diskConfig), Error);
          assertEquals(isTenantBuildFailure(first), true);

          // Mode is part of the process-local cache key but not the persisted
          // MDX path-cache key. Switching it gives this simulated new worker an
          // empty evidence memo while reusing the dependency from _index.json.
          const restartedConfig = {
            ...diskConfig,
            mode: "production" as const,
            moduleCache: new Map<string, string>(),
          };
          const second = await assertRejects(() => loadModule(pagePath, restartedConfig), Error);
          assertEquals(isBuildFailure(second), true);
          assertEquals(isTenantBuildFailure(second), true);
        });
      },
    );
  });

  it("ignores legacy disk cache entries that predate unresolved-import sidecars", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "./dep";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
        "app/dep.tsx": [
          `import { gone } from "./gone";`,
          `export const label = gone;`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const diskConfig = {
            ...config,
            projectId: "legacy-cache-project",
            contentSourceId: "main",
          };
          const legacyCacheDir = join(
            getMdxEsmCacheDir(),
            encodeURIComponent(diskConfig.projectId),
            encodeURIComponent(diskConfig.contentSourceId),
          );
          await Deno.mkdir(join(legacyCacheDir, "app"), { recursive: true });
          const legacyDepArtifact = join(legacyCacheDir, "app/dep.legacy.js");
          await Deno.writeTextFile(
            legacyDepArtifact,
            [`import { gone } from "./gone";`, `export const label = gone;`].join("\n"),
          );
          const legacyPathKey = `mdx-esm-ec841873:19.1.1:_vf_modules/app/dep.js`;
          assertEquals(
            legacyPathKey === buildMdxEsmPathCacheKey("_vf_modules/app/dep.js", "19.1.1"),
            false,
          );
          await Deno.writeTextFile(
            join(legacyCacheDir, "_index.json"),
            JSON.stringify({ [legacyPathKey]: legacyDepArtifact }),
          );

          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), diskConfig),
            Error,
          );
          assertEquals(isBuildFailure(error), true);
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  it("attributes an executed dynamic dependency that failed to transform", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `const dependency = await import("./broken");`,
          `export const value = dependency.value;`,
        ].join("\n"),
        "app/broken.ts": `export const value: = "broken";`,
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.ts"), config),
            Error,
          );

          assertEquals(isMissingModuleError(error), true);
          assertEquals(isBuildFailure(error), true);
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  // The same seam must not launder a framework fault. A module whose imports
  // all resolve, and which then throws while executing, is an application
  // error: it must come back out of `loadModule` untagged on both predicates.
  // Asserting this through the real fixture rather than on a hand-built error
  // is the point — a constructed Error never enters `loadModule`, so it would
  // pass identically if the classification branch were deleted or inverted.
  it("leaves a resolvable import that throws at module scope untagged", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { boom } from "./dep";`,
          `export default function Page() { return boom; }`,
        ].join("\n"),
        "app/dep.tsx": [
          `throw new Error("dependency exploded at module scope");`,
          `export const boom = "unreachable";`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), config),
            Error,
            "dependency exploded at module scope",
          );

          assertEquals(isMissingModuleError(error), false);
          assertEquals(isBuildFailure(error), false);
          assertEquals(isTenantBuildFailure(error), false);
        });
      },
    );
  });
});

// The retry seam sees `ERR_MODULE_NOT_FOUND` for four different causes and may
// only downgrade one of them. `isMissingModuleError` cannot tell them apart, so
// the discrimination is driven by the specifiers the resolver recorded dropping.
describe("module-loader/isUnresolvedTenantImport", () => {
  const REBUILT = "/tmp/out/veryfront-modules/proj-a/app/page.7f3c1d92.js";

  // The runtime names the missing target first and then appends the importer's
  // own location. At this seam the importer is always the rebuilt artifact, so
  // every real message mentions REBUILT somewhere — which is exactly why the
  // predicate may only inspect the first quoted token.
  const missing = () =>
    Object.assign(
      new TypeError(
        'Module not found "file:///tmp/out/veryfront-modules/proj-a/app/missing".\n' +
          `    at file://${REBUILT}:1:23`,
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

  it("classifies a dropped tenant specifier as tenant source", () => {
    assertEquals(isUnresolvedTenantImport(missing(), new Set(["./missing"])), true);
  });

  it("classifies a dropped project alias after its SSR rewrite", () => {
    const aliasMissing = Object.assign(
      new TypeError(
        'Module not found "file:///tmp/out/veryfront-modules/proj-a/_vf_modules/components/Foo.js".\n' +
          `    at file://${REBUILT}:1:23`,
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(
      isUnresolvedTenantImport(aliasMissing, new Set(["@/components/Foo"]), REBUILT),
      true,
    );
  });

  it("classifies an explicit project alias source extension after its SSR rewrite", () => {
    const aliasMissing = Object.assign(
      new TypeError(
        'Module not found "file:///tmp/out/veryfront-modules/proj-a/_vf_modules/components/Missing.js".\n' +
          `    at file://${REBUILT}:1:23`,
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(
      isUnresolvedTenantImport(aliasMissing, new Set(["@/components/Missing.tsx"]), REBUILT),
      true,
    );
  });

  it("does not classify an unrelated missing target alongside a dropped specifier", () => {
    const unrelated = Object.assign(
      new TypeError(
        'Module not found "file:///tmp/out/veryfront-modules/proj-a/app/cycle-alias".\n' +
          `    at file://${REBUILT}:1:23`,
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(isUnresolvedTenantImport(unrelated, new Set(["./missing"]), REBUILT), false);
  });

  // The cycle-breaking branch leaves a resolved target's specifier as authored
  // and relies on an alias the code itself marks as not runtime-verified. That
  // target resolved, so it is never recorded as dropped — and a framework path
  // the repo openly marks unverified must not page as a tenant warning.
  it("does not classify a failure when the resolver dropped nothing", () => {
    assertEquals(isUnresolvedTenantImport(missing(), new Set()), false);
  });

  // Bundle misses are framework infrastructure with dedicated recovery on the
  // outer branch, which the inner catch does not re-check. Exclude them even
  // when the tenant separately has an unresolved import.
  it("does not classify an HTTP-bundle miss even alongside a dropped specifier", () => {
    const bundleError = Object.assign(
      new TypeError(
        'Module not found "file:///tmp/veryfront-http-bundle/http-2b1f9c4e.mjs".',
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(isUnresolvedTenantImport(bundleError, new Set(["./missing"])), false);
  });

  // The missing module can be the rebuilt artifact itself rather than one of
  // its dependencies: a racing cache sweep or a failing cache volume can evict
  // it between persist and import. That is repeated cache eviction — framework
  // infrastructure — and must stay at error severity even when the tenant
  // separately has an unresolved import.
  it("does not classify an evicted rebuilt artifact, even alongside a dropped specifier", () => {
    const evicted = Object.assign(
      new TypeError(`Module not found "file://${REBUILT}?t=1&rebuilt=1".`),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(isUnresolvedTenantImport(evicted, new Set(["./missing"]), REBUILT), false);
    assertEquals(isUnresolvedTenantImport(evicted, new Set(["./missing"])), false);
  });

  // The regression this pins: the importer line also names the rebuilt
  // artifact, so a whole-message `includes` would classify a tenant typo as
  // framework and silently undo the fix.
  it("still classifies a dropped specifier whose importer is the rebuilt artifact", () => {
    const error = missing();

    assertEquals(error.message.includes(REBUILT), true);
    assertEquals(isUnresolvedTenantImport(error, new Set(["./missing"]), REBUILT), true);
  });

  // Node quotes the missing target with single quotes and leaves the importer
  // unquoted: `Cannot find module '/…/missing' imported from /…/page.js`.
  // A double-quote-only match returns "" there, which silently disables the
  // eviction guard on the Node runtime while every Deno test still passes.
  it("reads a single-quoted Node target so the eviction guard still fires", () => {
    const evictedOnNode = Object.assign(
      new Error(`Cannot find module '${REBUILT}' imported from ${REBUILT}`),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(isUnresolvedTenantImport(evictedOnNode, new Set(["./missing"]), REBUILT), false);
  });

  it("classifies a single-quoted Node target that is a dropped specifier", () => {
    const nodeMissing = Object.assign(
      new Error(
        `Cannot find module '/tmp/out/veryfront-modules/proj-a/app/missing' ` +
          `imported from ${REBUILT}`,
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(isUnresolvedTenantImport(nodeMissing, new Set(["./missing"]), REBUILT), true);
  });

  it("does not classify a failure that is not a resolution failure", () => {
    assertEquals(
      isUnresolvedTenantImport(new TypeError("x is not a function"), new Set(["./missing"])),
      false,
    );
  });

  // The runtime reports the *resolved* path, which for a dropped relative
  // specifier lands inside the build's own temp directory. A "does the message
  // mention our temp dir?" heuristic would therefore reject the one case this
  // predicate exists to catch. Pinned so nobody reintroduces it.
  it("classifies a dropped specifier whose resolved path is inside the build temp dir", () => {
    const tmpDir = "/tmp/out";
    const error = missing();

    assertEquals(error.message.includes(tmpDir), true);
    assertEquals(isUnresolvedTenantImport(error, new Set(["./missing"])), true);
  });
});

describe("module-loader/loadModule", () => {
  it("loads a module from an encoded dependency-pin cache directory", async () => {
    await withModuleLoaderFixture(
      { "app/page.ts": `export const value = "pinned";` },
      async ({ projectDir, tmpDir, config }) => {
        const filePath = join(projectDir, "app/page.ts");
        const dependencyPinningCacheKey = "on:z7bg3qnfgtcb";
        const moduleServerOrigin = "https://preview.example.test";
        const cacheVariant = buildModuleTransformCacheVariant(
          dependencyPinningCacheKey,
          moduleServerOrigin,
        );
        assert(cacheVariant);
        const artifactPath = join(
          tmpDir,
          "_pins",
          encodeURIComponent(cacheVariant),
          "app/page.pinned.mjs",
        );
        await Deno.mkdir(dirname(artifactPath), { recursive: true });
        await Deno.writeTextFile(artifactPath, `export const value = "pinned";`);
        config.moduleCache.set(
          getModuleCacheKey(
            filePath,
            undefined,
            projectDir,
            undefined,
            undefined,
            "development",
            dependencyPinningCacheKey,
            moduleServerOrigin,
          ),
          artifactPath,
        );

        await runWithCacheDir(tmpDir, async () => {
          const loaded = await loadModule(filePath, {
            ...config,
            dependencyPinningCacheKey,
            moduleServerOrigin,
          });

          assertEquals(loaded.value, "pinned");
        });
      },
    );
  });

  it("reuses the content-addressed module identity across repeated loads", async () => {
    await withModuleLoaderFixture(
      { "app/page.ts": `export const value = "stable";` },
      async ({ projectDir, tmpDir, config }) => {
        const filePath = join(projectDir, "app/page.ts");
        const productionConfig = { ...config, mode: "production" as const };
        const artifactPath = join(tmpDir, "page.stable.mjs");
        await Deno.writeTextFile(artifactPath, `export const value = "stable";`);
        productionConfig.moduleCache.set(
          getModuleCacheKey(filePath, undefined, projectDir, undefined, undefined, "production"),
          artifactPath,
        );

        await runWithCacheDir(tmpDir, async () => {
          const first = await loadModule(filePath, productionConfig);
          const loadedAt = Date.now();
          while (Date.now() === loadedAt) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          const second = await loadModule(filePath, productionConfig);

          assertStrictEquals(second, first);
        });
      },
    );
  });

  it("loads a new module identity when the cached content artifact changes", async () => {
    await withModuleLoaderFixture(
      { "app/page.ts": `export const value = "stable";` },
      async ({ projectDir, tmpDir, config }) => {
        const filePath = join(projectDir, "app/page.ts");
        const productionConfig = { ...config, mode: "production" as const };
        const cacheKey = getModuleCacheKey(
          filePath,
          undefined,
          projectDir,
          undefined,
          undefined,
          "production",
        );
        const stablePath = join(tmpDir, "page.stable.mjs");
        await Deno.writeTextFile(stablePath, `export const value = "stable";`);
        productionConfig.moduleCache.set(cacheKey, stablePath);

        await runWithCacheDir(tmpDir, async () => {
          const first = await loadModule(filePath, productionConfig);
          const changedPath = join(tmpDir, "page.changed.mjs");
          await Deno.writeTextFile(changedPath, `export const value = "changed";`);
          productionConfig.moduleCache.set(cacheKey, changedPath);
          const changed = await loadModule(filePath, productionConfig);

          assertNotStrictEquals(changed, first);
          assertEquals(changed.value, "changed");
        });
      },
    );
  });
});

describe("module-loader/isMissingModuleError (#2077)", () => {
  it("matches Node/Deno ERR_MODULE_NOT_FOUND by code", () => {
    const error = Object.assign(new Error("boom"), { code: "ERR_MODULE_NOT_FOUND" });
    assertEquals(isMissingModuleError(error), true);
  });

  it("matches the 'Cannot find module' message variant", () => {
    const error = new Error(
      "Cannot find module '/app/.cache/veryfront-mdx-esm/local-main/app/page.7b827689.js' " +
        "imported from /node_modules/veryfront/esm/src/rendering/orchestrator/module-loader/index.js",
    );
    assertEquals(isMissingModuleError(error), true);
  });

  it("matches the 'Module not found' message variant", () => {
    assertEquals(isMissingModuleError(new Error('Module not found "file:///x/page.abc.js"')), true);
  });

  it("does not match unrelated import failures", () => {
    assertEquals(isMissingModuleError(new Error("SyntaxError: Unexpected token")), false);
    assertEquals(isMissingModuleError(new TypeError("x is not a function")), false);
  });

  it("returns false for non-Error values", () => {
    assertEquals(isMissingModuleError("Cannot find module"), false);
    assertEquals(isMissingModuleError(null), false);
    assertEquals(isMissingModuleError(undefined), false);
  });
});
