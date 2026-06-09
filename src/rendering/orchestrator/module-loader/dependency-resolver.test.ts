import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import {
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
      {
        full: `from "@/Button"`,
        path: "@/Button",
        relativePath: "Button",
        depFilePath: "/project/components/Button.tsx",
        depTempPath: "/tmp/components/Button.abc.js",
        isLocalLib: false,
      },
      {
        full: `from "../lib/value"`,
        path: "../lib/value",
        relativePath: "../lib/value",
        depFilePath: "/project/lib/value.ts",
        depTempPath: "/tmp/lib/value.def.js",
        isLocalLib: false,
      },
    ]);

    assertStringIncludes(rewritten, `from "file:///tmp/components/Button.abc.js"`);
    assertStringIncludes(rewritten, `from "file:///tmp/lib/value.def.js"`);
  });
});
