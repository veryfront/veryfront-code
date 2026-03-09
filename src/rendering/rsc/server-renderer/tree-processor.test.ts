import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { renderChildren, renderTree } from "./tree-processor.ts";
import * as React from "react";
import type { ClientComponentMeta } from "../types.ts";

describe("rendering/rsc/server-renderer/tree-processor", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  describe("renderTree", () => {
    it("should return empty html node for null component", async () => {
      const result = await renderTree(null, {}, new Map(), new Map());
      assertEquals(result.type, "html");
      assertEquals((result as { html: string }).html, "");
    });

    it("should return empty html node for undefined component", async () => {
      const result = await renderTree(undefined, {}, new Map(), new Map());
      assertEquals(result.type, "html");
      assertEquals((result as { html: string }).html, "");
    });

    it("should return string html node for string component", async () => {
      const result = await renderTree("hello world" as any, {}, new Map(), new Map());
      assertEquals(result.type, "html");
      assertEquals((result as { html: string }).html, "hello world");
    });

    it("should return string html node for number component", async () => {
      const result = await renderTree(42 as any, {}, new Map(), new Map());
      assertEquals(result.type, "html");
      assertEquals((result as { html: string }).html, "42");
    });

    it("should handle a valid React element", async () => {
      const element = React.createElement("div", null, "test content");
      const result = await renderTree(
        element as any,
        {},
        new Map(),
        new Map(),
      );
      assertEquals(result.type, "html");
      assertEquals(
        (result as { html: string }).html.includes("test content"),
        true,
      );
    });

    it("should render a function component (server component)", async () => {
      function MyComponent(props: { message: string }) {
        return React.createElement("span", null, props.message);
      }

      const result = await renderTree(
        MyComponent,
        { message: "hello" },
        new Map(),
        new Map(),
      );

      assertEquals(result.type, "html");
      assertEquals(
        (result as { html: string }).html.includes("hello"),
        true,
      );
    });

    it("should render an async function component", async () => {
      async function AsyncComponent() {
        return React.createElement("p", null, "async result");
      }

      const result = await renderTree(
        AsyncComponent,
        {},
        new Map(),
        new Map(),
      );

      assertEquals(result.type, "html");
      assertEquals(
        (result as { html: string }).html.includes("async result"),
        true,
      );
    });

    it("should handle component returning null", async () => {
      function NullComponent() {
        return null;
      }

      const result = await renderTree(
        NullComponent,
        {},
        new Map(),
        new Map(),
      );

      assertEquals(result.type, "html");
      assertEquals((result as { html: string }).html, "");
    });

    it("should detect client components via manifest", async () => {
      function ClientComp() {
        return React.createElement("div", null, "client");
      }
      (ClientComp as any).__rsc_client = true;

      const clientManifest = new Map<string, ClientComponentMeta>();
      clientManifest.set("ClientComp", {
        id: "ClientComp",
        name: "ClientComp",
        exportName: "default",
        chunks: [],
      });

      const clientRefs = new Map<string, string>();
      const result = await renderTree(
        ClientComp,
        { foo: "bar" },
        clientManifest,
        clientRefs,
      );

      assertEquals(result.type, "client");
    });

    it("should handle React fragment elements", async () => {
      const element = React.createElement(
        React.Fragment,
        null,
        React.createElement("span", null, "a"),
        React.createElement("span", null, "b"),
      );

      const result = await renderTree(
        element as any,
        {},
        new Map(),
        new Map(),
      );

      assertEquals(result.type === "fragment" || result.type === "html", true);
    });
  });

  describe("renderChildren", () => {
    it("should return empty array for null children", async () => {
      const result = await renderChildren(null, new Map(), new Map());
      assertEquals(result, []);
    });

    it("should return empty array for undefined children", async () => {
      const result = await renderChildren(undefined, new Map(), new Map());
      assertEquals(result, []);
    });

    it("should handle string children", async () => {
      const result = await renderChildren("hello", new Map(), new Map());
      assertEquals(result.length, 1);
      assertEquals(result[0].type, "html");
      assertEquals((result[0] as { html: string }).html, "hello");
    });

    it("should handle number children", async () => {
      const result = await renderChildren(42, new Map(), new Map());
      assertEquals(result.length, 1);
      assertEquals((result[0] as { html: string }).html, "42");
    });

    it("should handle React element children", async () => {
      const children = React.createElement("div", null, "content");
      const result = await renderChildren(children, new Map(), new Map());
      assertEquals(result.length, 1);
      assertEquals(result[0].type, "html");
    });

    it("should handle array of children", async () => {
      const children = [
        React.createElement("span", { key: "1" }, "a"),
        React.createElement("span", { key: "2" }, "b"),
      ];
      const result = await renderChildren(children, new Map(), new Map());
      assertEquals(result.length, 2);
    });
  });
});
