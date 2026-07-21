import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import {
  isMissingModuleError,
  loadModule,
  type ModuleLoaderConfig,
  transformModuleWithDeps,
} from "./index.ts";
import { getModuleCacheKey } from "./module-cache-lookup.ts";
import { isBuildFailure } from "./build-failure.ts";

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

// sanitizeResources disabled: compiling a real page module starts esbuild's
// long-lived child process, which outlives the test.
describe("module-loader/loadModule build-failure tagging", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
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
});

describe("module-loader/loadModule", () => {
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
