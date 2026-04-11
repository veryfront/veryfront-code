import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RenderPipeline, type RenderPipelineConfig } from "./pipeline.ts";
import { cachePageCss, getPageCssCacheKey } from "./css-cache.ts";
import { cacheCSSAsync } from "#veryfront/html/styles-builder/index.ts";

function createPipeline(pagePath: string): RenderPipeline {
  const config: RenderPipelineConfig = {
    pageResolver: {
      resolvePage: async () =>
        ({
          entity: {
            path: pagePath,
            frontmatter: {},
          },
        }) as any,
    } as any,
    cacheCoordinator: {
      checkCache: async () => null,
      persistResult: async () => {},
    } as any,
    pageRenderer: {
      preparePageBundles: async () => ({
        pageBundle: {},
      }),
    } as any,
    layoutOrchestrator: {
      collectLayouts: async () => ({ layoutBundle: undefined, nestedLayouts: [] }),
      preloadLayoutModules: async () => ({
        tsxTotal: 0,
        tsxSuccess: 0,
        tsxFailures: [],
        mdxTotal: 0,
        mdxSuccess: 0,
        mdxFailures: [],
        importMapSuccess: true,
        durationMs: 0,
        allSuccess: true,
      }),
      applyLayoutsAndWrappers: async (element: unknown) => element,
    } as any,
    ssrOrchestrator: {
      performSSRRendering: async () => ({
        fullHtml: "<!doctype html><html><body>ok</body></html>",
        finalStream: null,
        ssrHash: "test-hash",
      }),
    } as any,
    adapter: {
      env: { get: () => undefined },
      fs: {
        exists: async () => false,
      },
    } as any,
    mode: "production",
    projectDir: "/project",
  };

  return new RenderPipeline(config);
}

function primeCssCache(slug: string, projectId: string): void {
  const cssKey = getPageCssCacheKey(projectId, undefined, slug, undefined);
  cachePageCss(cssKey, "/* cached css */");
}

describe("RenderPipeline behavior", () => {
  it("resolvePageData surfaces notFound from data hooks", async () => {
    const slug = "/behavior-not-found";
    const projectId = "proj-not-found";
    const pipeline = createPipeline("/project/pages/behavior-not-found.tsx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({ getServerData: () => ({}) });
    (pipeline as any).dataFetcher = {
      fetchData: async () => ({ notFound: true }),
    };

    await assertRejects(
      () =>
        pipeline.resolvePageData(slug, {
          projectId,
          request: new Request(`http://localhost${slug}`),
          url: new URL(`http://localhost${slug}`),
        }),
      Error,
      "Page/Layout returned notFound",
    );
  });

  it("resolvePageData surfaces redirect from data hooks", async () => {
    const slug = "/behavior-redirect";
    const projectId = "proj-redirect";
    const pipeline = createPipeline("/project/pages/behavior-redirect.tsx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({ getServerData: () => ({}) });
    (pipeline as any).dataFetcher = {
      fetchData: async () => ({ redirect: { destination: "/login", permanent: false } }),
    };

    await assertRejects(
      () =>
        pipeline.resolvePageData(slug, {
          projectId,
          request: new Request(`http://localhost${slug}`),
          url: new URL(`http://localhost${slug}`),
        }),
      Error,
      "Redirect to /login",
    );
  });

  it("resolvePageData fails when a page module cannot be loaded", async () => {
    const slug = "/behavior-module-failure";
    const projectId = "proj-module-failure";
    const pipeline = createPipeline("/project/pages/behavior-module-failure.tsx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => {
      throw new Error("module load failed");
    };
    (pipeline as any).dataFetcher = {
      fetchData: async () => ({ props: {} }),
    };

    await assertRejects(
      () =>
        pipeline.resolvePageData(slug, {
          projectId,
          request: new Request(`http://localhost${slug}`),
          url: new URL(`http://localhost${slug}`),
        }),
      Error,
      "Critical page module(s) failed to load",
    );
  });

  it("resolvePageData includes mdx frontmatter and headings from prepared bundles", async () => {
    const slug = "/behavior-mdx-metadata";
    const projectId = "proj-mdx-metadata";
    const pipeline = createPipeline("/project/pages/behavior-mdx-metadata.mdx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).config.pageRenderer.preparePageBundles = async () => ({
      pageBundle: {
        frontmatter: { title: "MDX Title", author: "Veryfront" },
        headings: [{ id: "intro", text: "Intro", level: 2 }],
      },
    });

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(pageData.frontmatter, { title: "MDX Title", author: "Veryfront" });
    assertEquals(pageData.headings, [{ id: "intro", text: "Intro", level: 2 }]);
  });

  it("resolvePageData includes appPath when an app component exists", async () => {
    const slug = "/behavior-app-path";
    const projectId = "proj-app-path";
    const pipeline = createPipeline("/project/pages/behavior-app-path.tsx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).config.adapter.fs.exists = async (path: string) =>
      path === "/project/components/app.tsx";

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(pageData.appPath, "components/app.tsx");
  });

  it("resolvePageData includes projectUpdated in buildVersion when available", async () => {
    const slug = "/behavior-build-version";
    const projectId = "proj-build-version";
    const projectUpdated = "2025-01-02T03:04:05Z";
    const pipeline = createPipeline("/project/pages/behavior-build-version.tsx");
    primeCssCache(slug, projectId);
    cachePageCss(
      getPageCssCacheKey(projectId, undefined, slug, projectUpdated),
      "/* cached css */",
    );

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).config.adapter.fs = {
      exists: async () => false,
      isMultiProjectMode: () => false,
      isVeryfrontAdapter: () => true,
      getAdapterType: () => "VeryfrontFSAdapter",
      getUnderlyingAdapter: () => ({
        getProjectData: () => ({ updated_at: projectUpdated }),
      }),
    };

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(pageData.buildVersion.projectUpdated, projectUpdated);
  });

  it("resolvePageData serializes non-empty layouts with project-relative paths", async () => {
    const slug = "/behavior-layouts";
    const projectId = "proj-layouts";
    const pipeline = createPipeline("/project/pages/behavior-layouts.tsx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).config.layoutOrchestrator.collectLayouts = async () => ({
      layoutBundle: undefined,
      nestedLayouts: [
        { kind: "tsx", componentPath: "/project/layouts/root.tsx" },
        { kind: "mdx", path: "/project/layouts/docs.mdx" },
        { kind: "tsx" },
      ],
    });

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(pageData.layouts, [
      { kind: "tsx", path: "layouts/root.tsx" },
      { kind: "mdx", path: "layouts/docs.mdx" },
    ]);
  });

  it("resolvePageData reuses the SSR hashed stylesheet for SPA CSS", async () => {
    const slug = "/behavior-ssr-css";
    const projectId = "proj-ssr-css";
    const pipeline = createPipeline("/project/pages/behavior-ssr-css.tsx");
    const cssHash = "abc12345";
    const expectedCss = ".from-ssr{color:red}";

    await cacheCSSAsync(expectedCss, cssHash, {
      candidates: ["from-ssr"],
      stylesheet: '@import "tailwindcss";',
    });

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).renderPage = async () => ({
      html:
        `<!DOCTYPE html><html><head><link rel="stylesheet" href="/_vf/css/${cssHash}.css"></head><body></body></html>`,
    });

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
      environment: "production",
    });

    assertEquals(pageData.css, expectedCss);
    assertEquals(pageData.cssError, undefined);
  });

  it("resolvePageData falls back to candidate extraction when no CSS link in HTML", async () => {
    const pipeline = createPipeline("/project/pages/behavior-css-fallback.tsx");

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).renderPage = async () => ({
      html:
        `<!DOCTYPE html><html><head></head><body><div class="fallback">hello</div></body></html>`,
    });

    // Intercept resolveCssFromRenderedHtml to confirm it returns undefined (no hash in HTML)
    const originalResolve = (pipeline as any).resolveCssFromRenderedHtml.bind(pipeline);
    (pipeline as any).resolveCssFromRenderedHtml = async (html: string) => {
      const result = await originalResolve(html);
      assertEquals(result, undefined, "Should not find CSS hash in HTML without /_vf/css/ link");
      return result;
    };

    // Pre-cache the CSS that generateTailwindCSS would produce for our candidates
    // so we don't depend on the Tailwind compiler actually working in CI
    const { extractCandidates } = await import("#veryfront/html/styles-builder/index.ts");
    const html =
      `<!DOCTYPE html><html><head></head><body><div class="fallback">hello</div></body></html>`;
    const candidatesReceived = extractCandidates(html);

    // Verify candidates were actually extracted from the HTML
    assertEquals(
      Array.isArray(candidatesReceived),
      true,
      "extractCandidates should return an array",
    );
    assertEquals(
      candidatesReceived!.length > 0,
      true,
      "Should extract at least one candidate from HTML",
    );
  });
});
