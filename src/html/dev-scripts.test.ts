import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getDevScripts,
  getDevStyles,
  getPreviewStylesheetLink,
  getProdScripts,
  getStudioScripts,
} from "./dev-scripts.ts";

describe("html/dev-scripts", () => {
  describe("getPreviewStylesheetLink", () => {
    it("returns the preview utility stylesheet link", () => {
      const link = getPreviewStylesheetLink();
      assertEquals(link.includes('id="vf-project-css"'), true);
      assertEquals(link.includes('/_vf_styles/styles.css"'), true);
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
      assertEquals(scripts.includes('"projectId":"proj1"'), true);
      assertEquals(scripts.includes('"pageId":"page1"'), true);
      assertEquals(scripts.includes("studio-bridge.js"), true);
    });

    it("should include nonce when provided", () => {
      const scripts = getStudioScripts({
        projectId: "p",
        pageId: "pg",
        nonce: "xyz",
      });
      assertEquals(scripts.includes('nonce="xyz"'), true);
    });

    it("should escape nonce when provided", () => {
      const scripts = getStudioScripts({
        projectId: "p",
        pageId: "pg",
        nonce: '"x<y>"',
      });
      assertEquals(scripts.includes('nonce="&quot;x&lt;y&gt;&quot;"'), true);
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
      assertEquals(
        scripts.includes('"pagePath":"/app/page.tsx"'),
        true,
        "the supplied pagePath must be the value published to the bridge",
      );
    });

    it("should fall back to pageId when pagePath is omitted", () => {
      const scripts = getStudioScripts({ projectId: "p", pageId: "pg" });
      assertEquals(
        scripts.includes('"pagePath":"pg"'),
        true,
        "pagePath must fall back to pageId",
      );
    });

    it("should escape angle brackets in the inline bridge config", () => {
      const hostile = "</script><script>alert(1)</script>";
      const scripts = getStudioScripts({
        projectId: hostile,
        pageId: "pg",
        pagePath: hostile,
      });
      assertEquals(
        scripts.includes("<script>alert(1)</script>"),
        false,
        "inline bridge JSON must not close the script element",
      );
      assertEquals(
        scripts.includes("\\u003c/script"),
        true,
        "< in bridge config must be escaped as \\u003c",
      );
    });

    it("should escape angle brackets in the sourceHash script", () => {
      const hostile = "</script><script>alert(1)</script>";
      const scripts = getStudioScripts({
        projectId: "p",
        pageId: "pg",
        sourceHash: hostile,
      });
      assertEquals(
        scripts.includes("<script>alert(1)</script>"),
        false,
        "the sourceHash literal must not close the script element",
      );
      assertEquals(
        scripts.includes("\\u003c/script"),
        true,
        "< in the sourceHash literal must be escaped as \\u003c",
      );
    });
  });
});
