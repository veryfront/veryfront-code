import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
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
    it("trims outer whitespace without rewriting document content", () => {
      const payload = makePayload({ html: "  <div><!-- comment -->text</div>  " });
      const result = RSCProductionOptimizer.optimizePayload(payload);
      assertEquals(result.html, "<div><!-- comment -->text</div>");
    });

    it("preserves raw-text content that resembles inter-tag whitespace", () => {
      const html = '<script>const marker = "> <"; /* <!-- keep --> */</script>';
      const payload = makePayload({ html });
      const result = RSCProductionOptimizer.optimizePayload(payload);
      assertEquals(result.html, html);
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

    it("changes when client module targets or assets change", () => {
      const base = makePayload({
        clientRefs: { Button: "/button-v1.js" },
        assets: { css: ["/app.css"], js: ["/app.js"] },
      });
      const changedRef = makePayload({
        clientRefs: { Button: "/button-v2.js" },
        assets: base.assets,
      });
      const changedAsset = makePayload({
        clientRefs: base.clientRefs,
        assets: { css: ["/theme.css"], js: ["/app.js"] },
      });

      assertEquals(
        RSCProductionOptimizer.generateETag(base) !==
          RSCProductionOptimizer.generateETag(changedRef),
        true,
      );
      assertEquals(
        RSCProductionOptimizer.generateETag(base) !==
          RSCProductionOptimizer.generateETag(changedAsset),
        true,
      );
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

    it("matches lists and wildcard validators", () => {
      assertEquals(RSCProductionOptimizer.checkETag('"old", W/"abc"', '"abc"'), true);
      assertEquals(RSCProductionOptimizer.checkETag("*", '"abc"'), true);
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

    it("does not overwrite routes whose sanitized names collide", () => {
      const payloads = new Map<string, RSCPayload>([
        ["/a-b", makePayload({ html: "one" })],
        ["/a_b", makePayload({ html: "two" })],
      ]);

      const { bundles } = RSCProductionOptimizer.bundlePayloads(payloads);
      assertEquals(Object.keys(bundles).length, 2);
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

    it("escapes client module paths before embedding them in HTML", () => {
      const [link] = RSCProductionOptimizer.generatePreloadLinks({
        Unsafe: '/module.js" onload="alert(1)',
      });
      assertEquals(link?.includes('" onload="'), false);
      assertEquals(link?.includes("&quot;"), true);
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
