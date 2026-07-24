import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
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

    it("retains the configured React version for server rendering", () => {
      const renderer = new RSCRenderer({
        clientManifest: new Map(),
        projectDir: "/tmp/test-project",
        reactVersion: "18.3.1",
      });

      assertEquals(
        (renderer as unknown as { reactVersion?: string }).reactVersion,
        "18.3.1",
      );
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

    it("emits a hydratable client reference with serialized props", async () => {
      function ClientComponent(_props: { label: string }) {
        return React.createElement("button", null, "client");
      }
      (ClientComponent as typeof ClientComponent & { __rsc_client?: boolean }).__rsc_client = true;

      const renderer = new RSCRenderer({
        clientManifest: new Map([
          [
            "ClientComponent",
            {
              id: "ClientComponent",
              path: "/_veryfront/fs/client-component.js",
              exports: ["default"],
            },
          ],
        ]),
        projectDir: "/tmp/test-project",
      });

      const payload = await renderer.renderToPayload(ClientComponent, { label: "Save" });

      assertStringIncludes(
        payload.html,
        'data-client-ref="/_veryfront/fs/client-component.js#default"',
      );
      assertStringIncludes(payload.html, "data-rsc-props");
      assertStringIncludes(payload.html, "Save");
    });

    it("detaches renderer metadata from caller-owned export arrays", async () => {
      function ClientComponent() {
        return React.createElement("button", null, "client");
      }
      (ClientComponent as typeof ClientComponent & { __rsc_client?: boolean }).__rsc_client = true;
      const exports = ["default"];
      const metadata = {
        id: "ClientComponent",
        path: "/_veryfront/fs/client-component.js",
        exports,
      };
      const renderer = new RSCRenderer({
        clientManifest: new Map([
          ["ClientComponent", metadata],
        ]),
        projectDir: "/tmp/test-project",
      });

      metadata.path = "/_veryfront/fs/mutated.js";
      exports.splice(0, exports.length, "ClientComponent");
      const payload = await renderer.renderToPayload(ClientComponent);

      assertStringIncludes(
        payload.html,
        'data-client-ref="/_veryfront/fs/client-component.js#default"',
      );
    });

    it("preserves nested server and client children in a hydratable boundary payload", async () => {
      function ClientShell(_props: { children?: React.ReactNode }) {
        return React.createElement("main", null, "client shell");
      }
      (ClientShell as typeof ClientShell & { __rsc_client?: boolean }).__rsc_client = true;

      function NestedClient(_props: { count: number; children?: React.ReactNode }) {
        return React.createElement("button", null, "nested client");
      }
      (NestedClient as typeof NestedClient & { __rsc_client?: boolean }).__rsc_client = true;

      function ServerChild() {
        return React.createElement("strong", { id: "server-child" }, "server text");
      }

      function Page() {
        return React.createElement(
          ClientShell,
          null,
          React.createElement(
            "section",
            { className: "content" },
            React.createElement(ServerChild),
            React.createElement(NestedClient, { count: 2 }, "nested text"),
          ),
        );
      }

      const renderer = new RSCRenderer({
        clientManifest: new Map([
          [
            "ClientShell",
            {
              id: "ClientShell",
              path: "/_veryfront/fs/client-shell.js",
              exports: ["default"],
            },
          ],
          [
            "NestedClient",
            {
              id: "NestedClient",
              path: "/_veryfront/fs/nested-client.js",
              exports: ["default"],
            },
          ],
        ]),
        projectDir: "/tmp/test-project",
      });

      const payload = await renderer.renderToPayload(Page);

      assertEquals(payload.tree?.type, "client");
      assertEquals(payload.tree?.children?.[0]?.type, "server");
      assertEquals(payload.tree?.children?.[0]?.component, "section");
      assertEquals(payload.tree?.children?.[0]?.children?.[0]?.component, "strong");
      assertEquals(payload.tree?.children?.[0]?.children?.[1]?.type, "client");
      assertStringIncludes(payload.html, "data-rsc-children=");
      assertStringIncludes(payload.html, "server text");
      assertStringIncludes(
        payload.html,
        'data-client-ref="/_veryfront/fs/nested-client.js#default"',
      );
    });

    it("routes production client references through the RSC module endpoint", async () => {
      function ClientComponent() {
        return React.createElement("button", null, "client");
      }
      (ClientComponent as typeof ClientComponent & { __rsc_client?: boolean }).__rsc_client = true;

      const renderer = new RSCRenderer({
        clientManifest: new Map([
          [
            "ClientComponent",
            {
              id: "ClientComponent",
              path: "/_veryfront/fs/YXBwL0NsaWVudENvbXBvbmVudC50c3g",
              rel: "app/ClientComponent.tsx",
              contentHash: "rev-a",
              exports: ["default"],
            },
          ],
        ]),
        projectDir: "/tmp/test-project",
        mode: "production",
      });

      const payload = await renderer.renderToPayload(ClientComponent);

      assertStringIncludes(
        payload.html,
        'data-client-ref="/_veryfront/rsc/module?rel=app%2FClientComponent.tsx&amp;v=rev-a#default"',
      );
      assertEquals(payload.html.includes("/_veryfront/fs/"), false);
      assertEquals(
        payload.html.includes(btoa("/tmp/test-project/app/ClientComponent.tsx")),
        false,
      );
      assertEquals(
        payload.clientRefs.ClientComponent,
        "/_veryfront/rsc/module?rel=app%2FClientComponent.tsx&v=rev-a",
      );
    });

    it("preserves legacy production manifest paths when rel is absent", async () => {
      function LegacyClient() {
        return React.createElement("button", null, "legacy client");
      }
      (LegacyClient as typeof LegacyClient & { __rsc_client?: boolean }).__rsc_client = true;

      const renderer = new RSCRenderer({
        clientManifest: new Map([
          [
            "LegacyClient",
            {
              id: "LegacyClient",
              path: "/_veryfront/fs/legacy-client.js",
              exports: ["default"],
            },
          ],
        ]),
        projectDir: "/tmp/test-project",
        mode: "production",
      });

      const payload = await renderer.renderToPayload(LegacyClient);

      assertStringIncludes(
        payload.html,
        'data-client-ref="/_veryfront/fs/legacy-client.js#default"',
      );
      assertEquals(payload.clientRefs.LegacyClient, "/_veryfront/fs/legacy-client.js");
    });

    it("keeps local production client references on the filesystem module endpoint", async () => {
      function ClientComponent() {
        return React.createElement("button", null, "client");
      }
      (ClientComponent as typeof ClientComponent & { __rsc_client?: boolean }).__rsc_client = true;

      const renderer = new RSCRenderer({
        clientManifest: new Map([
          [
            "ClientComponent",
            {
              id: "ClientComponent",
              path: "/_veryfront/fs/YXBwL0NsaWVudENvbXBvbmVudC50c3g",
              rel: "app/ClientComponent.tsx",
              exports: ["default"],
            },
          ],
        ]),
        projectDir: "/tmp/test-project",
        mode: "production",
        clientModuleStrategy: "fs",
      });

      const payload = await renderer.renderToPayload(ClientComponent);

      assertStringIncludes(
        payload.html,
        'data-client-ref="/_veryfront/fs/YXBwL0NsaWVudENvbXBvbmVudC50c3g#default"',
      );
      assertEquals(payload.tree, undefined);
    });

    it("uses remote module references while retaining preview diagnostics", async () => {
      function ClientComponent() {
        return React.createElement("button", null, "client");
      }
      (ClientComponent as typeof ClientComponent & { __rsc_client?: boolean }).__rsc_client = true;

      const renderer = new RSCRenderer({
        clientManifest: new Map([
          [
            "ClientComponent",
            {
              id: "ClientComponent",
              path: "/_veryfront/fs/YXBwL0NsaWVudENvbXBvbmVudC50c3g",
              rel: "app/ClientComponent.tsx",
              exports: ["default"],
            },
          ],
        ]),
        projectDir: "/tmp/test-project",
        mode: "development",
        clientModuleStrategy: "rsc-module",
      });

      const payload = await renderer.renderToPayload(ClientComponent);

      assertStringIncludes(
        payload.html,
        'data-client-ref="/_veryfront/rsc/module?rel=app%2FClientComponent.tsx#default"',
      );
      assertEquals(payload.tree?.type, "client");
    });

    it("uses manifest module paths for client components nested in host elements", async () => {
      function NestedClient() {
        return React.createElement("button", null, "client");
      }
      (NestedClient as typeof NestedClient & { __rsc_client?: boolean }).__rsc_client = true;

      function ServerParent() {
        return React.createElement("section", null, React.createElement(NestedClient));
      }

      const renderer = new RSCRenderer({
        clientManifest: new Map([
          [
            "NestedClient",
            {
              id: "NestedClient",
              path: "/_veryfront/fs/nested-client.js",
              exports: ["default"],
            },
          ],
        ]),
        projectDir: "/tmp/test-project",
      });

      const payload = await renderer.renderToPayload(ServerParent);

      assertStringIncludes(
        payload.html,
        'data-client-ref="/_veryfront/fs/nested-client.js#default"',
      );
    });

    it("routes nested production client references through the RSC module endpoint", async () => {
      function NestedClient() {
        return React.createElement("button", null, "client");
      }
      (NestedClient as typeof NestedClient & { __rsc_client?: boolean }).__rsc_client = true;

      function ServerParent() {
        return React.createElement("section", null, React.createElement(NestedClient));
      }

      const renderer = new RSCRenderer({
        clientManifest: new Map([
          [
            "NestedClient",
            {
              id: "NestedClient",
              path: "/_veryfront/fs/nested-client.js",
              rel: "app/NestedClient.tsx",
              exports: ["default"],
            },
          ],
        ]),
        projectDir: "/tmp/test-project",
        mode: "production",
      });

      const payload = await renderer.renderToPayload(ServerParent);

      assertStringIncludes(
        payload.html,
        'data-client-ref="/_veryfront/rsc/module?rel=app%2FNestedClient.tsx#default"',
      );
      assertEquals(payload.html.includes("/_veryfront/fs/"), false);
    });

    it("emits the actual export name for named-only client modules", async () => {
      function NamedWidget() {
        return React.createElement("button", null, "named client");
      }
      (NamedWidget as typeof NamedWidget & { __rsc_client?: boolean }).__rsc_client = true;

      const renderer = new RSCRenderer({
        clientManifest: new Map([
          [
            "NamedWidget",
            {
              id: "NamedWidget",
              path: "/_veryfront/fs/named-widget.js",
              exports: ["NamedWidget"],
            },
          ],
        ]),
        projectDir: "/tmp/test-project",
      });

      const payload = await renderer.renderToPayload(NamedWidget);

      assertStringIncludes(
        payload.html,
        'data-client-ref="/_veryfront/fs/named-widget.js#NamedWidget"',
      );
      assertEquals(payload.clientRefs.NamedWidget, "/_veryfront/fs/named-widget.js");
    });

    it("prefers the rendered named export when a module also has a default", async () => {
      function Widget() {
        return React.createElement("button", null, "named client");
      }
      (Widget as typeof Widget & { __rsc_client?: boolean }).__rsc_client = true;

      const renderer = new RSCRenderer({
        clientManifest: new Map([
          [
            "Widget",
            {
              id: "Widget",
              path: "/_veryfront/fs/mixed-widget.js",
              exports: ["default", "Widget"],
            },
          ],
        ]),
        projectDir: "/tmp/test-project",
      });

      const payload = await renderer.renderToPayload(Widget);

      assertStringIncludes(
        payload.html,
        'data-client-ref="/_veryfront/fs/mixed-widget.js#Widget"',
      );
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

    it("isolates client references across concurrent renders", async () => {
      function FirstClient() {
        return React.createElement("button", null, "first client");
      }
      (FirstClient as typeof FirstClient & { __rsc_client?: boolean }).__rsc_client = true;

      function SecondClient() {
        return React.createElement("button", null, "second client");
      }
      (SecondClient as typeof SecondClient & { __rsc_client?: boolean }).__rsc_client = true;

      let releaseFirst!: () => void;
      let markFirstStarted!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const firstStarted = new Promise<void>((resolve) => {
        markFirstStarted = resolve;
      });

      async function DelayedFirst() {
        markFirstStarted();
        await firstGate;
        return React.createElement(FirstClient);
      }

      const renderer = new RSCRenderer({
        clientManifest: new Map([
          [
            "FirstClient",
            {
              id: "FirstClient",
              path: "/_veryfront/fs/first-client.js",
              exports: ["default"],
            },
          ],
          [
            "SecondClient",
            {
              id: "SecondClient",
              path: "/_veryfront/fs/second-client.js",
              exports: ["default"],
            },
          ],
        ]),
        projectDir: "/tmp/test-project",
      });

      const firstRender = renderer.renderToPayload(DelayedFirst);
      await firstStarted;
      const secondPayload = await renderer.renderToPayload(SecondClient);
      releaseFirst();
      const firstPayload = await firstRender;

      assertEquals(firstPayload.clientRefs, {
        FirstClient: "/_veryfront/fs/first-client.js",
      });
      assertEquals(secondPayload.clientRefs, {
        SecondClient: "/_veryfront/fs/second-client.js",
      });
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
