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

  describe("isModuleNotFoundError", () => {
    // Evaluate the helper out of the emitted browser script so the behaviour
    // itself is under test, not just the presence of a substring. Only the
    // helper is extracted — the rest of the script touches `window`.
    function helperSource(): string {
      const script = getRendererScript();
      const start = script.indexOf("function isModuleNotFoundError(error) {");
      assertEquals(start >= 0, true, "isModuleNotFoundError not found in renderer script");
      const end = script.indexOf("\n    }", start);
      assertEquals(end > start, true, "could not find end of isModuleNotFoundError");
      return script.slice(start, end + "\n    }".length);
    }

    function isModuleNotFoundError(error: unknown): boolean {
      return new Function(
        "error",
        `${helperSource()}\nreturn isModuleNotFoundError(error);`,
      )(error) as boolean;
    }

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

    it("handles null and non-Error values", () => {
      assertEquals(isModuleNotFoundError(null), false);
      assertEquals(isModuleNotFoundError(undefined), false);
      assertEquals(isModuleNotFoundError("Failed to fetch dynamically imported module"), true);
    });
  });

  describe("page module fallback", () => {
    it("only retries the /index.js path for module-not-found errors", () => {
      const script = getRendererScript();
      assertEquals(script.includes("isModuleNotFoundError(error)"), true);
      assertEquals(script.includes("canRetryAsIndex"), true);
    });

    it("rethrows the original error rather than the fallback's", () => {
      const script = getRendererScript();
      assertEquals(script.includes("throw pageModuleError"), true);
    });

    it("prefers the retry's error when the retry reached a module", () => {
      // A real <route>/index.tsx page 404s on <route>.js first, so the retry is
      // the load that matters and its link error must not be replaced by the
      // expected 404.
      const script = getRendererScript();
      assertEquals(
        script.includes("throw isModuleNotFoundError(indexError) ? pageModuleError : indexError;"),
        true,
      );
    });
  });
});
