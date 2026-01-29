import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateDevClientRendererScript } from "./dev-client-renderer.ts";

describe("hydration-script-builder/dev-client-renderer", () => {
  describe("generateDevClientRendererScript", () => {
    it("should return a module script tag", () => {
      const result = generateDevClientRendererScript();
      assertEquals(result.includes('<script type="module"'), true);
      assertEquals(result.includes("</script>"), true);
    });

    it("should include nonce attribute when provided", () => {
      const result = generateDevClientRendererScript("my-nonce");
      assertEquals(result.includes('nonce="my-nonce"'), true);
    });

    it("should not include nonce attribute when not provided", () => {
      const result = generateDevClientRendererScript();
      assertEquals(result.includes("nonce="), false);
    });

    it("should import React", () => {
      const result = generateDevClientRendererScript();
      assertEquals(result.includes("import * as React from 'react'"), true);
    });

    it("should import createRoot from react-dom/client", () => {
      const result = generateDevClientRendererScript();
      assertEquals(result.includes("import { createRoot } from 'react-dom/client'"), true);
    });

    it("should import RouterProvider from veryfront/router", () => {
      const result = generateDevClientRendererScript();
      assertEquals(result.includes("from 'veryfront/router'"), true);
    });

    it("should import PageContextProvider from veryfront/context", () => {
      const result = generateDevClientRendererScript();
      assertEquals(result.includes("from 'veryfront/context'"), true);
    });
  });
});
