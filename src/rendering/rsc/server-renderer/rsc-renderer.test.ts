import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RSCRenderer } from "./rsc-renderer.ts";
import * as React from "react";

describe("rendering/rsc/server-renderer/rsc-renderer", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  describe("RSCRenderer constructor", () => {
    it("should create renderer with empty client manifest", () => {
      const renderer = new RSCRenderer({
        clientManifest: new Map(),
        projectDir: "/tmp/test-project",
      });
      assertEquals(renderer instanceof RSCRenderer, true);
    });

    it("should create renderer with production mode", () => {
      const renderer = new RSCRenderer({
        clientManifest: new Map(),
        projectDir: "/tmp/test-project",
        mode: "production",
      });
      assertEquals(renderer instanceof RSCRenderer, true);
    });

    it("should create renderer with development mode", () => {
      const renderer = new RSCRenderer({
        clientManifest: new Map(),
        projectDir: "/tmp/test-project",
        mode: "development",
      });
      assertEquals(renderer instanceof RSCRenderer, true);
    });
  });

  describe("renderToPayload", () => {
    it("should render a simple HTML element", async () => {
      const renderer = new RSCRenderer({
        clientManifest: new Map(),
        projectDir: "/tmp/test-project",
      });

      function SimpleComponent() {
        return React.createElement("div", null, "Hello RSC");
      }

      const payload = await renderer.renderToPayload(SimpleComponent);
      assertEquals(typeof payload.html, "string");
      assertEquals(payload.html.includes("Hello RSC"), true);
      assertEquals(typeof payload.clientRefs, "object");
    });

    it("should render a React element directly", async () => {
      const renderer = new RSCRenderer({
        clientManifest: new Map(),
        projectDir: "/tmp/test-project",
      });

      const element = React.createElement("p", null, "direct element") as React.ReactElement;
      const payload = await renderer.renderToPayload(element);
      assertEquals(payload.html.includes("direct element"), true);
    });

    it("should return empty clientRefs for server-only components", async () => {
      const renderer = new RSCRenderer({
        clientManifest: new Map(),
        projectDir: "/tmp/test-project",
      });

      function ServerOnly() {
        return React.createElement("span", null, "server only");
      }

      const payload = await renderer.renderToPayload(ServerOnly);
      assertEquals(Object.keys(payload.clientRefs).length, 0);
    });

    it("should accept custom props", async () => {
      const renderer = new RSCRenderer({
        clientManifest: new Map(),
        projectDir: "/tmp/test-project",
      });

      function PropsComponent(props: { name: string }) {
        return React.createElement("span", null, `Hello ${props.name}`);
      }

      const payload = await renderer.renderToPayload(PropsComponent, { name: "World" });
      assertEquals(payload.html.includes("Hello World"), true);
    });

    it("should handle component returning null", async () => {
      const renderer = new RSCRenderer({
        clientManifest: new Map(),
        projectDir: "/tmp/test-project",
      });

      function NullComponent() {
        return null;
      }

      const payload = await renderer.renderToPayload(NullComponent);
      assertEquals(typeof payload.html, "string");
    });

    it("should clear client refs between renders", async () => {
      const renderer = new RSCRenderer({
        clientManifest: new Map(),
        projectDir: "/tmp/test-project",
      });

      function Comp1() {
        return React.createElement("div", null, "first");
      }
      function Comp2() {
        return React.createElement("div", null, "second");
      }

      await renderer.renderToPayload(Comp1);
      const payload2 = await renderer.renderToPayload(Comp2);

      assertEquals(typeof payload2.clientRefs, "object");
    });
  });
});
