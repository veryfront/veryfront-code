import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RSCProductionOptimizer } from "./production-optimizer.ts";
import type { RSCPayload } from "./types.ts";

function makePayload(overrides: Partial<RSCPayload> = {}): RSCPayload {
  return {
    html: overrides.html ?? "<div>hello</div>",
    clientRefs: overrides.clientRefs ?? {},
    assets: overrides.assets ?? { css: [], js: [] },
    tree: overrides.tree,
  };
}

describe("rendering/rsc/production-optimizer", () => {
  describe("optimizePayload", () => {
    it("should strip HTML comments", () => {
      const payload = makePayload({ html: "<div><!-- comment -->text</div>" });
      const result = RSCProductionOptimizer.optimizePayload(payload);
      assertEquals(result.html.includes("<!--"), false);
    });

    it("should remove whitespace between tags", () => {
      const payload = makePayload({ html: "<div>  <span>  text  </span>  </div>" });
      const result = RSCProductionOptimizer.optimizePayload(payload);
      assertEquals(result.html.includes(">  <"), false);
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
      const p = makePayload({ html: "<p>test</p>" });
      assertEquals(
        RSCProductionOptimizer.generateETag(p),
        RSCProductionOptimizer.generateETag(p),
      );
    });

    it("should differ for different html", () => {
      const a = RSCProductionOptimizer.generateETag(makePayload({ html: "<div>a</div>" }));
      const b = RSCProductionOptimizer.generateETag(makePayload({ html: "<div>b</div>" }));
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
        ["/", makePayload({ clientRefs: { App: "/app.js" } })],
      ]);
      const { bundles, manifest } = RSCProductionOptimizer.bundlePayloads(payloads);
      assertEquals("_" in bundles, true);
      assertEquals(manifest["/"], ["App"]);
    });
  });

  describe("generatePreloadLinks", () => {
    it("should generate modulepreload links", () => {
      const links = RSCProductionOptimizer.generatePreloadLinks({ Btn: "/btn.js" });
      assertEquals(links.length, 1);
      assertEquals(links[0].includes('rel="modulepreload"'), true);
      assertEquals(links[0].includes('href="/btn.js"'), true);
    });

    it("should return empty for no refs", () => {
      assertEquals(RSCProductionOptimizer.generatePreloadLinks({}).length, 0);
    });
  });

  describe("generateCSP", () => {
    it("should return a valid CSP string", () => {
      const csp = RSCProductionOptimizer.generateCSP();
      assertEquals(csp.includes("default-src 'none'"), true);
      assertEquals(csp.includes("script-src"), true);
      assertEquals(csp.includes("upgrade-insecure-requests"), true);
    });
  });

  describe("getCSPDirectives", () => {
    it("should return directives object", () => {
      const dirs = RSCProductionOptimizer.getCSPDirectives();
      assertEquals(dirs["default-src"], ["'none'"]);
      assertEquals(dirs["object-src"], ["'none'"]);
    });
  });
});
