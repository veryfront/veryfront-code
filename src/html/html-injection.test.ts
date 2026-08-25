import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { injectHTMLContent } from "./html-injection.ts";
import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";

const baseTemplate = `<!DOCTYPE html>
<html><head>{{ meta }}</head>
<body>{{ content }}</body></html>`;

const minMeta: HTMLMetadata = { title: "Test", description: "Desc" };
const PAGE_HASH = "a".repeat(64);
const UNUSED_HASH = "b".repeat(64);
const ABOUT_HASH = "c".repeat(64);

function releaseManifest(): ReleaseAssetManifest {
  return {
    schemaVersion: 2,
    projectId: "project-id",
    releaseId: "release-id",
    releaseVersion: 1,
    manifestVersion: 1,
    builderVersion: "0.1.765",
    sourceContentHash: "a".repeat(64),
    createdAt: "2026-07-27T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules: {
      "app/page.tsx": { contentHash: PAGE_HASH, size: 1, contentType: "text/javascript" },
      "components/Unused.tsx": {
        contentHash: UNUSED_HASH,
        size: 1,
        contentType: "text/javascript",
      },
    },
    css: [],
    routes: { "/": { modules: ["app/page.tsx"], css: [] } },
    dependencies: {},
    dependencyMode: "immutable",
  };
}

function customDirectoryReleaseManifest(): ReleaseAssetManifest {
  return {
    ...releaseManifest(),
    modules: {
      "src/site/page.tsx": { contentHash: PAGE_HASH, size: 1, contentType: "text/javascript" },
      "src/pages/about.tsx": {
        contentHash: ABOUT_HASH,
        size: 1,
        contentType: "text/javascript",
      },
    },
    routes: {
      "/": { modules: ["src/site/page.tsx"], css: [] },
      "/about": { modules: ["src/pages/about.tsx"], css: [] },
    },
  };
}

function extractHydrationData(html: string): Record<string, unknown> {
  const match = html.match(
    /<script id="veryfront-hydration-data" type="application\/json"[^>]*>([\s\S]*?)<\/script>/i,
  );
  assertExists(match?.[1], "expected hydration data script in HTML");
  return JSON.parse(match[1]);
}

describe("html/html-injection", () => {
  describe("injectHTMLContent", () => {
    it("should replace content placeholder", () => {
      const html = injectHTMLContent(
        "<div>{{ content }}</div>",
        "<p>Hello</p>",
        minMeta,
        { mode: "production", slug: "test" },
      );

      assertEquals(html.includes("<p>Hello</p>"), true);
      assertEquals(html.includes("{{ content }}"), false);
    });

    it("should replace title placeholder", () => {
      const html = injectHTMLContent(
        "<title>{{ title }}</title>",
        "",
        { title: "My Title", description: "" },
        { mode: "production", slug: "test" },
      );

      assertEquals(html.includes("My Title"), true);
    });

    it("should replace description placeholder", () => {
      const html = injectHTMLContent(
        "<p>{{ description }}</p>",
        "",
        { title: "", description: "My Description" },
        { mode: "production", slug: "test" },
      );

      assertEquals(html.includes("My Description"), true);
    });

    it("should inject dev scripts in development mode", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        { mode: "development", slug: "test" },
      );

      assertEquals(html.includes("hmr.js"), true);
    });

    it("should inject prod scripts in production mode", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        { mode: "production", slug: "my-slug" },
      );

      assertEquals(html.includes("rsc/client.js"), true);
      assertEquals(html.includes("hydrate.js"), false);
      assertEquals(html.includes("my-slug"), false);
    });

    it("injects a previously selected production hydration runtime", () => {
      const agedRuntimePath = "/_veryfront/hydration-runtime.1a2b3c4d.js";
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          prodHydrationModulePath: agedRuntimePath,
        },
      );

      assertEquals(html.includes(`src="${agedRuntimePath}"`), true);
      assertEquals(html.includes("/_veryfront/rsc/client.js"), false);
    });

    it("should escape script-closing sequences in prebuilt import maps", () => {
      const hostileImportMap = JSON.stringify({
        imports: {
          hostile: "</script><script>globalThis.__veryfrontImportMapBreakout = true</script>",
        },
      });
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          importMapJson: hostileImportMap,
          nonce: "nonce-123",
        },
      );

      assertEquals(html.includes("</script><script>"), false);
      assertEquals(html.includes("\\u003c/script"), true);
      assertEquals(
        html.includes('<script type="importmap" nonce="nonce-123">'),
        true,
        "the import map must carry the CSP nonce or a nonce-enforcing policy blocks module resolution",
      );
    });

    it("should clear dev placeholders in production mode", () => {
      const html = injectHTMLContent(
        "<div>{{ devScripts }}{{ devStyles }}</div><body></body>",
        "",
        minMeta,
        { mode: "production", slug: "test" },
      );

      assertEquals(html.includes("devScripts"), false);
      assertEquals(html.includes("devStyles"), false);
    });

    it("should inject hydration data for client pages", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "/app/page.tsx",
          isClientPage: true,
        },
      );

      const hydrationData = extractHydrationData(html);
      assertEquals(hydrationData.pagePath, "app/page.tsx");
      assertEquals(hydrationData.clientModuleStrategy, "rsc-module");
      assertEquals(
        html.indexOf('id="veryfront-hydration-data"') < html.indexOf("<p>content</p>"),
        true,
      );
    });

    it("injects a minimal dependency snapshot for non-client full documents", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          dependencyPinningCacheKey: "on:snapshot-a",
        },
      );

      assertEquals(extractHydrationData(html), {
        dependencyPinningCacheKey: "on:snapshot-a",
      });
      assertEquals(html.includes("/_veryfront/rsc/client.js"), true);
    });

    it("keeps non-client full documents byte-identical when pinning is off", () => {
      const unkeyed = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        { mode: "production", slug: "test" },
      );
      const flagOff = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          dependencyPinningCacheKey: "off",
        },
      );

      assertEquals(flagOff, unkeyed);
      assertEquals(flagOff.includes("veryfront-hydration-data"), false);
    });

    it("injects route-scoped release asset modules into full-document client page hydration data", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "/project/app/page.tsx",
          projectDir: "/project",
          isClientPage: true,
          releaseAssetManifest: releaseManifest(),
        },
      );

      const hydrationData = extractHydrationData(html);
      assertEquals(hydrationData.releaseAssetModules, {
        "app/page.tsx": `/_vf/assets/${PAGE_HASH}.js`,
      });
    });

    it("uses configured route directories for route-scoped release asset modules", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "about",
          pagePath: "/project/src/pages/about.tsx",
          projectDir: "/project",
          isClientPage: true,
          directories: { app: "src/site", pages: "src/pages" },
          releaseAssetManifest: customDirectoryReleaseManifest(),
        },
      );

      const hydrationData = extractHydrationData(html);
      assertEquals(hydrationData.releaseAssetModules, {
        "src/pages/about.tsx": `/_vf/assets/${ABOUT_HASH}.js`,
      });
    });

    it("seeds route params into client-page hydration data (issue #2741)", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "docs/guides/intro",
          pagePath: "/app/page.tsx",
          isClientPage: true,
          params: { slug: ["guides", "intro"] },
        },
      );

      const hydrationData = extractHydrationData(html);
      // Catch-all arrays are preserved in the payload; the client runtime joins
      // them when seeding the router (issue #2742).
      assertEquals(hydrationData.params, { slug: ["guides", "intro"] });
    });

    it("escapes </script> in route params so the hydration payload cannot break out (XSS)", () => {
      const payload = "</script><script>globalThis.pwned=1</script>";
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "/app/page.tsx",
          isClientPage: true,
          params: { slug: [payload] },
        },
      );

      // The literal breakout sequence must not appear anywhere in the output;
      // jsonForInlineScript encodes `<` as \\u003c inside the JSON value.
      assertEquals(html.includes("<script>globalThis.pwned=1</script>"), false);
      // Round-trips losslessly: if the payload had broken out of the tag, the
      // extractor's non-greedy `</script>` match would truncate the JSON and
      // JSON.parse would throw here.
      assertEquals(extractHydrationData(html).params, { slug: [payload] });
    });

    it("defaults client-page hydration params to an empty object when unset", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "/app/page.tsx",
          isClientPage: true,
        },
      );

      assertEquals(extractHydrationData(html).params, {});
    });

    it("keeps production client-page injection on the RSC client boot script", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "/app/page.tsx",
          isClientPage: true,
        },
      );

      assertEquals(html.includes("/_veryfront/rsc/client.js"), true);
      assertEquals(html.includes("/_veryfront/hydration-runtime.js"), false);
    });

    it("adds the provided nonce to client-page hydration data", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "/app/page.tsx",
          isClientPage: true,
          nonce: "nonce-123",
        },
      );

      assertEquals(
        html.includes(
          '<script id="veryfront-hydration-data" type="application/json" nonce="nonce-123">',
        ),
        true,
      );
    });

    it("should use fs hydration strategy for local development client pages", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "development",
          slug: "test",
          pagePath: "/app/page.tsx",
          isClientPage: true,
        },
      );

      const hydrationData = extractHydrationData(html);
      assertEquals(hydrationData.clientModuleStrategy, "fs");
    });

    it("should inject studio scripts when studioEmbed is true", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "",
        minMeta,
        {
          mode: "production",
          slug: "test",
          studioEmbed: true,
          projectId: "p1",
          pageId: "pg1",
        },
      );

      assertEquals(html.includes("studio-bridge.js"), true);
    });

    it("propagates the nonce to injected development styles and scripts", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "development",
          slug: "test",
          nonce: "nonce-123",
        },
      );

      assertEquals(html.includes('<style nonce="nonce-123">'), true);
      assertEquals(
        html.includes(
          '<script type="module" src="/_veryfront/rsc/client.js" nonce="nonce-123"></script>',
        ),
        true,
      );
      assertEquals(
        html.includes('<script type="module" src="/_veryfront/hmr.js" nonce="nonce-123"></script>'),
        true,
      );
    });

    it("propagates the nonce to injected production scripts", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "my-slug",
          nonce: "nonce-123",
        },
      );

      assertEquals(
        html.includes(
          '<script type="module" src="/_veryfront/rsc/client.js" nonce="nonce-123"></script>',
        ),
        true,
      );
      assertEquals(html.includes("/_veryfront/hydrate.js"), false);
    });

    it("injects preview utility CSS for remote preview full HTML documents", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          environment: "preview",
          slug: "test",
        },
      );

      assertEquals(html.includes('id="vf-project-css"'), true);
      assertEquals(html.includes('/_vf_styles/styles.css"'), true);
    });

    it("injects production project stylesheet links for full HTML documents", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          environment: "production",
          slug: "test",
          projectStylesheetHref: "/_vf/css/abc123.css",
        },
      );

      assertEquals(html.includes('<link rel="stylesheet" href="/_vf/css/abc123.css">'), true);
    });

    it("skips stylesheet injection only for real stylesheet markup", () => {
      const alreadyLinked = `<!DOCTYPE html>
<html><head><link id="vf-project-css" rel="stylesheet" href="/_vf_styles/styles.css"></head>
<body>{{ content }}</body></html>`;

      const deduped = injectHTMLContent(alreadyLinked, "<p>content</p>", minMeta, {
        mode: "production",
        environment: "preview",
        slug: "test",
        projectStylesheetHref: "/_vf/css/abc123.css",
      });
      assertEquals(deduped.includes("/_vf/css/abc123.css"), false);
      // The markup already links the project stylesheet, so it is left alone
      // and no second link is injected alongside it.
      assertEquals(deduped.split("/_vf_styles/styles.css").length - 1, 1);

      // Lookalike substrings — data-* attributes, non-link CSS URLs, and the
      // id in ordinary text — must not suppress the required injection.
      const lookalikes = `<!DOCTYPE html>
<html><head><meta data-id="vf-project-css" data-href="/_vf_styles/styles.css">
<a href="/_vf/css/decoy.css">id="vf-tailwind-css"</a></head>
<body>{{ content }}</body></html>`;

      const injected = injectHTMLContent(lookalikes, "<p>content</p>", minMeta, {
        mode: "production",
        environment: "preview",
        slug: "test",
        projectStylesheetHref: "/_vf/css/abc123.css",
      });
      assertEquals(
        injected.includes('<link rel="stylesheet" href="/_vf/css/abc123.css">'),
        true,
      );
    });

    it("does not treat preload or data attributes as an applied project stylesheet", () => {
      for (
        const lookalike of [
          '<link rel="preload" href="/_vf/css/decoy.css">',
          '<link rel="preload" id="vf-project-css" href="/decoy.css">',
          '<link rel="stylesheet" data-href="/_vf/css/decoy.css" href="/decoy.css">',
          '<style data-id="vf-project-css">body { color: red; }</style>',
        ]
      ) {
        const html = injectHTMLContent(
          `<!DOCTYPE html><html><head>${lookalike}</head><body>{{ content }}</body></html>`,
          "<p>content</p>",
          minMeta,
          {
            mode: "production",
            environment: "production",
            slug: "test",
            projectStylesheetHref: "/_vf/css/required.css",
          },
        );

        assertEquals(
          html.includes('<link rel="stylesheet" href="/_vf/css/required.css">'),
          true,
          lookalike,
        );
      }
    });

    it("recognizes mixed-case stylesheet rel tokens and genuine project style elements", () => {
      for (
        const existingStylesheet of [
          '<link rel="preload StyleSheet" href="/_vf/css/existing.css">',
          '<style id = "vf-project-css">body { color: red; }</style>',
        ]
      ) {
        const html = injectHTMLContent(
          `<!DOCTYPE html><html><head>${existingStylesheet}</head><body>{{ content }}</body></html>`,
          "<p>content</p>",
          minMeta,
          {
            mode: "production",
            environment: "production",
            slug: "test",
            projectStylesheetHref: "/_vf/css/duplicate.css",
          },
        );

        assertEquals(html.includes("/_vf/css/duplicate.css"), false, existingStylesheet);
      }
    });
  });
});
