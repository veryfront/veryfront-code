import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { usePageContext, useRouter } from "../../react/runtime/core.ts";
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

  it("falls back to the bare child when the import map does not own veryfront/router", async () => {
    const doc = docWithImportMap({ "react": "https://example.com/react.js" });
    const child = React.createElement("div", null, "bare");

    const result = await wrapWithRouterProvider(child, { params: {}, frontmatter: {} }, doc);

    // No specifier to load → hydration still proceeds with the unwrapped child.
    assertEquals(result, child);
  });

  it("does not disguise a malformed import map as an unavailable router provider", async () => {
    const dom = new JSDOM(
      '<!doctype html><script type="importmap">{"imports":{"veryfront/router":}}</script>',
    );
    const child = React.createElement("div", null, "bare");

    await assertRejects(
      () =>
        wrapWithRouterProvider(
          child,
          { params: {}, frontmatter: {} },
          dom.window.document as unknown as Document,
        ),
      SyntaxError,
      "invalid JSON",
    );
  });
});
