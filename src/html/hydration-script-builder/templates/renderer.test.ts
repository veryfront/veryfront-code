import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getRendererScript } from "./renderer.ts";

describe("hydration-script-builder/templates/renderer", () => {
  describe("getRendererScript", () => {
    function assertIncludes(result: string, substring: string): void {
      assertEquals(result.includes(substring), true);
    }

    it("should return a non-empty string", () => {
      const result = getRendererScript();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should define async renderPage function", () => {
      assertIncludes(getRendererScript(), "async function renderPage(pathname)");
    });

    it("should look for veryfront-hydration-data script element", () => {
      assertIncludes(getRendererScript(), "getElementById('veryfront-hydration-data')");
    });

    it("should parse hydration data as JSON", () => {
      assertIncludes(getRendererScript(), "JSON.parse");
    });

    it("should handle studioEmbed flag", () => {
      const result = getRendererScript();
      assertIncludes(result, "data.studioEmbed");
      assertIncludes(result, "__veryfrontSetStudioEmbed");
    });

    it("should install release asset modules from hydration data", () => {
      const result = getRendererScript();
      assertIncludes(result, "data.releaseAssetModules");
      assertIncludes(result, "__veryfrontSetReleaseAssetModules");
    });

    it("should install release id from hydration data", () => {
      const result = getRendererScript();
      assertIncludes(result, "data.releaseId");
      assertIncludes(result, "__veryfrontSetReleaseId");
    });

    it("should use the RSC module endpoint only for app router RSC client pages", () => {
      const result = getRendererScript();
      assertIncludes(result, "data.clientModuleStrategy === 'rsc-module'");
      assertIncludes(result, "isAppRouterPath(normalizedPagePath)");
      assertIncludes(result, "'/_veryfront/rsc/module?rel=' + encodeURIComponent(data.pagePath)");
      assertIncludes(result, "const moduleUrl = shouldRenderRscClientPage");
    });

    it("uses the configured App Router root for pages and layouts", () => {
      const result = getRendererScript();
      assertIncludes(result, "data.appRouterRoot");
      assertIncludes(result, "function isAppRouterPath");
      assertIncludes(result, "function isRootAppLayoutPath");
    });

    it("should use pathToModuleUrl for non-RSC page loading", () => {
      assertIncludes(getRendererScript(), "pathToModuleUrl(data.pagePath");
    });

    it("should fallback to Pages Router pattern", () => {
      assertIncludes(getRendererScript(), "Falling back to Pages Router pattern");
    });

    it("should handle root path in fallback", () => {
      assertIncludes(
        getRendererScript(),
        "resolvedPathname === '/' ? 'index' : resolvedPathname.slice(1)",
      );
    });

    it("should get PageComponent from default export", () => {
      assertIncludes(getRendererScript(), "pageModule.default || pageModule");
    });

    it("should merge props with normalized params", () => {
      const result = getRendererScript();
      assertIncludes(result, "const normalizedParams = normalizeRouteParams(data.params)");
      assertIncludes(result, "...(data.props || {}), params: normalizedParams");
    });

    it("should wrap with layouts from innermost to outermost", () => {
      const result = getRendererScript();
      assertIncludes(result, "const layouts = data.layouts");
      assertIncludes(result, "layouts.length - 1; i >= 0; i--");
    });

    it("should load only the client layouts advertised for an isolated App Router page", () => {
      const result = getRendererScript();
      assertIncludes(result, "loadHydrationComponent");
      assertIncludes(result, "layouts[i].path");
      assertIncludes(result, "shouldRenderRscClientPage");
      assertIncludes(result, "'/_veryfront/rsc/module?rel=' + encodeURIComponent(path)");
    });

    it("should recreate initial layouts with their serialized props", () => {
      const result = getRendererScript();
      assertIncludes(result, "data.layoutProps?.[layouts[i].path] || {}");
      assertIncludes(result, "{ ...layoutProps, children: tree }");
    });

    it("should mount isolated App Router pages inside the server-emitted page island", () => {
      const result = getRendererScript();
      assertIncludes(result, "data.isolatedClientPage");
      assertIncludes(result, "getElementById('veryfront-page-island')");
      assertIncludes(result, "Isolated client page root not found");
    });

    it("should unwrap App Router document layouts before mounting into the root container", () => {
      const result = getRendererScript();
      assertIncludes(result, "function unwrapAppRouterDocumentLayout");
      assertIncludes(result, "element.type !== 'html'");
      assertIncludes(result, "child.type === 'body'");
      assertIncludes(result, "isRootAppLayoutPath(layouts[i].path)");
    });

    it("should wrap with App component when appPath is provided", () => {
      const result = getRendererScript();
      assertIncludes(result, "data.appPath");
      assertIncludes(result, "loadHydrationComponent(data.appPath, shouldRenderRscClientPage)");
    });

    it("should build page context with slug, path, params, query, frontmatter, and headings", () => {
      const result = getRendererScript();
      assertIncludes(result, "slug: data.slug");
      assertIncludes(result, "path: data.pagePath");
      assertIncludes(result, "params: normalizedParams");
      assertIncludes(result, "frontmatter: data.frontmatter");
      assertIncludes(result, "headings,");
    });

    it("should include mdxHeadings alias for backwards compatibility", () => {
      assertIncludes(getRendererScript(), "mdxHeadings: headings");
    });

    it("should wrap with PageContextProvider", () => {
      assertIncludes(getRendererScript(), "PageContextProvider");
    });

    it("should wrap with RouterProvider", () => {
      assertIncludes(getRendererScript(), "RouterProvider");
    });

    it("should use hydrateRoot for initial render", () => {
      assertIncludes(getRendererScript(), "hydrateRoot");
    });

    it("should client-render RSC module pages into the root container", () => {
      const result = getRendererScript();
      assertIncludes(
        result,
        "data.clientModuleStrategy === 'rsc-module' && isAppRouterPath(normalizedPagePath)",
      );
      assertIncludes(result, "container.__reactRoot = createRoot(container)");
      assertIncludes(result, "container.__reactRoot.render(tree)");
    });

    it("should use identifierPrefix 'vf'", () => {
      assertIncludes(getRendererScript(), "identifierPrefix: 'vf'");
    });

    it("should expose renderPage on window for HMR", () => {
      assertIncludes(getRendererScript(), "window.__veryfrontRenderPage = renderPage");
    });

    it("should store initial page data in history state", () => {
      assertIncludes(getRendererScript(), "window.history.replaceState");
    });

    it("should signal hydration complete", () => {
      assertIncludes(getRendererScript(), "__veryfrontHydrationComplete");
    });

    it("should signal hydration failed", () => {
      assertIncludes(getRendererScript(), "__veryfrontHydrationFailed");
    });

    it("should look for root container", () => {
      assertIncludes(getRendererScript(), "getElementById('root')");
    });

    it("should support re-rendering via __reactRoot", () => {
      assertIncludes(getRendererScript(), "container.__reactRoot");
    });
  });

  // Evaluate helpers out of the emitted browser script so the behaviour itself
  // is under test, not just the presence of a substring. Only the helpers are
  // extracted; the rest of the script touches `window`.
  function extractFunction(declaration: string): string {
    const script = getRendererScript();
    const start = script.indexOf(declaration);
    assertEquals(start >= 0, true, declaration + " not found in renderer script");
    const end = script.indexOf("\n    }", start);
    assertEquals(end > start, true, "could not find end of " + declaration);
    return script.slice(start, end + "\n    }".length);
  }

  function isModuleNotFoundError(error: unknown): boolean {
    return new Function(
      "error",
      extractFunction("function isModuleNotFoundError(") +
        "\nreturn isModuleNotFoundError(error);",
    )(error) as boolean;
  }

  type ImportModule = (url: string) => Promise<unknown>;

  function loadPageModuleWithIndexFallback(
    basePath: string,
    pageSlug: string,
    pageModuleError: unknown,
    importModule: ImportModule,
  ): Promise<unknown> {
    const source = [
      extractFunction("function isModuleNotFoundError("),
      extractFunction("function preferReachedModuleError("),
      extractFunction("async function loadPageModuleWithIndexFallback("),
    ].join("\n");

    return new Function(
      "basePath",
      "pageSlug",
      "pageModuleError",
      "importModule",
      source +
        "\nreturn loadPageModuleWithIndexFallback(basePath, pageSlug, pageModuleError, importModule);",
    )(basePath, pageSlug, pageModuleError, importModule) as Promise<unknown>;
  }

  describe("isModuleNotFoundError", () => {
    it("treats a failed fetch as module-not-found", () => {
      assertEquals(
        isModuleNotFoundError(
          new TypeError(
            "Failed to fetch dynamically imported module: http://x/_vf_modules/pages/a.js",
          ),
        ),
        true,
      );
      assertEquals(
        isModuleNotFoundError(new TypeError("error loading dynamically imported module")),
        true,
      );
    });

    it("does not treat a link error as module-not-found", () => {
      // This is the case that used to be retried at <route>/index.js, replacing
      // a precise link error with a misleading 404.
      assertEquals(
        isModuleNotFoundError(
          new SyntaxError(
            "The requested module '/_vf_modules/_veryfront/platform/polyfills/node-noop.js' " +
              "does not provide an export named 'createHash'",
          ),
        ),
        false,
      );
    });

    it("does not treat a module evaluation error as module-not-found", () => {
      assertEquals(isModuleNotFoundError(new Error("boom during module evaluation")), false);
      assertEquals(isModuleNotFoundError(new ReferenceError("x is not defined")), false);
    });

    it("does not treat app errors that merely mention loading as module-not-found", () => {
      assertEquals(isModuleNotFoundError(new Error("Failed to load user profile")), false);
      assertEquals(isModuleNotFoundError(new TypeError("Failed to fetch /api/session")), false);
    });

    it("recognizes the browser wordings for a module that could not be fetched", () => {
      assertEquals(isModuleNotFoundError(new TypeError("Importing a module script failed.")), true);
      assertEquals(
        isModuleNotFoundError(new TypeError("Failed to load module script: unexpected MIME type")),
        true,
      );
    });

    it("handles null and non-Error values", () => {
      assertEquals(isModuleNotFoundError(null), false);
      assertEquals(isModuleNotFoundError(undefined), false);
      assertEquals(isModuleNotFoundError("Failed to fetch dynamically imported module"), true);
    });
  });

  describe("loadPageModuleWithIndexFallback", () => {
    const notFound = (url: string) =>
      new TypeError("Failed to fetch dynamically imported module: " + url);
    const linkError = () =>
      new SyntaxError(
        "The requested module '/_vf_modules/_veryfront/platform/polyfills/node-noop.js' " +
          "does not provide an export named 'createHash'",
      );

    async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
      try {
        await promise;
      } catch (error) {
        return error;
      }
      throw new Error("expected the fallback to reject");
    }

    it("loads the module from <route>/index.js when <route>.js is missing", async () => {
      const requested: string[] = [];
      const pageModule = { default: "docs-index" };

      const loaded = await loadPageModuleWithIndexFallback(
        "http://modules/pages/docs",
        "docs",
        null,
        (url) => {
          requested.push(url);
          if (url.endsWith("/docs.js")) return Promise.reject(notFound(url));
          return Promise.resolve(pageModule);
        },
      );

      assertEquals(loaded, pageModule);
      assertEquals(requested, [
        "http://modules/pages/docs.js",
        "http://modules/pages/docs/index.js",
      ]);
    });

    it("retries at /index.js for rejections the classifier does not recognize", async () => {
      // A proxy that rewrites a module miss into an HTML shell surfaces as a
      // SyntaxError. Gating the retry on error wording turned that into a blank
      // page for routes that load fine from <route>/index.js.
      const requested: string[] = [];
      const pageModule = { default: "docs-index" };

      const loaded = await loadPageModuleWithIndexFallback(
        "http://modules/pages/docs",
        "docs",
        null,
        (url) => {
          requested.push(url);
          if (url.endsWith("/docs.js")) {
            return Promise.reject(new SyntaxError("Unexpected token '<'"));
          }
          return Promise.resolve(pageModule);
        },
      );

      assertEquals(loaded, pageModule);
      assertEquals(requested.length, 2);
    });

    it("throws the original error when both the route and its index are missing", async () => {
      const original = notFound("http://modules/pages/docs.js");

      const thrown = await captureRejection(
        loadPageModuleWithIndexFallback(
          "http://modules/pages/docs",
          "docs",
          null,
          (url) => Promise.reject(url.endsWith("/index.js") ? notFound(url) : original),
        ),
      );

      assertEquals(thrown, original);
    });

    it("throws the link error from <route>.js rather than the retry's 404", async () => {
      const original = linkError();

      const thrown = await captureRejection(
        loadPageModuleWithIndexFallback(
          "http://modules/pages/docs",
          "docs",
          null,
          (url) => Promise.reject(url.endsWith("/index.js") ? notFound(url) : original),
        ),
      );

      assertEquals(thrown, original);
    });

    it("throws the retry's link error when <route>.js was merely missing", async () => {
      const indexLinkError = linkError();

      const thrown = await captureRejection(
        loadPageModuleWithIndexFallback(
          "http://modules/pages/docs",
          "docs",
          null,
          (url) => Promise.reject(url.endsWith("/index.js") ? indexLinkError : notFound(url)),
        ),
      );

      assertEquals(thrown, indexLinkError);
    });

    it("does not retry when the slug is already an index route", async () => {
      const requested: string[] = [];
      const original = notFound("http://modules/pages/index.js");

      const thrown = await captureRejection(
        loadPageModuleWithIndexFallback("http://modules/pages/index", "index", null, (url) => {
          requested.push(url);
          return Promise.reject(original);
        }),
      );

      assertEquals(thrown, original);
      assertEquals(requested, ["http://modules/pages/index.js"]);
    });

    it("prefers a link error over a stale hydration-data fetch failure", async () => {
      // Hydration data can carry a pagePath that no longer resolves. That 404
      // must never outrank an error proving the fallback reached a module.
      const staleFetchFailure = notFound("http://modules/pages/old-name.js");
      const indexLinkError = linkError();

      const thrown = await captureRejection(
        loadPageModuleWithIndexFallback(
          "http://modules/pages/index",
          "index",
          staleFetchFailure,
          () => Promise.reject(indexLinkError),
        ),
      );

      assertEquals(thrown, indexLinkError);
    });

    it("keeps the hydration-data error when nothing else reached a module", async () => {
      const original = notFound("http://modules/pages/old-name.js");

      const thrown = await captureRejection(
        loadPageModuleWithIndexFallback(
          "http://modules/pages/docs",
          "docs",
          original,
          (url) => Promise.reject(notFound(url)),
        ),
      );

      assertEquals(thrown, original);
    });
  });
});
