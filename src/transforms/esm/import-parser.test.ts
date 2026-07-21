import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { parseLocalImports } from "./import-parser.ts";
import { rewriteBodyImports } from "../mdx/compiler/import-rewriter.ts";

/**
 * Stand in for the MDX extension, which is not loaded in unit tests. It turns
 * MDX into a JSX module carrying the source's import statements, and rewrites
 * those imports with the same `rewriteBodyImports` the real extension calls,
 * for the target it was given. That rewrite is the whole point: at the "server"
 * target it turns `./Child.tsx` into an absolute `file://` URL, and a stub that
 * skipped it could not see what the parser does with the result.
 */
function withStubContentProcessor(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  register("ContentProcessor", {
    compileMdx: (opts: Record<string, unknown>) => {
      const content = String(opts.content ?? "");
      const filePath = String(opts.filePath ?? "");
      calls.push(filePath);

      const imports = content.split("\n").filter((line) => line.startsWith("import "));
      const body = filePath
        ? rewriteBodyImports(imports.join("\n"), {
          filePath,
          target: (opts.target as "browser" | "server") ?? "server",
        })
        : imports.join("\n");

      return Promise.resolve({
        compiledCode: `${body}\nexport default function MDXContent() { return null; }`,
        frontmatter: undefined,
      });
    },
  });
  return { calls, restore: () => unregister("ContentProcessor") };
}

async function withProject<T>(
  files: Record<string, string>,
  test: (projectDir: string) => Promise<T>,
): Promise<T> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-import-parser-" });
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = join(projectDir, relativePath);
      await Deno.mkdir(dirname(absolutePath), { recursive: true });
      await Deno.writeTextFile(absolutePath, content);
    }
    return await test(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
  }
}

describe("transforms/esm/import-parser", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  it("parses imports from a .tsx file", async () => {
    await withProject(
      {
        "pages/index.tsx":
          `import { Button } from "@/components/Button";\nexport default () => Button;`,
        "components/Button.tsx": `export const Button = "b";`,
      },
      async (projectDir) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "pages/index.tsx");
        const result = await parseLocalImports(
          await Deno.readTextFile(filePath),
          filePath,
          projectDir,
          adapter,
        );

        assertEquals(result.missing.length, 0);
        assertEquals(result.imports.length, 1);
      },
    );
  });

  it("parses imports out of an .mdx file instead of failing to lex it", async () => {
    const stub = withStubContentProcessor();
    try {
      // MDX is not JSX. Handing the raw source to esbuild under the `jsx` loader
      // failed with "<stdin>:1:1: ERROR: Syntax error", which reached users as
      // "Component has missing dependencies" naming a file that exists.
      await withProject(
        {
          "components/snippet.mdx": [
            `import { Badge } from "@/components/Badge";`,
            ``,
            `## Snippet`,
            ``,
            "This is a piece of MDX with `code` in it.",
            ``,
            `- point one`,
            `- point two`,
            ``,
            `<Badge />`,
          ].join("\n"),
          "components/Badge.tsx": `export const Badge = () => null;`,
        },
        async (projectDir) => {
          const adapter = await getLocalAdapter();
          const filePath = join(projectDir, "components/snippet.mdx");
          const result = await parseLocalImports(
            await Deno.readTextFile(filePath),
            filePath,
            projectDir,
            adapter,
          );

          assertEquals(result.missing.length, 0);
          assertEquals(
            result.imports.some((imp) => imp.absolutePath.endsWith("components/Badge.tsx")),
            true,
          );
          // The MDX went through the content compiler rather than straight to esbuild.
          assertEquals(stub.calls.length, 1);
        },
      );
    } finally {
      stub.restore();
    }
  });

  // Regression: the content compile runs with the "server" target, which
  // rewrites `./Child.tsx` to an absolute file:// URL before the lexer sees it.
  // Only `./`, `../` and `@/` were recognised, so the sibling was dropped
  // without even being reported as missing, and never recursively transformed.
  it("tracks a sibling component an .mdx file imports relatively", async () => {
    const stub = withStubContentProcessor();
    try {
      await withProject(
        {
          "components/snippet.mdx": [
            `import Child from "./Child.tsx";`,
            `import Parent from "../layout/Parent.tsx";`,
            ``,
            `<Child />`,
          ].join("\n"),
          "components/Child.tsx": `export default () => null;`,
          "layout/Parent.tsx": `export default () => null;`,
        },
        async (projectDir) => {
          const adapter = await getLocalAdapter();
          const filePath = join(projectDir, "components/snippet.mdx");
          const result = await parseLocalImports(
            await Deno.readTextFile(filePath),
            filePath,
            projectDir,
            adapter,
          );

          assertEquals(result.missing.length, 0);
          assertEquals(
            result.imports.some((imp) => imp.absolutePath.endsWith("components/Child.tsx")),
            true,
            "the sibling component must be tracked",
          );
          assertEquals(
            result.imports.some((imp) => imp.absolutePath.endsWith("layout/Parent.tsx")),
            true,
            "a parent-directory import must be tracked",
          );
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("tracks a stylesheet an .mdx file imports relatively", async () => {
    const stub = withStubContentProcessor();
    try {
      await withProject(
        {
          "components/snippet.mdx": `import "./snippet.css";\n\n# Heading\n`,
          "components/snippet.css": `.snippet { color: red; }`,
        },
        async (projectDir) => {
          const adapter = await getLocalAdapter();
          const filePath = join(projectDir, "components/snippet.mdx");
          const result = await parseLocalImports(
            await Deno.readTextFile(filePath),
            filePath,
            projectDir,
            adapter,
          );

          assertEquals(result.missing.length, 0);
          assertEquals(result.imports.length, 0);
          assertEquals(
            result.cssImports.some((imp) => imp.absolutePath.endsWith("components/snippet.css")),
            true,
            "a relative stylesheet must be registered as a CSS import",
          );
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("reports an .mdx sibling that does not exist as missing", async () => {
    const stub = withStubContentProcessor();
    try {
      await withProject(
        { "components/snippet.mdx": `import Child from "./Missing.tsx";\n\n<Child />\n` },
        async (projectDir) => {
          const adapter = await getLocalAdapter();
          const filePath = join(projectDir, "components/snippet.mdx");
          const result = await parseLocalImports(
            await Deno.readTextFile(filePath),
            filePath,
            projectDir,
            adapter,
          );

          assertEquals(result.imports.length, 0);
          assertEquals(result.missing.length, 1, "a dropped import must be reported, not silent");
          assertEquals(result.missing[0]?.reason.includes("Missing.tsx"), true);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("handles an .mdx file with no imports", async () => {
    const stub = withStubContentProcessor();
    try {
      await withProject(
        { "components/plain.mdx": `# Heading\n\nJust prose, no imports.\n` },
        async (projectDir) => {
          const adapter = await getLocalAdapter();
          const filePath = join(projectDir, "components/plain.mdx");
          const result = await parseLocalImports(
            await Deno.readTextFile(filePath),
            filePath,
            projectDir,
            adapter,
          );

          assertEquals(result.missing.length, 0);
          assertEquals(result.imports.length, 0);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("short-circuits .css and .json without invoking the compiler", async () => {
    await withProject({}, async (projectDir) => {
      const adapter = await getLocalAdapter();
      for (const file of ["styles/globals.css", "data/config.json"]) {
        const result = await parseLocalImports("{}", join(projectDir, file), projectDir, adapter);
        assertEquals(result.imports.length, 0);
        assertEquals(result.missing.length, 0);
      }
    });
  });
});
