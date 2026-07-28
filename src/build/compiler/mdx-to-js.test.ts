import "#veryfront/schemas/_test-setup.ts";
import "../../transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { parseAllImports } from "#veryfront/transforms/import-rewriter/parse-cache.ts";
import { compileMDXToJS } from "./mdx-to-js.ts";

describe("build/compiler/compileMDXToJS", () => {
  afterAll(async () => {
    await esbuild.stop();
  });

  it("emits normal ESM with validated frontmatter and a default component", async () => {
    const projectDir = await Deno.makeTempDir();
    const sourcePath = `${projectDir}/page.mdx`;
    const content = "---\ntitle: Hello\n---\n# Page";
    await Deno.writeTextFile(sourcePath, content);

    try {
      const result = await compileMDXToJS(sourcePath, content, {
        projectDir,
        mode: "production",
        adapter: await runtime.get(),
      });

      assertEquals(result.frontmatter, { title: "Hello" });
      assertStringIncludes(result.code, "frontmatter");
      assertEquals(
        /export\s+(?:default|\{[^}]*\bdefault\b)/.test(result.code),
        true,
      );
      assertEquals(result.code.includes("missing-component"), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("preserves actual imports without matching fenced examples", async () => {
    const projectDir = await Deno.makeTempDir();
    const sourcePath = `${projectDir}/page.mdx`;
    const content = [
      'import Button from "./Button.tsx"',
      "",
      "```js",
      'import Fake from "./fake-example.ts"',
      "```",
      "",
      "<Button />",
    ].join("\n");
    await Deno.writeTextFile(sourcePath, content);

    try {
      const result = await compileMDXToJS(sourcePath, content, {
        projectDir,
        mode: "development",
        adapter: await runtime.get(),
      });
      const parsed = await parseAllImports(result.code);
      const imports = parsed.imports.map(({ specifier }) => specifier);

      assertEquals(imports.includes("./Button.tsx"), true);
      assertEquals(imports.includes("./fake-example.ts"), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects malformed metadata instead of compiling it as content", async () => {
    const projectDir = await Deno.makeTempDir();
    const sourcePath = `${projectDir}/page.mdx`;
    const content = "---\ntitle: [unterminated\n---\n# Page";
    await Deno.writeTextFile(sourcePath, content);
    const adapter = await runtime.get();

    try {
      await assertRejects(() =>
        compileMDXToJS(sourcePath, content, {
          projectDir,
          mode: "production",
          adapter,
        })
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects lexical and symlink source escapes", async () => {
    const root = await Deno.makeTempDir();
    const projectDir = `${root}/project`;
    const outsidePath = `${root}/outside.mdx`;
    const linkedPath = `${projectDir}/linked.mdx`;
    await Deno.mkdir(projectDir);
    await Deno.writeTextFile(outsidePath, "# Outside");
    await Deno.symlink(outsidePath, linkedPath);
    const adapter = await runtime.get();

    try {
      await assertRejects(
        () =>
          compileMDXToJS(outsidePath, "# Outside", {
            projectDir,
            mode: "production",
            adapter,
          }),
        Error,
        "outside",
      );
      await assertRejects(
        () =>
          compileMDXToJS(linkedPath, "# Outside", {
            projectDir,
            mode: "production",
            adapter,
          }),
        Error,
        "outside",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
