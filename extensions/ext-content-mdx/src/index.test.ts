/**
 * ext-content-mdx extension smoke tests.
 *
 * @module extensions/ext-content-mdx/test
 */

import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ContentModuleValues } from "veryfront/extensions/content";

import factory, { MdxContentProcessor } from "./index.ts";

describe("ext-content-mdx factory", () => {
  it("produces an extension whose name is ext-content-mdx", () => {
    const ext = factory();
    assertEquals(ext.name, "ext-content-mdx");
    assertEquals(ext.version, "0.1.0");
  });

  it("declares the ContentProcessor contract", () => {
    const ext = factory();
    assertEquals(ext.contracts?.provides, ["ContentProcessor"]);
    assertEquals(ext.capabilities, []);
  });

  it("registers ContentProcessor when setup runs", async () => {
    const ext = factory();
    let registered: unknown = null;
    const ctx = {
      config: {},
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      provide: (_name: string, impl: unknown) => {
        registered = impl;
      },
      get: () => undefined,
      resolve: () => {
        throw new Error("resolve not used");
      },
    };
    await ext.setup?.(ctx as never);
    assertExists(registered);
    assertEquals(registered instanceof MdxContentProcessor, true);
  });
});

describe("MdxContentProcessor.compileMarkdown", () => {
  it("compiles a trivial markdown document to an ESM module", async () => {
    const impl = new MdxContentProcessor();
    const result = await impl.compileMarkdown({
      mode: "production",
      projectDir: "/tmp",
      content: "# Hello\n\nworld\n",
    });
    assertExists(result.compiledCode);
    assertStringIncludes(result.compiledCode, "export default function MDContent");
    assertEquals(result.headings?.length, 1);
    assertEquals(result.headings?.[0]?.text, "Hello");
  });

  it("exposes rawHtml for markdown preview consumers", async () => {
    const impl = new MdxContentProcessor();
    const result = await impl.compileMarkdown({
      mode: "production",
      projectDir: "/tmp",
      content: "**bold**",
    });
    assertExists(result.rawHtml);
    assertStringIncludes(result.rawHtml!, "<strong>");
  });

  it("applies configured Markdown plugin tuples before sanitization", async () => {
    const appendParagraph = (options: { text: string }) => (tree: { children: unknown[] }) => {
      tree.children.push({
        type: "paragraph",
        children: [{ type: "text", value: options.text }],
      });
    };
    const impl = new MdxContentProcessor();
    const result = await impl.compileMarkdown({
      mode: "production",
      projectDir: "/tmp",
      content: "# Plugins",
      remarkPlugins: [[appendParagraph, { text: "Configured plugin" }]],
    });

    assertStringIncludes(result.rawHtml ?? "", "Configured plugin");
  });

  it("sanitizes HTML introduced by configured rehype plugins", async () => {
    const injectScript = () => (tree: { children: unknown[] }) => {
      tree.children.push({
        type: "element",
        tagName: "script",
        properties: {},
        children: [{ type: "text", value: "globalThis.compromised = true" }],
      });
    };
    const impl = new MdxContentProcessor();
    const result = await impl.compileMarkdown({
      mode: "production",
      projectDir: "/tmp",
      content: "# Safe",
      rehypePlugins: [injectScript],
    });

    assertEquals(result.rawHtml?.includes("<script"), false);
    assertEquals(result.rawHtml?.includes("globalThis.compromised"), false);
  });

  it("rejects MDX-only module values instead of silently ignoring them", async () => {
    const impl = new MdxContentProcessor();

    await assertRejects(
      () =>
        impl.compileMarkdown({
          mode: "production",
          projectDir: "/tmp",
          content: "# Invalid",
          moduleValues: { bindings: { greeting: "Hello" } },
        }),
      TypeError,
      "only supported for MDX",
    );
  });
});

describe("MdxContentProcessor.compileMdx", () => {
  it("compiles trivial mdx content", async () => {
    const impl = new MdxContentProcessor();
    const result = await impl.compileMdx({
      mode: "production",
      projectDir: "/tmp",
      content: "# Title\n\nParagraph\n",
    });
    assertExists(result.compiledCode);
    assertStringIncludes(result.compiledCode, "export default");
  });

  it("keeps both build modes on the portable JSX runtime", async () => {
    const impl = new MdxContentProcessor();
    const production = await impl.compileMdx({
      mode: "production",
      projectDir: "/tmp",
      content: "# Production",
    });
    const development = await impl.compileMdx({
      mode: "development",
      projectDir: "/tmp",
      content: "# Development",
    });

    assertStringIncludes(production.compiledCode, 'from "react/jsx-runtime"');
    assertStringIncludes(development.compiledCode, 'from "react/jsx-runtime"');
    assertEquals(development.compiledCode.includes("react/jsx-dev-runtime"), false);
  });

  it("discovers and rewrites only parser-recognized module imports", async () => {
    const impl = new MdxContentProcessor();
    const result = await impl.compileMdx({
      mode: "production",
      projectDir: "/tmp/project",
      filePath: "/tmp/project/page.mdx",
      content: [
        'import Button from "./Button.tsx"',
        'export const loadPanel = () => import("./Panel.tsx")',
        "",
        "<Button />",
        "",
        "```tsx",
        'import Missing from "./not-a-real-module.tsx"',
        "```",
      ].join("\n"),
    });

    assertStringIncludes(result.compiledCode, "file://");
    assertStringIncludes(result.compiledCode, "/tmp/project/Button.tsx");
    assertStringIncludes(result.compiledCode, "/tmp/project/Panel.tsx");
    assertStringIncludes(result.compiledCode, "not-a-real-module.tsx");
    assertEquals(result.compiledCode.includes("file:///tmp/project/not-a-real-module.tsx"), false);
  });

  it("preserves static export examples inside fenced code", async () => {
    const impl = new MdxContentProcessor();
    const result = await impl.compileMdx({
      mode: "production",
      projectDir: "/tmp",
      content: [
        "```ts",
        'export const title = "Example only";',
        "```",
      ].join("\n"),
    });

    assertEquals(result.frontmatter, {});
    assertStringIncludes(result.compiledCode, "Example only");
  });

  it("preserves export-shaped text inside MDX expressions", async () => {
    const impl = new MdxContentProcessor();
    const result = await impl.compileMdx({
      mode: "production",
      projectDir: "/tmp",
      content: [
        "{`before",
        'export const title = "Expression text";',
        "after`}",
      ].join("\n"),
    });

    assertEquals(result.frontmatter, {});
    assertStringIncludes(result.compiledCode, "Expression text");
  });

  it("injects deterministic local bindings and JSON-serializable exports", async () => {
    const impl = new MdxContentProcessor();
    const result = await impl.compileMdx({
      mode: "production",
      projectDir: "/tmp",
      content: "# {greeting}",
      outputFormat: "program",
      moduleValues: {
        bindings: {
          later: "z",
          greeting: "Hello",
          publishedAt: new Date("2024-01-01T00:00:00.000Z"),
        },
        exports: {
          meta: { publishedAt: new Date("2024-01-01T00:00:00.000Z") },
        },
      },
    });

    assertStringIncludes(result.compiledCode, 'const greeting = "Hello";');
    assertStringIncludes(result.compiledCode, 'const later = "z";');
    assertStringIncludes(result.compiledCode, "export const meta");
    assertStringIncludes(result.compiledCode, '"publishedAt": "2024-01-01T00:00:00.000Z"');
    assertEquals(
      result.compiledCode.indexOf("const greeting") <
        result.compiledCode.indexOf("const later"),
      true,
    );
    assertEquals(result.globals, {
      greeting: "Hello",
      later: "z",
      publishedAt: "2024-01-01T00:00:00.000Z",
    });
  });

  it("rejects injected statement syntax before it can enter generated code", async () => {
    const impl = new MdxContentProcessor();
    const injectedName = "safe = 1; globalThis.__mdxInjected = true; const other";

    await assertRejects(
      () =>
        impl.compileMdx({
          mode: "production",
          projectDir: "/tmp",
          content: "# Invalid",
          outputFormat: "program",
          moduleValues: { bindings: { [injectedName]: "value" } },
        }),
      TypeError,
      "Invalid MDX module value name",
    );
    assertEquals((globalThis as Record<string, unknown>).__mdxInjected, undefined);
  });

  it("rejects accessor-backed module data without invoking the accessor", async () => {
    const impl = new MdxContentProcessor();
    let accessorReads = 0;
    const metadata = {};
    Object.defineProperty(metadata, "secret", {
      enumerable: true,
      get() {
        accessorReads++;
        return "hidden";
      },
    });

    await assertRejects(
      () =>
        impl.compileMdx({
          mode: "production",
          projectDir: "/tmp",
          content: "# Invalid",
          outputFormat: "program",
          moduleValues: { exports: { meta: metadata } },
        }),
      TypeError,
      "must be a data property",
    );
    assertEquals(accessorReads, 0);
  });

  it("rejects accessor-backed binding maps without invoking the accessor", async () => {
    const impl = new MdxContentProcessor();
    let accessorReads = 0;
    const bindings: Record<string, unknown> = {};
    Object.defineProperty(bindings, "greeting", {
      enumerable: true,
      get() {
        accessorReads++;
        return "Hello";
      },
    });

    await assertRejects(
      () =>
        impl.compileMdx({
          mode: "production",
          projectDir: "/tmp",
          content: "# Invalid",
          outputFormat: "program",
          moduleValues: { bindings },
        }),
      TypeError,
      "must be a data property",
    );
    assertEquals(accessorReads, 0);
  });

  it("rejects accessor-backed array elements without invoking the accessor", async () => {
    const impl = new MdxContentProcessor();
    let accessorReads = 0;
    const items: unknown[] = [];
    Object.defineProperty(items, "0", {
      enumerable: true,
      get() {
        accessorReads++;
        return "hidden";
      },
    });
    items.length = 1;

    await assertRejects(
      () =>
        impl.compileMdx({
          mode: "production",
          projectDir: "/tmp",
          content: "# Invalid",
          outputFormat: "program",
          moduleValues: { exports: { items } },
        }),
      TypeError,
      "must be a data property",
    );
    assertEquals(accessorReads, 0);
  });

  it("rejects accessor-backed module-value options without invoking the accessor", async () => {
    const impl = new MdxContentProcessor();
    let accessorReads = 0;
    const moduleValues: ContentModuleValues = {};
    Object.defineProperty(moduleValues, "bindings", {
      enumerable: true,
      get() {
        accessorReads++;
        return { greeting: "Hello" };
      },
    });

    await assertRejects(
      () =>
        impl.compileMdx({
          mode: "production",
          projectDir: "/tmp",
          content: "# Invalid",
          outputFormat: "program",
          moduleValues,
        }),
      TypeError,
      "must be a data property",
    );
    assertEquals(accessorReads, 0);
  });

  it("rejects unknown module-value options instead of silently ignoring typos", async () => {
    const impl = new MdxContentProcessor();
    const moduleValues = {
      binding: { greeting: "Hello" },
    } as unknown as ContentModuleValues;

    await assertRejects(
      () =>
        impl.compileMdx({
          mode: "production",
          projectDir: "/tmp",
          content: "# Invalid",
          outputFormat: "program",
          moduleValues,
        }),
      TypeError,
      'unknown option "binding"',
    );
  });

  it("rejects names declared as both bindings and exports", async () => {
    const impl = new MdxContentProcessor();

    await assertRejects(
      () =>
        impl.compileMdx({
          mode: "production",
          projectDir: "/tmp",
          content: "# Invalid",
          outputFormat: "program",
          moduleValues: {
            bindings: { shared: "local" },
            exports: { shared: "public" },
          },
        }),
      TypeError,
      '"shared" cannot be both a binding and an export',
    );
  });

  it("rejects module values for function-body output", async () => {
    const impl = new MdxContentProcessor();

    await assertRejects(
      () =>
        impl.compileMdx({
          mode: "production",
          projectDir: "/tmp",
          content: "# Invalid",
          outputFormat: "function-body",
          moduleValues: { bindings: { greeting: "Hello" } },
        }),
      TypeError,
      "require program output",
    );
  });

  it("rejects generated modules with duplicate runtime bindings", async () => {
    const impl = new MdxContentProcessor();

    await assertRejects(
      () =>
        impl.compileMdx({
          mode: "production",
          projectDir: "/tmp",
          content: "export const MDXContent = { shadowed: true }\n\n# Invalid",
          outputFormat: "program",
        }),
      SyntaxError,
      "Identifier 'MDXContent' has already been declared",
    );
  });
});
