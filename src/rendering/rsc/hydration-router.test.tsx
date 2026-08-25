import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { usePageContext, useRouter } from "../../react/runtime/core.ts";
import type { ClientRuntimeHydrationData } from "./client-module-strategy.ts";
import { wrapWithRouterProvider } from "./hydration-router.ts";

function docWithImportMap(imports: Record<string, string>): Document {
  const dom = new JSDOM(
    `<!doctype html><html><head><script type="importmap">${
      JSON.stringify({ imports })
    }</script></head><body></body></html>`,
  );
  return dom.window.document as unknown as Document;
}

describe("rendering/rsc/wrapWithRouterProvider", () => {
  it("wraps the child in the router provider when the import map owns veryfront/router", async () => {
    const doc = docWithImportMap({ "veryfront/router": "https://example.com/router.js" });

    const Consumer = (): React.ReactElement => {
      const r = useRouter();
      const p = usePageContext();
      return <i>{r.params.id}:{String(p.frontmatter.t)}</i>;
    };

    const wrapped = await wrapWithRouterProvider(
      React.createElement(Consumer),
      { params: { id: "5" }, frontmatter: { t: "hi" } },
      doc,
    );

    // It resolves `veryfront/router` (→ the runtime module) and calls its
    // `wrapForHydration`, so the child renders inside a real
    // RouterProvider/PageContextProvider seeded with params + frontmatter.
    const html = renderToStaticMarkup(wrapped as React.ReactElement);
    assertStringIncludes(html, "5:hi");
  });

  it("threads getServerData props to usePageContext().data for hydrated components", async () => {
    const doc = docWithImportMap({ "veryfront/router": "https://example.com/router.js" });

    const Consumer = (): React.ReactElement => {
      const p = usePageContext();
      return <i>data:{String(p.data.greeting)}</i>;
    };

    const wrapped = await wrapWithRouterProvider(
      React.createElement(Consumer),
      { params: {}, frontmatter: {}, props: { greeting: "from-server" } },
      doc,
    );

    // `props` from the hydration payload reaches `usePageContext().data`, so a
    // hydrated client tree under an App/RSC page reseeds with the same server
    // data the server render used — not an empty object.
    const html = renderToStaticMarkup(wrapped as React.ReactElement);
    assertStringIncludes(html, "data:from-server");
  });

  it("preserves all catch-all route segments (joins array params)", async () => {
    const doc = docWithImportMap({ "veryfront/router": "https://example.com/router.js" });

    const Consumer = (): React.ReactElement => {
      const r = useRouter();
      return <i>slug:{r.params.slug}</i>;
    };

    const wrapped = await wrapWithRouterProvider(
      React.createElement(Consumer),
      { params: { slug: ["guides", "intro"] }, frontmatter: {} },
      doc,
    );

    // The full catch-all path survives — not just the first segment.
    const html = renderToStaticMarkup(wrapped as React.ReactElement);
    assertStringIncludes(html, "slug:guides/intro");
  });

  it("wraps the child even when the page has no hydration data", async () => {
    const doc = docWithImportMap({ "veryfront/router": "https://example.com/router.js" });

    const Consumer = (): React.ReactElement => {
      const r = useRouter();
      const p = usePageContext();
      return <i>p:{String(r.params.id)}|f:{String(p.frontmatter.t)}</i>;
    };
    const child = React.createElement(Consumer);

    const cases: Array<[string, ClientRuntimeHydrationData | null]> = [
      ["null hydration data", null],
      ["a payload without params", { frontmatter: {} }],
    ];

    for (const [label, hydrationData] of cases) {
      const wrapped = await wrapWithRouterProvider(child, hydrationData, doc);

      // Without this the swallowed throw is indistinguishable from the
      // documented import-map fallback below.
      assertEquals(
        wrapped === child,
        false,
        `a router-owning import map must still wrap with ${label}`,
      );
      assertStringIncludes(
        renderToStaticMarkup(wrapped as React.ReactElement),
        "p:undefined|f:undefined",
        `the router provider must render with ${label}`,
      );
    }
  });

  it("falls back to the bare child when the import map does not own veryfront/router", async () => {
    const doc = docWithImportMap({ "react": "https://example.com/react.js" });
    const child = React.createElement("div", null, "bare");

    const result = await wrapWithRouterProvider(child, { params: {}, frontmatter: {} }, doc);

    // No specifier to load → hydration still proceeds with the unwrapped child.
    assertEquals(result, child);
  });
});
