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
 *
 * `compileMarkdown` mirrors the real extension too: Markdown becomes a fixed
 * template whose only import is the bare JSX runtime, so a `.md` file can never
 * contribute a dependency and must not be compiled to find that out.
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
    compileMarkdown: (opts: Record<string, unknown>) => {
      calls.push(String(opts.filePath ?? ""));

      return Promise.resolve({
        compiledCode: [
          `import { jsx as _jsx } from "react/jsx-runtime";`,
          `export default function MDContent() { return _jsx("div", {}); }`,
        ].join("\n"),
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

  // Regression: an extensionless specifier is the common shape in real MDX, and
  // the rewritten absolute URL carries no extension either. Resolving it with a
  // bare existence check reported a file that exists as a missing dependency.
  it("resolves an extensionless sibling an .mdx file imports", async () => {
    const stub = withStubContentProcessor();
    try {
      await withProject(
        {
          "components/snippet.mdx": `import Card from "./Card";\n\n<Card />\n`,
          "components/Card.tsx": `export default () => null;`,
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

          assertEquals(result.missing.length, 0, "an existing file must not be reported missing");
          assertEquals(
            result.imports.some((imp) => imp.absolutePath.endsWith("components/Card.tsx")),
            true,
            "the extension ladder must find the sibling",
          );
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("resolves a directory-index sibling an .mdx file imports", async () => {
    const stub = withStubContentProcessor();
    try {
      await withProject(
        {
          "components/snippet.mdx": `import { Ui } from "./ui";\n\n<Ui />\n`,
          "components/ui/index.tsx": `export const Ui = () => null;`,
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

          assertEquals(result.missing.length, 0, "an existing file must not be reported missing");
          assertEquals(
            result.imports.some((imp) => imp.absolutePath.endsWith("components/ui/index.tsx")),
            true,
            "the index ladder must find the directory entry point",
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

          // The report reaches users verbatim in the "Component has missing
          // dependencies" build error, so it names what the author wrote, not
          // where the server happened to put the project.
          const missing = result.missing[0];
          assertEquals(missing?.specifier, "./Missing.tsx");
          assertEquals(
            `${missing?.specifier} ${missing?.reason}`.includes(projectDir),
            false,
            "a server path must not reach the user-facing report",
          );
          assertEquals(
            `${missing?.specifier} ${missing?.reason}`.includes("file://"),
            false,
            "an internal file URL must not reach the user-facing report",
          );
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

  // Dependency parsing runs on every render, including cache hits. Markdown
  // compiles to a fixed template whose only import is the bare JSX runtime, so
  // the answer is always "no dependencies" and the compile is pure cost.
  it("answers for a .md file without invoking the compiler", async () => {
    const stub = withStubContentProcessor();
    try {
      await withProject(
        { "content/post.md": `# Heading\n\nProse with a [link](https://example.com).\n` },
        async (projectDir) => {
          const adapter = await getLocalAdapter();
          const filePath = join(projectDir, "content/post.md");
          const result = await parseLocalImports(
            await Deno.readTextFile(filePath),
            filePath,
            projectDir,
            adapter,
          );

          assertEquals(result.imports.length, 0);
          assertEquals(result.cssImports.length, 0);
          assertEquals(result.missing.length, 0);
          assertEquals(stub.calls.length, 0, "Markdown must not be compiled to parse its imports");
        },
      );
    } finally {
      stub.restore();
    }
  });

  // Dependency parsing runs on every render, so an uncached compile per render
  // per MDX file is paid on every cache hit, recursively.
  it("compiles unchanged .mdx content once across repeated parses", async () => {
    const stub = withStubContentProcessor();
    try {
      await withProject(
        {
          "components/snippet.mdx": `import Card from "./Card.tsx";\n\n<Card />\n`,
          "components/Card.tsx": `export default () => null;`,
        },
        async (projectDir) => {
          const adapter = await getLocalAdapter();
          const filePath = join(projectDir, "components/snippet.mdx");
          const code = await Deno.readTextFile(filePath);

          const first = await parseLocalImports(code, filePath, projectDir, adapter);
          const second = await parseLocalImports(code, filePath, projectDir, adapter);

          assertEquals(stub.calls.length, 1, "a repeat parse must reuse the compiled output");
          assertEquals(first.imports.length, 1);
          assertEquals(second.imports.length, 1);
          assertEquals(second.imports[0]?.absolutePath, first.imports[0]?.absolutePath);

          // Edited content must never be answered from the previous compile.
          const edited = `import Other from "./Other.tsx";\n\n<Other />\n`;
          await Deno.writeTextFile(join(projectDir, "components/Other.tsx"), `export default 1;`);
          const third = await parseLocalImports(edited, filePath, projectDir, adapter);

          assertEquals(stub.calls.length, 2, "changed content must be compiled again");
          assertEquals(
            third.imports.some((imp) => imp.absolutePath.endsWith("components/Other.tsx")),
            true,
          );
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
