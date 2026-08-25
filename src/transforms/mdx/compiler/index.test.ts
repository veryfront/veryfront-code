import "#veryfront/schemas/_test-setup.ts";
import "./__tests__/content-processor-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compileContent } from "./index.ts";

// Markers that identify which compiler produced the output: the MDX compiler
// emits a `_createMdxContent` component, the Markdown compiler emits a
// `markdown-body` wrapper around pre-rendered HTML.
const MDX_MARKER = "_createMdxContent";
const MARKDOWN_MARKER = "markdown-body";

const JSX_SOURCE = "# Hello World\n\nSome content.\n\n<Chart />";

describe("transforms/mdx/compiler/index", () => {
  describe("compileContent", () => {
    it("routes .md files to markdown compiler", async () => {
      const result = await compileContent(
        "production",
        "/tmp/project",
        JSX_SOURCE,
        undefined,
        "docs/readme.md",
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
      assertEquals(result.compiledCode.includes("Hello World"), true);
      assertEquals(typeof result.frontmatter, "object");
      assertEquals(
        result.compiledCode.includes(MARKDOWN_MARKER),
        true,
        ".md must compile through the Markdown compiler",
      );
      assertEquals(
        result.compiledCode.includes(MDX_MARKER),
        false,
        ".md must not go through the MDX compiler",
      );
    });

    it("routes .mdx files to MDX compiler", async () => {
      const result = await compileContent(
        "production",
        "/tmp/project",
        JSX_SOURCE,
        undefined,
        "docs/page.mdx",
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
      assertEquals(typeof result.frontmatter, "object");
      assertEquals(
        result.compiledCode.includes(MDX_MARKER),
        true,
        ".mdx must compile through the MDX compiler",
      );
      assertEquals(
        result.compiledCode.includes(MARKDOWN_MARKER),
        false,
        ".mdx must not go through the Markdown compiler",
      );
    });

    it("defaults target to server", async () => {
      const content = `import Chart from "./Chart.tsx";\n\n# Hi\n\n<Chart />`;
      const compile = (target?: "server" | "browser") =>
        compileContent(
          "production",
          "/project",
          content,
          undefined,
          "/project/app/page.mdx",
          target,
        );

      const omitted = await compile();
      const server = await compile("server");
      const browser = await compile("browser");

      assertEquals(
        omitted.compiledCode,
        server.compiledCode,
        "omitting target must compile exactly like target server",
      );
      assertEquals(
        omitted.compiledCode === browser.compiledCode,
        false,
        "the default must not be the browser target",
      );
      assertStringIncludes(omitted.compiledCode, "file:///project/app/Chart.tsx");
    });

    it("passes frontmatter through to markdown compiler", async () => {
      const result = await compileContent(
        "production",
        "/tmp/project",
        "# Content",
        { title: "Injected" },
        "doc.md",
      );
      assertEquals(
        result.frontmatter.title,
        "Injected",
        "caller-supplied frontmatter must reach the markdown compiler",
      );
    });

    it("lets caller frontmatter override the in-body block", async () => {
      const result = await compileContent(
        "production",
        "/tmp/project",
        "---\ntitle: From Body\n---\n# Content",
        { title: "From Caller" },
        "doc.md",
      );
      assertEquals(
        result.frontmatter.title,
        "From Caller",
        "caller-supplied frontmatter must win over the in-body YAML block",
      );
    });

    it("handles files without extension as MDX", async () => {
      const result = await compileContent(
        "production",
        "/tmp/project",
        "# No Extension\n\n<Chart />",
        undefined,
        undefined,
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
      assertEquals(
        result.compiledCode.includes(MDX_MARKER),
        true,
        "a filePath-less render must default to the MDX compiler",
      );
      assertEquals(
        result.compiledCode.includes(MARKDOWN_MARKER),
        false,
        "a filePath-less render must not fall through to the Markdown compiler",
      );
    });
  });
});
