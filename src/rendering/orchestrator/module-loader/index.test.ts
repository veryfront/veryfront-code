import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { isMissingModuleError, type ModuleLoaderConfig, transformModuleWithDeps } from "./index.ts";

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
        const depPath = assertTransformedImportPath(transformedCode, "/components/Label.");

        assertStringIncludes(transformedPath, "/app/page.");
        assertEquals(transformedPath.endsWith(".mjs"), true);
        assertEquals((await Deno.stat(depPath)).isFile, true);
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
        const depPath = assertTransformedImportPath(transformedCode, "/lib/value.");

        assertStringIncludes(transformedPath, "/app/page.");
        assertEquals(transformedPath.endsWith(".mjs"), true);
        assertEquals((await Deno.stat(depPath)).isFile, true);
      },
    );
  });

  it("fails immediately when a local dependency cannot be resolved", async () => {
    await withModuleLoaderFixture(
      { "app/page.json": `import value from "../missing.json";` },
      async ({ projectDir, tmpDir, config }) => {
        await assertRejects(
          () =>
            transformModuleWithDeps(
              join(projectDir, "app/page.json"),
              tmpDir,
              config.adapter,
              config,
            ),
          TypeError,
          "Unable to resolve 1 local module dependency",
        );
      },
    );
  });

  it("rejects circular local imports without recursing indefinitely", async () => {
    await withModuleLoaderFixture(
      {
        "app/a.json": `import { b } from "./b.json"; export const a = b;`,
        "app/b.json": `import { a } from "./a.json"; export const b = a;`,
      },
      async ({ projectDir, tmpDir, config }) => {
        await assertRejects(
          () =>
            transformModuleWithDeps(
              join(projectDir, "app/a.json"),
              tmpDir,
              config.adapter,
              config,
            ),
          TypeError,
          "Circular local module dependencies",
        );
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
