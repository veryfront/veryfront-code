import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getProdScripts } from "./prod-scripts.ts";

describe("hydration-script-builder/prod-scripts", () => {
  describe("getProdScripts", () => {
    it("should return a module script tag", () => {
      const result = getProdScripts("my-page");
      assertEquals(result.includes('<script type="module"'), true);
      assertEquals(result.includes("</script>"), true);
    });

    it("should include nonce attribute when provided", () => {
      const result = getProdScripts("page", undefined, undefined, "nonce-abc");
      assertEquals(result.includes('nonce="nonce-abc"'), true);
    });

    it("should not include nonce attribute when not provided", () => {
      const result = getProdScripts("page");
      assertEquals(result.includes("nonce="), false);
    });

    it("should import React", () => {
      const result = getProdScripts("page");
      assertEquals(result.includes("import * as React from 'react'"), true);
    });

    it("should import RouterProvider from veryfront/router", () => {
      const result = getProdScripts("page");
      assertEquals(result.includes("from 'veryfront/router'"), true);
    });

    it("should import PageContextProvider from veryfront/context", () => {
      const result = getProdScripts("page");
      assertEquals(result.includes("from 'veryfront/context'"), true);
    });

    it("should include router script content", () => {
      const result = getProdScripts("page");
      assertEquals(result.includes("MODULE_SERVER_URL"), true);
    });

    it("should include loader script content", () => {
      const result = getProdScripts("page");
      assertEquals(result.includes("loadComponent"), true);
    });

    it("should include renderer script content", () => {
      const result = getProdScripts("page");
      assertEquals(result.includes("renderPage"), true);
    });
  });
});
