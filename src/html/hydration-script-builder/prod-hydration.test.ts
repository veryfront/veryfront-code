import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { generateProdHydrationScript } from "./prod-hydration.ts";

describe("prod-hydration", () => {
  describe("generateProdHydrationScript", () => {
    it("should generate script without nonce", () => {
      const script = generateProdHydrationScript("test-page");

      assert(script.includes('<script type="module">'));
      assert(!script.includes('nonce="'));
      assert(script.includes("</script>"));
    });

    it("should generate script with nonce", () => {
      const nonce = "test-nonce";
      const script = generateProdHydrationScript("test-page", undefined, undefined, nonce);

      assert(script.includes(`<script type="module" nonce="${nonce}">`));
    });

    it("should import React and ReactDOM", () => {
      const script = generateProdHydrationScript("test-page");

      assert(script.includes("import * as React from 'react'"));
      assert(script.includes("import * as ReactDOM from 'react-dom/client'"));
    });

    it("should import App, Layout, and Page components", () => {
      const script = generateProdHydrationScript("my-page");

      assert(script.includes("import { App } from '@/components/app'"));
      assert(script.includes("import { Layout } from '@/components/layout'"));
      assert(script.includes("import { Page } from '@/pages/my-page'"));
    });

    it("should use correct page slug in import", () => {
      const script = generateProdHydrationScript("products/list");

      assert(script.includes("import { Page } from '@/pages/products/list'"));
    });

    it("should create React element tree", () => {
      const script = generateProdHydrationScript("test-page");

      assert(script.includes("React.createElement(App"));
      assert(script.includes("React.createElement(Layout"));
      assert(script.includes("React.createElement(Page"));
    });

    it("should pass empty props when no props provided", () => {
      const script = generateProdHydrationScript("test-page");

      assert(script.includes("React.createElement(Page, {})"));
    });

    it("should pass props as JSON", () => {
      const props = { title: "Test", count: 42 };
      const script = generateProdHydrationScript("test-page", undefined, props);

      assert(script.includes(JSON.stringify(props)));
    });

    it("should use hydrateRoot", () => {
      const script = generateProdHydrationScript("test-page");

      assert(script.includes("ReactDOM.hydrateRoot(root, tree)"));
    });

    it("should get root element by ID", () => {
      const script = generateProdHydrationScript("test-page");

      assert(script.includes("document.getElementById('root')"));
      assert(script.includes("if (root)"));
    });

    it("should handle complex props", () => {
      const props = {
        nested: { value: 123 },
        array: [1, 2, 3],
      };
      const script = generateProdHydrationScript("test-page", undefined, props);

      assert(script.includes(JSON.stringify(props)));
    });
  });
});
