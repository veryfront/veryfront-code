import "#veryfront/schemas/_test-setup.ts";
import {
  registerTailwindExtension,
} from "../../html/styles-builder/__tests__/css-processor-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
} from "#veryfront/release-assets/constants.ts";
import {
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
} from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { FSAdapterWrapper } from "#veryfront/platform/adapters/fs/wrapper.ts";
import {
  clearCSSCache,
  getCSSByHash,
  invalidateCompiler,
} from "#veryfront/html/styles-builder/index.ts";
import { register as registerContract } from "#veryfront/extensions/contracts.ts";
import { HTMLGenerator, type HTMLGeneratorConfig } from "./html.ts";
import { buildHeadElements, mergeFrontmatter } from "./html-head.ts";
import { mergeImportedCSS } from "./html-imported-css.ts";
import {
  createHTMLContext,
  createHTMLGenerator,
  createMockAdapter,
  createSingleChunkStream,
} from "./html.test-helpers.ts";
import { installTestCSSOptimizationEngine } from "../../../tests/_helpers/css-optimization-engine.ts";

type Head = {
  metas: Array<{ name?: string; property?: string; content?: string }>;
  links: Array<Record<string, string | null | undefined>>;
  styles: string[];
};

const REACT_HASH = "e".repeat(64);
const RELEASE_CSS_HASH = "f".repeat(64);
const REACT_CDN_URL = "https://esm.sh/react@19.2.4?target=es2022&deps=csstype@3.2.3";
const PIN_KEY_A = "on:z7bg3qnfgtcb";
const PIN_KEY_B = "on:3w5e11264sgsf";

function extractBridgeConfig(html: string): Record<string, unknown> {
  const match = html.match(/window\.__VF_BRIDGE_CONFIG__=(\{.*?\});<\/script>/);
  assertExists(match?.[1], "expected Studio bridge config script");
  return JSON.parse(match[1]);
}

function releaseManifest(): ReleaseAssetManifest {
  return {
    schemaVersion: 2,
    projectId: "p",
    releaseId: "rel-1",
    releaseVersion: 1,
    manifestVersion: 1,
    builderVersion: "0.1.800",
    sourceContentHash: "a".repeat(64),
    createdAt: "2026-06-12T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules: {},
    css: [],
    routes: {},
    dependencyMode: "immutable",
    dependencies: {
      [REACT_CDN_URL]: {
        contentHash: REACT_HASH,
        size: 1,
        contentType: "text/javascript",
      },
    },
  };
}

function releaseManifestWithCSS(): ReleaseAssetManifest {
  return {
    ...releaseManifest(),
    css: [{
      contentHash: RELEASE_CSS_HASH,
      size: 1,
      contentType: "text/css",
      styleProfileHash: "c".repeat(64),
      cssPipelineIdentity: "test-css-pipeline@1",
    }],
    routes: { "/": { modules: [], css: [RELEASE_CSS_HASH] } },
  };
}

describe("HTMLGenerator helpers", () => {
  const originalManifestFlag = getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);
  const originalDependencyFlag = getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);
  let restoreCSSOptimizationEngine: (() => void) | undefined;

  beforeEach(() => {
    restoreCSSOptimizationEngine = installTestCSSOptimizationEngine();
  });

  afterEach(() => {
    restoreCSSOptimizationEngine?.();
    restoreCSSOptimizationEngine = undefined;
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, originalManifestFlag ?? "");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, originalDependencyFlag ?? "");
    configureReleaseAssetManifestFetcher(undefined);
    clearReleaseAssetManifestCache();
    clearCSSCache();
  });

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

    it("should preserve description meta tags for exact Head adoption", () => {
      const head: Head = {
        metas: [{ name: "description", content: "A description" }],
        links: [],
        styles: [],
      };
      assertEquals(
        buildHeadElements({ ...head, scripts: [] } as any).other,
        '<meta data-vf-head="true" name="description" content="A description">',
      );
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

    it("escapes collected head attributes and neutralizes raw text closing tags", () => {
      const result = buildHeadElements({
        metas: [
          {
            name: `viewport" onmouseover="alert(1)`,
            content: `" < > &`,
          },
        ],
        links: [
          {
            rel: `stylesheet" onload="alert(1)`,
            href: `/style.css?x="<&`,
          },
        ],
        styles: [`body:after{content:"</style><style>body{color:red}</style>"}`],
        scripts: [
          {
            id: `head" onload="alert(1)`,
            content: `globalThis.value="</script><script>alert(1)</script>"`,
          },
        ],
      } as any);

      assertEquals(result.other.includes('name="viewport" onmouseover="alert(1)"'), false);
      assertEquals(result.other.includes('rel="stylesheet" onload="alert(1)"'), false);
      assertEquals(result.scripts.includes('id="head" onload="alert(1)"'), false);
      assertEquals(result.scripts.includes("</script><script>alert(1)</script>"), false);
      assertEquals(result.other.includes("</style><style>body{color:red}</style>"), false);
      assertEquals(result.other.includes('content="&quot; &lt; &gt; &amp;"'), true);
      assertEquals(
        result.other.includes('name="viewport&quot; onmouseover=&quot;alert(1)"'),
        true,
      );
      assertEquals(
        result.other.includes('rel="stylesheet&quot; onload=&quot;alert(1)"'),
        true,
      );
      assertEquals(result.scripts.includes('id="head&quot; onload=&quot;alert(1)"'), true);
      assertEquals(result.scripts.includes("<\\/script><script>alert(1)<\\/script>"), true);
      assertEquals(result.other.includes("<\\/style><style>body{color:red}<\\/style>"), true);
    });

    it("should render style tags", () => {
      const head: Head = {
        metas: [],
        links: [],
        styles: [".body { color: red; }", ".header { font-size: 2rem; }"],
      };
      const result = buildHeadElements({ ...head, scripts: [] } as any).other;
      assertEquals(
        result.includes('<style data-vf-head="true">.body { color: red; }</style>'),
        true,
      );
      assertEquals(
        result.includes(
          '<style data-vf-head="true">.header { font-size: 2rem; }</style>',
        ),
        true,
      );
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
      assertEquals(result.includes('<style data-vf-head="true">'), true);
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

    it("validates rich HTML metadata while merging source precedence", () => {
      const result = mergeFrontmatter({
        pageInfo: {
          entity: {
            frontmatter: {
              tags: "source",
              date: new Date("2026-07-24T08:30:00.000Z"),
              nested: { unsafe: true },
              og: { title: "Entity title" },
            },
          },
        },
        pageBundle: {
          frontmatter: {
            tags: ["bundle"],
          },
        },
        collectedMetadata: {
          og: { title: "Generated title" },
          meta: [{ name: "robots", content: "index,follow" }],
          scripts: [{ src: "/metadata.js", defer: "true" }],
        },
      } as never);

      assertEquals(result, {
        tags: ["bundle"],
        date: new Date("2026-07-24T08:30:00.000Z"),
        nested: { unsafe: true },
        og: { title: "Generated title" },
        meta: [{ name: "robots", content: "index,follow" }],
        scripts: [{ src: "/metadata.js", defer: "true" }],
      });
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

  describe("resolveErrorComponentPath", () => {
    it("returns null when the app root is absent", async () => {
      const generator = new HTMLGenerator({
        projectDir: "/project",
        adapter: {
          fs: {
            stat: () =>
              Promise.reject(
                Object.assign(new Error("app root not found"), { code: "ENOENT" }),
              ),
          },
        } as any,
        config: {} as any,
        mode: "production",
      });

      assertEquals(
        await generator.resolveErrorComponentPath(createHTMLContext()),
        null,
      );
    });

    it("propagates operational app-root stat failures", async () => {
      const generator = new HTMLGenerator({
        projectDir: "/project",
        adapter: {
          fs: {
            stat: () =>
              Promise.reject(
                Object.assign(new Error("app storage unavailable"), { code: "EIO" }),
              ),
          },
        } as any,
        config: {} as any,
        mode: "production",
      });

      await assertRejects(
        () => generator.resolveErrorComponentPath(createHTMLContext()),
        Error,
        "app storage unavailable",
      );
    });

    it("does not reinterpret an absolute page path outside the app root", async () => {
      let componentReads = 0;
      const generator = new HTMLGenerator({
        projectDir: "/project",
        adapter: {
          fs: {
            stat: async () => ({
              isFile: false,
              isDirectory: true,
              isSymlink: false,
              size: 0,
              mtime: null,
            }),
            readFile: () => {
              componentReads++;
              return Promise.reject(
                Object.assign(new Error("candidate not found"), { code: "ENOENT" }),
              );
            },
          },
        } as any,
        config: { react: { version: "19.2.4" } } as any,
        mode: "production",
      });

      const context = createHTMLContext({
        pageInfo: {
          entity: {
            path: "/app/external/page.tsx",
            frontmatter: {},
          },
        } as any,
      });

      assertEquals(await generator.resolveErrorComponentPath(context), null);
      assertEquals(componentReads, 0);
    });
  });

  describe("generateFullHTML", () => {
    it("fully initializes Studio for authored HTML documents", async () => {
      const html = await createHTMLGenerator().generateFullHTML(
        createHTMLContext({
          html:
            '<!DOCTYPE html><html><head></head><body><div id="root"><main>Hello</main></div></body></html>',
          pageInfo: {
            entity: {
              path: "/project/app/page.tsx",
              content: "export default function Page() { return <main>Hello</main>; }",
              frontmatter: {},
            },
          } as never,
          options: {
            studioEmbed: true,
            projectId: "project-1",
            pageId: "page-1",
            nonce: "nonce-123",
          },
        }),
      );

      assertEquals(extractBridgeConfig(html), {
        projectId: "project-1",
        pageId: "page-1",
        pagePath: "app/page.tsx",
        nonce: "nonce-123",
      });
      assertStringIncludes(html, "window.__VERYFRONT_SOURCE_HASH__=");
      assertStringIncludes(html, 'data-vf-selector="vf-div-1"');
      assertStringIncludes(html, 'data-vf-selector="vf-main-2"');
      assertStringIncludes(
        html,
        '<script type="module" src="/_veryfront/studio-bridge.js" nonce="nonce-123"></script>',
      );
    });

    it("applies collected metadata precedence to full HTML documents", async () => {
      const html = await createHTMLGenerator().generateFullHTML(
        createHTMLContext({
          html:
            "<!DOCTYPE html><html><head><title>{{title}}</title>{{meta}}{{links}}{{styles}}</head><body><main>Hello</main>{{scripts}}</body></html>",
          pageInfo: {
            entity: {
              path: "/project/app/page.tsx",
              frontmatter: {
                title: "Source title",
                description: "Source description",
                og: { title: "Source OpenGraph title" },
              },
            },
          } as never,
          collectedMetadata: {
            title: "Generated title",
            description: "Generated description",
            og: { title: "Generated OpenGraph title" },
          },
        }),
      );

      assertStringIncludes(html, "<title>Generated title</title>");
      assertStringIncludes(html, 'name="description" content="Generated description"');
      assertStringIncludes(
        html,
        'property="og:title" content="Generated OpenGraph title"',
      );
      assertEquals(html.includes("Source OpenGraph title"), false);
    });

    it("does not invoke layout frontmatter accessors for fragment documents", async () => {
      let getterCalls = 0;
      const layoutFrontmatter: Record<string, unknown> = {
        description: "Safe layout description",
      };
      Object.defineProperty(layoutFrontmatter, "title", {
        enumerable: true,
        get() {
          getterCalls++;
          return "Unsafe layout title";
        },
      });

      const html = await createHTMLGenerator().generateFullHTML(
        createHTMLContext({
          html: "<main>Hello</main>",
          layoutBundle: { frontmatter: layoutFrontmatter } as never,
        }),
      );

      assertEquals(getterCalls, 0);
      assertEquals(html.includes("Unsafe layout title"), false);
      assertStringIncludes(html, 'name="description" content="Safe layout description"');
    });

    it("validates structured metadata before injecting a full HTML document", async () => {
      let getterCalls = 0;
      const frontmatter: Record<string, unknown> = {
        description: "Validated description",
        og: { title: "Validated OpenGraph title" },
        links: [{ rel: "canonical", href: "https://example.com/page" }],
        icons: [{ href: "/icon.svg", type: "image/svg+xml" }],
        scripts: [{ content: "window.__METADATA__ = true" }],
        styles: [{ content: "body { color: navy; }" }],
      };
      Object.defineProperty(frontmatter, "title", {
        enumerable: true,
        get() {
          getterCalls++;
          return "Unsafe title";
        },
      });

      const html = await createHTMLGenerator().generateFullHTML(
        createHTMLContext({
          html:
            "<!DOCTYPE html><html><head>{{meta}}{{links}}{{styles}}</head><body><main>Hello</main>{{scripts}}</body></html>",
          pageInfo: {
            entity: {
              path: "/project/app/page.tsx",
              frontmatter,
            },
          } as never,
        }),
      );

      assertEquals(getterCalls, 0);
      assertStringIncludes(html, 'name="description" content="Validated description"');
      assertStringIncludes(
        html,
        'property="og:title" content="Validated OpenGraph title"',
      );
      assertStringIncludes(html, 'rel="canonical" href="https://example.com/page"');
      assertStringIncludes(html, 'rel="icon" href="/icon.svg" type="image/svg+xml"');
      assertStringIncludes(html, "window.__METADATA__ = true");
      assertStringIncludes(html, "body { color: navy; }");
      assertEquals(html.includes("Unsafe title"), false);
    });

    it("does not hydrate full documents for non-prologue use-client text", async () => {
      const serverSources = [
        "// 'use client';\nexport default function Page() {}",
        "export default function Page() {\n  'use client';\n}",
        "import React from 'react';\n'use client';\nexport default function Page() {}",
      ];

      for (const pageSource of serverSources) {
        const html = await createHTMLGenerator({
          readFile: async (path: string) => path.endsWith("/app/page.tsx") ? pageSource : "",
        }).generateFullHTML(createHTMLContext());

        assertEquals(html.includes('id="veryfront-hydration-data"'), false);
        assertEquals(html.includes("/_veryfront/hydration-runtime.js"), false);
      }
    });

    it("propagates operational page reads during client-directive detection", async () => {
      const failure = Object.assign(new Error("page source unavailable"), {
        code: "EIO",
      });
      const generator = createHTMLGenerator({
        readFile: async (path: string) => {
          if (path.endsWith("/app/page.tsx")) throw failure;
          return "";
        },
      });

      await assertRejects(
        () => generator.generateFullHTML(createHTMLContext()),
        Error,
        "page source unavailable",
      );
    });

    it("preserves the exact client module strategy independently from render mode", async () => {
      const readFile = async () => `'use client';`;
      const remoteDevelopmentHtml = await createHTMLGenerator({
        mode: "development",
        isLocalProject: false,
        clientModuleStrategy: "rsc-module",
        readFile,
      }).generateFullHTML(createHTMLContext({ options: { environment: "preview" } }));
      const localProductionHtml = await createHTMLGenerator({
        mode: "production",
        isLocalProject: true,
        clientModuleStrategy: "rsc-module",
        readFile,
      }).generateFullHTML(createHTMLContext({ options: { environment: "preview" } }));
      const localDevelopmentHtml = await createHTMLGenerator({
        mode: "development",
        isLocalProject: true,
        clientModuleStrategy: "fs",
        readFile,
      }).generateFullHTML(createHTMLContext({ options: { environment: "preview" } }));

      const parseHydrationData = (html: string) => {
        const payload = html.match(
          /<script id="veryfront-hydration-data" type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
        )?.[1];
        assertExists(payload);
        return JSON.parse(payload) as { clientModuleStrategy?: string };
      };

      assertEquals(parseHydrationData(remoteDevelopmentHtml).clientModuleStrategy, "rsc-module");
      assertEquals(parseHydrationData(localProductionHtml).clientModuleStrategy, "rsc-module");
      assertEquals(parseHydrationData(localDevelopmentHtml).clientModuleStrategy, "fs");
      assertEquals(localProductionHtml.includes("/_veryfront/hmr"), false);
    });

    it("publishes only client-owned layouts for an isolated page island", async () => {
      const generator = createHTMLGenerator({
        mode: "production",
        isLocalProject: false,
      });
      const serverLayoutPath = "/project/app/layout.tsx";
      const clientLayoutPath = "/project/app/dashboard/layout.tsx";

      const html = await generator.generateFullHTML(createHTMLContext({
        html:
          '<main id="server-layout"><div id="veryfront-page-island"><button>Count: 0</button></div></main>',
        nestedLayouts: [
          { kind: "tsx", path: serverLayoutPath, componentPath: serverLayoutPath },
          { kind: "tsx", path: clientLayoutPath, componentPath: clientLayoutPath },
        ],
        options: {
          environment: "production",
          clientPageIsland: {
            clientLayoutPaths: [clientLayoutPath],
            hasServerLayouts: true,
          },
          layoutProps: {
            "app/layout.tsx": { audience: "server" },
            "app/dashboard/layout.tsx": { theme: "docs" },
          },
        },
      }));

      const payload = html.match(
        /<script id="veryfront-hydration-data" type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
      )?.[1];
      assertExists(payload);
      const hydrationData = JSON.parse(payload) as {
        isolatedClientPage?: boolean;
        layouts?: Array<{ kind?: string; path?: string }>;
        layoutProps?: Record<string, Record<string, unknown>>;
      };

      assertEquals(hydrationData.isolatedClientPage, true);
      assertEquals(hydrationData.layouts, [{
        kind: "tsx",
        path: "app/dashboard/layout.tsx",
      }]);
      assertEquals(hydrationData.layoutProps, {
        "app/dashboard/layout.tsx": { theme: "docs" },
      });
    });

    it("forwards nonce when injecting import maps into full HTML documents", async () => {
      const generator = createHTMLGenerator({
        readFile: async () => `'use client';`,
      });

      const html = await generator.generateFullHTML(createHTMLContext({
        options: { nonce: "nonce-123" },
      }));

      assertEquals(html.includes('<script type="importmap" nonce="nonce-123">'), true);
    });

    it("keeps the import map and hydration payload on historical snapshot A after B", async () => {
      const generator = createHTMLGenerator({
        readFile: async (path: string) => path.endsWith("/app/page.tsx") ? `'use client';` : "",
      });
      const renderSnapshot = (
        key: string,
        react: string,
      ) =>
        generator.generateFullHTML(createHTMLContext({
          options: {
            environment: "production",
            dependencyPinningCacheKey: key,
            dependencyPinningDependencies: { react },
          },
        }));

      const snapshotBHtml = await renderSnapshot(PIN_KEY_B, "^19.0.0");
      const snapshotAHtml = await renderSnapshot(PIN_KEY_A, "^18.3.1");
      const parseImportMap = (html: string) => {
        const json = html.match(
          /<script type="importmap"[^>]*>([\s\S]*?)<\/script>/,
        )?.[1];
        assertExists(json);
        return JSON.parse(json).imports as Record<string, string>;
      };
      const parseHydrationData = (html: string) => {
        const json = html.match(
          /<script id="veryfront-hydration-data" type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
        )?.[1];
        assertExists(json);
        return JSON.parse(json) as { dependencyPinningCacheKey?: string };
      };

      assertStringIncludes(parseImportMap(snapshotBHtml).react!, "react@19.0.0");
      assertStringIncludes(parseImportMap(snapshotAHtml).react!, "react@18.3.1");
      assertEquals(
        parseHydrationData(snapshotAHtml).dependencyPinningCacheKey,
        PIN_KEY_A,
      );
    });

    it("treats an undefined manifest option as absent for full HTML import maps", async () => {
      setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
      setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
      configureReleaseAssetManifestFetcher(() =>
        Promise.resolve({ state: "ready", manifest_version: 1, manifest: releaseManifest() })
      );
      const generator = createHTMLGenerator({
        readFile: async (path: string) => path.endsWith("/app/page.tsx") ? `'use client';` : "",
      });

      const html = await generator.generateFullHTML(createHTMLContext({
        options: {
          environment: "production",
          releaseId: "rel-1",
          releaseAssetManifest: undefined,
        },
      }));

      assertStringIncludes(html, `/_vf/assets/${REACT_HASH}.js`);
    });

    it("injects preview utility CSS into full HTML documents for preview rendering", async () => {
      const mockAdapter = createMockAdapter(async () => `'use client';`);

      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const html = await generator.generateFullHTML(createHTMLContext({
        options: { environment: "preview" },
      }));

      assertEquals(html.includes('id="vf-project-css"'), true);
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
      assertEquals(html.includes('id="vf-project-css"'), false);
    });

    it("owns a rejecting project CSS task when full-document import-map construction fails", async () => {
      const cssFailure = new Error("project CSS preparation failed");
      const importMapFailure = new Error("import map construction failed");
      const unhandledReasons: unknown[] = [];
      const onUnhandled = (event: PromiseRejectionEvent) => {
        unhandledReasons.push(event.reason);
        event.preventDefault();
      };
      const config: Record<string, unknown> = {};
      Object.defineProperty(config, "client", {
        get() {
          throw importMapFailure;
        },
      });
      registerContract("CSSProcessor", {
        cacheIdentity: "test-css-processor-import-map-failure@1",
        defaultStylesheet: "",
        compile: () => Promise.reject(cssFailure),
      });
      invalidateCompiler();
      globalThis.addEventListener("unhandledrejection", onUnhandled);

      try {
        const generator = new HTMLGenerator({
          projectDir: "/project",
          adapter: createMockAdapter(async (path: string) =>
            path.endsWith("/globals.css") ? ".promise-owner { color: navy; }" : ""
          ) as never,
          config: config as never,
          mode: "production",
        });

        const rejection = await assertRejects(
          () =>
            generator.generateFullHTML(createHTMLContext({
              options: {
                environment: "production",
                projectSlug: "full-document-promise-owner-import-map-failure",
              },
            })),
          Error,
          importMapFailure.message,
        );
        assertStrictEquals(rejection, importMapFailure);
        await new Promise((resolve) => setTimeout(resolve, 20));

        assertEquals(unhandledReasons, []);
      } finally {
        globalThis.removeEventListener("unhandledrejection", onUnhandled);
        await registerTailwindExtension();
        invalidateCompiler();
      }
    });

    it("propagates an authoritative project CSS failure without a transient unhandled rejection", async () => {
      const cssFailure = new Error("authoritative project CSS failure");
      const unhandledReasons: unknown[] = [];
      const onUnhandled = (event: PromiseRejectionEvent) => {
        unhandledReasons.push(event.reason);
        event.preventDefault();
      };
      registerContract("CSSProcessor", {
        cacheIdentity: "test-css-processor-authoritative-failure@1",
        defaultStylesheet: "",
        compile: () => Promise.reject(cssFailure),
      });
      invalidateCompiler();
      globalThis.addEventListener("unhandledrejection", onUnhandled);

      try {
        const generator = createHTMLGenerator({
          readFile: async (path: string) =>
            path.endsWith("/globals.css") ? ".promise-consumer { color: teal; }" : "",
        });

        await assertRejects(
          () =>
            generator.generateFullHTML(createHTMLContext({
              options: {
                environment: "production",
                projectSlug: "full-document-promise-owner-css-failure",
              },
            })),
          Error,
          cssFailure.message,
        );
        await new Promise((resolve) => setTimeout(resolve, 20));

        assertEquals(unhandledReasons, []);
      } finally {
        globalThis.removeEventListener("unhandledrejection", onUnhandled);
        await registerTailwindExtension();
        invalidateCompiler();
      }
    });

    it("reports the exact project stylesheet despite authored href-like decoys", async () => {
      const decoyHash = "d".repeat(64);
      const mockAdapter = createMockAdapter(async (path: string) => {
        if (path.endsWith("/app/page.tsx")) return `'use client';`;
        if (path.endsWith("/globals.css")) return ".artifact-page { color: navy; }";
        return "";
      });
      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const result = await generator.generateFullHTMLWithStylesheetArtifact(createHTMLContext({
        html: `<!DOCTYPE html><html><head>
          <a href="/_vf/css/${decoyHash}.css">decoy</a>
          <div data-href="/_vf/css/${decoyHash}.css"></div>
          <link rel="preload" href="/_vf/css/${decoyHash}.css">
        </head><body><main class="artifact-page">Hello</main></body></html>`,
        options: { environment: "production" },
      }));

      assertEquals(result.stylesheet?.kind, "project");
      assertEquals(result.stylesheet?.hash.length, 64);
      assertEquals(
        result.stylesheet?.kind === "project" && result.stylesheet.css.length !== 0,
        true,
      );
      assertStringIncludes(
        result.html,
        `<link rel="stylesheet" href="/_vf/css/${result.stylesheet?.hash}.css">`,
      );
      assertStringIncludes(result.html, `<a href="/_vf/css/${decoyHash}.css">decoy</a>`);
    });

    it("reports the exact release stylesheet linked into a full HTML document", async () => {
      const generator = createHTMLGenerator({
        readFile: async (path: string) => path.endsWith("/app/page.tsx") ? `'use client';` : "",
      });

      const result = await generator.generateFullHTMLWithStylesheetArtifact(
        createHTMLContext({
          html: "<!DOCTYPE html><html><head></head><body><main>Release</main></body></html>",
          options: {
            environment: "production",
            releaseAssetManifest: releaseManifestWithCSS(),
          },
        }),
      );

      assertEquals(result.stylesheet, { kind: "release", hash: RELEASE_CSS_HASH });
      assertStringIncludes(
        result.html,
        `<link rel="stylesheet" href="/_vf/assets/${RELEASE_CSS_HASH}.css">`,
      );
      assertEquals(result.html.includes("/_vf/css/"), false);
    });

    it("reports the exact project stylesheet linked around an HTML fragment", async () => {
      const mockAdapter = createMockAdapter(async (path: string) => {
        if (path.endsWith("/globals.css")) return ".fragment-artifact { color: teal; }";
        return "";
      });
      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const result = await generator.generateFullHTMLWithStylesheetArtifact(
        createHTMLContext({
          html: '<main class="fragment-artifact">Fragment</main>',
          options: { environment: "production" },
        }),
      );

      assertEquals(result.stylesheet?.kind, "project");
      assertEquals(result.stylesheet?.hash.length, 64);
      assertEquals(
        result.stylesheet?.kind === "project" && result.stylesheet.css.length !== 0,
        true,
      );
      assertStringIncludes(
        result.html,
        `<link rel="stylesheet" href="/_vf/css/${result.stylesheet?.hash}.css">`,
      );
    });

    it("reports the exact release stylesheet linked around an HTML fragment", async () => {
      const generator = createHTMLGenerator();

      const result = await generator.generateFullHTMLWithStylesheetArtifact(
        createHTMLContext({
          html: "<main>Release fragment</main>",
          options: {
            environment: "production",
            releaseAssetManifest: releaseManifestWithCSS(),
          },
        }),
      );

      assertEquals(result.stylesheet, { kind: "release", hash: RELEASE_CSS_HASH });
      assertStringIncludes(
        result.html,
        `<link rel="stylesheet" href="/_vf/assets/${RELEASE_CSS_HASH}.css">`,
      );
      assertEquals(result.html.includes("/_vf/css/"), false);
    });

    it("does not start project CSS when release CSS covers an HTML fragment", async () => {
      let compileCalls = 0;
      registerContract("CSSProcessor", {
        compile: () => {
          compileCalls++;
          return Promise.reject(new Error("project CSS must not start"));
        },
      });
      invalidateCompiler();

      try {
        const generator = createHTMLGenerator({
          readFile: async (path: string) =>
            path.endsWith("/globals.css") ? ".release-only { color: red; }" : "",
        });
        const result = await generator.generateFullHTMLWithStylesheetArtifact(
          createHTMLContext({
            html: '<main class="release-only">Release fragment</main>',
            options: {
              environment: "production",
              projectSlug: "release-fragment-no-jit",
              releaseAssetManifest: releaseManifestWithCSS(),
            },
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        assertEquals(result.stylesheet, { kind: "release", hash: RELEASE_CSS_HASH });
        assertEquals(compileCalls, 0);
      } finally {
        await registerTailwindExtension();
        invalidateCompiler();
      }
    });

    it("uses optional file reads when probing the global stylesheet", async () => {
      const calls: string[] = [];
      const generator = new HTMLGenerator({
        projectDir: "/project",
        adapter: {
          fs: {
            readFile: async (path: string) => {
              calls.push(`readFile:${path}`);
              if (path.endsWith("/app/page.tsx")) return "'use client';";
              throw new Error(`unexpected required read: ${path}`);
            },
            readOptionalTextFile: async (path: string) => {
              calls.push(`readOptionalTextFile:${path}`);
              if (path.endsWith("/globals.css")) return "";
              return "";
            },
            exists: async () => false,
            stat: async () => ({
              isFile: false,
              isDirectory: false,
              isSymlink: false,
              size: 0,
              mtime: null,
            }),
            readDir: async function* () {},
          },
        } as any,
        config: {} as any,
        mode: "production",
      });

      await generator.generateFullHTML(createHTMLContext({
        options: { environment: "production" },
      }));

      assertEquals(calls.includes("readOptionalTextFile:/project/globals.css"), true);
      assertEquals(calls.includes("readFile:/project/globals.css"), false);
    });

    it("uses wrapped optional file reads when probing the global stylesheet", async () => {
      const calls: string[] = [];
      const wrappedFs = new FSAdapterWrapper({
        readFile: async (path: string) => {
          calls.push(`underlyingReadFile:${path}`);
          if (path.endsWith("/app/page.tsx")) return "'use client';";
          throw new Error(`unexpected required read: ${path}`);
        },
        readOptionalTextFile: async (path: string) => {
          calls.push(`underlyingReadOptionalTextFile:${path}`);
          return "";
        },
        exists: async () => false,
        stat: async () => ({
          isFile: false,
          isDirectory: false,
          isSymlink: false,
          size: 0,
          mtime: null,
        }),
      });
      const generator = new HTMLGenerator({
        projectDir: "/project",
        adapter: { fs: wrappedFs } as any,
        config: {} as any,
        mode: "production",
      });

      await generator.generateFullHTML(createHTMLContext({
        options: { environment: "production" },
      }));

      assertEquals(
        calls.includes("underlyingReadOptionalTextFile:/project/globals.css"),
        true,
      );
      assertEquals(calls.includes("underlyingReadFile:/project/globals.css"), false);
    });

    it("propagates operational global stylesheet read failures", async () => {
      const failure = Object.assign(new Error("stylesheet backend unavailable"), {
        code: "EIO",
      });
      const generator = new HTMLGenerator({
        projectDir: "/project",
        adapter: {
          fs: {
            readFile: async (path: string) =>
              path.endsWith("/app/page.tsx") ? "" : Promise.reject(failure),
            readOptionalTextFile: () => Promise.reject(failure),
            exists: async () => false,
            stat: async () => ({
              isFile: false,
              isDirectory: false,
              isSymlink: false,
              size: 0,
              mtime: null,
            }),
            readDir: async function* () {},
          },
        } as any,
        config: {} as any,
        mode: "production",
      });

      await assertRejects(
        () => generator.generateFullHTML(createHTMLContext()),
        Error,
        "stylesheet backend unavailable",
      );
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

    it("places theme persistence after authored head-close text", async () => {
      const authoredTail = "</script><!-- authored head-close: </head> -->";
      const html = await createHTMLGenerator().generateFullHTML(
        createHTMLContext({
          html: `<!DOCTYPE html><html><head>` +
            `<script>globalThis.fakeHeadClose = "</head>";</script>` +
            `<!-- authored head-close: </head> -->` +
            `</head><body><main>Hello</main></body></html>`,
          options: {
            colorScheme: "dark",
            colorSchemeFromParam: true,
          },
        }),
      );

      const authoredTailEnd = html.indexOf(authoredTail) + authoredTail.length;
      const themeScriptIndex = html.indexOf("localStorage.setItem('theme','dark')");
      const structuralHeadCloseIndex = html.lastIndexOf("</head>");

      assertEquals(authoredTailEnd >= authoredTail.length, true);
      assertEquals(themeScriptIndex > authoredTailEnd, true);
      assertEquals(themeScriptIndex < structuralHeadCloseIndex, true);
    });

    it("escapes nonce values before injecting theme persistence scripts", async () => {
      const mockAdapter = createMockAdapter(async () => `'use client';`);

      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const html = await generator.generateFullHTML({
        html: "<!DOCTYPE html><html><head></head><body><main>Hello</main></body></html>",
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
          nonce: `nonce-"<&'`,
          colorScheme: "dark",
          colorSchemeFromParam: true,
        },
      });

      assertEquals(html.includes('nonce="nonce-&quot;&lt;&amp;&#39;"'), true);
      assertEquals(html.includes(`nonce="nonce-"<&'"`), false);
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
          metas: [{ charset: "utf-8" }],
          links: [],
          styles: [".from-head{color:blue}"],
          scripts: [{ content: "window.__HEAD_OK__=true" }],
        },
      });

      assertEquals(
        html.includes(
          '<style data-vf-head="true" nonce="nonce-123">.from-head{color:blue}</style>',
        ),
        true,
      );
      assertEquals(html.includes('<script data-vf-head="true"'), true);
      assertEquals(html.includes('nonce="nonce-123">window.__HEAD_OK__=true</script>'), true);
      assertEquals((html.match(/<meta charset=/gi) ?? []).length, 1);
      assertEquals(
        html.indexOf('<meta charset="UTF-8">') <
          html.indexOf('<script data-vf-head="true"'),
        true,
      );
    });

    it("merges collected Head singletons before shell serialization", async () => {
      const mockAdapter = createMockAdapter(async () => "");
      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const html = await generator.generateFullHTML({
        html: "<div>Hello</div>",
        pageInfo: {
          entity: {
            path: "/project/app/page.tsx",
            frontmatter: {
              title: "Frontmatter title",
              description: "Frontmatter description",
              viewport: "width=400",
              links: [{
                rel: "canonical",
                href: "https://example.com/frontmatter",
              }],
              scripts: [
                { id: "frontmatter", src: "/shared.js" },
                {
                  content: "globalThis.__headShared=(globalThis.__headShared||0)+1;",
                },
              ],
            },
          },
        } as any,
        pageBundle: {} as any,
        layoutBundle: undefined,
        nestedLayouts: [],
        collectedMetadata: {},
        slug: "test-page",
        ssrHash: "hash123",
        collectedHead: {
          title: "Head title",
          description: "Head description",
          metas: [{ name: "viewport", content: "width=900" }],
          links: [{
            rel: "canonical",
            href: "https://example.com/head",
          }],
          styles: [],
          scripts: [
            { id: "head", src: "/shared.js" },
            {
              content: "globalThis.__headShared=(globalThis.__headShared||0)+1;",
            },
          ],
        },
      });

      assertEquals(
        html.includes(
          '<title data-vf-head="true">Head title</title>',
        ),
        true,
      );
      assertEquals(
        html.includes(
          '<meta data-vf-head="true" name="description" content="Head description">',
        ),
        true,
      );
      assertEquals(
        html.includes(
          '<meta data-vf-head="true" name="viewport" content="width=900">',
        ),
        true,
      );
      assertEquals(
        html.includes(
          '<link data-vf-head="true" rel="canonical" href="https://example.com/head">',
        ),
        true,
      );
      assertEquals(
        (html.match(/rel="canonical"/g) ?? []).length,
        1,
      );
      assertEquals(
        (html.match(/src="\/shared\.js"/g) ?? []).length,
        1,
      );
      assertEquals(
        (html.match(/<script\b[^>]*>globalThis\.__headShared=/g) ?? [])
          .length,
        1,
      );
      assertEquals(
        (html.match(/<meta[^>]+name="description"[^>]*>/g) ?? []).length,
        1,
      );
      assertEquals(
        (html.match(/<meta[^>]+name="viewport"[^>]*>/g) ?? []).length,
        1,
      );
    });

    it("preserves empty collected metadata and exact viewport attributes", async () => {
      const mockAdapter = createMockAdapter(async () => "");
      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const html = await generator.generateFullHTML({
        html: "<div>Hello</div>",
        pageInfo: {
          entity: {
            path: "/project/app/page.tsx",
            frontmatter: {
              title: "Fallback title",
              description: "Fallback description",
              viewport: "width=400",
            },
          },
        } as any,
        pageBundle: {} as any,
        layoutBundle: undefined,
        nestedLayouts: [],
        collectedMetadata: {},
        slug: "test-page",
        ssrHash: "hash123",
        collectedHead: {
          title: "",
          description: "",
          metas: [
            {
              name: "description",
              content: "",
              "data-source": "react",
            },
            {
              name: "viewport",
              content: "",
              media: "screen",
            },
          ],
          links: [],
          styles: [],
          scripts: [],
        },
      });

      assertEquals(
        html.includes('<title data-vf-head="true"></title>'),
        true,
      );
      assertEquals(
        html.includes(
          '<meta data-vf-head="true" name="description" content="" data-source="react">',
        ),
        true,
      );
      assertEquals(
        html.includes(
          '<meta data-vf-head="true" name="viewport" content="" media="screen">',
        ),
        true,
      );
      assertEquals(
        (html.match(/<meta[^>]+name="description"[^>]*>/g) ?? []).length,
        1,
      );
      assertEquals(
        (html.match(/<meta[^>]+name="viewport"[^>]*>/g) ?? []).length,
        1,
      );
    });

    it("replaces existing nonce attributes with the response nonce without duplication", async () => {
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

      assertEquals(
        html.includes('<style nonce="nonce-123">.chat{color:red}</style>'),
        true,
      );
      assertEquals(
        html.includes('<script nonce="nonce-123">window.__vf=1</script>'),
        true,
      );
      assertEquals(html.includes('nonce="existing-nonce"'), false);
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
    it("reports the exact project stylesheet linked around a streamed fragment", async () => {
      const mockAdapter = createMockAdapter(async (path: string) => {
        if (path.endsWith("/globals.css")) return ".stream-artifact { color: purple; }";
        return "";
      });
      const generator = createHTMLGenerator({
        readFile: mockAdapter.fs.readFile,
      });

      const result = await generator.generateHTMLStreamWithStylesheetArtifact(
        createSingleChunkStream('<main class="stream-artifact">Stream</main>'),
        createHTMLContext({ options: { environment: "production" } }),
      );
      const html = await new Response(result.stream).text();

      assertEquals(result.stylesheet?.kind, "project");
      assertEquals(result.stylesheet?.hash.length, 64);
      assertEquals(
        result.stylesheet?.kind === "project" && result.stylesheet.css.length !== 0,
        true,
      );
      assertStringIncludes(
        html,
        `<link rel="stylesheet" href="/_vf/css/${result.stylesheet?.hash}.css">`,
      );
    });

    it("reports the exact release stylesheet linked into a streamed full document", async () => {
      const generator = createHTMLGenerator({
        readFile: async (path: string) => path.endsWith("/app/page.tsx") ? `'use client';` : "",
      });

      const result = await generator.generateHTMLStreamWithStylesheetArtifact(
        createSingleChunkStream(
          "<!DOCTYPE html><html><head></head><body><main>Release</main></body></html>",
        ),
        createHTMLContext({
          options: {
            environment: "production",
            releaseAssetManifest: releaseManifestWithCSS(),
          },
        }),
      );
      const html = await new Response(result.stream).text();

      assertEquals(result.stylesheet, { kind: "release", hash: RELEASE_CSS_HASH });
      assertStringIncludes(
        html,
        `<link rel="stylesheet" href="/_vf/assets/${RELEASE_CSS_HASH}.css">`,
      );
      assertEquals(html.includes("/_vf/css/"), false);
    });

    it("does not start project CSS when release CSS covers a streamed fragment", async () => {
      let compileCalls = 0;
      registerContract("CSSProcessor", {
        compile: () => {
          compileCalls++;
          return Promise.reject(new Error("project CSS must not start"));
        },
      });
      invalidateCompiler();

      try {
        const generator = createHTMLGenerator({
          readFile: async (path: string) =>
            path.endsWith("/globals.css") ? ".release-stream { color: red; }" : "",
        });
        const result = await generator.generateHTMLStreamWithStylesheetArtifact(
          createSingleChunkStream('<main class="release-stream">Release stream</main>'),
          createHTMLContext({
            options: {
              environment: "production",
              projectSlug: "release-stream-no-jit",
              releaseAssetManifest: releaseManifestWithCSS(),
            },
          }),
        );
        await new Response(result.stream).text();
        await new Promise((resolve) => setTimeout(resolve, 0));

        assertEquals(result.stylesheet, { kind: "release", hash: RELEASE_CSS_HASH });
        assertEquals(compileCalls, 0);
      } finally {
        await registerTailwindExtension();
        invalidateCompiler();
      }
    });

    it("finalizes Studio selectors and bridge scripts for both streamed document shapes", async () => {
      const generator = createHTMLGenerator();
      for (
        const source of [
          '<!DOCTYPE html><html><head></head><body><div id="root"><main>Full</main></div></body></html>',
          "<main>Fragment</main>",
        ]
      ) {
        const responseStream = await generator.generateHTMLStream(
          createSingleChunkStream(source),
          createHTMLContext({
            options: {
              studioEmbed: true,
              projectId: "project-1",
              pageId: "page-1",
              nonce: "nonce-123",
            },
          }),
        );
        const html = await new Response(responseStream).text();

        assertStringIncludes(html, "/_veryfront/studio-bridge.js");
        assertStringIncludes(html, 'data-vf-selector="vf-main-');
        assertEquals(extractBridgeConfig(html).nonce, "nonce-123");
      }
    });

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
      assertEquals(html.includes('id="vf-project-css"'), true);
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
      assertEquals(html.includes('id="vf-project-css"'), false);
      assertEquals(html.includes("/_veryfront/rsc/client.js"), true);
      assertEquals(html.includes("/_veryfront/hydration-runtime.js"), false);
      assertEquals(html.includes("/_veryfront/hydrate.js"), false);
    });

    it("builds streamed full-document CSS after component imports are collected", async () => {
      let cssImportReads = 0;
      let importsReady = false;
      const streamHtml =
        '<!DOCTYPE html><html><head><title>Imported CSS</title></head><body><div class="hero-banner">Hero</div></body></html>';
      const mockAdapter = createMockAdapter(async (path: string) => {
        if (path === "/project/globals.css") return '@import "tailwindcss";';
        if (path === "/project/components/hero.css") {
          return ".hero-banner { color: var(--hero-color); }";
        }
        return "";
      });
      const generator = new HTMLGenerator({
        projectDir: "/project",
        adapter: mockAdapter as any,
        config: {} as any,
        mode: "production",
      });
      const context = createHTMLContext({
        options: {
          environment: "production",
          projectSlug: "streamed-full-doc-css-import-test",
        },
      });
      Object.defineProperty(context, "cssImports", {
        configurable: true,
        enumerable: true,
        get() {
          cssImportReads += 1;
          return importsReady ? ["/project/components/hero.css"] : undefined;
        },
      });
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          importsReady = true;
          controller.enqueue(new TextEncoder().encode(streamHtml));
          controller.close();
        },
      });

      const responseStream = await generator.generateHTMLStream(stream, context);
      const html = await new Response(responseStream).text();

      assertEquals(cssImportReads, 1);
      const cssHash = html.match(/\/_vf\/css\/([^"/]+)\.css/)?.[1];
      assertExists(cssHash);
      const css = getCSSByHash(cssHash);
      assertExists(css);
      assertStringIncludes(css, ".hero-banner");
      assertStringIncludes(css, "var(--hero-color)");
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

    it("keeps CSS Module selectors stable across project roots", async () => {
      async function mergeAt(projectDir: string): Promise<string | undefined> {
        const modulePath = `${projectDir}/components/card.module.css`;
        return await mergeImportedCSS({
          fs: {
            readFile: (path: string) =>
              Promise.resolve(path === modulePath ? ".root { color: red; }" : ""),
          },
          logger: { debug: () => {} },
          projectDir,
          globalCSS: undefined,
          cssImports: [modulePath],
          stylesheetPath: "globals.css",
        });
      }

      assertEquals(
        await mergeAt("/tmp/release-a/project"),
        await mergeAt("/tmp/release-b/project"),
      );
    });

    it("propagates imported stylesheet read failures", async () => {
      const failure = Object.assign(new Error("imported stylesheet unavailable"), {
        code: "EIO",
      });

      await assertRejects(
        () =>
          mergeImportedCSS({
            fs: { readFile: () => Promise.reject(failure) },
            logger: { debug: () => {} },
            projectDir: "/project",
            globalCSS: "/* global */",
            cssImports: ["/project/components/card.css"],
            stylesheetPath: "globals.css",
          }),
        Error,
        "imported stylesheet unavailable",
      );
    });
  });
});
