import "#veryfront/schemas/_test-setup.ts";
import "../../../transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { withTempFile, writeTextFile } from "#veryfront/testing/index.ts";
import { toFileUrl } from "#veryfront/compat/path/index.ts";
import {
  register,
  resolve as resolveContract,
  tryResolve,
  unregister,
} from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
import type { CodeParser } from "#veryfront/extensions/parser/index.ts";
import { bundleMdx, bundleMDXWithOptions } from "./mdx-bundler.ts";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";

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

/** A short cross-runtime module URL for self-contained import fixtures. */
function moduleDataUrl(code: string): string {
  return `data:text/javascript;base64,${btoa(code)}`;
}

/**
 * Loads emitted MDX as a real ES module.
 *
 * Runtime imports are replaced with inline stubs so nothing resolves from the
 * registry. A disposable module file keeps the import specifier short enough
 * for Bun even as the emitted compatibility wrapper grows.
 */
async function importEmittedModule(
  code: string,
  options: { providerHeading?: boolean } = {},
): Promise<{ default: (props: Record<string, unknown>) => unknown; meta?: unknown }> {
  const createElementStub =
    "(type, props, ...children) => ({ type, props: { ...props, children } })";
  const executable = code
    .replace(
      /import\s*\{([^}]*)\}\s*from\s*"react\/jsx-runtime";?/g,
      (_statement, clause: string) =>
        clause.split(",").map((entry) => {
          const [imported, alias] = entry.trim().split(/\s+as\s+/);
          const local = alias ?? imported;
          if (!imported || !local) throw new Error("Invalid JSX runtime import in emitted code");
          return imported === "Fragment"
            ? `const ${local} = "fragment";`
            : `const ${local} = (type, props) => ({ type, props });`;
        }).join("\n"),
    )
    .replace(
      /import\s*\{\s*createElement\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*"react";?/g,
      (_statement, local: string) => `const ${local} = ${createElementStub};`,
    )
    .replace(
      /import\s+([A-Za-z_$][\w$]*)\s+from\s+"react";?/g,
      (_statement, local: string) =>
        `const ${local} = {` +
        "Component: class { constructor(props) { this.props = props; } }," +
        `createElement: ${createElementStub}` +
        "};",
    )
    .replace(
      /import\s*\{\s*useMDXComponents(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*\}\s*from\s*"veryfront\/mdx";?/g,
      (_statement, alias: string | undefined) => {
        const local = alias ?? "useMDXComponents";
        return (
          options.providerHeading
            ? `const ${local} = (components) => ({ h1: "provider-heading", ...components });`
            : `const ${local} = (components) => ({ ...components });`
        );
      },
    );

  return await withTempFile(async (modulePath) => {
    await writeTextFile(modulePath, executable);
    return await import(toFileUrl(modulePath).href);
  }, { prefix: "vf-mdx-emitted-", suffix: ".mjs" });
}

function renderEmittedComponent(
  component: (props: Record<string, unknown>) => unknown,
  props: Record<string, unknown> = {},
): unknown {
  let rendered = component(props);
  for (let depth = 0; depth < 10; depth++) {
    const element = rendered as { type?: unknown; props?: Record<string, unknown> } | null;
    if (!element || typeof element !== "object" || typeof element.type !== "function") {
      return rendered;
    }
    const childProps = element.props ?? {};
    const child = element.type as {
      (value: Record<string, unknown>): unknown;
      new (value: Record<string, unknown>): { render(): unknown };
      prototype?: { render?: unknown };
    };
    rendered = typeof child.prototype?.render === "function"
      ? new child(childProps).render()
      : child(childProps);
  }
  throw new Error("Emitted component recursion exceeded the test limit");
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
    });

    it("does not inject React when automatic JSX output never references it", async () => {
      const result = await bundleMDXWithOptions({
        content: "# Automatic JSX",
        filePath: "/tmp/automatic-jsx.mdx",
        projectDir: "/tmp",
      });

      assertEquals(result.code.includes('import React from "react"'), false);
      assertEquals(result.dependencies.includes("react"), false);
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

    it("preserves provider components", async () => {
      const source = {
        path: "/tmp/test-project/pages/provider-components.mdx",
        content: "# Provider heading",
      };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, async () => "");

      const output = result.outputs.get("/tmp/test-project/pages/provider-components.js");
      assertExists(output);
      const loaded = await importEmittedModule(output.content, {
        providerHeading: true,
      });
      const rendered = loaded.default({}) as { type?: unknown };
      assertEquals(rendered.type, "provider-heading");
    });

    it("preserves React expressions", async () => {
      const source = {
        path: "/tmp/test-project/pages/react-expression.mdx",
        content: '{React.createElement("span", { id: "authored" }, "text")}',
      };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, async () => "");

      const output = result.outputs.get("/tmp/test-project/pages/react-expression.js");
      assertExists(output);
      const rendered = JSON.stringify((await importEmittedModule(output.content)).default({}));
      assertStringIncludes(rendered, "authored");
      assertStringIncludes(rendered, "text");
    });

    it("exports generated metadata beside a local meta import", async () => {
      const importedMeta = moduleDataUrl("export const meta = { title: 'Imported' };");
      const source = {
        path: "/tmp/test-project/pages/imported-meta.mdx",
        content: `---\ntitle: Generated\n---\nimport { meta } from ${
          JSON.stringify(importedMeta)
        }\n\n# Hello`,
      };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, async () => "");

      const output = result.outputs.get("/tmp/test-project/pages/imported-meta.js");
      assertExists(output);
      const loaded = await importEmittedModule(output.content);
      assertEquals((loaded.meta as { title?: string }).title, "Generated");
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

      // Either it succeeds or pushes to result.errors - both are acceptable
      assertEquals(
        result.outputs.size + result.errors.length > 0,
        true,
        "should produce output or capture error",
      );
    });

    it("should report unresolvable local imports", async () => {
      const source = {
        path: "/tmp/test-project/pages/page.mdx",
        content: 'import { A } from "./missing.tsx";\n\n# Hi\n',
      };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      await bundleMdx(source, options, result, compileFn);

      assertEquals(result.errors.length, 1, "unresolvable local import is reported once");
      assertStringIncludes(
        result.errors[0]!.message,
        "Cannot find module '/tmp/test-project/pages/missing.tsx' from '/tmp/test-project/pages/page.mdx'",
        "error names the resolved import and the source file",
      );
    });

    it("does not validate a re-export shown inside a code fence", async () => {
      const source = {
        path: "/tmp/test-project/pages/example.mdx",
        content: '```js\nexport { value } from "./missing.js";\n```\n',
      };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, async () => "");

      assertEquals(result.errors, []);
      assertExists(result.outputs.get("/tmp/test-project/pages/example.js"));
    });

    it("does not validate re-exports shown in inline or indented code", async () => {
      const source = {
        path: "/tmp/test-project/pages/example.mdx",
        content: '`export { value } from "./inline.js"`\n\n' +
          '    export { value } from "./indented.js";\n',
      };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, async () => "");

      assertEquals(result.errors, []);
      assertExists(result.outputs.get("/tmp/test-project/pages/example.js"));
    });

    it("does not validate imports shown in container-nested indented code", async () => {
      const source = {
        path: "/tmp/test-project/pages/example.mdx",
        content: '>     {import("./missing.js")}\n\n' +
          '-     {import("./list-missing.js")}\n\n' +
          '> - item\n\n    {import("./quote-list-missing.js")}\n\n' +
          '- item\n\n\n    {import("./ended-list-missing.js")}\n',
      };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, async () => "");

      assertEquals(result.errors, []);
      assertExists(result.outputs.get("/tmp/test-project/pages/example.js"));
    });

    it("does not validate imports shown in ordered-list continuation fences", async () => {
      const source = {
        path: "/tmp/test-project/pages/example.mdx",
        content: '10. item\n    ~~~js\n    {import("./missing.js")}\n    ~~~\n',
      };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, async () => "");

      assertEquals(result.errors, []);
      assertExists(result.outputs.get("/tmp/test-project/pages/example.js"));
    });

    it("does not validate indented imports after headings", async () => {
      const source = {
        path: "/tmp/test-project/pages/heading-code.mdx",
        content: '# Heading\n    {import("./missing.js")}',
      };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, async () => "");

      assertEquals(result.errors, []);
      assertExists(result.outputs.get("/tmp/test-project/pages/heading-code.js"));
    });

    it("does not validate indented imports after setext headings", async () => {
      for (const [name, underline] of [["equals", "======="], ["hyphen", "---"]] as const) {
        const source = {
          path: `/tmp/test-project/pages/${name}-heading-code.mdx`,
          content: `Heading\n${underline}\n    {import("./missing.js")}`,
        };
        const result = createBundleResult();

        await bundleMdx(source, createOptions(), result, async () => "");

        assertEquals(result.errors, []);
        assertExists(result.outputs.get(`/tmp/test-project/pages/${name}-heading-code.js`));
      }
    });

    it("validates dynamic imports with options", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const permissiveProcessor: ContentProcessor = {
        compileMdx: (options) => active.compileMdx({ ...options, content: "# Compiled" }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", permissiveProcessor, async () => {
        const result = createBundleResult();
        await bundleMdx(
          {
            path: "/tmp/test-project/pages/import-options.mdx",
            content: '{import("./missing.js", {})}',
          },
          createOptions(),
          result,
          async () => "",
        );

        assertEquals(result.errors.length, 1);
        assertStringIncludes(result.errors[0]!.message, "missing.js");
      });
    });

    it("validates imports after scanner and container edge cases", async () => {
      for (
        const [name, content] of [
          [
            "regex-condition",
            '{(() => { if (/\\)/.test(value)) /"/.test(value); return import("./missing.js"); })()}',
          ],
          [
            "split-control-flow",
            '{(() => { if\n(ok)\n/"/.test(value); return import("./missing.js"); })()}',
          ],
          [
            "multiline-control-flow",
            '{(() => { if (\nok)\n/"/.test(value); return import("./missing.js"); })()}',
          ],
          [
            "commented-control-flow",
            '{(() => { if /* note */ (ok) /"/.test(value); return import("./missing.js"); })()}',
          ],
          [
            "commented-regex-operand",
            '{(() => { return /* note */ /"/.test(value); return import("./missing.js"); })()}',
          ],
          [
            "line-leading-object-literal",
            '{(() => { const ratio =\n{} / value; return import("./missing.js"); })()}',
          ],
          [
            "list-continuation",
            '- item\n\n    {import("./missing.js")}',
          ],
          [
            "list-padding-continuation",
            '-   item\n\n      {import("./missing.js")}',
          ],
          [
            "list-tab-continuation",
            '-\titem\n\n      {import("./missing.js")}',
          ],
          [
            "labeled-block",
            '{(() => { label: {} /"/.test(value); return import("./missing.js"); })()}',
          ],
          [
            "function-expression-body",
            '{(() => { const ratio = function() {} / value; return import("./missing.js"); })()}',
          ],
          [
            "class-expression-body",
            '{(() => { const ratio = class {} / value; return import("./missing.js"); })()}',
          ],
          [
            "postfix-update-division",
            '{(() => { const ratio = value++ / divisor; return import("./missing.js"); })()}',
          ],
          [
            "member-keyword-division",
            '{(() => { const ratio = object.return / divisor; return import("./missing.js"); })()}',
          ],
          [
            "spread-regex",
            '{(() => { const values = [.../"/]; return import("./missing.js"); })()}',
          ],
          [
            "restricted-statement",
            '{(() => { debugger\n/"/.test(value); return import("./missing.js"); })()}',
          ],
          [
            "list-fence-end",
            '- ```\n  example\n{import("./missing.js")}\n```',
          ],
          [
            "blockquote-fence-end",
            '> ```\n{import("./missing.js")}\n```',
          ],
          [
            "export-comment",
            'export /* note */ const child = import("./missing.js")',
          ],
          [
            "string-named-re-export",
            'export { default as "}" } from "./missing.js"',
          ],
          [
            "declaration-continuation",
            'export const\nchild = import("./missing.js")',
          ],
          [
            "split-default-import",
            'import Child\nfrom "./missing.js"\n\n<Child />',
          ],
          [
            "combined-named-import",
            'import Child, { meta } from "./missing.js"',
          ],
          [
            "combined-namespace-import",
            'import Child, * as child from "./missing.js"',
          ],
          [
            "extends-regex",
            'export class Matcher extends /"/.constructor { static child = import("./missing.js") }',
          ],
          [
            "async-function-continuation",
            'export async function\nload(value = import("./missing.js")) {}',
          ],
          [
            "double-quoted-jsx-backslash",
            '<Widget label="value' + "\\" + '" child={import("./missing.js")} />',
          ],
          [
            "single-quoted-jsx-backslash",
            "<Widget label='value" + "\\" + '\' child={import("./missing.js")} />',
          ],
          [
            "invalid-list-marker",
            '1234567890. ~~~\n{import("./missing.js")}\n~~~',
          ],
        ] as const
      ) {
        const result = createBundleResult();

        await bundleMdx(
          { path: `/tmp/test-project/pages/${name}.mdx`, content },
          createOptions(),
          result,
          async () => "",
        );

        assertEquals(result.errors.length, 1, `${name} should validate its executable import`);
        assertStringIncludes(result.errors[0]!.message, "missing.js");
      }
    });

    it("does not validate re-export syntax quoted in ordinary prose", async () => {
      const source = {
        path: "/tmp/test-project/pages/example.mdx",
        content: 'To re-export, use export { value } from "./missing.js".\n',
      };
      const result = createBundleResult();

      await bundleMdx(source, createOptions(), result, async () => "");

      assertEquals(result.errors, []);
      assertExists(result.outputs.get("/tmp/test-project/pages/example.js"));
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

      assertStringIncludes(
        result.code,
        "function _createMdxContent(props)",
        "compiled MDX body must be inlined into the emitted module",
      );
      assertExists(result.frontmatter, "should return frontmatter object");
      assertExists(result.dependencies, "should return dependencies array");

      // Substring assertions are what let this emit unparseable code: they
      // passed while the module declared MDXContent twice, returned at top
      // level, and called a MDXContentWrapper nothing defined. Load it instead.
      const loaded = await importEmittedModule(result.code);
      assertEquals(
        typeof loaded.default,
        "function",
        "the emitted module must default-export a component",
      );
      assertEquals(
        typeof loaded.default({}),
        "object",
        "the exported component must render without a wrapper the module never defined",
      );
      assertEquals(typeof loaded.meta, "object", "the emitted module must export meta");
    });

    it("does not redeclare a meta export the MDX source already declares", async () => {
      // MDX passes ESM declarations through to the program output, so a document
      // that exports meta itself already has one. A second declaration would
      // redeclare the binding and the module would not parse.
      const result = await bundleMDXWithOptions({
        content: "export const meta = { title: 'Authored' };\n\n# Hello",
        filePath: "/tmp/authored-meta.mdx",
        projectDir: "/tmp",
      });

      assertEquals(
        result.code.match(/export const meta\b/g)?.length,
        1,
        "the emitted module must declare meta exactly once",
      );

      const loaded = await importEmittedModule(result.code);
      assertEquals(
        (loaded.meta as { title?: string } | undefined)?.title,
        "Authored",
        "the authored meta export survives",
      );
    });

    it("does not redeclare class or async-function meta bindings", async () => {
      for (
        const declaration of [
          "export class meta {}",
          "export async function meta() {}",
        ]
      ) {
        const result = await bundleMDXWithOptions({
          content: `${declaration}\n\n# Hello`,
          filePath: "/tmp/authored-meta-binding.mdx",
          projectDir: "/tmp",
        });

        assertEquals(
          result.code.includes("export const meta ="),
          false,
          `${declaration} must suppress the generated meta binding`,
        );
        const loaded = await importEmittedModule(result.code);
        assertEquals(typeof loaded.meta, "function");
      }
    });

    it("avoids injected names that nested var declarations bind at module scope", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const nestedVarProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: "if (false) { var meta; var React; }\n" +
            "export default function MDXContent(props = {}) { return props; }",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", nestedVarProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Nested var bindings",
          filePath: "/tmp/nested-var-bindings.mdx",
          projectDir: "/tmp",
        });

        assertEquals(result.code.includes('import React from "react"'), false);
        const loaded = await importEmittedModule(result.code);
        assertEquals(loaded.meta, {});
      });
    });

    it("inherits component overrides from the MDX provider", async () => {
      const result = await bundleMDXWithOptions({
        content: "# Provider heading",
        filePath: "/tmp/provider-components.mdx",
        projectDir: "/tmp",
      });

      assertEquals(
        result.code.includes("__VeryfrontProviderMDXContent"),
        false,
        "provider-aware compiler output must not receive a compatibility wrapper",
      );
      const loaded = await importEmittedModule(result.code, {
        providerHeading: true,
      });
      const rendered = loaded.default({}) as { type?: unknown };
      assertEquals(
        rendered.type,
        "provider-heading",
        "compiled MDX must merge component overrides from the surrounding provider",
      );
    });

    it("preserves provider overrides when a content processor ignores providerImportSource", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const ignoringProcessor: ContentProcessor = {
        compileMdx: (options) => {
          const { providerImportSource: _ignored, ...forwarded } = options;
          return active.compileMdx(forwarded);
        },
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", ignoringProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Provider heading",
          filePath: "/tmp/third-party-provider-components.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, {
          providerHeading: true,
        });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("keeps free globals distinct from generated provider bindings", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const freeGlobalProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: "export default function MDXContent() { " +
            "return __veryfrontUseMDXComponents; }",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", freeGlobalProcessor, async () => {
        const globalName = "__veryfrontUseMDXComponents";
        const result = await bundleMDXWithOptions({
          content: "# Free global",
          filePath: "/tmp/free-provider-global.mdx",
          projectDir: "/tmp",
          globals: { [globalName]: "caller-global" },
        });

        assertEquals(
          /const\s*{\s*__veryfrontUseMDXComponents\s*}\s*=\s*globalThis/.test(result.code),
          true,
        );
        assertEquals(
          /useMDXComponents\s+as\s+__veryfrontUseMDXComponents_/.test(result.code),
          true,
        );
      });
    });

    it("preserves static properties on a compatibility-wrapped component", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const staticProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'function Content() { return { type: "h1" }; }\n' +
            '({}).constructor.defineProperty(Content, "getLayout", { value: () => "layout" });\n' +
            "const Object = null;\n" +
            "const Reflect = null;\n" +
            "const Proxy = null;\n" +
            "const globalThis = {};\n" +
            "export default Content;",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", staticProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Static API",
          filePath: "/tmp/static-api.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code) as unknown as {
          default: { getLayout?: () => string };
        };
        assertEquals(loaded.default.getLayout?.(), "layout");
        assertEquals(Object.hasOwn(loaded.default, "getLayout"), true);
      });
    });

    it("invokes copied static accessors on the original component", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const accessorProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'class Content { static #layout = "layout"; ' +
            "static get layout() { return this.#layout; } }\nexport default Content;",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", accessorProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Local accessor",
          filePath: "/tmp/local-accessor-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code) as unknown as {
          default: { layout: string };
        };
        assertEquals(loaded.default.layout, "layout");
      });
    });

    it("preserves inherited statics on a compatibility-wrapped component", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const inheritedProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'class Base { static layout = "base-layout"; }\n' +
            "class Content extends Base {}\nexport default Content;",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", inheritedProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Inherited static",
          filePath: "/tmp/inherited-static-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code) as unknown as {
          default: { layout: string };
        };
        assertEquals(loaded.default.layout, "base-layout");
      });
    });

    it("forwards local static mutations through the compatibility wrapper", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const mutableProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'class Content { static layout = "a"; ' +
            'static update() { this.layout = "b"; } }\nexport default Content;',
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", mutableProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Mutable local static",
          filePath: "/tmp/mutable-local-static-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code) as unknown as {
          default: { layout: string; update(): void };
        };
        loaded.default.update();
        assertEquals(loaded.default.layout, "b");
      });
    });

    it("does not mistake an unused authored provider-hook import for provider wiring", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const ignoringProcessor: ContentProcessor = {
        compileMdx: (options) => {
          const { providerImportSource: _ignored, ...forwarded } = options;
          return active.compileMdx(forwarded);
        },
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", ignoringProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: 'import { useMDXComponents } from "veryfront/mdx";\n\n# Provider heading',
          filePath: "/tmp/authored-provider-import.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, {
          providerHeading: true,
        });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("does not mistake an authored helper call for provider wiring", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const ignoringProcessor: ContentProcessor = {
        compileMdx: (options) => {
          const { providerImportSource: _ignored, ...forwarded } = options;
          return active.compileMdx(forwarded);
        },
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", ignoringProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: 'import { useMDXComponents as authoredHook } from "veryfront/mdx";\n' +
            "export function readProvider() { return authoredHook(); }\n\n" +
            "# Provider heading",
          filePath: "/tmp/authored-provider-helper.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, {
          providerHeading: true,
        });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("does not mistake a shadowed provider-hook alias for provider wiring", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const shadowingProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'import { useMDXComponents as authoredHook } from "veryfront/mdx";\n' +
            "export default function MDXContent(props = {}) {\n" +
            "  function authoredHook() { return {}; }\n" +
            "  const components = { ...authoredHook(), ...props.components };\n" +
            '  return React.createElement(components.h1 ?? "h1", null, "Shadowed heading");\n' +
            "}",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", shadowingProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Shadowed provider hook",
          filePath: "/tmp/shadowed-provider-hook.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, { providerHeading: true });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("does not mistake provider-hook calls in nested methods for provider wiring", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const methodProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'import { useMDXComponents as authoredHook } from "veryfront/mdx";\n' +
            "export default function MDXContent(props = {}) {\n" +
            "  const objectHelper = { read() { return authoredHook(); } };\n" +
            "  class ClassHelper { read() { return authoredHook(); } }\n" +
            "  void objectHelper;\n" +
            "  void ClassHelper;\n" +
            '  return React.createElement(props.components?.h1 ?? "h1", null, "Method heading");\n' +
            "}",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", methodProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Nested method provider hook",
          filePath: "/tmp/nested-method-provider-hook.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, { providerHeading: true });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("does not mistake an unused provider-hook call for provider wiring", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const unusedHookProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'import { useMDXComponents as authoredHook } from "veryfront/mdx";\n' +
            "export default function MDXContent(props = {}) {\n" +
            "  authoredHook();\n" +
            '  return React.createElement(props.components?.h1 ?? "h1", null, "Unused hook");\n' +
            "}",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", unusedHookProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Unused provider hook",
          filePath: "/tmp/unused-provider-hook.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, { providerHeading: true });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("does not mistake a discarded provider component map for provider wiring", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const discardedMapProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'import { useMDXComponents as authoredHook } from "veryfront/mdx";\n' +
            "export default function MDXContent(props = {}) {\n" +
            "  ({ ...authoredHook() });\n" +
            '  return React.createElement(props.components?.h1 ?? "h1", null, "Discarded map");\n' +
            "}",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", discardedMapProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Discarded provider map",
          filePath: "/tmp/discarded-provider-map.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, { providerHeading: true });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("does not mistake a provider map used only as a return guard for wiring", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const guardedMapProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'import { useMDXComponents as authoredHook } from "veryfront/mdx";\n' +
            "function Content(props = {}) {\n" +
            '  return React.createElement(props.components?.h1 ?? "h1", null, "Guarded map");\n' +
            "}\n" +
            "export default function MDXContent(props = {}) {\n" +
            "  const components = { ...authoredHook() };\n" +
            "  return components && React.createElement(Content, " +
            "{ components: props.components });\n" +
            "}",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", guardedMapProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Guarded provider map",
          filePath: "/tmp/guarded-provider-map.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, { providerHeading: true });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("does not mistake a provider map passed as an unrelated prop for wiring", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const debugMapProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'import { useMDXComponents as authoredHook } from "veryfront/mdx";\n' +
            "function Content(props = {}) {\n" +
            '  return React.createElement(props.components?.h1 ?? "h1", null, "Debug map");\n' +
            "}\n" +
            "export default function MDXContent(props = {}) {\n" +
            "  const components = { ...authoredHook() };\n" +
            "  return React.createElement(Content, {\n" +
            "    components: props.components,\n" +
            "    debug: components,\n" +
            "  });\n" +
            "}",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", debugMapProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Debug provider map",
          filePath: "/tmp/debug-provider-map.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, { providerHeading: true });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("does not treat host-element component props as provider wiring", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const hostPropProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'import { useMDXComponents as authoredHook } from "veryfront/mdx";\n' +
            "export default function MDXContent(props = {}) {\n" +
            "  const components = { ...authoredHook() };\n" +
            '  return React.createElement("section", null,\n' +
            '    React.createElement("div", { components }),\n' +
            '    React.createElement(props.components?.h1 ?? "h1", null, "Host prop heading"),\n' +
            "  );\n" +
            "}",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", hostPropProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Host component prop",
          filePath: "/tmp/host-component-prop.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, { providerHeading: true });
        assertStringIncludes(
          JSON.stringify(renderEmittedComponent(loaded.default)),
          "provider-heading",
        );
      });
    });

    it("does not mistake an unreachable provider-hook call for provider wiring", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const unreachableHookProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'import { useMDXComponents as authoredHook } from "veryfront/mdx";\n' +
            "export default function MDXContent(props = {}) {\n" +
            "  if (false) authoredHook();\n" +
            '  return React.createElement(props.components?.h1 ?? "h1", null, "Unreachable hook");\n' +
            "}",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", unreachableHookProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Unreachable provider hook",
          filePath: "/tmp/unreachable-provider-hook.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, { providerHeading: true });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("does not mistake a loop-contained provider spread for provider wiring", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const loopProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'import { useMDXComponents as authoredHook } from "veryfront/mdx";\n' +
            "export default function MDXContent(props = {}) {\n" +
            "  for (; false;) ({ ...authoredHook() });\n" +
            '  return React.createElement(props.components?.h1 ?? "h1", null, "Loop heading");\n' +
            "}",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", loopProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Loop-contained provider hook",
          filePath: "/tmp/loop-provider-hook.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, { providerHeading: true });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("wraps a local specifier-form default export", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const specifierProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode:
            'const Content = (props = {}) => React.createElement(props.components?.h1 ?? "h1", null, "Specifier heading");\n' +
            "export { Content as default };",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", specifierProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Specifier export",
          filePath: "/tmp/specifier-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, { providerHeading: true });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("preserves aliases of a compatibility-wrapped default binding", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const aliasedProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode:
            'function Content(props = {}) { return React.createElement(props.components?.h1 ?? "h1", null, "Aliased heading"); }\n' +
            "export { Content, Content as default };\n" +
            'Content.getLayout = () => "layout";',
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", aliasedProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Aliased export",
          filePath: "/tmp/aliased-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, {
          providerHeading: true,
        }) as unknown as {
          default: ((props: Record<string, unknown>) => unknown) & {
            getLayout?: () => string;
          };
          Content: ((props: Record<string, unknown>) => unknown) & {
            getLayout?: () => string;
          };
        };
        assertEquals(loaded.default, loaded.Content);
        assertEquals(loaded.Content.getLayout?.(), "layout");
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("redirects declaration-form aliases to the compatibility wrapper", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      for (
        const [kind, declaration] of [
          [
            "function",
            'export function Content(props = {}) { return React.createElement(props.components?.h1 ?? "h1", null, "Function heading"); }',
          ],
          [
            "const",
            'export const Content = (props = {}) => React.createElement(props.components?.h1 ?? "h1", null, "Const heading");',
          ],
          [
            "class",
            'export class Content extends React.Component { render() { return React.createElement(this.props.components?.h1 ?? "h1", null, "Class heading"); } }',
          ],
        ] as const
      ) {
        const declarationProcessor: ContentProcessor = {
          compileMdx: async (options) => ({
            ...await active.compileMdx(options),
            compiledCode: `${declaration}\nexport { Content as default };`,
          }),
          compileMarkdown: (options) => active.compileMarkdown(options),
          getRemarkPlugins: () => active.getRemarkPlugins(),
          getRehypePlugins: () => active.getRehypePlugins(),
        };

        await withContractOverride("ContentProcessor", declarationProcessor, async () => {
          const result = await bundleMDXWithOptions({
            content: `# ${kind} declaration export`,
            filePath: `/tmp/${kind}-declaration-default.mdx`,
            projectDir: "/tmp",
          });

          const loaded = await importEmittedModule(result.code, {
            providerHeading: true,
          }) as unknown as {
            default: (props: Record<string, unknown>) => unknown;
            Content: (props: Record<string, unknown>) => unknown;
          };
          assertEquals(loaded.default, loaded.Content);
          assertEquals(
            (renderEmittedComponent(loaded.Content) as { type?: unknown }).type,
            "provider-heading",
          );
        });
      }
    });

    it("preserves aliases of named default declarations", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const namedDefaultProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode:
            'export default function Content(props = {}) { return React.createElement(props.components?.h1 ?? "h1", null, "Named default heading"); }\n' +
            "export { Content };\n" +
            'Content.getLayout = () => "layout";',
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", namedDefaultProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Named default export",
          filePath: "/tmp/named-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, {
          providerHeading: true,
        }) as unknown as {
          default: ((props: Record<string, unknown>) => unknown) & {
            getLayout?: () => string;
          };
          Content: ((props: Record<string, unknown>) => unknown) & {
            getLayout?: () => string;
          };
        };
        assertEquals(loaded.default, loaded.Content);
        assertEquals(loaded.Content.getLayout?.(), "layout");
        assertEquals(
          (renderEmittedComponent(loaded.Content) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("snapshots an identifier-form default export before later reassignment", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const identifierProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'const First = () => ({ type: "first" });\n' +
            'const Second = () => ({ type: "second" });\n' +
            "let Content = First;\n" +
            "export default Content;\n" +
            "export { Content };\n" +
            "Content = Second;",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", identifierProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Identifier export",
          filePath: "/tmp/identifier-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code) as unknown as {
          default: (props: Record<string, unknown>) => unknown;
          Content: (props: Record<string, unknown>) => unknown;
        };
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "first",
        );
        assertEquals(
          (renderEmittedComponent(loaded.Content) as { type?: unknown }).type,
          "second",
        );
      });
    });

    it("wraps aliases of a source-backed specifier-form default export", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const sourceModule = moduleDataUrl(
        'export function Content(props = {}) { return { type: props.components?.h1 ?? "h1" }; }\n' +
          'Content.getLayout = () => "layout";',
      );
      const specifierProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: `export { Content as default, Content } from ${
            JSON.stringify(sourceModule)
          };`,
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", specifierProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Source-backed export",
          filePath: "/tmp/source-backed-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, {
          providerHeading: true,
        }) as unknown as {
          default: ((props: Record<string, unknown>) => unknown) & {
            getLayout?: () => string;
          };
          Content: ((props: Record<string, unknown>) => unknown) & {
            getLayout?: () => string;
          };
        };
        assertEquals(loaded.default, loaded.Content);
        assertEquals(loaded.Content.getLayout?.(), "layout");
        assertEquals(
          (renderEmittedComponent(loaded.Content) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("wraps source-backed aliases declared in later exports", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const sourceModule = moduleDataUrl(
        'export default function Content(props = {}) { return { type: props.components?.h1 ?? "h1" }; }',
      );
      const separateAliasProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: `export { default } from ${JSON.stringify(sourceModule)};\n` +
            `export { default as Content } from ${JSON.stringify(sourceModule)};`,
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", separateAliasProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Separate source alias",
          filePath: "/tmp/separate-source-alias.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, {
          providerHeading: true,
        }) as unknown as {
          default: (props: Record<string, unknown>) => unknown;
          Content: (props: Record<string, unknown>) => unknown;
        };
        assertEquals(loaded.default, loaded.Content);
        assertEquals(
          (renderEmittedComponent(loaded.Content) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("invokes source-backed static accessors on the source component", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const sourceModule = moduleDataUrl(
        'export default class Content { static #layout = "layout"; ' +
          "static get layout() { return this.#layout; } }",
      );
      const accessorProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: `export { default } from ${JSON.stringify(sourceModule)};`,
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", accessorProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Source accessor",
          filePath: "/tmp/source-accessor-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code) as unknown as {
          default: { layout: string };
        };
        assertEquals(loaded.default.layout, "layout");
      });
    });

    it("invokes source-backed static methods on the source component", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const sourceModule = moduleDataUrl(
        'export default class Content { static #layout = "layout"; ' +
          "static getLayout() { return this.#layout; } }",
      );
      const methodProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: `export { default } from ${JSON.stringify(sourceModule)};`,
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", methodProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Source method",
          filePath: "/tmp/source-method-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code) as unknown as {
          default: { getLayout(): string };
        };
        assertEquals(loaded.default.getLayout, loaded.default.getLayout);
        assertEquals(
          Object.getOwnPropertyDescriptor(loaded.default, "getLayout")?.value,
          loaded.default.getLayout,
        );
        assertEquals(loaded.default.getLayout(), "layout");
      });
    });

    it("forwards source-backed static writes to the source component", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const sourceModule = moduleDataUrl(
        'class Content { static layout = "initial"; static themeValue = ""; ' +
          "static set theme(value) { this.themeValue = `${this === Content}:${value}`; } " +
          "static readState() { return [this.layout, this.themeValue]; } } export default Content;",
      );
      const writableProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: `export { default } from ${JSON.stringify(sourceModule)};`,
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", writableProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Source writes",
          filePath: "/tmp/source-writes-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code) as unknown as {
          default: { layout: string; theme: string; readState(): [string, string] };
        };
        loaded.default.layout = "updated";
        loaded.default.theme = "dark";
        assertEquals(loaded.default.readState(), ["updated", "true:dark"]);
      });
    });

    it("forwards source-backed static deletions to the source component", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const sourceModule = moduleDataUrl(
        'class Content { static layout = "layout"; ' +
          "static readLayout() { return this.layout; } } export default Content;",
      );
      const deletableProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: `export { default } from ${JSON.stringify(sourceModule)};`,
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", deletableProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Source deletion",
          filePath: "/tmp/source-deletion-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code) as unknown as {
          default: { layout?: string; readLayout(): string | undefined };
        };
        assertEquals(delete loaded.default.layout, true);
        assertEquals(loaded.default.readLayout(), undefined);
        assertEquals("layout" in loaded.default, false);
      });
    });

    it("preserves source-backed statics when the proxy becomes non-extensible", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const sourceModule = moduleDataUrl(
        'class Content { static #layout = "layout"; static title = "Page"; ' +
          "static getLayout() { return this.#layout; } } export default Content;",
      );
      const staticProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: `export { default } from ${JSON.stringify(sourceModule)};`,
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", staticProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Source statics",
          filePath: "/tmp/source-static-freeze-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code) as unknown as {
          default: { title: string; getLayout(): string };
        };
        Object.freeze(loaded.default);
        assertEquals(Object.isFrozen(loaded.default), true);
        assertEquals(Object.keys(loaded.default).includes("title"), true);
        assertEquals(loaded.default.title, "Page");
        assertEquals(loaded.default.getLayout(), "layout");
      });
    });

    it("uses the Proxy intrinsic when authored code shadows its name", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const sourceModule = moduleDataUrl(
        'export default function Content(props = {}) { return { type: props.components?.h1 ?? "h1" }; }',
      );
      const shadowingProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: "const Proxy = null; export { Proxy };\n" +
            `export { default } from ${JSON.stringify(sourceModule)};`,
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", shadowingProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Shadowed Proxy",
          filePath: "/tmp/shadowed-proxy-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, {
          providerHeading: true,
        }) as unknown as {
          default: (props: Record<string, unknown>) => unknown;
          Proxy: null;
        };
        assertEquals(loaded.Proxy, null);
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("preserves import attributes on a source-backed default export", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const attributedProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode:
            'export { default } from "data:application/json,%7B%7D" with { type: "json" };',
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", attributedProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Attributed export",
          filePath: "/tmp/attributed-default.mdx",
          projectDir: "/tmp",
        });

        assertStringIncludes(result.code, 'with { type: "json" }');
      });
    });

    it("renders a fallback class component through React", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const classProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: "export default class Content extends React.Component {\n" +
            "  render() {\n" +
            '    const Heading = this.props.components?.h1 ?? "h1";\n' +
            '    return React.createElement(Heading, null, "Class heading");\n' +
            "  }\n" +
            "}",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", classProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Class export",
          filePath: "/tmp/class-default.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code, { providerHeading: true });
        assertEquals(
          (renderEmittedComponent(loaded.default) as { type?: unknown }).type,
          "provider-heading",
        );
      });
    });

    it("keeps a compiled module directive ahead of compatibility imports", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const directiveProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode:
            '"use client";\nexport default function MDXContent(props = {}) { return props; }',
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", directiveProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Client MDX",
          filePath: "/tmp/client-boundary.mdx",
          projectDir: "/tmp",
        });

        const directiveIndex = result.code.indexOf('"use client"');
        const firstImportIndex = result.code.indexOf("import ");
        assertEquals(directiveIndex >= 0, true);
        assertEquals(firstImportIndex > directiveIndex, true);
      });
    });

    it("includes named and star re-export sources in dependencies", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const reexportProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode:
            'export { value } from "./named.js";\nexport * from "./all.js";\nexport default function MDXContent() { return null; }',
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", reexportProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Re-exports",
          filePath: "/tmp/reexports.mdx",
          projectDir: "/tmp",
        });

        assertEquals(result.dependencies.includes("./named.js"), true);
        assertEquals(result.dependencies.includes("./all.js"), true);
      });
    });

    it("preserves the React binding for authored expressions", async () => {
      const result = await bundleMDXWithOptions({
        content: '{React.createElement("span", { id: "authored" }, "text")}',
        filePath: "/tmp/react-expression.mdx",
        projectDir: "/tmp",
      });

      const loaded = await importEmittedModule(result.code);
      const rendered = JSON.stringify(loaded.default({}));
      assertStringIncludes(rendered, "authored");
      assertStringIncludes(rendered, "text");
    });

    it("exports generated metadata when meta is only a local import", async () => {
      const importedMeta = moduleDataUrl("export const meta = { title: 'Imported' };");
      const result = await bundleMDXWithOptions({
        content: `---\ntitle: Generated\n---\nimport { meta } from ${
          JSON.stringify(importedMeta)
        }\n\n{__veryfrontGeneratedMeta}`,
        filePath: "/tmp/imported-meta.mdx",
        projectDir: "/tmp",
      });

      assertStringIncludes(result.code, "const __veryfrontGeneratedMeta_");
      assertStringIncludes(result.code, "children: __veryfrontGeneratedMeta");
      const loaded = await importEmittedModule(result.code);
      assertEquals(
        loaded.meta,
        { title: "Generated" },
        "a local import does not satisfy the emitted module's named meta export",
      );
    });

    it("uses the first-party analyzer when another parser contract emits ESTree", async () => {
      const estreeParser: CodeParser = {
        parse: () =>
          Promise.resolve({
            type: "Program",
            body: [{
              type: "ExportNamedDeclaration",
              declaration: {
                type: "VariableDeclaration",
                declarations: [{
                  type: "VariableDeclarator",
                  id: {
                    type: "ObjectPattern",
                    properties: [{
                      type: "Property",
                      value: { type: "Identifier", name: "meta" },
                    }],
                  },
                }],
              },
            }],
          }),
        traverse: () => {},
        generate: () => Promise.resolve({ code: "" }),
        injectJsxNodePositions: (source) => source,
      };

      await withContractOverride("CodeParser", estreeParser, async () => {
        const result = await bundleMDXWithOptions({
          content: "export const { meta } = { meta: { title: 'Authored' } };\n\n# Hello",
          filePath: "/tmp/estree-parser.mdx",
          projectDir: "/tmp",
        });

        const loaded = await importEmittedModule(result.code);
        assertEquals(loaded.meta, { title: "Authored" });
      });
    });

    it("should extract frontmatter from content", async () => {
      const result = await bundleMDXWithOptions({
        content: "---\ntitle: My Page\ndescription: A description\n---\n# My Page",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
      });

      assertEquals(result.frontmatter.title, "My Page", "should extract title");
      assertEquals(result.frontmatter.description, "A description", "should extract description");

      const loaded = await importEmittedModule(result.code);
      assertEquals(
        (loaded.meta as { title?: string } | undefined)?.title,
        "My Page",
        "the frontmatter must reach consumers through the emitted module, not only the result",
      );
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

    it("should include globals import when globals provided", async () => {
      const result = await bundleMDXWithOptions({
        content: "# Test",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
        globals: { myGlobal: "MyGlobal" },
      });

      assertEquals(result.code.includes("myGlobal"), true, "should reference global in code");
    });

    it("does not inject globals already bound by the compiled module", async () => {
      const active = resolveContract<ContentProcessor>("ContentProcessor");
      const authoredGlobalProcessor: ContentProcessor = {
        compileMdx: async (options) => ({
          ...await active.compileMdx(options),
          compiledCode: 'export const myGlobal = "authored";\n' +
            "export default function MDXContent() { return myGlobal; }",
        }),
        compileMarkdown: (options) => active.compileMarkdown(options),
        getRemarkPlugins: () => active.getRemarkPlugins(),
        getRehypePlugins: () => active.getRehypePlugins(),
      };

      await withContractOverride("ContentProcessor", authoredGlobalProcessor, async () => {
        const result = await bundleMDXWithOptions({
          content: "# Test",
          filePath: "/tmp/authored-global.mdx",
          projectDir: "/tmp",
          globals: { myGlobal: "injected" },
        });

        const loaded = await importEmittedModule(result.code) as unknown as {
          myGlobal: string;
        };
        assertEquals(loaded.myGlobal, "authored");
      });
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
