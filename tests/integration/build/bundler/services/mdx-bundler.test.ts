import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { writeTextFile } from "#veryfront/testing/deno-compat";
import {
  bundleMdx,
  bundleMDXWithOptions,
} from "../../../../../src/build/renderer/services/mdx-bundler.ts";
import type {
  BundleResult,
  BundlerOptions,
} from "../../../../../src/build/renderer/types/bundler-types.ts";
import { withTestContext } from "../../../../_helpers/context.ts";

function createOptions(projectDir: string): BundlerOptions {
  return {
    sources: [],
    projectDir,
    mode: "development",
  };
}

function createResult(): BundleResult {
  return {
    outputs: new Map(),
    errors: [],
    warnings: [],
    dependencies: new Map(),
  };
}

function compileMDXForImport(_src: string): Promise<string> {
  return Promise.resolve(`export default function() { return "${_src}"; }`);
}

describe("MDX Bundler", () => {
  describe("bundleMdx", () => {
    it("bundles basic MDX content", async () => {
      await withTestContext("mdx-basic", async (context) => {
        const content = `# Hello World

This is a simple MDX document.

## Features

- Markdown
- Components
- Everything!`;

        const source = {
          path: join(context.projectDir, "test.mdx"),
          content,
        };

        const options = createOptions(context.projectDir);
        const result = createResult();

        await bundleMdx(source, options, result, compileMDXForImport);

        const outputPath = source.path.replace(/\.mdx$/, ".js");
        const output = result.outputs.get(outputPath);
        assertExists(output);

        assertEquals(output.type, "js");
        assertEquals(
          output.content.includes("react/jsx-runtime"),
          true,
          "the emitted module imports the jsx runtime it compiles against",
        );
        assertEquals(output.content.includes("export default function"), true);
        assertEquals(output.content.includes("export const meta"), true);
      });
    });

    it("extracts frontmatter", async () => {
      await withTestContext("mdx-frontmatter", async (context) => {
        const content = `---
title: Test Page
description: A test MDX page
author: Test Author
tags:
  - test
  - mdx
---

# Content

This is the body.`;

        const source = {
          path: join(context.projectDir, "page.mdx"),
          content,
        };

        const options = createOptions(context.projectDir);
        const result = createResult();

        await bundleMdx(source, options, result, compileMDXForImport);

        const outputPath = source.path.replace(/\.mdx$/, ".js");
        const output = result.outputs.get(outputPath);
        assertExists(output);

        assertEquals(output.content.includes('"title"'), true);
        assertEquals(output.content.includes("Test Page"), true);
        assertEquals(output.content.includes("Test Author"), true);

        assertExists(output.meta);
        assertEquals(output.meta.title, "Test Page");
        assertEquals(output.meta.description, "A test MDX page");
      });
    });

    it("handles MDX without frontmatter", async () => {
      await withTestContext("mdx-no-frontmatter", async (context) => {
        const content = `# Simple Page

No frontmatter here.`;

        const source = {
          path: join(context.projectDir, "simple.mdx"),
          content,
        };

        const options = createOptions(context.projectDir);
        const result = createResult();

        await bundleMdx(source, options, result, compileMDXForImport);

        const outputPath = source.path.replace(/\.mdx$/, ".js");
        const output = result.outputs.get(outputPath);
        assertExists(output);

        assertEquals(output.content.includes("export const meta"), true);
        assertExists(output.content);
      });
    });

    it("processes MDX imports", async () => {
      await withTestContext("mdx-imports", async (context) => {
        await writeTextFile(
          join(context.projectDir, "imported.mdx"),
          `# Imported Content`,
        );

        const content = `---
title: Main Page
---

import Imported from "./imported.mdx"

# Main Content

<Imported />`;

        const source = {
          path: join(context.projectDir, "main.mdx"),
          content,
        };

        const options = createOptions(context.projectDir);
        const result = createResult();

        let importCompiled = false;
        const compileImport = (_src: string): Promise<string> => {
          importCompiled = true;
          return Promise.resolve(
            `export default function ImportedMDX() { return "Imported"; }`,
          );
        };

        await bundleMdx(source, options, result, compileImport);

        assertEquals(importCompiled, true);

        const importOutputPath = join(context.projectDir, "imported.js");
        assertExists(result.outputs.get(importOutputPath));
      });
    });

    it("processes dynamic MDX imports in multiline JSX attribute expressions", async () => {
      await withTestContext("mdx-multiline-jsx-import", async (context) => {
        const childPath = join(context.projectDir, "child.mdx");
        await writeTextFile(childPath, "# Child");
        const source = {
          path: join(context.projectDir, "page.mdx"),
          content: '<Widget\n  prop={\n\n    import("./child.mdx")\n}>\n</Widget>',
        };
        const result = createResult();
        let compiledImportSource: string | undefined;

        await bundleMdx(
          source,
          createOptions(context.projectDir),
          result,
          (importSource) => {
            compiledImportSource = importSource;
            return Promise.resolve("export default function Child() {}");
          },
        );

        assertEquals(result.errors, []);
        assertEquals(compiledImportSource, "# Child");
        const childOutputPath = join(context.projectDir, "child.js");
        assertExists(result.outputs.get(childOutputPath));
        const pageOutput = result.outputs.get(join(context.projectDir, "page.js"));
        assertExists(pageOutput);
        assertEquals(pageOutput.content.includes(childOutputPath), true);
      });
    });

    it("processes dynamic MDX imports after regex braces in template expressions", async () => {
      await withTestContext("mdx-template-regex-import", async (context) => {
        const childPath = join(context.projectDir, "child.mdx");
        await writeTextFile(childPath, "# Child");
        const source = {
          path: join(context.projectDir, "page.mdx"),
          content: '{`${/}/.test(value) && import("./child.mdx")}`}',
        };
        const result = createResult();
        let compiledImportSource: string | undefined;

        await bundleMdx(
          source,
          createOptions(context.projectDir),
          result,
          (importSource) => {
            compiledImportSource = importSource;
            return Promise.resolve("export default function Child() {}");
          },
        );

        assertEquals(result.errors, []);
        assertEquals(compiledImportSource, "# Child");
        const childOutputPath = join(context.projectDir, "child.js");
        assertExists(result.outputs.get(childOutputPath));
        const pageOutput = result.outputs.get(join(context.projectDir, "page.js"));
        assertExists(pageOutput);
        assertEquals(pageOutput.content.includes(childOutputPath), true);
      });
    });

    it("processes dynamic MDX imports after nested templates with literal braces", async () => {
      await withTestContext("mdx-nested-template-import", async (context) => {
        const childPath = join(context.projectDir, "child.mdx");
        await writeTextFile(childPath, "# Child");
        const source = {
          path: join(context.projectDir, "page.mdx"),
          content: '{`${`}`}${import("./child.mdx")}`}',
        };
        const result = createResult();
        let compiledImportSource: string | undefined;

        await bundleMdx(
          source,
          createOptions(context.projectDir),
          result,
          (importSource) => {
            compiledImportSource = importSource;
            return Promise.resolve("export default function Child() {}");
          },
        );

        assertEquals(result.errors, []);
        assertEquals(compiledImportSource, "# Child");
        const childOutputPath = join(context.projectDir, "child.js");
        assertExists(result.outputs.get(childOutputPath));
        const pageOutput = result.outputs.get(join(context.projectDir, "page.js"));
        assertExists(pageOutput);
        assertEquals(pageOutput.content.includes(childOutputPath), true);
      });
    });

    it("processes MDX imports after escaped backticks and split import keywords", async () => {
      await withTestContext("mdx-escaped-backtick-and-split-import", async (context) => {
        await writeTextFile(join(context.projectDir, "dynamic-child.mdx"), "# Dynamic child");
        await writeTextFile(join(context.projectDir, "static-child.mdx"), "# Static child");
        const source = {
          path: join(context.projectDir, "page.mdx"),
          content: 'import\nStaticChild from "./static-child.mdx"\n\n' +
            '\\` {import("./dynamic-child.mdx")} `later`',
        };
        const result = createResult();
        const compiledSources: string[] = [];

        await bundleMdx(
          source,
          createOptions(context.projectDir),
          result,
          (importSource) => {
            compiledSources.push(importSource);
            return Promise.resolve("export default function Child() {}");
          },
        );

        assertEquals(result.errors, []);
        assertEquals(compiledSources.sort(), ["# Dynamic child", "# Static child"]);
        for (const child of ["dynamic-child.js", "static-child.js"]) {
          const childOutputPath = join(context.projectDir, child);
          assertExists(result.outputs.get(childOutputPath));
          const pageOutput = result.outputs.get(join(context.projectDir, "page.js"));
          assertExists(pageOutput);
          assertEquals(pageOutput.content.includes(childOutputPath), true);
        }
      });
    });

    it("processes MDX imports after regex quotes and in ESM declarations", async () => {
      await withTestContext("mdx-regex-and-esm-imports", async (context) => {
        await writeTextFile(join(context.projectDir, "regex-child.mdx"), "# Regex child");
        await writeTextFile(join(context.projectDir, "esm-child.mdx"), "# ESM child");
        await writeTextFile(join(context.projectDir, "division-child.mdx"), "# Division child");
        const source = {
          path: join(context.projectDir, "page.mdx"),
          content: 'export const child = import("./esm-child.mdx")\n\n' +
            'export const ratio = numerator\n  / (await import("./division-child.mdx")).value\n\n' +
            '{/"/.test(value) && import("./regex-child.mdx")}',
        };
        const result = createResult();
        const compiledSources: string[] = [];

        await bundleMdx(
          source,
          createOptions(context.projectDir),
          result,
          (importSource) => {
            compiledSources.push(importSource);
            return Promise.resolve("export default function Child() {}");
          },
        );

        assertEquals(result.errors, []);
        assertEquals(compiledSources.sort(), [
          "# Division child",
          "# ESM child",
          "# Regex child",
        ]);
        const pageOutput = result.outputs.get(join(context.projectDir, "page.js"));
        assertExists(pageOutput);
        assertEquals(
          pageOutput.content.includes(join(context.projectDir, "division-child.js")),
          true,
        );
        assertEquals(pageOutput.content.includes(join(context.projectDir, "esm-child.js")), true);
        assertEquals(pageOutput.content.includes(join(context.projectDir, "regex-child.js")), true);
      });
    });

    it("processes dependencies across expression, comment, fence, and export boundaries", async () => {
      const scenarios = [
        {
          name: "expression-fence",
          children: ["expression"],
          content: "```js `invalid`\n" +
            '{numerator\n  / /}/.test(value) && import("./expression-child.mdx")}',
        },
        {
          name: "comment",
          children: ["comment"],
          content: "export const commentChild = (() => {\n" +
            '  if (ok) // note\n    /"/.test(value)\n' +
            '  return import("./comment-child.mdx")\n})()',
        },
        {
          name: "split-export",
          children: ["split-dynamic", "split-static"],
          content: 'export\nconst splitChild = import("./split-dynamic-child.mdx")\n\n' +
            'export\n* from "./split-static-child.mdx"',
        },
      ] as const;

      for (const scenario of scenarios) {
        await withTestContext(`mdx-${scenario.name}-boundary`, async (context) => {
          for (const child of scenario.children) {
            await writeTextFile(
              join(context.projectDir, `${child}-child.mdx`),
              `# ${child} child`,
            );
          }
          const result = createResult();
          const compiledSources: string[] = [];

          await bundleMdx(
            { path: join(context.projectDir, "page.mdx"), content: scenario.content },
            createOptions(context.projectDir),
            result,
            (importSource) => {
              compiledSources.push(importSource);
              return Promise.resolve("export default function Child() {}");
            },
          );

          assertEquals(result.errors, []);
          assertEquals(
            compiledSources.sort(),
            scenario.children.map((child) => `# ${child} child`).sort(),
          );
          const pageOutput = result.outputs.get(join(context.projectDir, "page.js"));
          assertExists(pageOutput);
          for (const child of scenario.children) {
            assertEquals(
              pageOutput.content.includes(join(context.projectDir, `${child}-child.js`)),
              true,
            );
          }
        });
      }
    });

    it("validates local imports", async () => {
      await withTestContext("mdx-validate-imports", async (context) => {
        const content = `---
title: Test
---

import NonExistent from "./non-existent.js"

# Content`;

        const source = {
          path: join(context.projectDir, "test.mdx"),
          content,
        };

        const options = createOptions(context.projectDir);
        const result = createResult();

        await bundleMdx(source, options, result, compileMDXForImport);

        assertEquals(result.errors.length > 0, true);
        const hasImportError = result.errors.some((err) =>
          err.message.includes("Cannot find module")
        );
        assertEquals(hasImportError, true);
      });
    });

    it("tracks dependencies", async () => {
      await withTestContext("mdx-dependencies", async (context) => {
        const content = `---
title: Test
---

import Component from "./component.tsx"

# Content`;

        const source = {
          path: join(context.projectDir, "page.mdx"),
          content,
        };

        const options = createOptions(context.projectDir);
        const result = createResult();

        await bundleMdx(source, options, result, compileMDXForImport);

        const deps = result.dependencies.get(source.path);
        assertExists(deps);
        assertEquals(
          deps.includes("react/jsx-runtime"),
          true,
          "the compiled module depends on the jsx runtime, not the react namespace",
        );
      });
    });

    it("handles compilation errors gracefully", async () => {
      await withTestContext("mdx-compile-error", async (context) => {
        const content = `# Test

<Component unclosed=`;

        const source = {
          path: join(context.projectDir, "broken.mdx"),
          content,
        };

        const options = createOptions(context.projectDir);
        const result = createResult();

        await bundleMdx(source, options, result, compileMDXForImport);

        assertEquals(result.errors.length > 0, true);
      });
    });

    it("respects development mode", async () => {
      await withTestContext("mdx-dev-mode", async (context) => {
        const source = {
          path: join(context.projectDir, "dev.mdx"),
          content: `# Development Mode Test`,
        };

        const options = createOptions(context.projectDir);
        const result = createResult();

        await bundleMdx(source, options, result, compileMDXForImport);

        const outputPath = source.path.replace(/\.mdx$/, ".js");
        const output = result.outputs.get(outputPath);
        assertExists(output);

        assertExists(output.content);
      });
    });
  });

  describe("bundleMDXWithOptions", () => {
    it("bundles MDX with custom options", async () => {
      await withTestContext("mdx-with-options", async (context) => {
        const content = `---
title: Custom Options Test
---

# Test Content

Using custom bundler.`;

        const result = await bundleMDXWithOptions({
          content,
          filePath: join(context.projectDir, "test.mdx"),
          projectDir: context.projectDir,
          mode: "production",
        });

        assertExists(result.code);
        assertEquals(
          result.code.includes("react/jsx-runtime"),
          true,
          "the emitted module imports the jsx runtime it compiles against",
        );
        assertEquals(result.code.includes("export default"), true);

        assertExists(result.frontmatter);
        assertEquals(result.frontmatter.title, "Custom Options Test");

        assertEquals(Array.isArray(result.dependencies), true);
      });
    });

    it("handles globals", async () => {
      await withTestContext("mdx-globals", async (context) => {
        const content = `# Test

Using global: {API_URL}`;

        const result = await bundleMDXWithOptions({
          content,
          filePath: join(context.projectDir, "test.mdx"),
          projectDir: context.projectDir,
          mode: "production",
          globals: {
            API_URL: "https://api.example.com",
          },
        });

        assertEquals(result.code.includes("API_URL"), true);
        assertEquals(result.code.includes("globalThis"), true);
      });
    });

    it("handles custom plugins", async () => {
      await withTestContext("mdx-plugins", async (context) => {
        const result = await bundleMDXWithOptions({
          content: `# Test Content`,
          filePath: join(context.projectDir, "test.mdx"),
          projectDir: context.projectDir,
          mode: "production",
          remarkPlugins: [],
          rehypePlugins: [],
        });

        assertExists(result.code);
        assertEquals(result.code.length > 0, true);
      });
    });

    it("returns errors on compilation failure", async () => {
      await withTestContext("mdx-options-error", async (context) => {
        const result = await bundleMDXWithOptions({
          content: `<Component unclosed=`,
          filePath: join(context.projectDir, "broken.mdx"),
          projectDir: context.projectDir,
          mode: "production",
        });

        assertExists(result.errors);
        assertEquals(result.errors.length > 0, true);
        assertEquals(result.code, "");
        assertEquals(Object.keys(result.frontmatter).length, 0);
      });
    });

    it("extracts dependencies correctly", async () => {
      await withTestContext("mdx-deps-extract", async (context) => {
        const content = `---
title: Dependencies Test
---

import Button from "@/components/Button"
import { useState } from "react"

# Content`;

        const result = await bundleMDXWithOptions({
          content,
          filePath: join(context.projectDir, "test.mdx"),
          projectDir: context.projectDir,
          mode: "production",
        });

        assertEquals(Array.isArray(result.dependencies), true);
        assertEquals(result.dependencies.length >= 0, true);
      });
    });

    it("handles empty content", async () => {
      await withTestContext("mdx-empty", async (context) => {
        const result = await bundleMDXWithOptions({
          content: "",
          filePath: join(context.projectDir, "empty.mdx"),
          projectDir: context.projectDir,
          mode: "production",
        });

        assertExists(result.code);
        assertEquals(result.frontmatter, {});
      });
    });

    it("generates correct meta object", async () => {
      await withTestContext("mdx-meta", async (context) => {
        const content = `---
title: Meta Test
description: Testing meta generation
author: Test Author
date: 2024-01-01
custom: value
---

# Content`;

        const result = await bundleMDXWithOptions({
          content,
          filePath: join(context.projectDir, "test.mdx"),
          projectDir: context.projectDir,
          mode: "production",
        });

        assertEquals(result.code.includes("export const meta"), true);
        assertEquals(result.frontmatter.title, "Meta Test");
        assertEquals(result.frontmatter.description, "Testing meta generation");
        assertEquals(result.frontmatter.author, "Test Author");
        assertEquals(result.frontmatter.custom, "value");
      });
    });

    it("defaults to production mode", async () => {
      await withTestContext("mdx-default-mode", async (context) => {
        const result = await bundleMDXWithOptions({
          content: `# Test`,
          filePath: join(context.projectDir, "test.mdx"),
          projectDir: context.projectDir,
        });

        assertExists(result.code);
      });
    });
  });
});
