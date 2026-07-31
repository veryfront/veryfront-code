import "#veryfront/schemas/_test-setup.ts";
import "./styles-builder/__tests__/css-processor-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import {
  clearAllManifests,
  recordSSRModules,
} from "#veryfront/modules/manifest/route-module-manifest.ts";
import {
  generateHTMLShellPartsWithStylesheetArtifact,
  wrapInHTMLShell,
} from "./html-shell-generator.ts";
import type { RenderMetadata } from "#veryfront/types";
import type { HTMLGenerationOptions } from "./types.ts";
import { getProdHydrationModulePath } from "./hydration-script-builder/prod-scripts.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { installTestCSSOptimizationEngine } from "../../tests/_helpers/css-optimization-engine.ts";
import { FakeTime } from "#std/testing/time";
import { validateVeryfrontConfig } from "#veryfront/config";

const PIN_KEY_A = "on:z7bg3qnfgtcb";
const PIN_KEY_B = "on:3w5e11264sgsf";
const ENCODED_PIN_KEY_A = encodeURIComponent(PIN_KEY_A);
const ENCODED_PIN_KEY_B = encodeURIComponent(PIN_KEY_B);

describe("html-generation/html-shell-generator", () => {
  let restoreCSSOptimizationEngine: (() => void) | undefined;

  beforeEach(() => {
    restoreCSSOptimizationEngine = installTestCSSOptimizationEngine();
  });
  afterEach(() => {
    restoreCSSOptimizationEngine?.();
    restoreCSSOptimizationEngine = undefined;
  });

  const mockConfig = {
    dev: {
      components: [],
    },
  };

  function createMeta(
    overrides: Partial<RenderMetadata> = {},
  ): RenderMetadata {
    return {
      title: "Test Page",
      slug: "test",
      frontmatter: {},
      ...overrides,
    };
  }

  function createOptions(
    overrides: Partial<HTMLGenerationOptions> = {},
  ): HTMLGenerationOptions {
    return {
      mode: "development",
      config: mockConfig,
      ...overrides,
    };
  }

  describe("wrapInHTMLShell", () => {
    it("should generate complete HTML document", async () => {
      const result = await wrapInHTMLShell(
        "<h1>Hello</h1>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, "<!DOCTYPE html>");
      assertStringIncludes(result, "<html");
      assertStringIncludes(result, "<head>");
      assertStringIncludes(result, "<body");
      assertStringIncludes(result, "suppressHydrationWarning");
      assertStringIncludes(result, "</html>");
    });

    it("emits the charset before every production head script", async () => {
      const result = await wrapInHTMLShell(
        "<h1>Hello</h1>",
        createMeta(),
        createOptions({
          mode: "production",
          environment: "production",
          isLocalProject: false,
          projectId: "default",
        }),
      );
      const head = result.slice(
        result.indexOf("<head>") + "<head>".length,
        result.indexOf("</head>"),
      ).trimStart();

      assert(
        head.startsWith('<meta charset="UTF-8">'),
        "The encoding declaration must precede scripts and other head content",
      );
      assert(
        result.indexOf('<meta charset="UTF-8">') < result.indexOf("<script"),
        "No production head script may precede the encoding declaration",
      );
    });

    it("should include content in the body", async () => {
      const result = await wrapInHTMLShell(
        "<h1>Hello World</h1>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, "<h1>Hello World</h1>");
    });

    it("rejects shell input accessors without executing them", async () => {
      let metadataAccessorCalls = 0;
      const metadata: Record<string, unknown> = { title: "Test" };
      Object.defineProperty(metadata, "slug", {
        enumerable: true,
        get() {
          metadataAccessorCalls++;
          return "unsafe";
        },
      });

      await assertRejects(
        () => wrapInHTMLShell("<p>content</p>", metadata as never, createOptions()),
        TypeError,
        "HTML shell metadata must not contain accessor properties",
      );
      assertEquals(metadataAccessorCalls, 0);

      let optionAccessorCalls = 0;
      const options: Record<string, unknown> = {
        config: mockConfig,
        projectId: "test-project",
      };
      Object.defineProperty(options, "mode", {
        enumerable: true,
        get() {
          optionAccessorCalls++;
          return "development";
        },
      });

      await assertRejects(
        () => wrapInHTMLShell("<p>content</p>", createMeta(), options as never),
        TypeError,
        "HTML shell options must not contain accessor properties",
      );
      assertEquals(optionAccessorCalls, 0);
    });

    it("rejects nested serialized accessors without executing them", async () => {
      let accessorCalls = 0;
      const props = {
        card: Object.defineProperty({}, "title", {
          enumerable: true,
          get() {
            accessorCalls++;
            return "unsafe";
          },
        }),
      };

      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<p>content</p>",
            createMeta(),
            createOptions(),
            {},
            props,
          ),
        TypeError,
      );
      assertEquals(accessorCalls, 0);
    });

    it("captures one nested hydration snapshot before asynchronous shell work", async () => {
      const params = { slug: ["before"] };
      const props = { card: { title: "before" } };
      const frontmatter = { description: "before" };
      const layoutProps = {
        "app/layout.tsx": { theme: "before" },
      };
      const resultPromise = wrapInHTMLShell(
        "<p>content</p>",
        createMeta(),
        createOptions({ frontmatter, layoutProps }),
        params,
        props,
      );

      params.slug[0] = "after";
      props.card.title = "after";
      frontmatter.description = "after";
      layoutProps["app/layout.tsx"].theme = "after";

      const result = await resultPromise;
      const hydrationMatch = result.match(
        /<script id="veryfront-hydration-data" type="application\/json"[^>]*>\s*([\s\S]*?)\s*<\/script>/,
      );
      if (!hydrationMatch?.[1]) throw new Error("missing hydration payload");
      const hydrationData = JSON.parse(hydrationMatch[1]) as {
        params: { slug: string[] };
        props: { card: { title: string } };
        frontmatter: { description: string };
        layoutProps: Record<string, { theme: string }>;
      };

      assertEquals(hydrationData.params, { slug: ["before"] });
      assertEquals(hydrationData.props, { card: { title: "before" } });
      assertEquals(hydrationData.frontmatter, { description: "before" });
      assertEquals(hydrationData.layoutProps, {
        "app/layout.tsx": { theme: "before" },
      });
    });

    it("accepts public config callbacks and hooks while snapshotting consumed config", async () => {
      let callbackCalls = 0;
      let hookCalls = 0;
      const config = validateVeryfrontConfig({
        react: { version: "18.3.1" },
        client: { moduleResolution: "bundled" },
        dev: { hmr: true, components: ["before-component"] },
        security: {
          cors: {
            origin: (_origin: string) => {
              callbackCalls++;
              return true;
            },
          },
        },
        extensions: [{
          name: "html-config-probe",
          version: "1.0.0",
          capabilities: [],
          setup() {
            hookCalls++;
          },
          teardown() {
            hookCalls++;
          },
        }],
      });

      const resultPromise = wrapInHTMLShell(
        "<p>content</p>",
        createMeta(),
        createOptions({
          config,
          clientModuleStrategy: "fs",
          isLocalProject: true,
        }),
      );
      config.react!.version = "19.1.1";
      config.dev!.components![0] = "after-component";

      const result = await resultPromise;
      assertStringIncludes(result, 'window.__veryfrontComponents = ["before-component"]');
      assertStringIncludes(result, 'src="/_veryfront/hmr.js"');
      assertStringIncludes(result, "react@18.3.1");
      assertEquals(result.includes("after-component"), false);
      assertEquals(result.includes("react@19.1.1"), false);
      assertEquals(callbackCalls, 0);
      assertEquals(hookCalls, 0);
    });

    it("rejects accessors and proxies in consumed config fields without invoking them", async () => {
      let accessorCalls = 0;
      const accessorConfig = Object.defineProperty({}, "client", {
        enumerable: true,
        get() {
          accessorCalls++;
          return { moduleResolution: "bundled" };
        },
      });

      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<p>content</p>",
            createMeta(),
            createOptions({ config: accessorConfig }),
          ),
        TypeError,
        "HTML shell config.client must be an own data property",
      );
      assertEquals(accessorCalls, 0);

      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<p>content</p>",
            createMeta(),
            createOptions({
              config: {
                client: new Proxy({ moduleResolution: "bundled" }, {}),
              },
            }),
          ),
        TypeError,
        "HTML shell config.client must not contain Proxy values",
      );
    });

    it("canonically snapshots intentional Date values in hydration frontmatter", async () => {
      const publishedAt = new Date("2026-07-24T08:30:00.000Z");
      const result = await wrapInHTMLShell(
        "<p>content</p>",
        createMeta({ frontmatter: { title: "Dated", publishedAt } as never }),
        createOptions({
          frontmatter: { title: "Dated", publishedAt } as never,
        }),
      );
      const hydrationMatch = result.match(
        /<script id="veryfront-hydration-data" type="application\/json"[^>]*>\s*([\s\S]*?)\s*<\/script>/,
      );
      if (!hydrationMatch?.[1]) throw new Error("missing hydration payload");
      const hydrationData = JSON.parse(hydrationMatch[1]) as {
        frontmatter: { publishedAt: string };
      };

      assertEquals(
        hydrationData.frontmatter.publishedAt,
        "2026-07-24T08:30:00.000Z",
      );
    });

    it("should set title from metadata", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ title: "My Test Page" }),
        createOptions(),
      );

      assertStringIncludes(result, "<title>My Test Page</title>");
    });

    it("should use frontmatter title if provided", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({
          title: "Default Title",
          frontmatter: { title: "Frontmatter Title" },
        }),
        createOptions(),
      );

      assertStringIncludes(result, "<title>Frontmatter Title</title>");
    });

    it("should include import map", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, '<script type="importmap">');
      assertStringIncludes(result, '"imports"');
      assertStringIncludes(result, '"react"');
    });

    it("should use custom import map if provided", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          importMap: {
            "custom-lib": "https://cdn.example.com/lib.js",
          },
        }),
      );

      assertStringIncludes(result, '"custom-lib"');
      assertStringIncludes(result, "https://cdn.example.com/lib.js");
    });

    it("should not allow custom import maps to close the import-map script", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          importMap: {
            hostile: "</script><script>globalThis.__veryfrontImportMapBreakout = true</script>",
          },
        }),
      );

      assertEquals(result.includes("</script><script>"), false);
      assertStringIncludes(result, "\\u003c/script");
    });

    it("should preload react/jsx-runtime to eliminate waterfall delay", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      // jsx-runtime must be modulepreloaded so the browser fetches it early,
      // rather than discovering it late when modules execute (~500ms saving)
      assertStringIncludes(result, 'rel="modulepreload"');
      assertStringIncludes(result, "jsx-runtime");
      // Verify it appears BEFORE the body tag (in <head>)
      const preloadIndex = result.indexOf("jsx-runtime");
      const bodyIndex = result.indexOf("<body");
      assert(
        preloadIndex < bodyIndex,
        "jsx-runtime preload should be in <head>, before <body>",
      );
    });

    it("escapes custom jsx-runtime URLs in modulepreload attributes", async () => {
      const hostileRuntimeUrl =
        'https://cdn.example.com/jsx-runtime.js?value="><script>alert(1)</script>';
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          importMap: { "react/jsx-runtime": hostileRuntimeUrl },
        }),
      );

      assertStringIncludes(
        result,
        'href="https://cdn.example.com/jsx-runtime.js?value=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"',
      );
      assertEquals(result.includes(`href="${hostileRuntimeUrl}"`), false);
    });

    it("does not re-parse generated import map JSON for jsx-runtime preload", async () => {
      const originalParse = JSON.parse;
      let importMapParseCalls = 0;

      JSON.parse = ((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
        if (typeof text === "string" && text.includes('"react/jsx-runtime"')) {
          importMapParseCalls++;
          throw new Error("import map JSON should not be parsed by shell generation");
        }

        return originalParse(text, reviver);
      }) as typeof JSON.parse;

      try {
        const result = await wrapInHTMLShell(
          "<div>Content</div>",
          createMeta(),
          createOptions(),
        );

        assertStringIncludes(result, "jsx-runtime");
        assertEquals(importMapParseCalls, 0);
      } finally {
        JSON.parse = originalParse;
      }
    });

    it("does not emit SSR-derived legacy route manifest modules as HTML preloads", async () => {
      clearAllManifests();
      recordSSRModules("project-slug", "dashboard", [
        "lib/api.js",
        "lib/files.js",
        "lib/fs-files.js",
      ]);

      try {
        const result = await wrapInHTMLShell(
          "<div>Content</div>",
          createMeta(),
          createOptions({
            projectDir: "/project",
            pagePath: "/project/pages/dashboard.tsx",
            mode: "production",
            environment: "production",
            isLocalProject: false,
            projectId: "default",
            projectSlug: "project-slug",
          }),
        );

        assertStringIncludes(
          result,
          '<link rel="modulepreload" href="/_vf_modules/pages/dashboard.tsx">',
        );
        assertEquals(result.includes("/_vf_modules/lib/api.js"), false);
        assertEquals(result.includes("/_vf_modules/lib/files.js"), false);
        assertEquals(result.includes("/_vf_modules/lib/fs-files.js"), false);
      } finally {
        clearAllManifests();
      }
    });

    it("omits page and layout preloads outside the project directory", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          projectDir: "/project",
          pagePath: "/private/workspace/secret-pages/dashboard.tsx",
          nestedLayouts: [
            { kind: "tsx", path: "/private/workspace/secret-layouts/root.tsx" },
          ],
        }),
      );

      assertEquals(result.includes("/private/workspace/"), false);
      assertEquals(result.includes("secret-pages/dashboard.tsx"), false);
      assertEquals(result.includes("secret-layouts/root.tsx"), false);
    });

    it("rejects project-directory prefix collisions in module preloads", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          projectDir: "/project",
          pagePath: "/project-secret/pages/admin.tsx",
          nestedLayouts: [
            { kind: "tsx", path: "/project-secret/app/layout.tsx" },
          ],
        }),
      );

      assertEquals(result.includes("secret/pages/admin.tsx"), false);
      assertEquals(result.includes("secret/app/layout.tsx"), false);
      assertEquals(result.includes("/project-secret/"), false);
    });

    it("omits module paths that WHATWG URL parsing would move outside the prefix", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          projectDir: "/project",
          pagePath: "/project/app/.%2e/.%2e/admin.tsx",
          nestedLayouts: [
            { kind: "tsx", path: "/project/app/%2E./layout.tsx" },
          ],
        }),
      );

      assertEquals(result.includes(".%2e"), false);
      assertEquals(result.includes("%2E."), false);
      assertEquals(result.includes("/_vf_modules/admin.tsx"), false);
    });

    it("preserves module preloads for paths inside the project directory", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          projectDir: "/project",
          pagePath: "/project/pages/dashboard.tsx",
          nestedLayouts: [
            { kind: "tsx", path: "/project/app/layout.tsx" },
          ],
        }),
      );

      assertStringIncludes(
        result,
        '<link rel="modulepreload" href="/_vf_modules/pages/dashboard.tsx">',
      );
      assertStringIncludes(
        result,
        '<link rel="modulepreload" href="/_vf_modules/app/layout.tsx">',
      );
    });

    it("preloads the same exact source identity used by hydration imports", async () => {
      for (
        const [sourcePath, requestPath] of [
          ["pages/guide.md", "pages/guide.md"],
          ["pages/authored.js", "pages/authored.js.js"],
          ["pages/authored.mjs", "pages/authored.mjs.js"],
        ]
      ) {
        const result = await wrapInHTMLShell(
          "<div>Content</div>",
          createMeta(),
          createOptions({
            projectDir: "/project",
            pagePath: `/project/${sourcePath}`,
          }),
        );

        assertStringIncludes(
          result,
          `<link rel="modulepreload" href="/_vf_modules/${requestPath}">`,
        );
      }
    });

    it("binds page and layout fallback preloads to historical snapshot A after B", async () => {
      const common = createOptions({
        projectDir: "/project",
        pagePath: "/project/pages/dashboard.tsx",
        nestedLayouts: [
          { kind: "tsx", path: "/project/app/layout.tsx" },
        ],
      });
      const snapshotB = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        {
          ...common,
          dependencyPinningCacheKey: PIN_KEY_B,
          dependencyPinningDependencies: {
            react: "19.0.0",
            veryfront: "0.2.0",
          },
        },
      );
      const snapshotA = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        {
          ...common,
          dependencyPinningCacheKey: PIN_KEY_A,
          dependencyPinningDependencies: {
            react: "18.3.1",
            veryfront: "0.1.10",
          },
        },
      );

      assertStringIncludes(
        snapshotB,
        `<link rel="modulepreload" href="/_vf_modules/_pins/${ENCODED_PIN_KEY_B}/pages/dashboard.tsx">`,
      );
      assertStringIncludes(
        snapshotA,
        `<link rel="modulepreload" href="/_vf_modules/_pins/${ENCODED_PIN_KEY_A}/pages/dashboard.tsx">`,
      );
      assertStringIncludes(
        snapshotA,
        `<link rel="modulepreload" href="/_vf_modules/_pins/${ENCODED_PIN_KEY_A}/app/layout.tsx">`,
      );
      assertEquals(snapshotA.includes(ENCODED_PIN_KEY_B), false);
    });

    it("keeps flag-off fallback preload output byte-identical", async () => {
      using _time = new FakeTime(new Date("2026-07-26T00:00:00.000Z"));
      const common = createOptions({
        projectDir: "/project",
        pagePath: "/project/pages/dashboard.tsx",
        nestedLayouts: [
          { kind: "tsx", path: "/project/app/layout.tsx" },
        ],
        dependencyPinningDependencies: {
          react: "18.3.1",
          veryfront: "0.1.10",
        },
      });

      const unkeyed = await wrapInHTMLShell("<div>Content</div>", createMeta(), common);
      const flagOff = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        { ...common, dependencyPinningCacheKey: "off" },
      );

      assertEquals(flagOff, unkeyed);
    });

    it("escapes in-project filenames in modulepreload attributes", async () => {
      const hostilePagePath = '/project/pages/dashboard"><script>alert(1)</script>.tsx';
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          projectDir: "/project",
          pagePath: hostilePagePath,
        }),
      );

      assertStringIncludes(
        result,
        'href="/_vf_modules/pages/dashboard&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;.tsx"',
      );
      assertEquals(
        result.includes(
          'href="/_vf_modules/pages/dashboard"><script>alert(1)</script>.tsx"',
        ),
        false,
      );
    });

    it("omits malformed release-manifest URLs from modulepreload attributes", async () => {
      const hostileHash = 'hash"><script>alert(1)</script>';
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 2,
        projectId: "project",
        releaseId: "release",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "test",
        sourceContentHash: "a".repeat(64),
        createdAt: "2026-01-01T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {
          "pages/dashboard.tsx": {
            contentHash: hostileHash,
            size: 1,
            contentType: "text/javascript",
          },
        },
        css: [],
        routes: {
          "/dashboard": { modules: ["pages/dashboard.tsx"], css: [] },
        },
        dependencyMode: "source",
        dependencies: {},
      };
      const options = {
        ...createOptions({
          projectDir: "/project",
          pagePath: "/project/pages/dashboard.tsx",
        }),
        releaseAssetManifest: manifest,
      };
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        options,
      );

      assertEquals(
        result.includes("/_vf/assets/hash"),
        false,
      );
    });

    it("should include the project stylesheet link in development mode", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, 'id="vf-project-css"');
      assertStringIncludes(
        result,
        "<!-- Project stylesheet -->",
      );
      assert(!result.includes("cdn.jsdelivr.net/npm/@tailwindcss/browser@4"));
    });

    it("should use hashed CSS link in production mode", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          mode: "production",
          environment: "production",
          isLocalProject: false,
          globalCSS: '@import "tailwindcss";',
        }),
      );

      assertStringIncludes(result, "/_vf/css/");
      assertStringIncludes(result, ".css");
      assert(!result.includes("cdn.jsdelivr.net/npm/@tailwindcss/browser@4"));
      assertStringIncludes(
        result,
        "<!-- Project stylesheet -->",
      );
    });

    it("reports the exact project stylesheet artifact linked by the shell", async () => {
      const css = ".artifact-test{color:navy}";
      const hash = "a".repeat(64);

      const result = await generateHTMLShellPartsWithStylesheetArtifact(
        createMeta(),
        createOptions({
          mode: "production",
          environment: "production",
          isLocalProject: false,
          projectSlug: "artifact-test",
        }),
        undefined,
        undefined,
        '<main class="artifact-test"></main>',
        Promise.resolve({ css, hash, fromCache: false }),
      );

      assertEquals(result.stylesheet, { kind: "project", hash, css });
      assertStringIncludes(
        result.start,
        `<link rel="stylesheet" href="/_vf/css/${hash}.css">`,
      );
    });

    it("reports the exact release stylesheet artifact linked by the shell", async () => {
      const hash = "b".repeat(64);
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 2,
        projectId: "project",
        releaseId: "release",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "test",
        sourceContentHash: "c".repeat(64),
        createdAt: "2026-01-01T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {},
        css: [{
          contentHash: hash,
          size: 1,
          contentType: "text/css",
          styleProfileHash: "c".repeat(64),
          cssPipelineIdentity: "test-css-pipeline@1",
        }],
        routes: { "/": { modules: [], css: [hash] } },
        dependencyMode: "source",
        dependencies: {},
      };

      const result = await generateHTMLShellPartsWithStylesheetArtifact(
        createMeta(),
        {
          ...createOptions({
            mode: "production",
            environment: "production",
            isLocalProject: false,
            projectSlug: "artifact-test",
          }),
          releaseAssetManifest: manifest,
        } as HTMLGenerationOptions,
      );

      assertEquals(result.stylesheet, { kind: "release", hash });
      assertStringIncludes(
        result.start,
        `<link rel="stylesheet" href="/_vf/assets/${hash}.css">`,
      );
    });

    it("owns an unused prefetched CSS rejection when release CSS is authoritative", async () => {
      const hash = "b".repeat(64);
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 2,
        projectId: "project",
        releaseId: "release",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "test",
        sourceContentHash: "c".repeat(64),
        createdAt: "2026-01-01T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {},
        css: [{
          contentHash: hash,
          size: 1,
          contentType: "text/css",
          styleProfileHash: "c".repeat(64),
          cssPipelineIdentity: "test-css-pipeline@1",
        }],
        routes: { "/": { modules: [], css: [hash] } },
        dependencyMode: "source",
        dependencies: {},
      };

      const result = await generateHTMLShellPartsWithStylesheetArtifact(
        createMeta(),
        {
          ...createOptions({
            mode: "production",
            environment: "production",
            isLocalProject: false,
            projectSlug: "artifact-test",
          }),
          releaseAssetManifest: manifest,
        } as HTMLGenerationOptions,
        undefined,
        undefined,
        "<main></main>",
        Promise.reject(new Error("unused project CSS failure")),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(result.stylesheet, { kind: "release", hash });
    });

    it("propagates a prefetched CSS rejection when project CSS is authoritative", async () => {
      await assertRejects(
        () =>
          generateHTMLShellPartsWithStylesheetArtifact(
            createMeta(),
            {
              ...createOptions({
                mode: "production",
                environment: "production",
                isLocalProject: false,
                projectSlug: "artifact-test",
              }),
              releaseAssetManifest: null,
            } as HTMLGenerationOptions,
            undefined,
            undefined,
            "<main></main>",
            Promise.reject(new Error("project CSS preparation failed")),
          ),
        Error,
        "project CSS preparation failed",
      );
    });

    it("rejects malformed release stylesheet identities before linking them", async () => {
      const hostileHash = 'x"><script>globalThis.pwned=1</script>';
      const manifest = {
        schemaVersion: 2,
        projectId: "project",
        releaseId: "release",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "test",
        sourceContentHash: "c".repeat(64),
        createdAt: "2026-01-01T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {},
        css: [{
          contentHash: hostileHash,
          size: 1,
          contentType: "text/css",
          styleProfileHash: "c".repeat(64),
          cssPipelineIdentity: "test-css-pipeline@1",
        }],
        routes: { "/": { modules: [], css: [hostileHash] } },
        dependencyMode: "source",
        dependencies: {},
      } as unknown as ReleaseAssetManifest;

      await assertRejects(
        () =>
          generateHTMLShellPartsWithStylesheetArtifact(
            createMeta(),
            {
              ...createOptions({
                mode: "production",
                environment: "production",
                isLocalProject: false,
                projectSlug: "artifact-test",
              }),
              releaseAssetManifest: manifest,
            } as HTMLGenerationOptions,
          ),
        TypeError,
        "64 lowercase hexadecimal characters",
      );
    });

    it("should prefer projectSlug over default projectId for production CSS caching", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ slug: "page-slug" }),
        createOptions({
          mode: "production",
          environment: "production",
          isLocalProject: false,
          projectId: "default",
          projectSlug: "project-slug",
          globalCSS: '@import "tailwindcss";',
        }),
      );

      assertStringIncludes(result, "/_vf/css/");
      assertStringIncludes(result, ".css");
      assert(
        !result.includes('href="/_vf/css/.css"'),
        "Should emit a real project-scoped CSS hash when projectSlug is available",
      );
    });

    it("should not emit /_vf/css/.css when CSS hash is empty", async () => {
      // Bug regression: when CSS compilation fails, cssHash is ""
      // and the old code emitted <link href="/_vf/css/.css"> which 404s.
      // Trigger empty hash by using projectId "default" (skips CSS generation).
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ slug: "default" }),
        createOptions({
          mode: "production",
          environment: "production",
          isLocalProject: false,
          projectId: "default",
        }),
      );

      assert(
        !result.includes('href="/_vf/css/.css"'),
        "Should not emit /_vf/css/.css with empty hash",
      );
      assertStringIncludes(
        result,
        "<!-- Project stylesheet -->",
      );
    });

    it("should include hydration data script", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ slug: "test-slug" }),
        createOptions(),
        { id: "123" },
        { title: "Test" },
      );

      assertStringIncludes(result, 'id="veryfront-hydration-data"');
      assertStringIncludes(result, 'type="application/json"');
      assertStringIncludes(result, '"slug"');
      assertStringIncludes(result, '"test-slug"');
    });

    it("should include development scripts in dev mode", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({ isLocalProject: true, clientModuleStrategy: "fs" }),
      );

      assertStringIncludes(result, "Client-side error logger");
      assertStringIncludes(result, "veryfront-error-overlay");
    });

    it("should include production scripts in prod mode", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({ mode: "production", isLocalProject: false }),
      );
      const runtimePath = getProdHydrationModulePath();

      assertStringIncludes(result, runtimePath);
      assertStringIncludes(result, `rel="modulepreload" href="${runtimePath}"`);
      assert(!result.includes("Client-side error logger"));
    });

    it("should allow local production renders to force production scripts", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          mode: "production",
          environment: "production",
          isLocalProject: true,
          forceProductionScripts: true,
        }),
      );

      assertStringIncludes(result, getProdHydrationModulePath());
      assert(!result.includes("Client-side error logger"));
      assert(!result.includes("veryfront-error-overlay"));
    });

    it("should suppress preview hmr script when production scripts are forced", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          mode: "production",
          environment: "preview",
          isLocalProject: true,
          forceProductionScripts: true,
        }),
      );

      assert(!result.includes("preview-hmr.js"));
    });

    it("should handle layout disabled", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ frontmatter: { layout: false } }),
        createOptions(),
      );

      assertStringIncludes(result, 'data-layout="none"');
    });

    it("should handle layout enabled", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, 'data-layout="default"');
    });

    it("should include custom meta tags from frontmatter", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({
          frontmatter: {
            description: "Test description",
            author: "John Doe",
          },
        }),
        createOptions(),
      );

      assertStringIncludes(result, 'name="description"');
      assertStringIncludes(result, "Test description");
    });

    it("should set language attribute", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ frontmatter: { lang: "ja" } }),
        createOptions(),
      );

      assertStringIncludes(result, 'lang="ja"');
      // data-theme/color-scheme only set when colorSchemeFromParam is true
      assert(!result.includes('data-theme="light"'));
    });

    it("should use default language when not specified", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, 'lang="en"');
      // data-theme only set when colorSchemeFromParam is true
      assert(!result.includes('data-theme="light"'));
    });

    it("should set data-theme when colorSchemeFromParam is true", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({ colorScheme: "dark", colorSchemeFromParam: true }),
      );

      assertStringIncludes(result, 'data-theme="dark"');
      assertStringIncludes(result, "color-scheme: dark");
    });

    it("should add body class if specified", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ frontmatter: { bodyClass: "custom-body-class" } }),
        createOptions(),
      );

      assertStringIncludes(
        result,
        '<body class="custom-body-class" suppressHydrationWarning>',
      );
    });

    it("escapes body class values from frontmatter", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ frontmatter: { bodyClass: `theme" onclick="alert(1)` } }),
        createOptions(),
      );

      assertStringIncludes(
        result,
        '<body class="theme&quot; onclick=&quot;alert(1)" suppressHydrationWarning>',
      );
      assert(!result.includes('class="theme" onclick="alert(1)"'));
    });

    it("should include veryfront-portals div", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, 'id="veryfront-portals"');
    });

    it("uses the audited Mermaid pin and preserves readable source on render failures", async () => {
      const result = await wrapInHTMLShell(
        '<pre><code class="language-mermaid">flowchart LR\nA --&gt; B</code></pre>',
        createMeta(),
        createOptions({
          pagePath: "/project/README.md",
          pageType: "md",
        }),
      );

      assertStringIncludes(
        result,
        "https://esm.sh/mermaid@11.16.0?target=es2022&pin=v135",
      );
      assert(!result.includes("https://esm.sh/mermaid@11'"));
      assertStringIncludes(result, "securityLevel: 'strict'");
      assertStringIncludes(result, "catch (error)");
      assertStringIncludes(result, "Mermaid rendering failed; showing source");
      assert(!result.includes("style.visibility = 'hidden'"));
    });

    it("should escape HTML in metadata", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ title: "Test <script>alert('xss')</script>" }),
        createOptions(),
      );

      assert(!result.includes("<script>alert('xss')</script>"));
      assertStringIncludes(result, "&lt;script&gt;");
    });
  });
});
