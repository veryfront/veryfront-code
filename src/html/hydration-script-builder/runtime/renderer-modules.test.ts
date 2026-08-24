import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModuleNamespace } from "./env.ts";
import {
  isAppRouterPath,
  isModuleNotFoundError,
  isRootAppLayoutPath,
  loadPageModuleWithIndexFallback,
} from "./renderer.ts";

describe("hydration-script-builder/runtime/renderer", () => {
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
      const pageModule: ModuleNamespace = { default: "docs-index" };

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

    it("does not probe /index.js when <route>.js reached a module and threw at evaluation", async () => {
      // Issue #3667: an extension-style route (pages/vector-a.tsx, no folder) was
      // requesting <route>/index.js and 404ing. That only fires as the retry —
      // here <route>.js loads and throws a *runtime* error during evaluation
      // (the class surfaced by the #3661 O_NOFOLLOW adapter crash). The module
      // exists and is the served file, so the /index.js probe can only 404 and
      // add noise; the real error must surface untouched.
      const requested: string[] = [];
      const evaluationError = new TypeError(
        "Cannot read properties of undefined (reading 'O_NOFOLLOW')",
      );

      const thrown = await captureRejection(
        loadPageModuleWithIndexFallback(
          "http://modules/pages/vector-a",
          "vector-a",
          null,
          (url) => {
            requested.push(url);
            return Promise.reject(
              url.endsWith("/vector-a.js") ? evaluationError : notFound(url),
            );
          },
        ),
      );

      assertEquals(thrown, evaluationError);
      assertEquals(requested, ["http://modules/pages/vector-a.js"]);
    });

    it('retries at /index.js when Safari reports only "Load failed"', async () => {
      // Safari surfaces a failed dynamic import as a TypeError reading exactly
      // "Load failed", naming no module. That is the same shape as the
      // evaluation error pinned above, so the retry cannot be decided on the
      // error's type — only its wording distinguishes them. Without this the
      // <route>/index.js fallback never fired in Safari and the page stayed
      // blank for every <route>/index.tsx route.
      const requested: string[] = [];
      const pageModule: ModuleNamespace = { default: "docs-index" };

      const loaded = await loadPageModuleWithIndexFallback(
        "http://modules/pages/docs",
        "docs",
        null,
        (url) => {
          requested.push(url);
          if (url.endsWith("/docs.js")) {
            return Promise.reject(new TypeError("Load failed"));
          }
          return Promise.resolve(pageModule);
        },
      );

      assertEquals(loaded, pageModule);
      assertEquals(requested.length, 2);
    });

    it("refuses the retry for a module that throws a non-Error value", async () => {
      // Only module code produces a non-Error rejection; the loader's own
      // failures are TypeError or SyntaxError. Probing /index.js here can only
      // 404 and bury what the module threw.
      const requested: string[] = [];
      const thrown = await captureRejection(
        loadPageModuleWithIndexFallback(
          "http://modules/pages/vector-a",
          "vector-a",
          null,
          (url) => {
            requested.push(url);
            return Promise.reject(url.endsWith("/vector-a.js") ? "boom" : notFound(url));
          },
        ),
      );

      assertEquals(thrown, "boom");
      assertEquals(requested, ["http://modules/pages/vector-a.js"]);
    });

    it('refuses the retry for a trailing-period "Load failed."', async () => {
      // Safari's message has no period. Allowing one widened the match past the
      // engine wording for no gain, and an application error is free to end in
      // a full stop.
      const requested: string[] = [];
      const evaluationError = new TypeError("Load failed.");

      const thrown = await captureRejection(
        loadPageModuleWithIndexFallback(
          "http://modules/pages/vector-a",
          "vector-a",
          null,
          (url) => {
            requested.push(url);
            return Promise.reject(
              url.endsWith("/vector-a.js") ? evaluationError : notFound(url),
            );
          },
        ),
      );

      assertEquals(thrown, evaluationError);
      assertEquals(requested, ["http://modules/pages/vector-a.js"]);
    });

    it("still refuses the retry for an evaluation TypeError that merely mentions loading", async () => {
      // The Safari match is exact, so an application error that happens to
      // contain the words does not reopen the noise #3667 removed.
      const requested: string[] = [];
      const evaluationError = new TypeError("Image load failed for /hero.png");

      const thrown = await captureRejection(
        loadPageModuleWithIndexFallback(
          "http://modules/pages/vector-a",
          "vector-a",
          null,
          (url) => {
            requested.push(url);
            return Promise.reject(
              url.endsWith("/vector-a.js") ? evaluationError : notFound(url),
            );
          },
        ),
      );

      assertEquals(thrown, evaluationError);
      assertEquals(requested, ["http://modules/pages/vector-a.js"]);
    });

    it("retries at /index.js for rejections the classifier does not recognize", async () => {
      // A proxy that rewrites a module miss into an HTML shell surfaces as a
      // SyntaxError. Gating the retry on error wording turned that into a blank
      // page for routes that load fine from <route>/index.js.
      const requested: string[] = [];
      const pageModule: ModuleNamespace = { default: "docs-index" };

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

    it("does not retry for a nested index slug", async () => {
      const requested: string[] = [];
      const original = notFound("http://modules/pages/docs/index.js");

      const thrown = await captureRejection(
        loadPageModuleWithIndexFallback(
          "http://modules/pages/docs/index",
          "docs/index",
          null,
          (url) => {
            requested.push(url);
            return Promise.reject(original);
          },
        ),
      );

      assertEquals(thrown, original, "a nested index slug must surface the original error");
      assertEquals(
        requested,
        ["http://modules/pages/docs/index.js"],
        "a nested index slug must not probe <route>/index/index.js",
      );
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
  describe("isAppRouterPath", () => {
    it("matches the App Router root and anything under it", () => {
      assertEquals(isAppRouterPath("app", "app"), true);
      assertEquals(isAppRouterPath("app/page.tsx", "app"), true);
      assertEquals(isAppRouterPath("/app/nested/page.tsx", "app"), true);
    });

    it("does not match a sibling directory that shares the prefix", () => {
      assertEquals(isAppRouterPath("application/page.tsx", "app"), false);
      assertEquals(isAppRouterPath("pages/index.tsx", "app"), false);
    });

    it("honours a custom App Router root", () => {
      assertEquals(isAppRouterPath("src/app/page.tsx", "src/app"), true);
      assertEquals(isAppRouterPath("app/page.tsx", "src/app"), false);
    });

    it("treats a missing path as outside the App Router", () => {
      assertEquals(isAppRouterPath(undefined, "app"), false);
    });
  });

  describe("isRootAppLayoutPath", () => {
    it("matches the root layout in every source extension", () => {
      for (const ext of ["tsx", "jsx", "ts", "js"]) {
        assertEquals(isRootAppLayoutPath(`app/layout.${ext}`, "app"), true);
      }
      assertEquals(isRootAppLayoutPath("/app/layout.tsx", "app"), true);
    });

    it("does not match a nested layout or the page itself", () => {
      assertEquals(isRootAppLayoutPath("app/blog/layout.tsx", "app"), false);
      assertEquals(isRootAppLayoutPath("app/page.tsx", "app"), false);
    });
  });
});
