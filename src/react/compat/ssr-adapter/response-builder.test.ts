import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assertStringIncludes } from "std/assert/mod.ts";
import * as React from "react";
import { createSSRResponse } from "./response-builder.ts";

describe("response-builder", () => {
  describe("createSSRResponse", () => {
    it("should create a Response object", async () => {
      const element = React.createElement("div", null, "Hello World");
      const response = await createSSRResponse(element);

      assertExists(response);
      assertEquals(response instanceof Response, true);
    });

    it("should set correct content type", async () => {
      const element = React.createElement("div", null, "Hello");
      const response = await createSSRResponse(element);

      const contentType = response.headers.get("Content-Type");
      assertExists(contentType);
      assertStringIncludes(contentType, "text/html");
    });

    it("should set security headers", async () => {
      const element = React.createElement("div", null, "Hello");
      const response = await createSSRResponse(element);

      assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
      assertExists(response.headers.get("X-React-Version"));
    });

    it("should return 200 status for successful render", async () => {
      const element = React.createElement("div", null, "Hello");
      const response = await createSSRResponse(element);

      assertEquals(response.status, 200);
    });

    it("should accept custom headers", async () => {
      const element = React.createElement("div", null, "Hello");
      const customHeaders = new Headers({ "X-Custom": "value" });
      const response = await createSSRResponse(element, {
        headers: customHeaders,
      });

      assertEquals(response.headers.get("X-Custom"), "value");
    });

    it("should handle title option", async () => {
      const element = React.createElement("div", null, "Hello");
      const response = await createSSRResponse(element, {
        title: "Test Page",
      });

      assertExists(response);
      assertEquals(response.status, 200);
    });

    it("should handle meta option", async () => {
      const element = React.createElement("div", null, "Hello");
      const response = await createSSRResponse(element, {
        meta: { description: "Test" },
      });

      assertExists(response);
    });

    it("should handle scripts option", async () => {
      const element = React.createElement("div", null, "Hello");
      const response = await createSSRResponse(element, {
        scripts: [{ src: "/app.js" }],
      });

      assertExists(response);
    });

    it("should handle bootstrapScripts option", async () => {
      const element = React.createElement("div", null, "Hello");
      const response = await createSSRResponse(element, {
        bootstrapScripts: ["/bootstrap.js"],
      });

      assertExists(response);
    });

    it("should handle nonce option", async () => {
      const element = React.createElement("div", null, "Hello");
      const response = await createSSRResponse(element, {
        nonce: "test-nonce-123",
      });

      assertExists(response);
    });

    it("should render nested components", async () => {
      const child = React.createElement("span", null, "Child");
      const element = React.createElement("div", null, child);
      const response = await createSSRResponse(element);

      assertEquals(response.status, 200);
    });

    it("should handle empty options", async () => {
      const element = React.createElement("div", null, "Hello");
      const response = await createSSRResponse(element, {});

      assertExists(response);
      assertEquals(response.status, 200);
    });

    it("should return response with body", async () => {
      const element = React.createElement("div", null, "Hello");
      const response = await createSSRResponse(element);

      assertExists(response.body);
    });
  });
});
