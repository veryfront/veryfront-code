import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { importParserInternals, parseLocalImports } from "./import-parser.ts";
import { rewriteBodyImports } from "../mdx/compiler/import-rewriter.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";

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
  const projectDir = await makeTempDir({ prefix: "vf-import-parser-" });
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

  it("rejects an .mdx import that escapes the project directory", async () => {
    const stub = withStubContentProcessor();
    const rootDir = await makeTempDir({ prefix: "vf-import-parser-boundary-" });
    try {
      const projectDir = join(rootDir, "project");
      const filePath = join(projectDir, "components/snippet.mdx");
      await Deno.mkdir(dirname(filePath), { recursive: true });
      await Deno.writeTextFile(join(rootDir, "secret.tsx"), `export default "private";`);
      const code = `import Secret from "../../secret.tsx";\n\n<Secret />\n`;
      await Deno.writeTextFile(filePath, code);

      const result = await parseLocalImports(
        code,
        filePath,
        projectDir,
        await getLocalAdapter(),
      );

      assertEquals(result.imports.length, 0, "an out-of-project file must not be imported");
      assertEquals(result.missing.length, 1, "an out-of-project import must be rejected");
    } finally {
      stub.restore();
      await Deno.remove(rootDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("rejects an .mdx import through a symlink outside the project directory", async () => {
    const stub = withStubContentProcessor();
    const rootDir = await makeTempDir({ prefix: "vf-import-parser-symlink-" });
    try {
      const projectDir = join(rootDir, "project");
      const filePath = join(projectDir, "pages/index.mdx");
      const externalDir = join(rootDir, "external");
      await Deno.mkdir(dirname(filePath), { recursive: true });
      await Deno.mkdir(externalDir, { recursive: true });
      await Deno.writeTextFile(join(externalDir, "secret.tsx"), `export default "private";`);
      await Deno.symlink(externalDir, join(projectDir, "linked"));
      const code = `import Secret from "../linked/secret.tsx";\n\n<Secret />\n`;
      await Deno.writeTextFile(filePath, code);

      const result = await parseLocalImports(
        code,
        filePath,
        projectDir,
        await getLocalAdapter(),
      );

      assertEquals(result.imports.length, 0, "a symlink escape must not be imported");
      assertEquals(result.missing.length, 1, "a symlink escape must be rejected");
    } finally {
      stub.restore();
      await Deno.remove(rootDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("rejects compiled MDX aliases that escape the project directory", async () => {
    const stub = withStubContentProcessor();
    const rootDir = await makeTempDir({ prefix: "vf-import-parser-alias-boundary-" });
    try {
      const projectDir = join(rootDir, "project");
      const filePath = join(projectDir, "pages/index.mdx");
      await Deno.mkdir(dirname(filePath), { recursive: true });
      await Deno.writeTextFile(join(rootDir, "secret.tsx"), `export default "private";`);
      const code = `import Secret from "@/../secret.tsx";\n\n<Secret />\n`;

      const result = await parseLocalImports(code, filePath, projectDir, await getLocalAdapter());

      assertEquals(result.imports.length, 0, "an alias traversal must not be imported");
      assertEquals(result.missing.length, 1, "an alias traversal must be rejected");
    } finally {
      stub.restore();
      await Deno.remove(rootDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("rejects compiled MDX aliases through symlinks outside the project directory", async () => {
    const stub = withStubContentProcessor();
    const rootDir = await makeTempDir({ prefix: "vf-import-parser-alias-symlink-" });
    try {
      const projectDir = join(rootDir, "project");
      const filePath = join(projectDir, "pages/index.mdx");
      const externalDir = join(rootDir, "external");
      await Deno.mkdir(dirname(filePath), { recursive: true });
      await Deno.mkdir(externalDir, { recursive: true });
      await Deno.writeTextFile(join(externalDir, "secret.tsx"), `export default "private";`);
      await Deno.symlink(externalDir, join(projectDir, "linked"));
      const code = `import Secret from "@/linked/secret.tsx";\n\n<Secret />\n`;

      const result = await parseLocalImports(code, filePath, projectDir, await getLocalAdapter());

      assertEquals(result.imports.length, 0, "an alias symlink escape must not be imported");
      assertEquals(result.missing.length, 1, "an alias symlink escape must be rejected");
    } finally {
      stub.restore();
      await Deno.remove(rootDir, { recursive: true }).catch(() => undefined);
    }
  });

  // Regression: containment validated the symlink's realPath target but then
  // returned the lexical path, so a link retargeted between the check and the
  // eventual readFile escaped the project (TOCTOU). The approved canonical path
  // is what must be recorded and read.
  it("returns the canonical path for an in-project symlinked import", async () => {
    const stub = withStubContentProcessor();
    const rootDir = await makeTempDir({ prefix: "vf-import-parser-canonical-" });
    try {
      const projectDir = join(rootDir, "project");
      const filePath = join(projectDir, "index.mdx");
      await Deno.mkdir(join(projectDir, "real"), { recursive: true });
      await Deno.writeTextFile(join(projectDir, "real/Child.tsx"), `export default () => null;`);
      await Deno.symlink(join(projectDir, "real"), join(projectDir, "linked"));
      const code = [
        `import Child from "./linked/Child.tsx";`,
        `import AliasChild from "@/linked/Child.tsx";`,
        ``,
        `<Child />`,
      ].join("\n");
      await Deno.writeTextFile(filePath, code);

      const result = await parseLocalImports(code, filePath, projectDir, await getLocalAdapter());

      const canonicalChild = await Deno.realPath(join(projectDir, "real/Child.tsx"));
      assertEquals(result.missing.length, 0, "an in-project symlink must resolve");
      assertEquals(result.imports.length, 2);
      for (const imp of result.imports) {
        assertEquals(
          imp.absolutePath,
          canonicalChild,
          "the recorded path must be the approved canonical path, not the symlinked one",
        );
        assertEquals(
          imp.requestedPath,
          join(projectDir, "linked/Child.tsx"),
          "the authored path must remain available for metadata",
        );
        assertEquals(imp.projectContained, true);
      }
      assertEquals(
        result.imports.some((imp) => imp.rewriteSpecifier?.startsWith("file://")),
        true,
        "the compiled file URL must remain available for the final import rewrite",
      );
    } finally {
      stub.restore();
      await Deno.remove(rootDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("rejects a canonical target on another Windows drive", async () => {
    assertEquals(
      importParserInternals.isPathWithinProject("D:/external/secret.tsx", "C:/project"),
      false,
    );
  });

  it("rejects encoded separators in compiled file URLs", () => {
    assertEquals(importParserInternals.fileUrlToPath("file:///project/a%2Fb.tsx"), null);
  });

  it("dispatches file URLs through the captured string intrinsic", () => {
    const shadowed = new String("file:///project/Child.tsx") as unknown as string;
    Object.defineProperty(shadowed, "startsWith", {
      value: () => false,
    });

    assertEquals(importParserInternals.isFileUrlSpecifier(shadowed), true);
  });

  it("preserves backslashes in POSIX file URL paths", () => {
    if (Deno.build.os === "windows") return;
    assertEquals(
      importParserInternals.fileUrlToPath("file:///project/a%5Cb.tsx"),
      "/project/a\\b.tsx",
    );
  });

  // Regression: symlinkSemantics was read as an inherited property, so a
  // marker inherited through the prototype chain (for example Object.prototype
  // pollution with "none") switched realPath() off and an in-project symlink
  // targeting a file outside the project was accepted. Only an own data
  // property is authority, as FSAdapterWrapper captures it.
  it("ignores an inherited symlink-free claim when validating containment", async () => {
    const stub = withStubContentProcessor();
    const rootDir = await makeTempDir({ prefix: "vf-import-parser-inherited-" });
    try {
      const projectDir = join(rootDir, "project");
      const filePath = join(projectDir, "pages/index.mdx");
      const externalDir = join(rootDir, "external");
      await Deno.mkdir(dirname(filePath), { recursive: true });
      await Deno.mkdir(externalDir, { recursive: true });
      await Deno.writeTextFile(join(externalDir, "secret.tsx"), `export default "private";`);
      await Deno.symlink(externalDir, join(projectDir, "linked"));
      const code = `import Secret from "@/linked/secret.tsx";\n\n<Secret />\n`;

      const localFs = (await getLocalAdapter()).fs;
      const pollutedFs = Object.create(
        { symlinkSemantics: "none" },
      ) as RuntimeAdapter["fs"];
      pollutedFs.stat = (path: string) => localFs.stat(path);
      pollutedFs.realPath = (path: string) => localFs.realPath!(path);
      const adapter = { fs: pollutedFs } as RuntimeAdapter;

      const result = await parseLocalImports(code, filePath, projectDir, adapter);

      assertEquals(result.imports.length, 0, "an inherited marker must not skip realPath");
      assertEquals(result.missing.length, 1, "the symlink escape must still be rejected");
    } finally {
      stub.restore();
      await Deno.remove(rootDir, { recursive: true }).catch(() => undefined);
    }
  });

  // Regression: an accepted import was classified from its canonical path, so
  // a stylesheet reached through an in-project symlink whose target carries no
  // .css suffix was processed as JavaScript instead of being registered for
  // HTML inclusion. The requested path names the type; the canonical path is
  // only what gets read.
  it("classifies a symlinked stylesheet from the requested path", async () => {
    const rootDir = await makeTempDir({ prefix: "vf-import-parser-css-classify-" });
    try {
      const projectDir = join(rootDir, "project");
      await Deno.mkdir(projectDir, { recursive: true });
      await Deno.writeTextFile(join(projectDir, "theme-generated"), `.theme { color: red; }`);
      await Deno.symlink(
        join(projectDir, "theme-generated"),
        join(projectDir, "theme.module.css"),
      );
      const filePath = join(projectDir, "pages/index.tsx");
      const code = `import "@/theme.module.css";\nexport default () => null;`;

      const result = await parseLocalImports(code, filePath, projectDir, await getLocalAdapter());

      assertEquals(result.missing.length, 0);
      assertEquals(result.imports.length, 0, "a stylesheet must not be treated as JavaScript");
      assertEquals(result.cssImports.length, 1, "the symlinked stylesheet must stay CSS");
      assertEquals(
        result.cssImports[0]?.absolutePath,
        await Deno.realPath(join(projectDir, "theme.module.css")),
        "the recorded path must still be the approved canonical target",
      );
      assertEquals(result.cssImports[0]?.requestedPath, join(projectDir, "theme.module.css"));
    } finally {
      await Deno.remove(rootDir, { recursive: true }).catch(() => undefined);
    }
  });

  // Regression: stripping trailing separators must preserve a portable Windows
  // drive root too: "C:/" must not become the drive-relative "C:", which
  // resolves against the current directory and breaks every @/ import of a
  // project mounted at a drive root.
  it("resolves compiled aliases when the project directory is a drive root", async () => {
    const adapter = {
      fs: {
        symlinkSemantics: "none" as const,
        resolveFile: (path: string) =>
          Promise.resolve(
            path === "components/Button.tsx" ? "C:/components/Button.tsx" : null,
          ),
      },
    } as unknown as RuntimeAdapter;
    const code = `import { Button } from "@/components/Button.tsx";\nexport default () => Button;`;

    const result = await parseLocalImports(code, "C:/pages/index.tsx", "C:/", adapter);

    assertEquals(result.missing.length, 0, "a drive-root @/ import must resolve");
    assertEquals(result.imports.length, 1);
    assertEquals(result.imports[0]?.absolutePath, "C:/components/Button.tsx");
  });

  it("preserves project-relative paths returned by symlink-free hosted adapters", async () => {
    const adapter = {
      fs: {
        symlinkSemantics: "none" as const,
        resolveFile: (path: string) =>
          Promise.resolve(path.endsWith("components/Button.tsx") ? "components/Button.tsx" : null),
      },
    } as unknown as RuntimeAdapter;
    const code = `import { Button } from "@/components/Button.tsx";\nexport default Button;`;

    const result = await parseLocalImports(
      code,
      "/workspace/project/app/page.tsx",
      "/workspace/project",
      adapter,
    );

    assertEquals(result.missing.length, 0);
    assertEquals(result.imports[0]?.absolutePath, "components/Button.tsx");
    assertEquals(result.imports[0]?.projectContained, true);
  });

  it("preserves hosted CSS module identity separately from its adapter read path", async () => {
    const adapter = {
      fs: {
        symlinkSemantics: "none" as const,
        resolveFile: (path: string) =>
          Promise.resolve(path === "theme.module.css" ? "theme.module.css" : null),
      },
    } as unknown as RuntimeAdapter;
    const code = `import styles from "@/theme.module.css";\nexport default styles.root;`;

    const result = await parseLocalImports(
      code,
      "/workspace/project/app/page.tsx",
      "/workspace/project",
      adapter,
    );

    assertEquals(result.missing.length, 0);
    assertEquals(result.cssImports[0]?.absolutePath, "theme.module.css");
    assertEquals(result.cssImports[0]?.requestedPath, "/workspace/project/theme.module.css");
    assertEquals(result.cssImports[0]?.projectContained, true);
  });

  it("preserves the lexical identity of hosted relative CSS imported from MDX", async () => {
    const stub = withStubContentProcessor();
    try {
      const adapter = {
        fs: {
          symlinkSemantics: "none" as const,
          resolveFile: (path: string) =>
            Promise.resolve(
              path.endsWith("components/theme.module.css") ? "components/theme.module.css" : null,
            ),
        },
      } as unknown as RuntimeAdapter;

      const result = await parseLocalImports(
        `import styles from "./theme.module.css";\n\n<div className={styles.root} />`,
        "/workspace/project/components/Post.mdx",
        "/workspace/project",
        adapter,
      );

      assertEquals(result.missing.length, 0);
      assertEquals(result.cssImports[0]?.absolutePath, "components/theme.module.css");
      assertEquals(
        result.cssImports[0]?.requestedPath,
        "/workspace/project/components/theme.module.css",
      );
    } finally {
      stub.restore();
    }
  });

  it("retains resolved filenames for compiled extensionless MDX imports", async () => {
    const stub = withStubContentProcessor();
    try {
      const adapter = {
        fs: {
          symlinkSemantics: "none" as const,
          resolveFile: (path: string) =>
            Promise.resolve(
              path.endsWith("components/Post")
                ? "components/Post.mdx"
                : path.endsWith("components/Card")
                ? "components/Card/index.tsx"
                : null,
            ),
        },
      } as unknown as RuntimeAdapter;

      const result = await parseLocalImports(
        [
          `import Post from "./Post";`,
          `import Card from "./Card";`,
          `export default [Post, Card];`,
        ].join("\n"),
        "/workspace/project/components/Page.mdx",
        "/workspace/project",
        adapter,
      );

      assertEquals(result.missing, []);
      assertEquals(
        result.imports.map(({ absolutePath, requestedPath, resolvedPath }) => ({
          absolutePath,
          requestedPath,
          resolvedPath,
        })),
        [
          {
            absolutePath: "components/Post.mdx",
            requestedPath: "/workspace/project/components/Post",
            resolvedPath: "/workspace/project/components/Post.mdx",
          },
          {
            absolutePath: "components/Card/index.tsx",
            requestedPath: "/workspace/project/components/Card",
            resolvedPath: "/workspace/project/components/Card/index.tsx",
          },
        ],
      );
    } finally {
      stub.restore();
    }
  });

  it("uses hosted alias resolution to retain extension and directory-index identity", async () => {
    const adapter = {
      fs: {
        symlinkSemantics: "none" as const,
        resolveFile: (path: string) =>
          Promise.resolve(
            path === "content/Post"
              ? "content/Post.mdx"
              : path === "content/Card"
              ? "content/Card/index.mdx"
              : null,
          ),
      },
    } as unknown as RuntimeAdapter;
    const code = [
      `import Post from "@/content/Post";`,
      `import Card from "@/content/Card";`,
      `export default [Post, Card];`,
    ].join("\n");

    const result = await parseLocalImports(
      code,
      "/workspace/project/app/page.tsx",
      "/workspace/project",
      adapter,
    );

    assertEquals(result.missing.length, 0);
    assertEquals(
      result.imports.map(({ absolutePath, requestedPath }) => ({ absolutePath, requestedPath })),
      [
        {
          absolutePath: "content/Post.mdx",
          requestedPath: "/workspace/project/content/Post.mdx",
        },
        {
          absolutePath: "content/Card/index.mdx",
          requestedPath: "/workspace/project/content/Card/index.mdx",
        },
      ],
    );
  });

  it("reports a canonicalization race as a missing import", async () => {
    const projectDir = "/workspace/project";
    const missing = Object.assign(new Error("removed during canonicalization"), { code: "ENOENT" });
    const adapter = {
      fs: {
        symlinkSemantics: "native" as const,
        resolveFile: () => Promise.resolve(`${projectDir}/components/Button.tsx`),
        realPath: (path: string) =>
          path === projectDir ? Promise.resolve(projectDir) : Promise.reject(missing),
      },
    } as unknown as RuntimeAdapter;
    const code = `import { Button } from "@/components/Button.tsx";\nexport default Button;`;

    const result = await parseLocalImports(code, `${projectDir}/app/page.tsx`, projectDir, adapter);

    assertEquals(result.imports.length, 0);
    assertEquals(result.missing.length, 1);
  });

  // Regression: stripping trailing separators turned a projectDir of "/" into
  // "", so the canonical check called realPath("") and every @/ import of a
  // root-mounted project failed, including files that exist inside it.
  it("resolves compiled MDX aliases when the project directory is the filesystem root", async () => {
    const stub = withStubContentProcessor();
    const rootDir = await makeTempDir({ prefix: "vf-import-parser-root-alias-" });
    try {
      const filePath = join(rootDir, "pages/index.mdx");
      await Deno.mkdir(dirname(filePath), { recursive: true });
      await Deno.writeTextFile(join(rootDir, "Badge.tsx"), `export const Badge = () => null;`);
      const aliasPath = join(rootDir, "Badge.tsx").replace(/^\/+/, "");
      const code = `import { Badge } from "@/${aliasPath}";\n\n<Badge />\n`;

      const result = await parseLocalImports(code, filePath, "/", await getLocalAdapter());

      assertEquals(result.missing.length, 0, "a root-mounted @/ import must resolve");
      assertEquals(result.imports.length, 1);
      assertEquals(
        result.imports[0]?.absolutePath,
        await Deno.realPath(join(rootDir, "Badge.tsx")),
      );
    } finally {
      stub.restore();
      await Deno.remove(rootDir, { recursive: true }).catch(() => undefined);
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

  it("reports a cross-project import with its parsed slug, version and path", async () => {
    await withProject(
      {
        "pages/index.tsx":
          `import { Button } from "demo@1.0/@/components/Button";\nexport default () => Button;`,
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

        assertEquals(
          result.crossProjectImports,
          [{
            specifier: "demo@1.0/@/components/Button",
            projectSlug: "demo",
            version: "1.0",
            path: "components/Button",
          }],
          "a cross-project import must be reported for SSR transformation",
        );
        assertEquals(
          result.missing.length,
          0,
          "a cross-project import is not a missing dependency",
        );
      },
    );
  });

  it("short-circuits .css and .json without invoking the compiler", async () => {
    await withProject({}, async (projectDir) => {
      const adapter = await getLocalAdapter();
      // Each source is invalid under the esbuild loader its extension selects,
      // so a file that lost its short circuit would reject instead of parsing.
      const sources: Record<string, string> = {
        "styles/globals.css": `.a { content: "unterminated`,
        "data/config.json": `{ "a": , }`,
      };

      for (const [file, source] of Object.entries(sources)) {
        const result = await parseLocalImports(source, join(projectDir, file), projectDir, adapter);
        assertEquals(result.imports.length, 0, "short-circuited files must never be compiled");
        assertEquals(result.missing.length, 0, "short-circuited files report no missing deps");
      }
    });
  });
});
