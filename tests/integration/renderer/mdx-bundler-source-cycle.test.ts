/**
 * Integration coverage for compatibility-wrapping a source re-export cycle.
 *
 * The temporal-dead-zone behavior requires a real two-file ES module graph, so
 * this cannot remain in the hermetic colocated unit suite.
 */

import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { withTempDir } from "#veryfront/testing/index.ts";
import {
  register,
  resolve as resolveContract,
  tryResolve,
  unregister,
} from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
import { bundleMDXWithOptions } from "#veryfront/build/renderer/services/mdx-bundler.ts";

async function withContractOverride<T>(
  name: string,
  replacement: unknown,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = tryResolve(name);
  unregister(name);
  register(name, replacement);
  try {
    return await operation();
  } finally {
    unregister(name);
    if (previous !== undefined) register(name, previous);
  }
}

function executableEmittedModule(code: string): string {
  const createElementStub =
    "(type, props, ...children) => ({ type, props: { ...props, children } })";
  return code
    .replace(
      /import\s*\{\s*createElement\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*"react";?/g,
      (_statement, local: string) => `const ${local} = ${createElementStub};`,
    )
    .replace(
      /import\s*\{\s*useMDXComponents\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*"veryfront\/mdx";?/g,
      (_statement, local: string) =>
        `const ${local} = (components) => ({ h1: "provider-heading", ...components });`,
    );
}

describe("build/renderer/services/mdx-bundler source re-exports", () => {
  it("loads source cycles without eagerly reading uninitialized bindings", async () => {
    await withTempDir(async (directory) => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const cyclicProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'export { default } from "./content.js";',
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", cyclicProcessor, async () => {
        const pagePath = join(directory, "page.js");
        const contentPath = join(directory, "content.js");
        const result = await bundleMDXWithOptions({
          content: "# Cyclic source export",
          filePath: join(directory, "page.mdx"),
          projectDir: directory,
        });
        await Deno.writeTextFile(pagePath, executableEmittedModule(result.code));
        await Deno.writeTextFile(
          contentPath,
          'import Page from "./page.js";\n' +
            "export { Page };\n" +
            'const Content = (props = {}) => ({ type: props.components?.h1 ?? "h1" });\n' +
            'Content.getLayout = () => "layout";\n' +
            "export default Content;",
        );

        const loaded = await import(toFileUrl(contentPath).href) as {
          Page: ((props: Record<string, unknown>) => unknown) & {
            getLayout?: () => string;
          };
        };
        assertEquals(loaded.Page.getLayout?.(), "layout");
        const wrapperElement = loaded.Page({}) as {
          type: (props: Record<string, unknown>) => unknown;
          props: Record<string, unknown>;
        };
        assertEquals(
          (wrapperElement.type(wrapperElement.props) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });
  });

  it("forwards statics before dependent modules initialize", async () => {
    await withTempDir(async (directory) => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const sourceProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'export { default } from "./content.js";',
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", sourceProcessor, async () => {
        const pagePath = join(directory, "page.js");
        const contentPath = join(directory, "content.js");
        const importerPath = join(directory, "importer.js");
        const result = await bundleMDXWithOptions({
          content: "# Source export statics",
          filePath: join(directory, "page.mdx"),
          projectDir: directory,
        });
        await Deno.writeTextFile(pagePath, executableEmittedModule(result.code));
        await Deno.writeTextFile(
          contentPath,
          'const Content = () => ({ type: "h1" });\n' +
            'Content.getLayout = () => "layout";\n' +
            "export default Content;",
        );
        await Deno.writeTextFile(
          importerPath,
          'import Page from "./page.js";\n' +
            "export const layout = Page.getLayout?.();",
        );

        const loaded = await import(toFileUrl(importerPath).href) as { layout: string };
        assertEquals(loaded.layout, "layout");
      });
    });
  });

  it("keeps source-backed re-exports after earlier side effects", async () => {
    await withTempDir(async (directory) => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const orderingProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'import "./setup.js";\nexport { default } from "./content.js";',
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", orderingProcessor, async () => {
        const pagePath = join(directory, "page.js");
        const statePath = join(directory, "state.js");
        const setupPath = join(directory, "setup.js");
        const contentPath = join(directory, "content.js");
        const result = await bundleMDXWithOptions({
          content: "# Ordered source export",
          filePath: join(directory, "page.mdx"),
          projectDir: directory,
        });
        await Deno.writeTextFile(pagePath, executableEmittedModule(result.code));
        await Deno.writeTextFile(statePath, "export const order = [];");
        await Deno.writeTextFile(
          setupPath,
          'import { order } from "./state.js"; order.push("setup");',
        );
        await Deno.writeTextFile(
          contentPath,
          'import { order } from "./state.js"; order.push("content");\n' +
            'export default function Content() { return { type: "h1" }; }',
        );

        await import(toFileUrl(pagePath).href);
        const state = await import(toFileUrl(statePath).href) as { order: string[] };
        assertEquals(state.order, ["setup", "content"]);
      });
    });
  });
});
