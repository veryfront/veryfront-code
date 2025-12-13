import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import { getDevStyles, getDevScripts, getProdScripts } from "./dev-scripts.ts";

describe("dev-scripts", () => {
  describe("getDevStyles", () => {
    it("should return dev styles without nonce", () => {
      const styles = getDevStyles();
      assert(styles.includes("<style>"));
      assert(styles.includes(".dev-indicator"));
      assert(styles.includes("#veryfront-error-overlay"));
      assert(!styles.includes('nonce="'));
    });

    it("should return dev styles with nonce attribute", () => {
      const nonce = "test-nonce-123";
      const styles = getDevStyles(nonce);
      assert(styles.includes(`<style nonce="${nonce}">`));
      assert(styles.includes(".dev-indicator"));
      assert(styles.includes("#veryfront-error-overlay"));
    });

    it("should include proper CSS properties for dev indicator", () => {
      const styles = getDevStyles();
      assert(styles.includes("position: fixed"));
      assert(styles.includes("z-index: 9999"));
      assert(styles.includes("background: #3b82f6"));
    });

    it("should include proper CSS properties for error overlay", () => {
      const styles = getDevStyles();
      assert(styles.includes("z-index: 999999"));
      assert(styles.includes("background: rgba(0,0,0,0.85)"));
    });
  });

  describe("getDevScripts", () => {
    it("should return dev scripts with default port", () => {
      const scripts = getDevScripts();
      assert(scripts.includes('<script type="module"'));
      assert(scripts.includes('src="/_veryfront/rsc/client.js"'));
      assert(scripts.includes('src="/_veryfront/hmr.js?port='));
      assert(!scripts.includes('nonce="'));
    });

    it("should return dev scripts with custom port", () => {
      const port = 5555;
      const scripts = getDevScripts(port);
      assert(scripts.includes(`src="/_veryfront/hmr.js?port=${port}"`));
    });

    it("should return dev scripts with nonce attribute", () => {
      const nonce = "test-nonce-456";
      const scripts = getDevScripts(undefined, nonce);
      assert(scripts.includes(`nonce="${nonce}"`));
      const nonceCount = (scripts.match(/nonce="/g) || []).length;
      assertEquals(nonceCount, 2, "Should have nonce on both script tags");
    });

    it("should return dev scripts with custom port and nonce", () => {
      const port = 7777;
      const nonce = "custom-nonce";
      const scripts = getDevScripts(port, nonce);
      assert(scripts.includes(`src="/_veryfront/hmr.js?port=${port}"`));
      assert(scripts.includes(`nonce="${nonce}"`));
    });
  });

  describe("getProdScripts", () => {
    it("should return production scripts with slug", () => {
      const slug = "test-page";
      const scripts = getProdScripts(slug);
      assert(scripts.includes('<script type="module"'));
      assert(scripts.includes('src="/_veryfront/rsc/client.js"'));
      assert(scripts.includes(`src="/_veryfront/hydrate.js?slug=${slug}"`));
      assert(!scripts.includes('nonce="'));
    });

    it("should URL encode the slug parameter", () => {
      const slug = "test/page with spaces";
      const scripts = getProdScripts(slug);
      const encodedSlug = encodeURIComponent(slug);
      assert(scripts.includes(`src="/_veryfront/hydrate.js?slug=${encodedSlug}"`));
    });

    it("should return production scripts with nonce attribute", () => {
      const slug = "test-page";
      const nonce = "prod-nonce-789";
      const scripts = getProdScripts(slug, nonce);
      assert(scripts.includes(`nonce="${nonce}"`));
      const nonceCount = (scripts.match(/nonce="/g) || []).length;
      assertEquals(nonceCount, 2, "Should have nonce on both script tags");
    });

    it("should handle special characters in slug", () => {
      const slug = "test@page#123";
      const scripts = getProdScripts(slug);
      const encodedSlug = encodeURIComponent(slug);
      assert(scripts.includes(encodedSlug));
    });

    it("should handle empty slug", () => {
      const slug = "";
      const scripts = getProdScripts(slug);
      assert(scripts.includes('src="/_veryfront/hydrate.js?slug="'));
    });
  });
});
