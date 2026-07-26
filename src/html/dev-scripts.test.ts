import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getDevScripts,
  getDevStyles,
  getPreviewStylesheetLink,
  getProdScripts,
  getStudioScripts,
} from "./dev-scripts.ts";

function extractBridgeConfig(scripts: string): Record<string, unknown> {
  const match = scripts.match(/window\.__VF_BRIDGE_CONFIG__=(\{.*?\});<\/script>/);
  assertExists(match?.[1], "expected Studio bridge config script");
  return JSON.parse(match[1]);
}

describe("html/dev-scripts", () => {
  describe("getPreviewStylesheetLink", () => {
    it("returns the preview utility stylesheet link", () => {
      const link = getPreviewStylesheetLink();
      assertEquals(link.includes('id="vf-tailwind-css"'), true);
      assertEquals(link.includes("/_vf_styles/styles.css?t="), true);
    });
  });

  describe("getDevStyles", () => {
    it("should return style tag", () => {
      const styles = getDevStyles();
      assertEquals(styles.includes("<style"), true);
      assertEquals(styles.includes("dev-indicator"), true);
    });

    it("should include nonce when provided", () => {
      const styles = getDevStyles("abc123");
      assertEquals(styles.includes('nonce="abc123"'), true);
    });

    it("should escape nonce when provided", () => {
      const styles = getDevStyles('"abc<123>');
      assertEquals(styles.includes('nonce="&quot;abc&lt;123&gt;"'), true);
    });
  });

  describe("getDevScripts", () => {
    it("should return script tags for dev", () => {
      const scripts = getDevScripts();
      assertEquals(scripts.includes("rsc/client.js"), true);
      assertEquals(scripts.includes("hmr.js"), true);
    });

    it("should include nonce when provided", () => {
      const scripts = getDevScripts(undefined, "nonce123");
      assertEquals(scripts.includes('nonce="nonce123"'), true);
    });

    it("should escape nonce when provided", () => {
      const scripts = getDevScripts(undefined, '"nonce<123>');
      assertEquals(scripts.includes('nonce="&quot;nonce&lt;123&gt;"'), true);
    });
  });

  describe("getProdScripts", () => {
    it("should return only the canonical RSC client script", () => {
      const scripts = getProdScripts("my-project");
      assertEquals(scripts.includes("rsc/client.js"), true);
      assertEquals(scripts.includes("hydrate.js"), false);
      assertEquals(scripts.includes("my-project"), false);
    });

    it("should not encode slug into a legacy hydration URL", () => {
      const scripts = getProdScripts("hello world");
      assertEquals(scripts.includes("hello%20world"), false);
    });

    it("should include nonce when provided", () => {
      const scripts = getProdScripts("slug", "n1");
      assertEquals(scripts.includes('nonce="n1"'), true);
    });

    it("should escape nonce when provided", () => {
      const scripts = getProdScripts("slug", '"n<1>');
      assertEquals(scripts.includes('nonce="&quot;n&lt;1&gt;"'), true);
    });
  });

  describe("getStudioScripts", () => {
    it("should include projectId and pageId", () => {
      const scripts = getStudioScripts({ projectId: "proj1", pageId: "page1" });
      assertEquals(extractBridgeConfig(scripts), {
        projectId: "proj1",
        pageId: "page1",
        pagePath: "page1",
      });
      assertEquals(scripts.includes("studio-bridge.js"), true);
    });

    it("should include nonce in both markup and runtime config", () => {
      const scripts = getStudioScripts({
        projectId: "p",
        pageId: "pg",
        nonce: "xyz",
      });
      assertEquals(scripts.includes('nonce="xyz"'), true);
      assertEquals(extractBridgeConfig(scripts).nonce, "xyz");
    });

    it("should encode nonce independently for HTML and inline JavaScript", () => {
      const scripts = getStudioScripts({
        projectId: "p",
        pageId: "pg",
        nonce: '"x</script><y>"',
      });
      assertEquals(
        scripts.includes('nonce="&quot;x&lt;/script&gt;&lt;y&gt;&quot;"'),
        true,
      );
      assertEquals(extractBridgeConfig(scripts).nonce, '"x</script><y>"');
      assertEquals(
        scripts.includes(
          'window.__VF_BRIDGE_CONFIG__={"projectId":"p","pageId":"pg","pagePath":"pg","nonce":"\\"x</script>',
        ),
        false,
      );
    });

    it("should include sourceHash script when provided", () => {
      const scripts = getStudioScripts({
        projectId: "p",
        pageId: "pg",
        sourceHash: "abc123",
      });
      assertEquals(scripts.includes("__VERYFRONT_SOURCE_HASH__"), true);
      assertEquals(scripts.includes("abc123"), true);
    });

    it("should include pagePath when provided", () => {
      const scripts = getStudioScripts({
        projectId: "p",
        pageId: "pg",
        pagePath: "/app/page.tsx",
      });
      assertEquals(extractBridgeConfig(scripts).pagePath, "/app/page.tsx");
    });

    it("does not emit retired direct-Yjs config fields", () => {
      const scripts = getStudioScripts({
        projectId: "p",
        pageId: "pg",
        wsUrl: "wss://example.test/socket",
        yjsGuid: "room-1",
      });
      const config = extractBridgeConfig(scripts);

      assertEquals(Object.hasOwn(config, "wsUrl"), false);
      assertEquals(Object.hasOwn(config, "yjsGuid"), false);
    });
  });
});
