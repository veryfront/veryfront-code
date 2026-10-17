import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import type { ContentCompileOptions } from "#veryfront/extensions/content/index.ts";
import type { TransformOptions } from "#veryfront/extensions/bundler/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { compileMDXToJS } from "./mdx-to-js.ts";

Deno.test("standalone MDX compilation preserves imports whose bindings it does not collect", async () => {
  const contracts = ["ContentProcessor", "Bundler"];
  const previous = contracts.map((name) => tryResolve(name));
  const namedImport = 'import {\n  Chart\n} from "./chart.tsx";';
  let processorContent = "";
  try {
    for (const name of contracts) unregister(name);
    register("ContentProcessor", {
      compileMdx(options: ContentCompileOptions) {
        processorContent = options.content;
        return Promise.resolve({
          compiledCode: `${namedImport}\nexport default function MDXContent() {}`,
          frontmatter: {},
          globals: {},
        });
      },
    });
    register("Bundler", {
      transform(options: TransformOptions) {
        return Promise.resolve({ code: options.code, warnings: [] });
      },
    });
    const result = await compileMDXToJS(
      "/project/page.mdx",
      `import Header from "./header.tsx";\n${namedImport}\n\n<Header /><Chart />`,
      { projectDir: "/project", mode: "production", adapter: {} as RuntimeAdapter },
    );
    assertStringIncludes(processorContent, namedImport);
    assertEquals(processorContent.includes('import Header from "./header.tsx"'), false);
    assertStringIncludes(result.code, namedImport);
    assertStringIncludes(result.code, "const Header =");
  } finally {
    for (const [index, name] of contracts.entries()) {
      unregister(name);
      if (previous[index] !== undefined) register(name, previous[index]);
    }
  }
});
