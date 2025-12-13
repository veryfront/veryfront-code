import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertStringIncludes } from "std/assert/mod.ts";
import * as React from "react";
import {
  renderToStringAdapter,
  renderToStaticMarkupAdapter,
} from "./string-renderer.ts";

describe("string-renderer", () => {
  describe("renderToStringAdapter", () => {
    it("should render a simple component to string", async () => {
      const element = React.createElement("div", { className: "test" }, "Hello World");
      const html = await renderToStringAdapter(element);

      assertEquals(typeof html, "string");
      assertStringIncludes(html, "Hello World");
      assertStringIncludes(html, "test");
    });

    it("should render nested components", async () => {
      const child = React.createElement("span", null, "Child");
      const element = React.createElement("div", null, child);
      const html = await renderToStringAdapter(element);

      assertEquals(typeof html, "string");
      assertStringIncludes(html, "Child");
      assertStringIncludes(html, "div");
      assertStringIncludes(html, "span");
    });

    it("should handle components with props", async () => {
      const element = React.createElement(
        "div",
        { id: "test-id", className: "test-class", "data-value": "test" },
        "Content",
      );
      const html = await renderToStringAdapter(element);

      assertStringIncludes(html, "test-id");
      assertStringIncludes(html, "test-class");
      assertStringIncludes(html, "test");
      assertStringIncludes(html, "Content");
    });

    it("should handle empty components", async () => {
      const element = React.createElement("div", null);
      const html = await renderToStringAdapter(element);

      assertEquals(typeof html, "string");
      assertStringIncludes(html, "div");
    });

    it("should handle text-only content", async () => {
      const element = React.createElement("p", null, "Plain text");
      const html = await renderToStringAdapter(element);

      assertStringIncludes(html, "Plain text");
    });

    it("should call onError callback on render failure", async () => {
      let errorCalled = false;
      let capturedError: Error | undefined;

      const BadComponent = () => {
        throw new Error("Render failed");
      };

      const element = React.createElement(BadComponent);

      try {
        await renderToStringAdapter(element, {
          onError: (error) => {
            errorCalled = true;
            capturedError = error;
          },
        });
      } catch {
        // Expected to throw
      }

      assertEquals(errorCalled, true);
      assertEquals(capturedError?.message, "Render failed");
    });

    it("should handle multiple children", async () => {
      const element = React.createElement(
        "div",
        null,
        React.createElement("span", null, "First"),
        React.createElement("span", null, "Second"),
      );
      const html = await renderToStringAdapter(element);

      assertStringIncludes(html, "First");
      assertStringIncludes(html, "Second");
    });
  });

  describe("renderToStaticMarkupAdapter", () => {
    it("should render a simple component to static markup", async () => {
      const element = React.createElement("div", { className: "test" }, "Hello World");
      const html = await renderToStaticMarkupAdapter(element);

      assertEquals(typeof html, "string");
      assertStringIncludes(html, "Hello World");
      assertStringIncludes(html, "test");
    });

    it("should render nested components", async () => {
      const child = React.createElement("span", null, "Child");
      const element = React.createElement("div", null, child);
      const html = await renderToStaticMarkupAdapter(element);

      assertEquals(typeof html, "string");
      assertStringIncludes(html, "Child");
    });

    it("should handle components with props", async () => {
      const element = React.createElement(
        "button",
        { type: "submit", className: "btn" },
        "Submit",
      );
      const html = await renderToStaticMarkupAdapter(element);

      assertStringIncludes(html, "submit");
      assertStringIncludes(html, "btn");
      assertStringIncludes(html, "Submit");
    });

    it("should call onError callback on render failure", async () => {
      let errorCalled = false;

      const BadComponent = () => {
        throw new Error("Render failed");
      };

      const element = React.createElement(BadComponent);

      try {
        await renderToStaticMarkupAdapter(element, {
          onError: () => {
            errorCalled = true;
          },
        });
      } catch {
        // Expected to throw
      }

      assertEquals(errorCalled, true);
    });

    it("should handle empty elements", async () => {
      const element = React.createElement("br");
      const html = await renderToStaticMarkupAdapter(element);

      assertEquals(typeof html, "string");
      assertStringIncludes(html, "br");
    });
  });
});
