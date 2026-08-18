import "#veryfront/schemas/_test-setup.ts";
import "../../html/styles-builder/__tests__/css-processor-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
} from "#veryfront/release-assets/constants.ts";
import {
  clearReleaseAssetManifestCache,
  registerManifestFetcherForRelease,
} from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { FSAdapterWrapper } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { clearCSSCache, getCSSByHash } from "#veryfront/html/styles-builder/index.ts";
import {
  HTMLGenerator,
  type HTMLGeneratorConfig,
  resolveErrorContentSourceEnvironment,
  resolveErrorContentSourceParameters,
  resolveRenderEnvironment,
} from "./html.ts";
import { buildHeadElements, mergeFrontmatter } from "./html-head.ts";
import {
  deserializeManagedHeadPayload,
  managedHeadDescriptorToTransportEntry,
} from "#veryfront/html/managed-head-protocol.ts";
import { mergeImportedCSS } from "./html-imported-css.ts";
import { StreamTimeoutError } from "../utils/stream-utils.ts";
import { getProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
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

const REACT_HASH = "e".repeat(64);
const REACT_CDN_URL = "https://esm.sh/react@19.2.4?target=es2022&deps=csstype@3.2.3";
const PIN_KEY_A = "on:z7bg3qnfgtcb";
const PIN_KEY_B = "on:3w5e11264sgsf";

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
    dependencies: {
      [REACT_CDN_URL]: {
        contentHash: REACT_HASH,
        size: 1,
        contentType: "text/javascript",
      },
    },
    dependencyMode: "immutable",
  };
}

describe("HTMLGenerator helpers", () => {
  const originalManifestFlag = getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);
  const originalDependencyFlag = getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);

  afterEach(() => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, originalManifestFlag ?? "");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, originalDependencyFlag ?? "");
    clearReleaseAssetManifestCache();
    clearCSSCache();
  });

  it("uses the configured production environment when a request omits it", () => {
    assertEquals(resolveRenderEnvironment(undefined, "production"), "production");
    assertEquals(resolveRenderEnvironment("preview", "production"), "preview");
  });

  it("uses a valid preview content identity for release-less hosted production errors", () => {
    assertEquals(
      resolveErrorContentSourceEnvironment(false, "production", undefined),
      "preview",
    );
    assertEquals(
      resolveErrorContentSourceEnvironment(false, "production", "release-1"),
      "production",
    );
    assertEquals(
      resolveErrorContentSourceEnvironment(true, "production", undefined),
      "production",
    );
  });

  it("derives hosted production error identity from a release content source", () => {
    assertEquals(
      resolveErrorContentSourceParameters(
        false,
        "production",
        undefined,
        { contentSourceId: "release-release-123" },
      ),
      {
        environment: "production",
        contentSourceEnvironment: "production",
        releaseId: "release-123",
      },
    );
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
        '<meta data-vf-head="true" content="A description" name="description">',
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
    it("uses the hydration runtime baked into an aged release", async () => {
      const agedRuntimePath = "/_veryfront/hydration-runtime.1a2b3c4d.js";
      const adapter = createMockAdapter(async (path: string) =>
        path.endsWith("/app/page.tsx") ? "'use client';" : ""
      );
      adapter.fs.readDir = async function* (path: string) {
        if (path !== "/project/custom-output/_veryfront") return;
        yield {
          name: agedRuntimePath.slice("/_veryfront/".length),
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        };
      };
      const generator = new HTMLGenerator({
        projectDir: "/project",
        adapter: adapter as any,
        config: { build: { outDir: "custom-output" } } as any,
        mode: "production",
        isLocalProject: false,
      });

      const html = await generator.generateFullHTML(createHTMLContext({
        html: "<main>Existing release</main>",
        options: {
          environment: "production",
          releaseId: "release-aged",
        },
      }));

      assertStringIncludes(html, `src="${agedRuntimePath}"`);
      assertStringIncludes(html, `rel="modulepreload" href="${agedRuntimePath}"`);
      assertEquals(html.includes(getProdHydrationModulePath()), false);
    });

    it("uses the hydration runtime baked into an aged release for full documents", async () => {
      const agedRuntimePath = "/_veryfront/hydration-runtime.2b3c4d5e.js";
      const adapter = createMockAdapter(async (path: string) =>
        path.endsWith("/app/page.tsx") ? "'use client';" : ""
      );
      adapter.fs.readDir = async function* (path: string) {
        if (path !== "/project/custom-output/_veryfront") return;
        yield {
          name: agedRuntimePath.slice("/_veryfront/".length),
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        };
      };
      const generator = new HTMLGenerator({
        projectDir: "/project",
        adapter: adapter as any,
        config: { build: { outDir: "custom-output" } } as any,
        mode: "production",
        isLocalProject: false,
      });

      const html = await generator.generateFullHTML(createHTMLContext({
        options: {
          environment: "production",
          releaseId: "release-aged",
        },
      }));

      assertStringIncludes(html, `src="${agedRuntimePath}"`);
      assertEquals(html.includes(getProdHydrationModulePath()), false);
    });

    it("keeps the RSC boot script for standalone production full documents", async () => {
      const generator = createHTMLGenerator({
        mode: "production",
        readFile: async (path) => path.endsWith("/app/page.tsx") ? "'use client';" : "",
      });

      const html = await generator.generateFullHTML(createHTMLContext({
        options: {
          environment: "production",
          releaseId: "standalone-dev",
        },
      }));

      assertStringIncludes(html, 'src="/_veryfront/rsc/client.js"');
      assertEquals(html.includes(getProdHydrationModulePath()), false);
    });

    it("fails closed when a full-document component also declares React Head", async () => {
      const generator = createHTMLGenerator();

      await assertRejects(
        () =>
          generator.generateFullHTML(createHTMLContext({
            collectedHead: {
              title: "Conflicting title",
              description: undefined,
              metas: [],
              links: [],
              styles: [],
              scripts: [],
            },
          })),
        Error,
        "React <Head> cannot be combined with a component-authored full HTML document",
      );
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

    it("selects client modules from project trust instead of render mode", async () => {
      const readFile = async () => `'use client';`;
      const remoteDevelopmentHtml = await createHTMLGenerator({
        mode: "development",
        isLocalProject: false,
        readFile,
      }).generateFullHTML(createHTMLContext({ options: { environment: "preview" } }));
      const localProductionHtml = await createHTMLGenerator({
        mode: "production",
        isLocalProject: true,
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
      assertEquals(parseHydrationData(localProductionHtml).clientModuleStrategy, "fs");
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
      registerManifestFetcherForRelease(
        "rel-1",
        () => Promise.resolve({ state: "ready", manifest_version: 1, manifest: releaseManifest() }),
      );
      const generator = createHTMLGenerator({
        readFile: async (path: string) => path.endsWith("/app/page.tsx") ? `'use client';` : "",
        readDir: async function* () {
          yield {
            name: getProdHydrationModulePath().slice("/_veryfront/".length),
            isFile: true,
            isDirectory: false,
            isSymlink: false,
          };
        },
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

    it("uses configured preview rendering for full HTML when the request omits it", async () => {
      const generator = createHTMLGenerator({
        environment: "preview",
        readFile: async () => `'use client';`,
      });

      const html = await generator.generateFullHTML(createHTMLContext());

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
      assertEquals(html.includes('id="vf-tailwind-css"'), false);
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

    it("does not grant the response nonce to rendered application markup", async () => {
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

      assertEquals(html.includes('<style nonce="nonce-123">.chat{color:red}</style>'), false);
      assertEquals(html.includes('<script nonce="nonce-123">window.__vf=1</script>'), false);
      assertEquals(html.includes("<style>.chat{color:red}</style>"), true);
      assertEquals(html.includes("<script>window.__vf=1</script>"), true);
      assertEquals(html.includes('<script type="importmap" nonce="nonce-123">'), true);
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
          scripts: [{
            type: "module",
            content: "import React from 'react'; window.__HEAD_OK__=Boolean(React)",
          }],
        },
      });

      assertEquals(
        html.includes(
          '<style data-vf-head="true" nonce="nonce-123">.from-head{color:blue}</style>',
        ),
        true,
      );
      assertEquals(html.includes('<script data-vf-head="true"'), true);
      assertEquals(
        html.includes(
          `import React from 'react'; window.__HEAD_OK__=Boolean(React)</script>`,
        ),
        true,
      );
      assertEquals((html.match(/<meta charset=/gi) ?? []).length, 1);
      const charsetIndex = html.indexOf('<meta charset="UTF-8">');
      const importMapIndex = html.indexOf('<script type="importmap"');
      const importMapEnd = html.indexOf("</script>", importMapIndex);
      const collectedModuleIndex = html.indexOf('<script data-vf-head="true"');
      const collectedModuleOpenEnd = html.indexOf(">", collectedModuleIndex);
      const collectedModuleOpen = html.slice(collectedModuleIndex, collectedModuleOpenEnd + 1);
      const cssIndex = html.indexOf("<!-- Tailwind CSS:");
      assertEquals(collectedModuleOpen.includes('type="module"'), true);
      assertEquals(collectedModuleOpen.includes('nonce="nonce-123"'), true);
      assertEquals(
        charsetIndex < importMapIndex &&
          importMapIndex < importMapEnd &&
          importMapEnd < collectedModuleIndex &&
          collectedModuleIndex < cssIndex,
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
          '<meta data-vf-head="true" content="Head description" name="description">',
        ),
        true,
      );
      assertEquals(
        html.includes(
          '<meta data-vf-head="true" content="width=900" name="viewport">',
        ),
        true,
      );
      assertEquals(
        html.includes(
          '<link data-vf-head="true" href="https://example.com/head" rel="canonical">',
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
      assertEquals(html.includes("data-vf-shell-head"), false);
    });

    it("publishes the complete committed React head through the server-owned payload", async () => {
      const generator = createHTMLGenerator();
      const html = await generator.generateFullHTML({
        html: "<main>Complete head</main>",
        pageInfo: {
          entity: { path: "/project/app/page.tsx", frontmatter: {} },
        } as any,
        pageBundle: {} as any,
        layoutBundle: undefined,
        nestedLayouts: [],
        collectedMetadata: {},
        slug: "complete-head",
        ssrHash: "head-hash",
        collectedHead: {
          title: "Committed title",
          metas: [
            { property: "og:image", content: "https://cdn.example/a.png" },
            { property: "og:image", content: "https://cdn.example/b.png" },
          ],
          links: [
            { rel: "preload", href: "/font-a.woff2", as: "font" },
            { rel: "preload", href: "/font-b.woff2", as: "font" },
          ],
          styles: [{ id: "route-style", content: ".route{}" }],
          scripts: [{ id: "route-script", src: "/route.js" }],
        },
      });

      const hydrationMatch = html.match(
        /<body\b[^>]*>\s*<!--[^]*?-->\s*<script id="veryfront-hydration-data" type="application\/json"[^>]*>([^]*?)<\/script>/i,
      );
      assertExists(hydrationMatch?.[1]);
      const hydrationData = JSON.parse(hydrationMatch[1]) as {
        managedHeadPayload: string;
      };
      const entries = deserializeManagedHeadPayload(hydrationData.managedHeadPayload)
        .map(managedHeadDescriptorToTransportEntry);

      assertEquals(
        entries.some((entry) => entry.tagName === "title" && entry.content === "Committed title"),
        true,
      );
      assertEquals(
        entries.filter((entry) =>
          entry.tagName === "meta" &&
          entry.attributes.some(([name, value]) => name === "property" && value === "og:image")
        ).map((entry) => entry.attributes.find(([name]) => name === "content")?.[1]),
        ["https://cdn.example/a.png", "https://cdn.example/b.png"],
      );
      assertEquals(
        entries.filter((entry) =>
          entry.tagName === "link" &&
          entry.attributes.some(([name, value]) => name === "rel" && value === "preload")
        ).map((entry) => entry.attributes.find(([name]) => name === "href")?.[1]),
        ["/font-a.woff2", "/font-b.woff2"],
      );
      assertEquals(
        entries.some((entry) =>
          entry.tagName === "style" && entry.content === ".route{}" &&
          entry.attributes.some(([name, value]) => name === "id" && value === "route-style")
        ),
        true,
      );
      assertEquals(
        entries.some((entry) =>
          entry.tagName === "script" &&
          entry.attributes.some(([name, value]) => name === "src" && value === "/route.js")
        ),
        true,
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
          '<meta data-vf-head="true" content="" data-source="react" name="description">',
        ),
        true,
      );
      assertEquals(
        html.includes(
          '<meta data-vf-head="true" content="" media="screen" name="viewport">',
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
      assertEquals(html.includes("data-vf-shell-head"), false);
    });

    it("does not rewrite application-owned nonce attributes", async () => {
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

      assertEquals(html.includes('<style nonce="existing-nonce">.chat{color:red}</style>'), true);
      assertEquals(
        html.includes('<script nonce="existing-nonce">window.__vf=1</script>'),
        true,
      );
      assertEquals(html.includes('nonce="existing-nonce"'), true);
      assertEquals(html.includes('nonce="nonce-123" nonce="existing-nonce"'), false);
    });

    it("escapes nonce values only on framework-generated tags", async () => {
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

      assertEquals(html.includes('<style nonce="nonce-&quot;&lt;&amp;&#39;">'), false);
      assertEquals(
        html.includes('<script nonce="nonce-&quot;&lt;&amp;&#39;">window.__vf=1</script>'),
        false,
      );
      assertEquals(html.includes("<style>.chat{color:red}</style>"), true);
      assertEquals(html.includes("<script>window.__vf=1</script>"), true);
      assertEquals(
        html.includes('<script type="importmap" nonce="nonce-&quot;&lt;&amp;&#39;">'),
        true,
      );
      assertEquals(html.includes('nonce="nonce-"<&\'"'), false);
    });

    it("leaves application script and style markup byte-for-byte unprivileged", async () => {
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
          '<script>window.tpl="<script>alert(1)";window.css="<style>.x{color:red}";</script>',
        ),
        true,
      );
      assertEquals(html.includes("<style>.chat{color:red}</style>"), true);
      assertEquals(html.includes('<script nonce="nonce-123">alert(1)'), false);
      assertEquals(html.includes('<style nonce="nonce-123">.x{color:red}'), false);
    });
  });

  describe("generateHTMLStream", () => {
    it("fails closed with the exact timeout instead of returning partial HTML", async () => {
      const generator = createHTMLGenerator();
      const timeout = new StreamTimeoutError(
        1,
        "<!DOCTYPE html><html><body>incomplete response",
      );
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(timeout);
        },
      });
      let responseStream: ReadableStream | undefined;
      let rejection: unknown;

      try {
        responseStream = await generator.generateHTMLStream(stream, createHTMLContext());
      } catch (error) {
        rejection = error;
      }

      assertStrictEquals(rejection, timeout);
      assertStrictEquals(responseStream, undefined);
      assertEquals(timeout.partialContent.includes("incomplete response"), true);
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

    it("uses configured preview rendering for streams when the request omits it", async () => {
      const generator = createHTMLGenerator({
        environment: "preview",
        readFile: async () => `'use client';`,
      });
      const stream = createSingleChunkStream(
        "<!DOCTYPE html><html><head></head><body><main>Hello</main></body></html>",
      );

      const responseStream = await generator.generateHTMLStream(
        stream,
        createHTMLContext(),
      );
      const html = await new Response(responseStream).text();

      assertEquals(html.includes('id="vf-project-css"'), true);
      assertEquals(html.includes("/_vf_styles/styles.css?t="), true);
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
          return ".hero-banner { color: rgb(12 34 56); }";
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
      assertStringIncludes(css, "rgb(12 34 56)");
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
