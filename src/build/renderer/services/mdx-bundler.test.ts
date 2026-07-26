import "#veryfront/schemas/_test-setup.ts";
import "../../../transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
import {
  register as registerContract,
  resolve as resolveContract,
  tryResolve as tryResolveContract,
} from "#veryfront/extensions/contracts.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
import { MDXProvider } from "#veryfront/mdx/index.ts";
import { EsModuleLexer } from "../../../../extensions/ext-bundler-esbuild/src/es-module-lexer.ts";
import { bundleMdx, bundleMDXWithOptions } from "./mdx-bundler.ts";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";

if (!tryResolveContract<ModuleLexer>("ModuleLexer")) {
  registerContract<ModuleLexer>("ModuleLexer", new EsModuleLexer());
}

interface GeneratedMdxModule {
  default: React.ComponentType;
  meta: Record<string, unknown>;
}

async function importGeneratedMdx(code: string): Promise<GeneratedMdxModule> {
  const filePath = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(filePath, code);
    return await import(
      `${toFileUrl(filePath).href}?v=${crypto.randomUUID()}`
    ) as GeneratedMdxModule;
  } finally {
    await Deno.remove(filePath);
  }
}

function CustomHeading({ children }: React.ComponentProps<"h1">): React.ReactElement {
  return React.createElement("h1", { "data-mdx-heading": "custom" }, children);
}

function createBundleResult(): BundleResult {
  return {
    outputs: new Map(),
    errors: [],
    warnings: [],
    dependencies: new Map(),
  };
}

function createOptions(overrides?: Partial<BundlerOptions>): BundlerOptions {
  return {
    sources: [],
    projectDir: "/tmp/test-project",
    mode: "production",
    ...overrides,
  };
}

describe("build/renderer/services/mdx-bundler", () => {
  describe("bundleMdx", () => {
    it("should compile simple MDX content", async () => {
      const source = { path: "/tmp/test-project/pages/test.mdx", content: "# Hello World" };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      await bundleMdx(source, options, result, compileFn);

      const output = result.outputs.get("/tmp/test-project/pages/test.js");
      assertExists(output, "should generate JS output");
      assertEquals(output.type, "js", "output type should be js");
      assertEquals(result.errors, []);

      const generated = await importGeneratedMdx(output.content);
      const html = renderToString(
        React.createElement(
          MDXProvider,
          {
            components: { h1: CustomHeading },
            children: React.createElement(generated.default),
          },
        ),
      );
      assertStringIncludes(html, '<h1 data-mdx-heading="custom">Hello World</h1>');
      assertEquals(generated.meta.slug, "pages/test");
      assertEquals(
        result.dependencies.get(source.path),
        ["react/jsx-runtime", "veryfront/mdx"],
      );
    });

    it("keeps development builds executable on the portable JSX runtime", async () => {
      const projectDir = await Deno.makeTempDir();
      try {
        const source = {
          path: join(projectDir, "development.mdx"),
          content: "# Development",
        };
        const result = createBundleResult();

        await bundleMdx(
          source,
          createOptions({ projectDir, mode: "development" }),
          result,
          () => Promise.resolve(""),
        );

        assertEquals(result.errors, []);
        const output = result.outputs.get(join(projectDir, "development.js"));
        assertExists(output);
        assertEquals(
          result.dependencies.get(source.path),
          ["react/jsx-runtime", "veryfront/mdx"],
        );

        const generated = await importGeneratedMdx(output.content);
        const html = renderToString(React.createElement(generated.default));
        assertStringIncludes(html, '<h1 id="development">Development</h1>');
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("resolves relative source paths against the project directory", async () => {
      const source = { path: "pages/relative.mdx", content: "# Relative" };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, () => Promise.resolve(""));

      const output = result.outputs.get("pages/relative.js");
      assertExists(output);
      const generated = await importGeneratedMdx(output.content);
      assertEquals(generated.meta.slug, "pages/relative");
      assertEquals(result.errors, []);
    });

    it("rejects source paths outside the project directory", async () => {
      const source = { path: "/tmp/outside.mdx", content: "# Outside" };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, () => Promise.resolve(""));

      assertEquals(result.outputs.size, 0);
      assertEquals(result.dependencies.size, 0);
      assertEquals(result.errors.length, 1);
      assertStringIncludes(result.errors[0]!.message, "inside the project directory");
    });

    it("rejects source paths that cannot produce a distinct JavaScript output", async () => {
      const source = { path: "/tmp/test-project/pages/not-mdx.txt", content: "# Invalid" };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, () => Promise.resolve(""));

      assertEquals(result.outputs.size, 0);
      assertEquals(result.dependencies.size, 0);
      assertEquals(result.errors.length, 1);
      assertStringIncludes(result.errors[0]!.message, 'must end with ".mdx"');
    });

    it("should extract frontmatter from MDX content", async () => {
      const source = {
        path: "/tmp/test-project/pages/test.mdx",
        content: "---\ntitle: Test Page\ndescription: A test\n---\n# Hello",
      };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      await bundleMdx(source, options, result, compileFn);

      const output = result.outputs.get("/tmp/test-project/pages/test.js");
      assertExists(output, "should generate output");
      assertExists(output.meta, "should have meta from frontmatter");
      assertEquals(output.meta!.title, "Test Page", "should extract title");
      assertEquals(output.meta!.description, "A test", "should extract description");
    });

    it("uses supported static exports as generated module metadata", async () => {
      const source = {
        path: "/tmp/test-project/pages/exported-meta.mdx",
        content: 'export const title = "Exported title";\n\n# Content',
      };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, () => Promise.resolve(""));

      const output = result.outputs.get("/tmp/test-project/pages/exported-meta.js");
      assertExists(output);
      assertEquals(output.meta?.title, "Exported title");
      const generated = await importGeneratedMdx(output.content);
      assertEquals(generated.meta.title, "Exported title");
    });

    it("should handle MDX content without frontmatter", async () => {
      const source = {
        path: "/tmp/test-project/pages/simple.mdx",
        content: "# Just Content\n\nSome text here.",
      };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      await bundleMdx(source, options, result, compileFn);

      const output = result.outputs.get("/tmp/test-project/pages/simple.js");
      assertExists(output, "should generate output even without frontmatter");
    });

    it("should generate output path by replacing .mdx with .js", async () => {
      const source = {
        path: "/tmp/test-project/pages/about.mdx",
        content: "# About",
      };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      await bundleMdx(source, options, result, compileFn);

      assertEquals(
        result.outputs.has("/tmp/test-project/pages/about.js"),
        true,
        "should replace .mdx with .js in output path",
      );
    });

    it("should track dependencies", async () => {
      const source = {
        path: "/tmp/test-project/pages/dep.mdx",
        content: "# Deps",
      };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      await bundleMdx(source, options, result, compileFn);

      assertEquals(
        result.dependencies.has("/tmp/test-project/pages/dep.mdx"),
        true,
        "should track source file dependencies",
      );
    });

    it("should capture errors without throwing", async () => {
      const source = {
        path: "/tmp/test-project/pages/bad.mdx",
        content: "---\ntitle: Bad\n---\n# Content with {invalid jsx <></>}",
      };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      // bundleMdx catches errors internally
      await bundleMdx(source, options, result, compileFn);

      assertEquals(result.outputs.size, 0);
      assertEquals(result.dependencies.size, 0);
      assertEquals(result.errors.length, 1);
      assertStringIncludes(result.errors[0]!.message, "Could not parse expression");
    });

    it("does not emit a parent module when an imported MDX module fails", async () => {
      const projectDir = await Deno.makeTempDir();
      try {
        const importedPath = `${projectDir}/imported.mdx`;
        await Deno.writeTextFile(importedPath, "# Imported");
        const source = {
          path: `${projectDir}/page.mdx`,
          content: 'import Imported from "./imported.mdx"\n\n<Imported />',
        };
        const result = createBundleResult();
        const options = createOptions({ projectDir });
        const expectedError = new Error("nested compilation failed");

        await bundleMdx(source, options, result, () => Promise.reject(expectedError));

        assertEquals(result.outputs.size, 0);
        assertEquals(result.errors, [expectedError]);
        assertEquals(result.dependencies.size, 0);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("bundles transitive MDX imports with their source paths and dependencies", async () => {
      const projectDir = await Deno.makeTempDir();
      const sectionPath = join(projectDir, "section.mdx");
      const leafPath = join(projectDir, "leaf.mdx");
      await Deno.writeTextFile(sectionPath, "# Section");
      await Deno.writeTextFile(leafPath, "# Leaf");

      try {
        const source = {
          path: join(projectDir, "page.mdx"),
          content: 'import Section from "./section.mdx"\n\n<Section />',
        };
        const result = createBundleResult();
        const compiledSourcePaths: Array<string | undefined> = [];
        const compileNested = (
          nestedSource: string,
          _options: BundlerOptions,
          nestedSourcePath?: string,
        ): Promise<string> => {
          compiledSourcePaths.push(nestedSourcePath);
          return Promise.resolve(
            nestedSource.includes("Section")
              ? 'import Leaf from "./leaf.mdx"; export default Leaf;'
              : 'export default function Leaf() { return "leaf"; }',
          );
        };

        await bundleMdx(source, createOptions({ projectDir }), result, compileNested);

        assertEquals(result.errors, []);
        assertEquals(compiledSourcePaths, [
          sectionPath,
          leafPath,
        ]);
        assertExists(result.outputs.get(join(projectDir, "section.js")));
        assertExists(result.outputs.get(join(projectDir, "leaf.js")));
        assertEquals(
          result.dependencies.get(sectionPath),
          [toFileUrl(join(projectDir, "leaf.js")).href],
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("passes a project-logical path to the real nested MDX compiler", async () => {
      const projectDir = await Deno.makeTempDir();
      const sectionPath = join(projectDir, "section.mdx");
      const componentPath = join(projectDir, "SectionComponent.tsx");
      await Deno.writeTextFile(
        sectionPath,
        'import SectionComponent from "./SectionComponent.tsx"\n\n<SectionComponent />',
      );
      await Deno.writeTextFile(
        componentPath,
        "export default function SectionComponent() { return null; }",
      );

      try {
        const source = {
          path: join(projectDir, "page.mdx"),
          content: 'import Section from "./section.mdx"\n\n<Section />',
        };
        const result = createBundleResult();
        const processor = resolveContract<ContentProcessor>("ContentProcessor");

        await bundleMdx(
          source,
          createOptions({ projectDir }),
          result,
          async (nestedSource, nestedOptions, nestedSourcePath) => {
            const compiled = await processor.compileMdx({
              content: nestedSource,
              filePath: nestedSourcePath,
              mode: nestedOptions.mode,
              outputFormat: "program",
              projectDir: nestedOptions.projectDir,
              providerImportSource: "veryfront/mdx",
              target: "server",
            });
            return compiled.compiledCode;
          },
        );

        assertEquals(result.errors, []);
        const nestedOutput = result.outputs.get(join(projectDir, "section.js"));
        assertExists(nestedOutput);
        assertStringIncludes(
          nestedOutput.content,
          toFileUrl(await Deno.realPath(componentPath)).href,
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("terminates cyclic nested MDX graphs without compiling a module twice", async () => {
      const projectDir = await Deno.makeTempDir();
      const firstPath = join(projectDir, "first.mdx");
      const secondPath = join(projectDir, "second.mdx");
      await Deno.writeTextFile(firstPath, "# First");
      await Deno.writeTextFile(secondPath, "# Second");

      try {
        const source = {
          path: join(projectDir, "page.mdx"),
          content: 'import First from "./first.mdx"\n\n<First />',
        };
        const result = createBundleResult();
        const compileCounts = new Map<string, number>();

        await bundleMdx(
          source,
          createOptions({ projectDir }),
          result,
          (nestedSource, _options, nestedSourcePath) => {
            compileCounts.set(
              nestedSourcePath,
              (compileCounts.get(nestedSourcePath) ?? 0) + 1,
            );
            return Promise.resolve(
              nestedSource.includes("First")
                ? 'import Second from "./second.mdx"; export default Second;'
                : 'import First from "./first.mdx"; export default First;',
            );
          },
        );

        assertEquals(result.errors, []);
        assertEquals(
          compileCounts,
          new Map([
            [firstPath, 1],
            [secondPath, 1],
          ]),
        );
        assertExists(result.outputs.get(join(projectDir, "first.js")));
        assertExists(result.outputs.get(join(projectDir, "second.js")));
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("does not emit a module with an unresolved local dependency", async () => {
      const source = {
        path: "/tmp/test-project/pages/missing-import.mdx",
        content: 'import Missing from "./missing.tsx"\n\n<Missing />',
      };
      const result = createBundleResult();

      await bundleMdx(
        source,
        createOptions(),
        result,
        (src) => Promise.resolve(`export default ${JSON.stringify(src)};`),
      );

      assertEquals(result.outputs.size, 0);
      assertEquals(result.dependencies.size, 0);
      assertEquals(result.errors.length, 1);
      assertStringIncludes(result.errors[0]!.message, "missing.tsx");
    });

    it("rejects a relative MDX import that escapes the project before reading it", async () => {
      const rootDir = await Deno.makeTempDir();
      const projectDir = join(rootDir, "project");
      const pagesDir = join(projectDir, "pages");
      await Deno.mkdir(pagesDir, { recursive: true });
      await Deno.writeTextFile(join(rootDir, "secret.mdx"), "# Host secret");
      let nestedCompileCalls = 0;

      try {
        const source = {
          path: join(pagesDir, "page.mdx"),
          content: 'import Secret from "../../secret.mdx"\n\n<Secret />',
        };
        const result = createBundleResult();

        await bundleMdx(source, createOptions({ projectDir }), result, () => {
          nestedCompileCalls++;
          return Promise.resolve("export default function Secret() {}");
        });

        assertEquals(nestedCompileCalls, 0);
        assertEquals(result.outputs.size, 0);
        assertEquals(result.dependencies.size, 0);
        assertEquals(result.errors.length, 1);
        assertStringIncludes(result.errors[0]!.message, "outside the project directory");
      } finally {
        await Deno.remove(rootDir, { recursive: true });
      }
    });

    it("rejects an outside file URL import before reading it", async () => {
      const rootDir = await Deno.makeTempDir();
      const projectDir = join(rootDir, "project");
      const pagesDir = join(projectDir, "pages");
      const outsidePath = join(rootDir, "outside.mdx");
      await Deno.mkdir(pagesDir, { recursive: true });
      await Deno.writeTextFile(outsidePath, "# Host secret");
      let nestedCompileCalls = 0;

      try {
        const source = {
          path: join(pagesDir, "page.mdx"),
          content: `import Secret from ${
            JSON.stringify(toFileUrl(outsidePath).href)
          }\n\n<Secret />`,
        };
        const result = createBundleResult();

        await bundleMdx(source, createOptions({ projectDir }), result, () => {
          nestedCompileCalls++;
          return Promise.resolve("export default function Secret() {}");
        });

        assertEquals(nestedCompileCalls, 0);
        assertEquals(result.outputs.size, 0);
        assertEquals(result.dependencies.size, 0);
        assertEquals(result.errors.length, 1);
        assertStringIncludes(result.errors[0]!.message, "outside the project directory");
      } finally {
        await Deno.remove(rootDir, { recursive: true });
      }
    });

    it("rejects an MDX symlink whose physical target escapes the project", async () => {
      if (Deno.build.os === "windows") return;

      const rootDir = await Deno.makeTempDir();
      const projectDir = join(rootDir, "project");
      const pagesDir = join(projectDir, "pages");
      const outsidePath = join(rootDir, "outside.mdx");
      await Deno.mkdir(pagesDir, { recursive: true });
      await Deno.writeTextFile(outsidePath, "# Host secret");
      await Deno.symlink(outsidePath, join(pagesDir, "linked.mdx"));
      let nestedCompileCalls = 0;

      try {
        const source = {
          path: join(pagesDir, "page.mdx"),
          content: 'import Secret from "./linked.mdx"\n\n<Secret />',
        };
        const result = createBundleResult();

        await bundleMdx(source, createOptions({ projectDir }), result, () => {
          nestedCompileCalls++;
          return Promise.resolve("export default function Secret() {}");
        });

        assertEquals(nestedCompileCalls, 0);
        assertEquals(result.outputs.size, 0);
        assertEquals(result.dependencies.size, 0);
        assertEquals(result.errors.length, 1);
        assertStringIncludes(result.errors[0]!.message, "outside the project directory");
      } finally {
        await Deno.remove(rootDir, { recursive: true });
      }
    });

    it("leaves bare package specifiers ending in .mdx to the module resolver", async () => {
      const projectDir = await Deno.makeTempDir();
      try {
        const source = {
          path: join(projectDir, "page.mdx"),
          content: 'import PackageDocument from "example-package/content.mdx"\n\n# Package',
        };
        const result = createBundleResult();

        await bundleMdx(source, createOptions({ projectDir }), result, () => {
          throw new Error("bare package imports must not be read as local MDX files");
        });

        assertEquals(result.errors, []);
        assertExists(result.outputs.get(join(projectDir, "page.js")));
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("does not treat import examples inside fenced code blocks as dependencies", async () => {
      const projectDir = await Deno.makeTempDir();
      try {
        const source = {
          path: join(projectDir, "page.mdx"),
          content: [
            "# Import example",
            "",
            "```tsx",
            'import Missing from "./not-a-real-module.tsx"',
            "```",
          ].join("\n"),
        };
        const result = createBundleResult();

        await bundleMdx(source, createOptions({ projectDir }), result, () => {
          throw new Error("code examples must not be processed as module imports");
        });

        assertEquals(result.errors, []);
        const output = result.outputs.get(join(projectDir, "page.js"));
        assertExists(output);
        const generated = await importGeneratedMdx(output.content);
        const html = renderToString(React.createElement(generated.default));
        assertStringIncludes(html, "not-a-real-module.tsx");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rewrites extensionless local imports to the file that was validated", async () => {
      const projectDir = await Deno.makeTempDir();
      const componentPath = join(projectDir, "Component.tsx");
      await Deno.writeTextFile(
        componentPath,
        "export default function Component() { return null; }",
      );
      await Deno.writeTextFile(
        join(projectDir, "Component.js"),
        "export default function LegacyComponent() { return null; }",
      );

      try {
        const source = {
          path: join(projectDir, "page.mdx"),
          content: 'import Component from "./Component"\n\n<Component />',
        };
        const result = createBundleResult();

        await bundleMdx(source, createOptions({ projectDir }), result, () => {
          throw new Error("a TSX import must not use the nested MDX compiler");
        });

        assertEquals(result.errors, []);
        const output = result.outputs.get(join(projectDir, "page.js"));
        assertExists(output);
        assertStringIncludes(output.content, "/Component.tsx");
        assertEquals(
          result.dependencies.get(source.path)?.some((dependency) =>
            dependency.endsWith("/Component.tsx")
          ),
          true,
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("does not infer a second extension for an explicit local import", async () => {
      const projectDir = await Deno.makeTempDir();
      await Deno.writeTextFile(
        join(projectDir, "Component.js.tsx"),
        "export default function Component() { return null; }",
      );

      try {
        const source = {
          path: join(projectDir, "page.mdx"),
          content: 'import Component from "./Component.js"\n\n<Component />',
        };
        const result = createBundleResult();

        await bundleMdx(source, createOptions({ projectDir }), result, () => {
          throw new Error("a TSX import must not use the nested MDX compiler");
        });

        assertEquals(result.outputs.size, 0);
        assertEquals(result.dependencies.size, 0);
        assertEquals(result.errors.length, 1);
        assertStringIncludes(result.errors[0]!.message, "Cannot find module './Component.js'");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("resolves root-relative imports from the project directory", async () => {
      const projectDir = await Deno.makeTempDir();
      const componentPath = join(projectDir, "components", "RootComponent.tsx");
      await Deno.mkdir(join(projectDir, "components"), { recursive: true });
      await Deno.writeTextFile(
        componentPath,
        "export default function RootComponent() { return null; }",
      );

      try {
        const source = {
          path: join(projectDir, "pages", "page.mdx"),
          content: 'import RootComponent from "/components/RootComponent.tsx"\n\n<RootComponent />',
        };
        const result = createBundleResult();

        await bundleMdx(source, createOptions({ projectDir }), result, () => {
          throw new Error("a TSX import must not use the nested MDX compiler");
        });

        assertEquals(result.errors, []);
        const output = result.outputs.get(join(projectDir, "pages", "page.js"));
        assertExists(output);
        assertStringIncludes(output.content, toFileUrl(await Deno.realPath(componentPath)).href);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("validates local import paths without dropping query or fragment suffixes", async () => {
      const projectDir = await Deno.makeTempDir();
      const componentPath = join(projectDir, "Component.tsx");
      await Deno.writeTextFile(
        componentPath,
        "export default function Component() { return null; }",
      );

      try {
        const source = {
          path: join(projectDir, "page.mdx"),
          content: 'import Component from "./Component.tsx?client#preview"\n\n<Component />',
        };
        const result = createBundleResult();

        await bundleMdx(source, createOptions({ projectDir }), result, () => {
          throw new Error("a TSX import must not use the nested MDX compiler");
        });

        assertEquals(result.errors, []);
        const output = result.outputs.get(join(projectDir, "page.js"));
        assertExists(output);
        const dependency = `${toFileUrl(await Deno.realPath(componentPath)).href}?client#preview`;
        assertStringIncludes(output.content, dependency);
        assertEquals(result.dependencies.get(source.path)?.includes(dependency), true);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  describe("bundleMDXWithOptions", () => {
    it("should return code string for simple MDX", async () => {
      const result = await bundleMDXWithOptions({
        content: "# Hello\n\nSimple content.",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
        mode: "production",
      });

      assertEquals(typeof result.code, "string", "should return code string");
      assertExists(result.frontmatter, "should return frontmatter object");
      assertExists(result.dependencies, "should return dependencies array");

      const generated = await importGeneratedMdx(result.code);
      const html = renderToString(
        React.createElement(
          MDXProvider,
          {
            components: { h1: CustomHeading },
            children: React.createElement(generated.default),
          },
        ),
      );
      assertStringIncludes(html, '<h1 data-mdx-heading="custom">Hello</h1>');
      assertEquals(result.dependencies, ["react/jsx-runtime", "veryfront/mdx"]);
    });

    it("passes Unified plugin tuple options through unchanged", async () => {
      const appendParagraph = (options: { text: string }) => (tree: { children: unknown[] }) => {
        tree.children.push({
          type: "paragraph",
          children: [{ type: "text", value: options.text }],
        });
      };
      const pluginOptions = { text: "Plugin tuple applied" };

      const result = await bundleMDXWithOptions({
        content: "# Plugin",
        filePath: "/tmp/plugin.mdx",
        projectDir: "/tmp",
        remarkPlugins: [[appendParagraph, pluginOptions]],
      });

      assertEquals(result.errors, undefined);
      const generated = await importGeneratedMdx(result.code);
      const html = renderToString(React.createElement(generated.default));
      assertStringIncludes(html, "Plugin tuple applied");
    });

    it("rejects source paths outside the declared project boundary", async () => {
      const rootDir = await Deno.makeTempDir();
      const projectDir = join(rootDir, "project");
      await Deno.mkdir(projectDir);

      try {
        const result = await bundleMDXWithOptions({
          content: "# Outside",
          filePath: join(rootDir, "outside.mdx"),
          projectDir,
        });

        assertEquals(result.code, "");
        assertEquals(result.dependencies, []);
        assertEquals(result.errors?.length, 1);
        assertStringIncludes(result.errors![0]!.message, "inside the project directory");
      } finally {
        await Deno.remove(rootDir, { recursive: true });
      }
    });

    it("rejects local imports that escape the declared project boundary", async () => {
      const rootDir = await Deno.makeTempDir();
      const projectDir = join(rootDir, "project");
      await Deno.mkdir(projectDir);
      await Deno.writeTextFile(join(rootDir, "outside.tsx"), "export default null;");

      try {
        const result = await bundleMDXWithOptions({
          content: 'import Outside from "../outside.tsx"\n\n<Outside />',
          filePath: join(projectDir, "page.mdx"),
          projectDir,
        });

        assertEquals(result.code, "");
        assertEquals(result.dependencies, []);
        assertEquals(result.errors?.length, 1);
        assertStringIncludes(result.errors![0]!.message, "outside the project directory");
      } finally {
        await Deno.remove(rootDir, { recursive: true });
      }
    });

    it("validates and canonicalizes local dependencies", async () => {
      const projectDir = await Deno.makeTempDir();
      const componentPath = join(projectDir, "Component.tsx");
      await Deno.writeTextFile(componentPath, "export default function Component() {}");

      try {
        const result = await bundleMDXWithOptions({
          content: 'import Component from "./Component.tsx?client"\n\n<Component />',
          filePath: join(projectDir, "page.mdx"),
          projectDir,
        });
        const dependency = `${toFileUrl(await Deno.realPath(componentPath)).href}?client`;

        assertEquals(result.errors, undefined);
        assertStringIncludes(result.code, dependency);
        assertEquals(result.dependencies.includes(dependency), true);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects local MDX dependencies when no output graph can be emitted", async () => {
      const projectDir = await Deno.makeTempDir();
      await Deno.writeTextFile(join(projectDir, "Nested.mdx"), "# Nested");

      try {
        const result = await bundleMDXWithOptions({
          content: 'import Nested from "./Nested.mdx"\n\n<Nested />',
          filePath: join(projectDir, "page.mdx"),
          projectDir,
        });

        assertEquals(result.code, "");
        assertEquals(result.dependencies, []);
        assertEquals(result.errors?.length, 1);
        assertStringIncludes(result.errors![0]!.message, "cannot emit imported MDX modules");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("should extract frontmatter from content", async () => {
      const result = await bundleMDXWithOptions({
        content: "---\ntitle: My Page\ndescription: A description\n---\n# My Page",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
      });

      assertEquals(result.frontmatter.title, "My Page", "should extract title");
      assertEquals(result.frontmatter.description, "A description", "should extract description");
    });

    it("returns supported static exports as frontmatter", async () => {
      const result = await bundleMDXWithOptions({
        content: 'export const title = "Exported title";\n\n# Content',
        filePath: "/tmp/exported-meta.mdx",
        projectDir: "/tmp",
      });

      assertEquals(result.errors, undefined);
      assertEquals(result.frontmatter.title, "Exported title");
      const generated = await importGeneratedMdx(result.code);
      assertEquals(generated.meta.title, "Exported title");
    });

    it("should handle content without frontmatter", async () => {
      const result = await bundleMDXWithOptions({
        content: "# No Frontmatter",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
      });

      assertEquals(typeof result.code, "string", "should return code");
      assertEquals(
        Object.keys(result.frontmatter).length,
        0,
        "should return empty frontmatter",
      );
    });

    it("should default mode to production", async () => {
      const result = await bundleMDXWithOptions({
        content: "# Test",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
      });

      assertEquals(typeof result.code, "string", "should compile with default mode");
    });

    it("embeds provided globals as module-local values", async () => {
      const injectedValue = 'Injected value"; globalThis.__mdxInjected = true; //';
      const result = await bundleMDXWithOptions({
        content: "# {myGlobal}",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
        globals: { myGlobal: injectedValue },
      });

      const generated = await importGeneratedMdx(result.code);
      const html = renderToString(React.createElement(generated.default));
      assertStringIncludes(html, "Injected value&quot;; globalThis.__mdxInjected = true; //");
      assertEquals(
        (globalThis as Record<string, unknown>).__mdxInjected,
        undefined,
        "compilation must not mutate shared global state",
      );
    });

    it("rejects global keys that cannot be safe module bindings", async () => {
      const result = await bundleMDXWithOptions({
        content: "# Test",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
        globals: { "invalid-name": "value" },
      });

      assertEquals(result.code, "");
      assertEquals(result.dependencies, []);
      assertExists(result.errors);
      assertStringIncludes(result.errors[0]!.message, "invalid-name");
    });

    it("rejects accessor-backed globals without invoking the accessor", async () => {
      let accessorReads = 0;
      const globals: Record<string, string> = {};
      Object.defineProperty(globals, "secret", {
        enumerable: true,
        get() {
          accessorReads++;
          return "hidden";
        },
      });

      const result = await bundleMDXWithOptions({
        content: "# Test",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
        globals,
      });

      assertEquals(accessorReads, 0);
      assertEquals(result.code, "");
      assertEquals(result.dependencies, []);
      assertExists(result.errors);
      assertStringIncludes(result.errors[0]!.message, "must be a data property");
    });

    it("rejects generated metadata collisions instead of returning invalid modules", async () => {
      const result = await bundleMDXWithOptions({
        content: "export const meta = { authored: true }\n\n# Test",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
      });

      assertEquals(result.code, "");
      assertEquals(result.dependencies, []);
      assertExists(result.errors);
      assertStringIncludes(result.errors[0]!.message, "meta");
      assertStringIncludes(result.errors[0]!.message, "already been declared");
    });

    it("should return errors array for invalid MDX", async () => {
      const result = await bundleMDXWithOptions({
        content: "---\ntitle: Test\n---\n# Content with {<<<invalid>>>}",
        filePath: "/tmp/bad.mdx",
        projectDir: "/tmp",
      });

      assertExists(result.errors, "should have errors array");
      assertEquals(result.errors!.length > 0, true, "should contain at least one error");
      assertEquals(result.code, "", "error path should return empty code");
    });
  });
});
