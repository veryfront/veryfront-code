import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDevScripts, getDevStyles, getProdScripts, getStudioScripts } from "./dev-scripts.ts";

describe("html/dev-scripts", () => {
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
  });

  describe("getProdScripts", () => {
    it("should return script tags with slug", () => {
      const scripts = getProdScripts("my-project");
      assertEquals(scripts.includes("rsc/client.js"), true);
      assertEquals(scripts.includes("hydrate.js"), true);
      assertEquals(scripts.includes("my-project"), true);
    });

    it("should encode slug in URL", () => {
      const scripts = getProdScripts("hello world");
      assertEquals(scripts.includes("hello%20world"), true);
    });

    it("should include nonce when provided", () => {
      const scripts = getProdScripts("slug", "n1");
      assertEquals(scripts.includes('nonce="n1"'), true);
    });
  });

  describe("getStudioScripts", () => {
    it("should include projectId and pageId", () => {
      const scripts = getStudioScripts({
        projectId: "proj1",
        pageId: "page1",
      });
      assertEquals(scripts.includes("projectId=proj1"), true);
      assertEquals(scripts.includes("pageId=page1"), true);
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
      assertEquals(scripts.includes("pagePath"), true);
    });
  });
});
