import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateProdHydrationScript } from "./prod-hydration.ts";

describe("hydration-script-builder/prod-hydration", () => {
  describe("generateProdHydrationScript", () => {
    it("should return a module script tag", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes('<script type="module"'), true);
      assertEquals(result.includes("</script>"), true);
    });

    it("should include nonce attribute when provided", () => {
      const result = generateProdHydrationScript("index", undefined, undefined, "n1");
      assertEquals(result.includes('nonce="n1"'), true);
    });

    it("should not include nonce attribute when not provided", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("nonce="), false);
    });

    it("should import React", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("import * as React from 'react'"), true);
    });

    it("should import ReactDOM from react-dom/client", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("import * as ReactDOM from 'react-dom/client'"), true);
    });

    it("should include the page slug in the import path", () => {
      const result = generateProdHydrationScript("about");
      assertEquals(result.includes("@/pages/about"), true);
    });

    it("should include different slug in import path", () => {
      const result = generateProdHydrationScript("blog/post");
      assertEquals(result.includes("@/pages/blog/post"), true);
    });

    it("should use hydrateRoot for hydration", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("hydrateRoot"), true);
    });

    it("should use identifierPrefix 'vf'", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("identifierPrefix: 'vf'"), true);
    });

    it("should include onRecoverableError handler", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("onRecoverableError"), true);
    });

    it("should serialize empty props by default", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("{}"), true);
    });

    it("should serialize provided props", () => {
      const props = { title: "Hello", count: 42 };
      const result = generateProdHydrationScript("index", undefined, props);
      assertEquals(result.includes('"title":"Hello"'), true);
      assertEquals(result.includes('"count":42'), true);
    });

    it("should import App and Layout components", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("import { App } from '@/components/app'"), true);
      assertEquals(result.includes("import { Layout } from '@/components/layout'"), true);
    });

    it("should nest Page inside Layout inside App", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("React.createElement(App"), true);
      assertEquals(result.includes("React.createElement(Layout"), true);
      assertEquals(result.includes("React.createElement(Page"), true);
    });
  });
});
