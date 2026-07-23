import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
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

function withSpan<T extends { full: string }>(
  source: string,
  dep: T,
): T & { start: number; end: number } {
  const start = source.indexOf(dep.full);
  return { ...dep, start, end: start + dep.full.length };
}

describe("module-loader/dependency-resolver", () => {
  it("resolves alias and relative imports while ignoring already transformed file imports", async () => {
    await withDependencyFixture(
      {
        "app/page.tsx": [
          `import { Button } from "@/components/Button";`,
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
      withSpan(source, {
        full: `from "@/Button"`,
        path: "@/Button",
        relativePath: "Button",
        depFilePath: "/project/components/Button.tsx",
        depTempPath: "/tmp/components/Button.abc.js",
        isLocalLib: false,
      }),
      withSpan(source, {
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
          `// Previous example: from "@/components/Button"`,
          `import { Button } from "@/components/Button";`,
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

        assertStringIncludes(rewritten, `// Previous example: from "@/components/Button"`);
        assertStringIncludes(
          rewritten,
          `import { Button } from "file:///tmp/components/Button.abc.js";`,
        );
      },
    );
  });

  it("does not resolve an alias through an implicit components fallback", async () => {
    await withDependencyFixture(
      {
        "app/page.tsx": `import { Button } from "@/Button";`,
        "components/Button.tsx": `export const Button = "button";`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "app/page.tsx");
        const deps = await resolveModuleDependencies({
          adapter,
          fileContent: await Deno.readTextFile(filePath),
          filePath,
          projectDir,
        });

        assertEquals(deps[0]?.depFilePath, null);
      },
    );
  });

  it("rejects relative imports that escape the project", async () => {
    await withDependencyFixture(
      { "app/page.tsx": `import value from "../../outside.ts";` },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "app/page.tsx");

        await assertRejects(
          () =>
            resolveModuleDependencies({
              adapter,
              fileContent: `import value from "../../outside.ts";`,
              filePath,
              projectDir,
            }),
          TypeError,
          "must stay inside the project",
        );
      },
    );
  });
});
