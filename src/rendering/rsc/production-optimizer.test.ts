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
      const payload = makePayload({ html: "<div><!-- comment -->text</div>" });
      const result = RSCProductionOptimizer.optimizePayload(payload);
      assertEquals(result.html.includes("<!--"), false);
    });

    it("preserves comment-like text in raw-text elements and attributes", () => {
      const payload = makePayload({
        html: `<p>İ</p>` +
          `<div data-marker="<!--attribute-->"><!-- remove --></div>` +
          `<script>globalThis.marker = "<!--script-->";</script>` +
          `<script/>globalThis.legacy = "<!--self-closing-script-->";</script>` +
          `<style>.marker::after { content: "<!--style-->"; }</style>` +
          `<textarea><!--textarea--></textarea>` +
          `<title><!--title--></title>`,
      });

      assertEquals(
        RSCProductionOptimizer.optimizePayload(payload).html,
        `<p>İ</p>` +
          `<div data-marker="<!--attribute-->"></div>` +
          `<script>globalThis.marker = "<!--script-->";</script>` +
          `<script/>globalThis.legacy = "<!--self-closing-script-->";</script>` +
          `<style>.marker::after { content: "<!--style-->"; }</style>` +
          `<textarea><!--textarea--></textarea>` +
          `<title><!--title--></title>`,
      );
    });

    it("preserves visible whitespace between inline elements", () => {
      const payload = makePayload({ html: "<span>hello</span> <span>world</span>" });
      const result = RSCProductionOptimizer.optimizePayload(payload);
      assertEquals(result.html, "<span>hello</span> <span>world</span>");
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

    it("returns metadata snapshots that do not alias the source payload", () => {
      const payload = makePayload({
        clientRefs: { Button: "/button-v1.js" },
        assets: { css: ["/app-v1.css"], js: ["/app-v1.js"] },
      });
      const result = RSCProductionOptimizer.optimizePayload(payload);

      payload.clientRefs.Button = "/button-v2.js";
      payload.assets?.css?.push("/app-v2.css");
      payload.assets?.js?.push("/app-v2.js");

      assertEquals(result.clientRefs, { Button: "/button-v1.js" });
      assertEquals(result.assets, { css: ["/app-v1.css"], js: ["/app-v1.js"] });
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

    it("fails closed to no-cache for invalid max-age values", () => {
      for (const maxAge of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
        const headers = RSCProductionOptimizer.getCacheHeaders({ isStatic: true, maxAge });
        assertEquals(headers["Cache-Control"], "no-cache, no-store, must-revalidate");
      }
    });
  });

  describe("generateETag", () => {
    it("should return a quoted 64-bit base36 string", () => {
      const etag = RSCProductionOptimizer.generateETag(makePayload());
      assertEquals(/^"[0-9a-z]{12,13}"$/.test(etag), true);
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

    it("changes when client module URLs or assets change", () => {
      const baseline = makePayload({
        clientRefs: { Button: "/button-v1.js" },
        assets: { css: ["/app-v1.css"], js: ["/app-v1.js"] },
      });
      const changedRef = makePayload({
        clientRefs: { Button: "/button-v2.js" },
        assets: baseline.assets,
      });
      const changedAssets = makePayload({
        clientRefs: baseline.clientRefs,
        assets: { css: ["/app-v2.css"], js: ["/app-v2.js"] },
      });

      assertEquals(
        RSCProductionOptimizer.generateETag(baseline) !==
          RSCProductionOptimizer.generateETag(changedRef),
        true,
      );
      assertEquals(
        RSCProductionOptimizer.generateETag(baseline) !==
          RSCProductionOptimizer.generateETag(changedAssets),
        true,
      );
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

    it("matches wildcard and comma-separated validators", () => {
      assertEquals(RSCProductionOptimizer.checkETag("*", '"abc"'), true);
      assertEquals(
        RSCProductionOptimizer.checkETag('"old", W/"abc", "other"', '"abc"'),
        true,
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
        ["/", makePayload({ clientRefs: { App: "/app.js" } })],
      ]);
      const { bundles, manifest } = RSCProductionOptimizer.bundlePayloads(payloads);
      assertEquals("_" in bundles, true);
      assertEquals(manifest["/"], ["App"]);
    });

    it("does not overwrite bundles whose route slugs sanitize identically", () => {
      const payloads = new Map<string, RSCPayload>([
        ["/a-b", makePayload({ html: "<div>hyphen</div>" })],
        ["/a_b", makePayload({ html: "<div>underscore</div>" })],
      ]);

      const { bundles, manifest } = RSCProductionOptimizer.bundlePayloads(payloads);

      assertEquals(Object.keys(bundles).length, 2);
      assertEquals(Object.keys(manifest).sort(), ["/a-b", "/a_b"]);
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

    it("escapes module URLs before emitting HTML attributes", () => {
      const [link] = RSCProductionOptimizer.generatePreloadLinks({
        Unsafe: '/module.js" onload="alert(1)',
      });

      assertExists(link);
      assertEquals(link.includes('" onload="'), false);
      assertEquals(link.includes("&quot;"), true);
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
