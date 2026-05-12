import "#veryfront/schemas/_test-setup.ts";
import "../../html/styles-builder/__tests__/css-processor-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type HTMLGeneratorConfig } from "./html.ts";
import { buildHeadElements, mergeFrontmatter } from "./html-head.ts";
import { mergeImportedCSS } from "./html-imported-css.ts";
import {
  createHTMLContext,
  createHTMLGenerator,
  createMockAdapter,
  createSingleChunkStream,
} from "./html.test-helpers.ts";

type Head = {
  metas: Array<{ name?: string; property?: string; content?: string }>;
  links: Array<Record<string, string | null | undefined>>;
  styles: string[];
};

describe("HTMLGenerator helpers", () => {
  describe("buildHeadElements", () => {
    it("should return empty string for undefined head", () => {
      assertEquals(buildHeadElements(undefined), { scripts: "", other: "" });
    });

    it("should return empty string for empty head", () => {
      assertEquals(buildHeadElements({ metas: [], links: [], styles: [], scripts: [] } as any), {
        scripts: "",
        other: "",
      });
    });

    it("should skip description meta tags", () => {
      const head: Head = {
        metas: [{ name: "description", content: "A description" }],
        links: [],
        styles: [],
      };
      assertEquals(buildHeadElements({ ...head, scripts: [] } as any), { scripts: "", other: "" });
    });

    it("should render meta tags with name attribute", () => {
      const head: Head = {
        metas: [{ name: "viewport", content: "width=device-width" }],
        links: [],
        styles: [],
      };
      const result = buildHeadElements({ ...head, scripts: [] } as any).other;
      assertEquals(result.includes('name="viewport"'), true);
      assertEquals(result.includes('content="width=device-width"'), true);
    });

    it("should render meta tags with property attribute (OpenGraph)", () => {
      const head: Head = {
        metas: [{ property: "og:title", content: "My Page" }],
        links: [],
        styles: [],
      };
      const result = buildHeadElements({ ...head, scripts: [] } as any).other;
      assertEquals(result.includes('property="og:title"'), true);
      assertEquals(result.includes('content="My Page"'), true);
    });

    it("should render link tags filtering null values", () => {
      const head: Head = {
        metas: [],
        links: [{ rel: "stylesheet", href: "/style.css", integrity: null }],
        styles: [],
      };
      const result = buildHeadElements({ ...head, scripts: [] } as any).other;
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
      const result = buildHeadElements({ ...head, scripts: [] } as any).other;
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
      const result = buildHeadElements({ ...head, scripts: [] } as any).other;
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
      const generator = createHTMLGenerator({
        mode: "development",
        readFile: async () => "",
      });

      assertExists(generator);
    });
  });

  describe("generateFullHTML", () => {
    it("forwards nonce when injecting import maps into full HTML documents", async () => {
      const generator = createHTMLGenerator({
        readFile: async () => `'use client';`,
      });

      const html = await generator.generateFullHTML(createHTMLContext({
        options: { nonce: "nonce-123" },
      }));

      assertEquals(html.includes('<script type="importmap" nonce="nonce-123">'), true);
    });

    it("injects preview utility CSS into full HTML documents for preview rendering", async () => {
      const mockAdapter = createMockAdapter(async () => `'use client';`);

      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const html = await generator.generateFullHTML(createHTMLContext({
        options: { environment: "preview" },
      }));

      assertEquals(html.includes('id="vf-tailwind-css"'), true);
      assertEquals(html.includes("/_vf_styles/styles.css?t="), true);
    });

    it("injects production project stylesheet links into full HTML documents", async () => {
      const mockAdapter = createMockAdapter(async (path: string) => {
        if (path.endsWith("/app/page.tsx")) return `'use client';`;
        if (path.endsWith("/globals.css")) {
          return "body { background: #0f172a; color: #f8fafc; }";
        }
        return "";
      });

      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const html = await generator.generateFullHTML(createHTMLContext({
        options: { environment: "production" },
      }));

      assertEquals(/<link rel="stylesheet" href="\/_vf\/css\/[^"]+\.css">/.test(html), true);
      assertEquals(html.includes('id="vf-tailwind-css"'), false);
    });

    it("preserves full-document layout head/body output for explicit dark-mode requests", async () => {
      const mockAdapter = createMockAdapter(async () => `'use client';`);

      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const html = await generator.generateFullHTML({
        html:
          '<!DOCTYPE html><html lang="en"><head><title>Layout Title</title><style>body{background:#0f172a;color:#f8fafc}</style></head><body class="theme-dark" style="background:#0f172a;color:#f8fafc"><main>Hello</main></body></html>',
        pageInfo: {
          entity: {
            path: "/project/app/page.tsx",
            frontmatter: {},
          },
        } as any,
        pageBundle: {} as any,
        layoutBundle: undefined,
        nestedLayouts: [],
        collectedMetadata: {},
        slug: "test-page",
        ssrHash: "hash123",
        options: {
          nonce: "nonce-123",
          colorScheme: "dark",
          colorSchemeFromParam: true,
        },
      });

      assertEquals(html.includes("<title>Layout Title</title>"), true);
      assertEquals(
        html.includes(
          '<body class="theme-dark" style="background:#0f172a;color:#f8fafc">',
        ),
        true,
      );
      assertEquals(html.includes('data-theme="dark"'), true);
      assertEquals(html.includes("color-scheme: dark;"), true);
      assertEquals(html.includes(`localStorage.setItem('theme','dark')`), true);
    });

    it("adds nonce to inline style and script tags in rendered HTML", async () => {
      const mockAdapter = createMockAdapter(async () => "");

      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const html = await generator.generateFullHTML({
        html:
          `<div><style>.chat{color:red}</style><script>window.__vf=1</script><main>Hello</main></div>`,
        pageInfo: {
          entity: {
            path: "/project/app/page.tsx",
            frontmatter: {},
          },
        } as any,
        pageBundle: {} as any,
        layoutBundle: undefined,
        nestedLayouts: [],
        collectedMetadata: {},
        slug: "test-page",
        ssrHash: "hash123",
        options: { nonce: "nonce-123" },
      });

      assertEquals(html.includes('<style nonce="nonce-123">.chat{color:red}</style>'), true);
      assertEquals(
        html.includes('<script nonce="nonce-123">window.__vf=1</script>'),
        true,
      );
    });

    it("adds nonce to collected head style and script tags", async () => {
      const mockAdapter = createMockAdapter(async () => "");

      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const html = await generator.generateFullHTML({
        html: "<div>Hello</div>",
        pageInfo: {
          entity: {
            path: "/project/app/page.tsx",
            frontmatter: {},
          },
        } as any,
        pageBundle: {} as any,
        layoutBundle: undefined,
        nestedLayouts: [],
        collectedMetadata: {},
        slug: "test-page",
        ssrHash: "hash123",
        options: { nonce: "nonce-123" },
        collectedHead: {
          title: "",
          description: "",
          metas: [],
          links: [],
          styles: [".from-head{color:blue}"],
          scripts: [{ content: "window.__HEAD_OK__=true" }],
        },
      });

      assertEquals(html.includes('<style nonce="nonce-123">.from-head{color:blue}</style>'), true);
      assertEquals(html.includes('<script data-vf-head="true"'), true);
      assertEquals(html.includes('nonce="nonce-123">window.__HEAD_OK__=true</script>'), true);
    });

    it("does not duplicate an existing nonce attribute", async () => {
      const mockAdapter = createMockAdapter(async () => "");

      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const html = await generator.generateFullHTML({
        html:
          `<div><style nonce="existing-nonce">.chat{color:red}</style><script nonce="existing-nonce">window.__vf=1</script></div>`,
        pageInfo: {
          entity: {
            path: "/project/app/page.tsx",
            frontmatter: {},
          },
        } as any,
        pageBundle: {} as any,
        layoutBundle: undefined,
        nestedLayouts: [],
        collectedMetadata: {},
        slug: "test-page",
        ssrHash: "hash123",
        options: { nonce: "nonce-123" },
      });

      assertEquals((html.match(/nonce="existing-nonce"/g) ?? []).length, 2);
      assertEquals(html.includes('nonce="nonce-123" nonce="existing-nonce"'), false);
    });

    it("escapes nonce values before injecting rendered tags", async () => {
      const mockAdapter = createMockAdapter(async () => "");

      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const html = await generator.generateFullHTML({
        html: `<div><style>.chat{color:red}</style><script>window.__vf=1</script></div>`,
        pageInfo: {
          entity: {
            path: "/project/app/page.tsx",
            frontmatter: {},
          },
        } as any,
        pageBundle: {} as any,
        layoutBundle: undefined,
        nestedLayouts: [],
        collectedMetadata: {},
        slug: "test-page",
        ssrHash: "hash123",
        options: { nonce: `nonce-"<&'` },
      });

      assertEquals(
        html.includes('<style nonce="nonce-&quot;&lt;&amp;&#39;">.chat{color:red}</style>'),
        true,
      );
      assertEquals(
        html.includes('<script nonce="nonce-&quot;&lt;&amp;&#39;">window.__vf=1</script>'),
        true,
      );
      assertEquals(
        html.includes('<script type="importmap" nonce="nonce-&quot;&lt;&amp;&#39;">'),
        true,
      );
      assertEquals(html.includes('nonce="nonce-"<&\'"'), false);
    });

    it("does not inject nonce markup into script or style literals inside inline scripts", async () => {
      const mockAdapter = createMockAdapter(async () => "");

      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const html = await generator.generateFullHTML({
        html:
          `<div><script>window.tpl="<script>alert(1)";window.css="<style>.x{color:red}";</script><style>.chat{color:red}</style></div>`,
        pageInfo: {
          entity: {
            path: "/project/app/page.tsx",
            frontmatter: {},
          },
        } as any,
        pageBundle: {} as any,
        layoutBundle: undefined,
        nestedLayouts: [],
        collectedMetadata: {},
        slug: "test-page",
        ssrHash: "hash123",
        options: { nonce: "nonce-123" },
      });

      assertEquals(
        html.includes(
          '<script nonce="nonce-123">window.tpl="<script>alert(1)";window.css="<style>.x{color:red}";</script>',
        ),
        true,
      );
      assertEquals(html.includes('<style nonce="nonce-123">.chat{color:red}</style>'), true);
      assertEquals(html.includes('<script nonce="nonce-123">alert(1)'), false);
      assertEquals(html.includes('<style nonce="nonce-123">.x{color:red}'), false);
    });
  });

  describe("generateHTMLStream", () => {
    it("preserves full-document layout output when streaming app-router pages", async () => {
      const mockAdapter = createMockAdapter(async () => `'use client';`);

      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const stream = createSingleChunkStream(
        '<!DOCTYPE html><html lang="en"><head><title>Stream Layout Title</title><style>body{background:#0f172a;color:#f8fafc}</style></head><body class="stream-dark" style="background:#0f172a;color:#f8fafc"><main>Hello</main></body></html>',
      );

      const responseStream = await generator.generateHTMLStream(
        stream,
        createHTMLContext({
          options: {
            nonce: "nonce-123",
            colorScheme: "dark",
            colorSchemeFromParam: true,
            environment: "preview",
          },
        }),
      );

      const html = await new Response(responseStream).text();

      assertEquals(html.includes("<title>Stream Layout Title</title>"), true);
      assertEquals(
        html.includes(
          '<body class="stream-dark" style="background:#0f172a;color:#f8fafc">',
        ),
        true,
      );
      assertEquals(html.includes('data-theme="dark"'), true);
      assertEquals(html.includes('id="vf-tailwind-css"'), true);
      assertEquals(html.includes(`localStorage.setItem('theme','dark')`), true);
    });

    it("keeps production project stylesheet links for streamed full-document pages", async () => {
      const mockAdapter = createMockAdapter(async (path: string) => {
        if (path.endsWith("/app/page.tsx")) return `'use client';`;
        if (path.endsWith("/globals.css")) {
          return "body { background: #0f172a; color: #f8fafc; }";
        }
        return "";
      });

      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const stream = createSingleChunkStream(
        "<!DOCTYPE html><html><head><title>Prod Layout</title></head><body><main>Hello</main></body></html>",
      );

      const responseStream = await generator.generateHTMLStream(
        stream,
        createHTMLContext({
          options: {
            environment: "production",
          },
        }),
      );

      const html = await new Response(responseStream).text();

      assertEquals(/<link rel="stylesheet" href="\/_vf\/css\/[^"]+\.css">/.test(html), true);
      assertEquals(html.includes('id="vf-tailwind-css"'), false);
      assertEquals(html.includes("hydrate.js?slug=test-page"), true);
    });
  });

  describe("mergeImportedCSS", () => {
    it("deduplicates only exact configured stylesheet path", async () => {
      const readPaths: string[] = [];
      const merged = await mergeImportedCSS({
        fs: {
          readFile: async (path: string) => {
            readPaths.push(path);
            if (path === "/project/styles/globals.css") return ".feature { color: red; }";
            if (path === "/project/globals.css") return ".duplicate { color: blue; }";
            return "";
          },
        },
        logger: { debug: () => {} },
        projectDir: "/project",
        globalCSS: "/* global */",
        cssImports: ["/project/styles/globals.css", "/project/globals.css"],
        stylesheetPath: "globals.css",
      });

      assertEquals(readPaths, ["/project/styles/globals.css"]);
      assertEquals(merged?.includes("/* global */"), true);
      assertEquals(merged?.includes(".feature { color: red; }"), true);
      assertEquals(merged?.includes(".duplicate { color: blue; }"), false);
    });

    it("orders imported css deterministically and rewrites module selectors", async () => {
      const merged = await mergeImportedCSS({
        fs: {
          readFile: async (path: string) => {
            if (path === "/project/b.css") return ".b { color: blue; }";
            if (path === "/project/a.module.css") return ".root { color: red; }";
            return "";
          },
        },
        logger: { debug: () => {} },
        projectDir: "/project",
        globalCSS: "/* global */",
        cssImports: ["/project/a.module.css", "/project/b.css"],
        stylesheetPath: "globals.css",
      });

      assertEquals(
        merged?.indexOf(".b { color: blue; }")! > merged?.indexOf("/* global */")!,
        true,
      );
      assertEquals(merged?.includes(".a_root__"), true);
      assertEquals(merged?.indexOf(".a_root__")! > merged?.indexOf(".b { color: blue; }")!, true);
    });
  });
});
