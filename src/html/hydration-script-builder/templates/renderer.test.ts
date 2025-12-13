import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { getRendererScript } from "./renderer.ts";

describe("renderer template", () => {
  describe("getRendererScript", () => {
    it("should return renderer script string", () => {
      const script = getRendererScript();

      assert(typeof script === "string");
      assert(script.length > 0);
    });

    it("should define renderPage function", () => {
      const script = getRendererScript();

      assert(script.includes("async function renderPage(pathname)"));
    });

    it("should get hydration data from script tag", () => {
      const script = getRendererScript();

      assert(script.includes("getElementById('veryfront-hydration-data')"));
    });

    it("should parse JSON hydration data", () => {
      const script = getRendererScript();

      assert(script.includes("JSON.parse"));
    });

    it("should use pagePath from hydration data", () => {
      const script = getRendererScript();

      assert(script.includes("data.pagePath"));
    });

    it("should fallback to Pages Router pattern", () => {
      const script = getRendererScript();

      assert(script.includes("Fallback to old Pages Router"));
    });

    it("should load layouts", () => {
      const script = getRendererScript();

      assert(script.includes("data.layouts"));
      assert(script.includes("loadComponent"));
    });

    it("should load app component", () => {
      const script = getRendererScript();

      assert(script.includes("data.appPath"));
      assert(script.includes("AppComponent"));
    });

    it("should create React element tree", () => {
      const script = getRendererScript();

      assert(script.includes("React.createElement"));
    });

    it("should render with RouterProvider", () => {
      const script = getRendererScript();

      assert(script.includes("RouterProvider"));
    });

    it("should mount to veryfront-content", () => {
      const script = getRendererScript();

      assert(script.includes("getElementById('veryfront-content')"));
    });

    it("should call renderPage on load", () => {
      const script = getRendererScript();

      assert(script.includes("renderPage(window.location.pathname)"));
    });

    it("should listen to popstate events", () => {
      const script = getRendererScript();

      assert(script.includes("addEventListener('popstate'"));
    });

    it("should handle errors", () => {
      const script = getRendererScript();

      assert(script.includes("catch (error)"));
      assert(script.includes("console.error"));
    });
  });
});
