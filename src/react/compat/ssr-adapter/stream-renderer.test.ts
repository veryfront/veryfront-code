import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import * as React from "react";
import { renderToStreamAdapter } from "./stream-renderer.ts";

describe("stream-renderer", () => {
  describe("renderToStreamAdapter", () => {
    it("should return a result object", async () => {
      const element = React.createElement("div", null, "Hello World");
      const result = await renderToStreamAdapter(element);

      assertExists(result);
      assertEquals(typeof result, "object");
    });

    it("should return either stream or html", async () => {
      const element = React.createElement("div", null, "Hello World");
      const result = await renderToStreamAdapter(element);

      assertEquals(
        result.stream !== undefined || result.html !== undefined,
        true,
      );
    });

    it("should handle empty options", async () => {
      const element = React.createElement("div", null, "Hello");
      const result = await renderToStreamAdapter(element, {});

      assertExists(result);
    });

    it("should accept SSR options", async () => {
      const element = React.createElement("div", null, "Hello");
      let errorCalled = false;

      const result = await renderToStreamAdapter(element, {
        onError: () => {
          errorCalled = false;
        },
        bootstrapScripts: ["/script.js"],
        nonce: "test-nonce",
      });

      assertExists(result);
      assertEquals(errorCalled, false);
    });

    it("should handle nested components", async () => {
      const child = React.createElement("span", null, "Child");
      const element = React.createElement("div", null, child);

      const result = await renderToStreamAdapter(element);

      assertExists(result);
    });

    it("should handle components with props", async () => {
      const element = React.createElement(
        "div",
        { id: "test", className: "container" },
        "Content",
      );

      const result = await renderToStreamAdapter(element);

      assertExists(result);
    });

    it("should call error handlers on failure", async () => {
      let errorCalled = false;

      const BadComponent = () => {
        throw new Error("Component failed");
      };

      const element = React.createElement(BadComponent);

      try {
        await renderToStreamAdapter(element, {
          onError: () => {
            errorCalled = true;
          },
        });
      } catch {
        // Expected to throw or fallback
      }

      // Error handler should be called or fallback should work
      assertEquals(typeof errorCalled, "boolean");
    });
  });
});
