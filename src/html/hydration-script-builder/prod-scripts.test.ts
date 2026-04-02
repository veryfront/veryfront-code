import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateProdHydrationModule,
  getProdScripts,
  PROD_HYDRATION_MODULE_PATH,
} from "./prod-scripts.ts";

describe("hydration-script-builder/prod-scripts", () => {
  describe("getProdScripts", () => {
    it("should return an external module script tag", () => {
      const result = getProdScripts("my-page");
      assertEquals(
        result.includes(`<script type="module" src="${PROD_HYDRATION_MODULE_PATH}"`),
        true,
      );
      assertEquals(result.includes("</script>"), true);
      assertEquals(result.includes("renderPage"), false);
    });

    it("should include nonce attribute when provided", () => {
      const result = getProdScripts("page", undefined, undefined, "nonce-abc");
      assertEquals(result.includes('nonce="nonce-abc"'), true);
    });

    it("should not include nonce attribute when not provided", () => {
      const result = getProdScripts("page");
      assertEquals(result.includes("nonce="), false);
    });
  });

  describe("generateProdHydrationModule", () => {
    it("should import React", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes("import * as React from 'react'"), true);
    });

    it("should import RouterProvider from veryfront/router", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes("from 'veryfront/router'"), true);
    });

    it("should import PageContextProvider from veryfront/context", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes("from 'veryfront/context'"), true);
    });

    it("should include router script content", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes("MODULE_SERVER_URL"), true);
    });

    it("should include loader script content", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes("loadComponent"), true);
    });

    it("should include renderer script content", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes("renderPage"), true);
    });
  });
});
