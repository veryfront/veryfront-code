import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getDevScripts,
  getDevStyles,
  getPreviewStylesheetLink,
  getProdScripts,
  getStudioScripts,
} from "./dev-scripts.ts";
import { Z_INDEX_DEV_INDICATOR, Z_INDEX_ERROR_OVERLAY } from "#veryfront/utils/constants/html.ts";
import {
  MAX_STUDIO_CONFIG_ID_LENGTH,
  MAX_STUDIO_CONFIG_NONCE_LENGTH,
  MAX_STUDIO_CONFIG_PATH_LENGTH,
} from "#veryfront/studio/limits.ts";

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

    it("uses the shared development-layer z-index values", () => {
      const styles = getDevStyles();

      assertEquals(styles.includes(`z-index: ${Z_INDEX_DEV_INDICATOR};`), true);
      assertEquals(styles.includes(`z-index: ${Z_INDEX_ERROR_OVERLAY};`), true);
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
      assertEquals(scripts.includes('"nonce":"xyz"'), true);
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
        pagePath: "app/page.tsx",
      });
      assertEquals(scripts.includes("pagePath"), true);
      assertEquals(scripts.includes('"pagePath":"app/page.tsx"'), true);
    });

    it("does not execute bridge-option accessors", () => {
      let accessorCalls = 0;
      const options: Record<string, unknown> = { pageId: "pg" };
      Object.defineProperty(options, "projectId", {
        enumerable: true,
        get() {
          accessorCalls++;
          return "private";
        },
      });
      assertThrows(
        () => getStudioScripts(options as never),
        TypeError,
        "Studio script options must not contain accessor properties",
      );
      assertEquals(accessorCalls, 0);
    });

    it("rejects retired collaboration options instead of emitting no-op config", () => {
      for (
        const options of [
          { wsUrl: "wss://studio.example.test/sync" },
          { yjsGuid: "project:page" },
        ]
      ) {
        assertThrows(
          () => getStudioScripts({ projectId: "p", pageId: "pg", ...options }),
          Error,
          "not supported",
        );
      }
    });

    it("rejects oversized bridge identifiers", () => {
      assertThrows(
        () =>
          getStudioScripts({
            projectId: "p".repeat(MAX_STUDIO_CONFIG_ID_LENGTH + 1),
            pageId: "pg",
          }),
        Error,
        "project ID",
      );
    });

    it("uses the same JavaScript string bounds as the browser bridge", () => {
      const boundedIdentifier = "é".repeat(MAX_STUDIO_CONFIG_ID_LENGTH);
      const boundedPath = "é".repeat(MAX_STUDIO_CONFIG_PATH_LENGTH);
      const boundedNonce = "n".repeat(MAX_STUDIO_CONFIG_NONCE_LENGTH);

      const scripts = getStudioScripts({
        projectId: boundedIdentifier,
        pageId: boundedIdentifier,
        pagePath: boundedPath,
        nonce: boundedNonce,
      });

      assertEquals(scripts.includes("studio-bridge.js"), true);
      assertThrows(
        () =>
          getStudioScripts({
            projectId: "p",
            pageId: "pg",
            nonce: `${boundedNonce}n`,
          }),
        Error,
        "CSP nonce",
      );
    });

    it("allows the empty identifier defaults accepted by bridge initialization", () => {
      const scripts = getStudioScripts({ projectId: "", pageId: "" });

      assertEquals(scripts.includes('"projectId":""'), true);
      assertEquals(scripts.includes('"pageId":""'), true);
    });

    it("derives only a bridge-safe page identifier from the source path", () => {
      const shortPathScripts = getStudioScripts({
        projectId: "project",
        pagePath: "docs/readme.md",
      });
      const longPath = `${"a".repeat(MAX_STUDIO_CONFIG_ID_LENGTH + 1)}.md`;
      const longPathScripts = getStudioScripts({ projectId: "project", pagePath: longPath });

      assertEquals(shortPathScripts.includes('"pageId":"docs/readme.md"'), true);
      assertEquals(longPathScripts.includes('"pageId":""'), true);
      assertEquals(longPathScripts.includes(`"pagePath":"${longPath}"`), true);
    });
  });
});
