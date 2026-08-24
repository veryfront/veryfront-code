import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RSCProductionOptimizer } from "./production-optimizer.ts";
import type { RSCPayload } from "./types.ts";

function makePayload(overrides: Partial<RSCPayload> = {}): RSCPayload {
  return {
    html: overrides.html ?? "<div>hello</div>",
    clientRefs: overrides.clientRefs ?? {},
    dependencyPinningCacheKey: overrides.dependencyPinningCacheKey,
    assets: overrides.assets ?? { css: [], js: [] },
    tree: overrides.tree,
  };
}

describe("rendering/rsc/production-optimizer", () => {
  describe("optimizePayload", () => {
    it("should strip HTML comments", () => {
      const payload = makePayload({ html: "<div><!--a-->KEEP<!--b--></div>" });
      const result = RSCProductionOptimizer.optimizePayload(payload);
      assertEquals(
        result.html,
        "<div>KEEP</div>",
        "comment stripping must not eat markup between comments",
      );
    });

    it("should remove whitespace between tags", () => {
      const payload = makePayload({ html: "<div>  <span>  text  </span>  </div>" });
      const result = RSCProductionOptimizer.optimizePayload(payload);
      assertEquals(
        result.html,
        "<div><span>  text  </span></div>",
        "only whitespace between tags is collapsed, not text content",
      );
    });

    it("should strip tree from output", () => {
      const payload = makePayload({ tree: { type: "fragment" } as RSCPayload["tree"] });
      const result = RSCProductionOptimizer.optimizePayload(payload);
      assertEquals(result.tree, undefined);
    });

    it("should preserve clientRefs and assets", () => {
      const payload = makePayload({
        clientRefs: { Button: "/btn.js" },
        assets: { css: ["/style.css"], js: ["/main.js"] },
      });
      const result = RSCProductionOptimizer.optimizePayload(payload);
      assertEquals(result.clientRefs, { Button: "/btn.js" });
      assertEquals(result.assets, { css: ["/style.css"], js: ["/main.js"] });
    });

    it("preserves dependency snapshot identity", () => {
      const result = RSCProductionOptimizer.optimizePayload(
        makePayload({ dependencyPinningCacheKey: "on:pins-a" }),
      );

      assertEquals(result.dependencyPinningCacheKey, "on:pins-a");
    });
  });

  describe("getCacheHeaders", () => {
    it("should return no-cache headers by default", () => {
      const headers = RSCProductionOptimizer.getCacheHeaders();
      assertEquals(headers["Cache-Control"], "no-cache, no-store, must-revalidate");
    });

    it("should return no-cache when not static", () => {
      const headers = RSCProductionOptimizer.getCacheHeaders({ isStatic: false, maxAge: 3600 });
      assertEquals(headers["Cache-Control"], "no-cache, no-store, must-revalidate");
    });

    it("should return public cache headers for static content", () => {
      const headers = RSCProductionOptimizer.getCacheHeaders({ isStatic: true, maxAge: 3600 });
      assertEquals(headers["Cache-Control"], "public, max-age=3600, stale-while-revalidate=7200");
      assertEquals(headers["CDN-Cache-Control"], "max-age=14400");
    });
  });

  describe("generateETag", () => {
    it("should return a quoted base36 string", () => {
      const etag = RSCProductionOptimizer.generateETag(makePayload());
      assertEquals(etag.startsWith('"'), true);
      assertEquals(etag.endsWith('"'), true);
    });

    it("should be deterministic", () => {
      const payload = makePayload({ html: "<p>test</p>" });
      assertEquals(
        RSCProductionOptimizer.generateETag(payload),
        RSCProductionOptimizer.generateETag(payload),
      );
    });

    it("should differ for different html", () => {
      const a = RSCProductionOptimizer.generateETag(makePayload({ html: "<div>a</div>" }));
      const b = RSCProductionOptimizer.generateETag(makePayload({ html: "<div>b</div>" }));
      assertEquals(a !== b, true);
    });

    it("should differ for different client reference maps", () => {
      const a = RSCProductionOptimizer.generateETag(
        makePayload({ clientRefs: { App: "/a.js" } }),
      );
      const b = RSCProductionOptimizer.generateETag(
        makePayload({ clientRefs: { App: "/b.js" } }),
      );
      assertEquals(a !== b, true, "ETag must cover the client reference map");
    });

    it("differs for identical output rendered under different dependency snapshots", () => {
      const a = RSCProductionOptimizer.generateETag(
        makePayload({ dependencyPinningCacheKey: "on:pins-a" }),
      );
      const b = RSCProductionOptimizer.generateETag(
        makePayload({ dependencyPinningCacheKey: "on:pins-b" }),
      );

      assertEquals(a !== b, true);
    });
  });

  describe("checkETag", () => {
    it("should return false for null request ETag", () => {
      assertEquals(RSCProductionOptimizer.checkETag(null, '"abc"'), false);
    });

    it("should match identical ETags", () => {
      assertEquals(RSCProductionOptimizer.checkETag('"abc"', '"abc"'), true);
    });

    it("should match weak ETags", () => {
      assertEquals(RSCProductionOptimizer.checkETag('W/"abc"', '"abc"'), true);
    });

    it("should not match different ETags", () => {
      assertEquals(
        RSCProductionOptimizer.checkETag('"abc"', '"def"'),
        false,
        "different ETags must not produce a 304",
      );
      assertEquals(
        RSCProductionOptimizer.checkETag('W/"abc"', '"abcd"'),
        false,
        "normalizing W/ and quotes must not turn a prefix into a match",
      );
      assertEquals(
        RSCProductionOptimizer.checkETag('""', '"abc"'),
        false,
        "an empty quoted ETag must not match",
      );
    });
  });

  describe("optimizeClientRefs", () => {
    it("should return refs unchanged without CDN prefix", () => {
      const refs = { Btn: "/btn.js" };
      assertEquals(RSCProductionOptimizer.optimizeClientRefs(refs), refs);
    });

    it("should prefix paths with CDN", () => {
      const refs = { Btn: "/btn.js", Card: "/card.js" };
      const result = RSCProductionOptimizer.optimizeClientRefs(refs, "https://cdn.example.com");
      assertEquals(result.Btn, "https://cdn.example.com/btn.js");
      assertEquals(result.Card, "https://cdn.example.com/card.js");
    });
  });

  describe("bundlePayloads", () => {
    it("should create bundles and manifest from payloads", () => {
      const payloads = new Map<string, RSCPayload>([
        [
          "/",
          makePayload({
            clientRefs: { App: "/app.js" },
            html: "<div><!-- c -->  <span>x</span>  </div>",
            tree: { type: "fragment" } as RSCPayload["tree"],
          }),
        ],
        ["/about", makePayload({ clientRefs: { About: "/about.js" } })],
      ]);
      const { bundles, manifest } = RSCProductionOptimizer.bundlePayloads(payloads);

      assertEquals(
        Object.keys(bundles).sort(),
        ["_", "_about"],
        "each route gets its own bundle id",
      );
      assertEquals(
        bundles["_"]?.tree,
        undefined,
        "bundled payloads must not carry the render tree",
      );
      assertEquals(
        bundles["_"]?.html,
        "<div><span>x</span></div>",
        "bundlePayloads must minify each payload",
      );
      assertEquals(manifest["/"], ["App"]);
      assertEquals(manifest["/about"], ["About"]);
    });
  });

  describe("generatePreloadLinks", () => {
    it("should generate modulepreload links", () => {
      const links = RSCProductionOptimizer.generatePreloadLinks({ Btn: "/btn.js" });
      assertEquals(links.length, 1);
      const first = links[0];
      assertExists(first);
      assertEquals(first.includes('rel="modulepreload"'), true);
      assertEquals(first.includes('href="/btn.js"'), true);
    });

    it("should return empty for no refs", () => {
      assertEquals(RSCProductionOptimizer.generatePreloadLinks({}).length, 0);
    });
  });

  describe("generateCSP", () => {
    it("should return a valid CSP string", () => {
      const csp = RSCProductionOptimizer.generateCSP();
      assertEquals(csp.includes("default-src 'none'"), true, "CSP denies everything by default");
      assertEquals(
        csp.includes("script-src 'self' https://esm.sh"),
        true,
        "the serialized script-src must stay self plus esm.sh",
      );
      assertEquals(
        csp.includes("frame-ancestors 'none'"),
        true,
        "the serialized CSP must forbid framing",
      );
      assertEquals(
        csp.includes("unsafe-inline"),
        false,
        "generated CSP must never permit inline scripts",
      );
      assertEquals(
        csp.includes("upgrade-insecure-requests"),
        true,
        "the valueless directive is serialized as a bare key",
      );
    });
  });

  describe("getCSPDirectives", () => {
    it("should return directives object", () => {
      const dirs = RSCProductionOptimizer.getCSPDirectives();
      assertEquals(dirs["default-src"], ["'none'"], "RSC responses deny everything by default");
      assertEquals(dirs["object-src"], ["'none'"], "RSC responses must not embed objects");
      assertEquals(
        dirs["script-src"],
        ["'self'", "https://esm.sh"],
        "RSC script-src must stay self plus esm.sh",
      );
      assertEquals(dirs["frame-ancestors"], ["'none'"], "RSC responses must not be framable");
      assertEquals(dirs["base-uri"], ["'none'"], "RSC responses must not rebase relative URLs");
      assertEquals(dirs["form-action"], ["'none'"], "RSC responses must not submit forms");
    });
  });
});
