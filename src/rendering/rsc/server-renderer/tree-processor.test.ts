import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/react/compat/ssr-adapter/test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { renderChildren, renderTree } from "./tree-processor.ts";
import { treeToHTML } from "./html-generator.ts";
import * as React from "react";
import type { ClientComponentMeta, RSCNode } from "../types.ts";

describe("rendering/rsc/server-renderer/tree-processor", () => {
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
        path: "./components/ClientComp.tsx",
        exports: ["default"],
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

      assertEquals(result.type, "fragment", "fragments must be walked, not string-rendered");

      const children = (result as { children: RSCNode[] }).children;
      assertEquals(children.length, 2, "both fragment children are processed");
      assertEquals(
        children.every((child) => child.type === "html"),
        true,
        "each fragment child renders to an html node",
      );
      assertEquals(
        (children[0] as { html: string }).html.includes(">a<"),
        true,
        "the first fragment child keeps its own markup",
      );
      assertEquals(
        (children[1] as { html: string }).html.includes(">b<"),
        true,
        "the second fragment child keeps its own markup",
      );
    });

    it("detects client components nested inside a fragment", async () => {
      function ClientComp() {
        return React.createElement("div", null, "client");
      }
      (ClientComp as any).__rsc_client = true;

      const clientManifest = new Map<string, ClientComponentMeta>();
      clientManifest.set("ClientComp", {
        id: "ClientComp",
        path: "./components/ClientComp.tsx",
        exports: ["default"],
      });

      const clientRefs = new Map<string, string>();
      const element = React.createElement(
        React.Fragment,
        null,
        React.createElement(ClientComp),
      );

      const result = await renderTree(element as any, {}, clientManifest, clientRefs);

      assertEquals(result.type, "fragment", "the fragment wrapper is preserved");

      const children = (result as { children: RSCNode[] }).children;
      assertEquals(children.length, 1, "the fragment has one child");
      assertEquals(
        children[0]!.type,
        "client",
        "a client component inside a fragment is detected",
      );
      assertEquals(
        (children[0] as { component: string }).component,
        "ClientComp",
        "the detected client component keeps its id",
      );
      assertEquals(
        clientRefs.has("ClientComp"),
        true,
        "a client component inside a fragment is registered in clientRefs",
      );
    });

    it("preserves htmlFor on custom elements with nested client boundaries", async () => {
      function ClientComp() {
        return React.createElement("input", { id: "field" });
      }
      (ClientComp as any).__rsc_client = true;

      const clientManifest = new Map<string, ClientComponentMeta>();
      clientManifest.set("ClientComp", {
        id: "ClientComp",
        path: "./components/ClientComp.tsx",
        exports: ["default"],
      });

      const clientRefs = new Map<string, string>();
      const element = React.createElement(
        "design-label",
        { htmlFor: "field" },
        React.createElement(ClientComp),
      );

      const result = await renderTree(element as any, {}, clientManifest, clientRefs);
      assertEquals(result.type, "html");

      const html = (result as { html: string }).html;
      assertEquals(
        html.includes('<design-label htmlFor="field">'),
        true,
        "custom-element attributes keep React prop spelling on the processor path",
      );
      assertEquals(html.includes('<design-label for="field">'), false);
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
      assertEquals(result[0]!.type, "html");
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
      assertEquals(result[0]!.type, "html");
    });

    it("should handle array of children", async () => {
      const children = [
        React.createElement("span", { key: "1" }, "a"),
        React.createElement("span", { key: "2" }, "b"),
      ];
      const result = await renderChildren(children, new Map(), new Map());
      assertEquals(result.length, 2);
    });

    it("should HTML-escape raw text children (XSS H14)", async () => {
      const result = await renderChildren(
        "<img src=x onerror=alert(1)>",
        new Map(),
        new Map(),
      );
      assertEquals(result.length, 1);
      assertEquals(result[0]!.type, "html");
      const html = (result[0] as { html: string }).html;
      assertEquals(html.includes("&lt;img"), true);
      assertEquals(html.includes("<img"), false);
    });
  });

  describe("XSS H14 - mixed text + client-component children", () => {
    it("should escape a text sibling next to a client component", async () => {
      function ClientWidget() {
        return React.createElement("div", null, "widget");
      }
      (ClientWidget as any).__rsc_client = true;

      const clientManifest = new Map<string, ClientComponentMeta>();
      clientManifest.set("ClientWidget", {
        id: "ClientWidget",
        path: "./components/ClientWidget.tsx",
        exports: ["default"],
      });

      const element = React.createElement(
        "div",
        null,
        "<img src=x onerror=alert(1)>",
        React.createElement(ClientWidget),
      );

      const result = await renderTree(
        element as any,
        {},
        clientManifest,
        new Map<string, string>(),
      );

      assertEquals(result.type, "html");
      const html = (result as { html: string }).html;
      assertEquals(html.includes("&lt;img"), true);
      assertEquals(html.includes("onerror=alert(1)>"), false);
    });

    it("should escape text children of a client component", async () => {
      function ClientWidget() {
        return React.createElement("div", null, "widget");
      }
      (ClientWidget as any).__rsc_client = true;

      const clientManifest = new Map<string, ClientComponentMeta>();
      clientManifest.set("ClientWidget", {
        id: "ClientWidget",
        path: "./components/ClientWidget.tsx",
        exports: ["default"],
      });

      const clientRefs = new Map<string, string>();
      const element = React.createElement(
        ClientWidget,
        null,
        "<img src=x onerror=alert(1)>",
      );

      const node = await renderTree(element as any, {}, clientManifest, clientRefs);

      assertEquals(node.type, "client", "the client boundary is preserved");
      assertEquals(
        (node as { children: RSCNode[] }).children[0],
        { type: "html", text: "<img src=x onerror=alert(1)>" },
        "boundary text children must stay unescaped data, not html",
      );

      const html = await treeToHTML(node, clientRefs, clientManifest);
      assertEquals(html.includes("&lt;img"), true, "boundary text is escaped on output");
      assertEquals(
        html.includes("<img src=x"),
        false,
        "boundary text must never be emitted as raw markup",
      );
    });

    it("should not double-escape a normal text-only element (regression)", async () => {
      const element = React.createElement("div", null, "hello & welcome");
      const result = await renderTree(element as any, {}, new Map(), new Map());
      assertEquals(result.type, "html");
      const html = (result as { html: string }).html;
      // text-only goes through React's fast path; should escape once, not twice
      assertEquals(html.includes("hello &amp; welcome"), true);
      assertEquals(html.includes("&amp;amp;"), false);
    });
  });
});
