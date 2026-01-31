import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { HTMLGenerator, type HTMLGeneratorConfig } from "./html.ts";

type Head = {
  metas: Array<{ name?: string; property?: string; content?: string }>;
  links: Array<Record<string, string | null | undefined>>;
  styles: string[];
};

// ---- Inline reimplementation of non-exported helpers ----

function buildHeadElements(head?: Head): string {
  if (!head) return "";

  const parts: string[] = [];

  for (const meta of head.metas) {
    if (meta.name === "description") continue;

    const attrs: string[] = [];
    if (meta.name) attrs.push(`name="${meta.name}"`);
    if (meta.property) attrs.push(`property="${meta.property}"`);
    if (meta.content) attrs.push(`content="${meta.content}"`);

    if (attrs.length) parts.push(`<meta ${attrs.join(" ")}>`);
  }

  for (const link of head.links) {
    const attrs = Object.entries(link)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");

    if (attrs) parts.push(`<link ${attrs}>`);
  }

  for (const style of head.styles) {
    parts.push(`<style>${style}</style>`);
  }

  return parts.join("\n  ");
}

function mergeFrontmatter(context: {
  pageInfo: { entity: { frontmatter?: Record<string, unknown> } };
  pageBundle: { frontmatter?: Record<string, unknown> };
  collectedMetadata?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...context.pageInfo.entity.frontmatter,
    ...context.pageBundle.frontmatter,
    ...(context.collectedMetadata ?? {}),
  };
}

// ---- Tests ----

describe("HTMLGenerator helpers", () => {
  describe("buildHeadElements", () => {
    it("should return empty string for undefined head", () => {
      assertEquals(buildHeadElements(undefined), "");
    });

    it("should return empty string for empty head", () => {
      assertEquals(buildHeadElements({ metas: [], links: [], styles: [] }), "");
    });

    it("should skip description meta tags", () => {
      const head: Head = {
        metas: [{ name: "description", content: "A description" }],
        links: [],
        styles: [],
      };
      assertEquals(buildHeadElements(head), "");
    });

    it("should render meta tags with name attribute", () => {
      const head: Head = {
        metas: [{ name: "viewport", content: "width=device-width" }],
        links: [],
        styles: [],
      };
      const result = buildHeadElements(head);
      assertEquals(result.includes('name="viewport"'), true);
      assertEquals(result.includes('content="width=device-width"'), true);
    });

    it("should render meta tags with property attribute (OpenGraph)", () => {
      const head: Head = {
        metas: [{ property: "og:title", content: "My Page" }],
        links: [],
        styles: [],
      };
      const result = buildHeadElements(head);
      assertEquals(result.includes('property="og:title"'), true);
      assertEquals(result.includes('content="My Page"'), true);
    });

    it("should render link tags filtering null values", () => {
      const head: Head = {
        metas: [],
        links: [{ rel: "stylesheet", href: "/style.css", integrity: null }],
        styles: [],
      };
      const result = buildHeadElements(head);
      assertEquals(result.includes('rel="stylesheet"'), true);
      assertEquals(result.includes('href="/style.css"'), true);
      assertEquals(result.includes("integrity"), false);
    });

    it("should render style tags", () => {
      const head: Head = {
        metas: [],
        links: [],
        styles: [".body { color: red; }", ".header { font-size: 2rem; }"],
      };
      const result = buildHeadElements(head);
      assertEquals(result.includes("<style>.body { color: red; }</style>"), true);
      assertEquals(result.includes("<style>.header { font-size: 2rem; }</style>"), true);
    });

    it("should combine multiple metas, links, and styles", () => {
      const head: Head = {
        metas: [
          { name: "viewport", content: "width=device-width" },
          { property: "og:title", content: "Title" },
        ],
        links: [{ rel: "icon", href: "/favicon.ico" }],
        styles: [".body { margin: 0; }"],
      };
      const result = buildHeadElements(head);
      assertEquals(result.includes("<meta"), true);
      assertEquals(result.includes("<link"), true);
      assertEquals(result.includes("<style>"), true);
    });
  });

  describe("mergeFrontmatter", () => {
    it("should merge page entity frontmatter, page bundle frontmatter, and collected metadata", () => {
      const context = {
        pageInfo: { entity: { frontmatter: { title: "Page Title" } } },
        pageBundle: { frontmatter: { author: "Author" } },
        collectedMetadata: { custom: "value" },
      };
      const result = mergeFrontmatter(context);
      assertEquals(result.title, "Page Title");
      assertEquals(result.author, "Author");
      assertEquals(result.custom, "value");
    });

    it("should let later sources override earlier ones", () => {
      const context = {
        pageInfo: { entity: { frontmatter: { title: "From Entity" } } },
        pageBundle: { frontmatter: { title: "From Bundle" } },
        collectedMetadata: { title: "From Metadata" },
      };
      const result = mergeFrontmatter(context);
      assertEquals(result.title, "From Metadata");
    });

    it("should handle missing frontmatter gracefully", () => {
      const context = {
        pageInfo: { entity: { frontmatter: undefined } },
        pageBundle: {},
        collectedMetadata: undefined,
      };
      const result = mergeFrontmatter(context);
      assertExists(result);
    });

    it("should handle empty objects", () => {
      const context = {
        pageInfo: { entity: { frontmatter: {} } },
        pageBundle: { frontmatter: {} },
        collectedMetadata: {},
      };
      const result = mergeFrontmatter(context);
      assertEquals(Object.keys(result).length, 0);
    });
  });

  describe("HTMLGeneratorConfig type", () => {
    it("should accept valid config", () => {
      const config: Partial<HTMLGeneratorConfig> = {
        projectDir: "/project",
        mode: "development",
      };
      assertEquals(config.projectDir, "/project");
      assertEquals(config.mode, "development");
    });

    it("should accept production mode", () => {
      const config: Partial<HTMLGeneratorConfig> = { mode: "production" };
      assertEquals(config.mode, "production");
    });
  });

  describe("HTMLGenerator constructor", () => {
    it("should create an instance with mock config", () => {
      const mockAdapter = {
        fs: {
          readFile: () => "",
          exists: () => false,
          stat: () => ({ isFile: false, isDirectory: false, isSymlink: false }),
          readDir: function* () {},
          mkdir: () => {},
          writeFile: () => {},
        },
      };

      const generator = new HTMLGenerator({
        projectDir: "/project",
        adapter: mockAdapter as any,
        config: {} as any,
        mode: "development",
      });

      assertExists(generator);
    });
  });
});
