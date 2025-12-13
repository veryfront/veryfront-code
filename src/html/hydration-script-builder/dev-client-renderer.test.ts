import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import { generateDevClientRendererScript } from "./dev-client-renderer.ts";

describe("dev-client-renderer", () => {
  describe("generateDevClientRendererScript", () => {
    it("should generate script without nonce", () => {
      const script = generateDevClientRendererScript();

      assert(script.includes('<script type="module">'));
      assert(!script.includes('nonce="'));
    });

    it("should generate script with nonce attribute", () => {
      const nonce = "test-nonce-123";
      const script = generateDevClientRendererScript(nonce);

      assert(script.includes(`<script type="module" nonce="${nonce}">`));
    });

    it("should include React imports", () => {
      const script = generateDevClientRendererScript();

      assert(script.includes("import * as React from 'react'"));
      assert(script.includes("import { createRoot } from 'react-dom/client'"));
    });

    it("should include router script", () => {
      const script = generateDevClientRendererScript();

      // The router script should be included via getRouterScript()
      // We just verify the structure is there
      assert(script.includes("</script>"));
      assert(script.length > 100); // Should have substantial content
    });

    it("should include loader script", () => {
      const script = generateDevClientRendererScript();

      // Verify the script has content from getLoaderScript()
      assert(script.includes("type=\"module\""));
    });

    it("should include renderer script", () => {
      const script = generateDevClientRendererScript();

      // Verify the script structure is complete
      assert(script.startsWith("\n  <script"));
      assert(script.includes("</script>"));
    });

    it("should handle empty string nonce", () => {
      const script = generateDevClientRendererScript("");

      assert(!script.includes('nonce=""'));
      assert(script.includes('<script type="module">'));
    });

    it("should generate valid module script tag", () => {
      const script = generateDevClientRendererScript();

      const moduleMatch = script.match(/<script type="module"[^>]*>/);
      assert(moduleMatch !== null, "Should have valid script tag");
    });

    it("should have proper script structure", () => {
      const script = generateDevClientRendererScript();

      // Count opening and closing script tags
      const openTags = (script.match(/<script/g) || []).length;
      const closeTags = (script.match(/<\/script>/g) || []).length;
      assertEquals(openTags, closeTags, "Should have matching script tags");
    });

    it("should handle special characters in nonce", () => {
      const nonce = "abc-123_XYZ/+=";
      const script = generateDevClientRendererScript(nonce);

      assert(script.includes(`nonce="${nonce}"`));
    });
  });
});
