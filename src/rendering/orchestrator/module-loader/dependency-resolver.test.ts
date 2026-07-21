import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import {
  type ResolvedModuleDependency,
  resolveModuleDependencies,
  rewriteResolvedDependencyImports,
} from "./dependency-resolver.ts";

async function withDependencyFixture<T>(
  files: Record<string, string>,
  test: (fixture: { projectDir: string }) => Promise<T>,
): Promise<T> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-module-deps-project-" });

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = join(projectDir, relativePath);
      await Deno.mkdir(dirname(absolutePath), { recursive: true });
      await Deno.writeTextFile(absolutePath, content);
    }

    return await test({ projectDir });
  } finally {
    await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
  }
}

// Every hand-built fixture below is a static `from "…"` span, so the helper
// stamps `isDynamic: false` instead of repeating it at each call site.
function withStaticSpan<T extends { full: string }>(
  source: string,
  dep: T,
): T & { start: number; end: number; isDynamic: false } {
  const start = source.indexOf(dep.full);
  return { ...dep, start, end: start + dep.full.length, isDynamic: false };
}

describe("module-loader/dependency-resolver", () => {
  it("resolves alias and relative imports while ignoring already transformed file imports", async () => {
    await withDependencyFixture(
      {
        "app/page.tsx": [
          `import { Button } from "@/Button";`,
          `import { value } from "../lib/value";`,
          `import { cached } from "file:///tmp/cached.js";`,
          `export const page = Button + value + cached;`,
        ].join("\n"),
        "components/Button.tsx": `export const Button = "button";`,
        "lib/value.ts": `export const value = "value";`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "app/page.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps.length, 2);
        assertStringIncludes(deps[0]?.depFilePath ?? "", "/components/Button.tsx");
        assertStringIncludes(deps[1]?.depFilePath ?? "", "/lib/value.ts");
      },
    );
  });

  it("rewrites transformed dependency imports to file URLs", () => {
    const source = [
      `import { Button } from "@/Button";`,
      `import { value } from "../lib/value";`,
    ].join("\n");

    const rewritten = rewriteResolvedDependencyImports(source, [
      withStaticSpan(source, {
        full: `from "@/Button"`,
        path: "@/Button",
        relativePath: "Button",
        depFilePath: "/project/components/Button.tsx",
        depTempPath: "/tmp/components/Button.abc.js",
        isLocalLib: false,
      }),
      withStaticSpan(source, {
        full: `from "../lib/value"`,
        path: "../lib/value",
        relativePath: "../lib/value",
        depFilePath: "/project/lib/value.ts",
        depTempPath: "/tmp/lib/value.def.js",
        isLocalLib: false,
      }),
    ]);

    assertStringIncludes(rewritten, `from "file:///tmp/components/Button.abc.js"`);
    assertStringIncludes(rewritten, `from "file:///tmp/lib/value.def.js"`);
  });

  it("rewrites the matched import instead of the same text in an earlier comment", async () => {
    await withDependencyFixture(
      {
        "app/page.tsx": [
          `// Previous example: from "@/Button"`,
          `import { Button } from "@/Button";`,
          `export const page = Button;`,
        ].join("\n"),
        "components/Button.tsx": `export const Button = "button";`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "app/page.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });
        const transformedDeps: Array<ResolvedModuleDependency & { depTempPath: string }> = deps
          .map((dep) => ({ ...dep, depTempPath: "/tmp/components/Button.abc.js" }));

        const rewritten = rewriteResolvedDependencyImports(fileContent, transformedDeps);

        assertStringIncludes(rewritten, `// Previous example: from "@/Button"`);
        assertStringIncludes(
          rewritten,
          `import { Button } from "file:///tmp/components/Button.abc.js";`,
        );
      },
    );
  });
});

describe("module-loader/dependency-resolver: dynamic imports", () => {
  it("resolves a dynamic @/ alias import inside getServerData", async () => {
    await withDependencyFixture(
      {
        "pages/test/e.tsx": [
          `export async function getServerData() {`,
          `  const { hashOf } = await import("@/lib/uses-crypto");`,
          `  return { props: { hashed: hashOf("hello") } };`,
          `}`,
        ].join("\n"),
        "lib/uses-crypto.ts": `export const hashOf = (v) => v;`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "pages/test/e.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps.length, 1);
        assertEquals(deps[0]?.isDynamic, true);
        assertEquals(deps[0]?.depFilePath, join(projectDir, "lib/uses-crypto.ts"));

        // The rewrite must replace only the quoted specifier, leaving
        // `await import(...)` intact.
        const rewritten = rewriteResolvedDependencyImports(fileContent, [
          { ...deps[0]!, depTempPath: "/tmp/out/lib/uses-crypto.abc.js" },
        ]);
        assertStringIncludes(
          rewritten,
          `await import("file:///tmp/out/lib/uses-crypto.abc.js")`,
        );
      },
    );
  });

  it("resolves a dynamic relative import that carries a .ts extension", async () => {
    await withDependencyFixture(
      {
        "pages/test/f.tsx": [
          `export async function getServerData() {`,
          `  const { hashOf } = await import("../../lib/uses-crypto.ts");`,
          `  return { props: { hashed: hashOf("hello") } };`,
          `}`,
        ].join("\n"),
        "lib/uses-crypto.ts": `export const hashOf = (v) => v;`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "pages/test/f.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps.length, 1);
        assertEquals(deps[0]?.isDynamic, true);
        assertEquals(deps[0]?.depFilePath, join(projectDir, "lib/uses-crypto.ts"));
      },
    );
  });

  it("still resolves static imports alongside dynamic ones", async () => {
    await withDependencyFixture(
      {
        "pages/test/mixed.tsx": [
          `import { Button } from "@/Button";`,
          `export async function getServerData() {`,
          `  const { value } = await import("../../lib/value");`,
          `  return { props: { value } };`,
          `}`,
          `export default () => Button;`,
        ].join("\n"),
        "components/Button.tsx": `export const Button = "button";`,
        "lib/value.ts": `export const value = "value";`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "pages/test/mixed.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps.length, 2);
        assertEquals(deps.filter((d) => d.isDynamic).length, 1);
        assertEquals(deps.filter((d) => !d.isDynamic).length, 1);
        assertEquals(deps.every((d) => d.depFilePath !== null), true);
      },
    );
  });

  it("ignores a dynamic import whose specifier is not a literal", async () => {
    await withDependencyFixture(
      {
        "pages/test/dyn.tsx": [
          `export async function getServerData(ctx) {`,
          `  const mod = await import(ctx.query.get("mod"));`,
          `  return { props: { mod } };`,
          `}`,
        ].join("\n"),
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "pages/test/dyn.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps.length, 0);
      },
    );
  });
});
