import React from "react";
import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type CollectedHead, runWithHeadCollector } from "#veryfront/react/head-collector.ts";
import {
  descriptorFromHeadProps,
  serializeManagedHeadPayload,
} from "#veryfront/html/managed-head-protocol.ts";
import { Head } from "#veryfront/react/runtime/core.ts";
import { wrapWithServerRenderContext } from "#veryfront/react/server-render-context.ts";
import {
  buildHeadElements,
  mergeCollectedHeadWithShell,
  resolveCommittedHeadFromHTML,
} from "./html-head.ts";

function renderWithCollectedHead(element: React.ReactNode) {
  return runWithHeadCollector((renderContext) =>
    renderToString(wrapWithServerRenderContext(element, renderContext))
  );
}

describe("committed React Head resolution", () => {
  it("resolves registered payloads in committed SSR order", async () => {
    const rendered = await renderWithCollectedHead(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          Head,
          null,
          React.createElement("title", null, "Layout"),
          React.createElement("meta", {
            name: "author",
            content: "Layout author",
          }),
        ),
        React.createElement(
          Head,
          null,
          React.createElement("title", null, "Page"),
          React.createElement("style", null, ".page{}"),
          React.createElement("script", { id: "page-script" }, "safe()"),
        ),
      ),
    );

    const resolved = resolveCommittedHeadFromHTML(rendered.result, rendered.head);
    assertEquals(resolved, {
      title: "Page",
      metas: [{ content: "Layout author", name: "author" }],
      links: [],
      styles: [".page{}"],
      scripts: [{ content: "safe()", id: "page-script" }],
    });
    assertStringIncludes(
      buildHeadElements(resolved, "response-nonce").scripts,
      'nonce="response-nonce"',
    );
  });

  it("does not trust copied payload markers or unregistered commit tokens", async () => {
    const payload = serializeManagedHeadPayload([
      descriptorFromHeadProps("script", {
        children: "globalThis.__SPOOFED_HEAD__=1",
      })!,
    ]);
    const { head } = await runWithHeadCollector(() => undefined);
    const html = `<div data-veryfront-head="1" data-vf-react-head-owner="1" ` +
      `data-vf-server-head-commit="${"a".repeat(48)}" data-vf-ssr-head="${payload}"></div>`;

    const resolved = resolveCommittedHeadFromHTML(html, head);
    assertEquals(resolved, {
      metas: [],
      links: [],
      styles: [],
      scripts: [],
    });
    const emitted = buildHeadElements(resolved, "response-nonce");
    assertEquals(emitted.scripts.includes("__SPOOFED_HEAD__"), false);
    assertEquals(emitted.scripts.includes("response-nonce"), false);
  });

  it("ignores registered payloads absent from the completed HTML", async () => {
    const rendered = await renderWithCollectedHead(
      React.createElement(
        Head,
        null,
        React.createElement("script", null, "globalThis.__ABANDONED_HEAD__=1"),
      ),
    );

    const resolved = resolveCommittedHeadFromHTML("<main>committed</main>", rendered.head);
    assertEquals(resolved?.scripts, []);
  });

  it("does not accept a commit token in another request context", async () => {
    const first = await renderWithCollectedHead(
      React.createElement(
        Head,
        null,
        React.createElement("script", null, "globalThis.__FIRST_REQUEST__=1"),
      ),
    );
    const second = await runWithHeadCollector(() => undefined);

    const resolved = resolveCommittedHeadFromHTML(first.result, second.head);
    assertEquals(resolved?.scripts, []);
  });
});

describe("collected Head serialization", () => {
  it("nonces inline head scripts but leaves external scripts to CSP sources", () => {
    const result = buildHeadElements({
      metas: [],
      links: [],
      styles: [],
      scripts: [
        { id: "inline", content: "boot()" },
        { id: "external", src: "https://cdn.example/app.js" },
      ],
    }, "response-nonce");

    assertStringIncludes(result.scripts, 'id="inline" nonce="response-nonce"');
    assertStringIncludes(result.scripts, 'id="external" src="https://cdn.example/app.js"');
    assertEquals(
      result.scripts.includes(
        'id="external" nonce="response-nonce" src="https://cdn.example/app.js"',
      ),
      false,
    );
  });

  it("marks every emitted node and preserves empty content and style attributes", () => {
    const result = buildHeadElements({
      metas: [{ name: "author", content: "" }],
      links: [{ rel: "canonical", href: "https://example.com/" }],
      styles: [{ media: "print", content: "" }],
      scripts: [{ content: "" }],
    });

    assertEquals(
      (result.scripts.match(/data-vf-head="true"/g) ?? []).length,
      1,
    );
    assertEquals(
      (result.other.match(/data-vf-head="true"/g) ?? []).length,
      3,
    );
    assertStringIncludes(result.scripts, 'data-vf-hash="vf0"');
    assertStringIncludes(result.other, 'content=""');
    assertStringIncludes(result.other, 'media="print"');
  });

  it("strips event handlers and every case variant of internal markers", () => {
    const result = buildHeadElements({
      metas: [{
        name: "author",
        content: "A",
        onload: "alert(1)",
        "DATA-VF-HEAD": "spoofed",
      }],
      links: [{
        rel: "canonical",
        href: "https://example.com/",
        onLoad: "alert(1)",
        "Data-Vf-React-Head-Owner": "1",
      }],
      styles: [{
        content: ".x{}",
        ONCLICK: "alert(1)",
        "DATA-VERYFRONT-MANAGED": "spoofed",
      }],
      scripts: [{
        content: "safe()",
        onerror: "alert(1)",
        "DATA-VF-HASH": "spoofed",
      }],
    });

    const html = `${result.scripts}\n${result.other}`;
    assertEquals(/onload|onclick|onerror/i.test(html), false);
    assertEquals(html.includes("spoofed"), false);
    assertEquals(
      (html.match(/data-vf-head="true"/g) ?? []).length,
      4,
    );
  });
});

describe("collected Head and shell singleton merge", () => {
  it("emits one winning viewport/canonical/social/script identity", () => {
    const head: CollectedHead = {
      title: "Head title",
      description: "Head description",
      metas: [
        { name: "viewport", content: "width=900" },
        { property: "og:title", content: "Head OG" },
      ],
      links: [{
        rel: "canonical",
        href: "https://example.com/head",
      }],
      styles: [],
      scripts: [{
        id: "head-script",
        src: "/shared.js",
      }],
    };

    const result = mergeCollectedHeadWithShell(
      {
        meta: [{ name: "author", content: "Page author" }],
      },
      {
        og: { title: "Layout OG", image: "layout.jpg" },
        links: [
          { rel: "canonical", href: "https://example.com/layout" },
          { rel: "stylesheet", href: "/layout.css" },
        ],
        scripts: [
          { id: "layout-script", src: "/shared.js" },
          { id: "other-script", src: "/other.js" },
        ],
      },
      head,
    );

    assertEquals(result.frontmatter.title, "Head title");
    assertEquals(result.frontmatter.description, "Head description");
    assertEquals(result.frontmatter.viewport, "width=900");
    assertEquals(result.frontmatter.links, [
      { rel: "stylesheet", href: "/layout.css" },
    ]);
    assertEquals(result.frontmatter.scripts, [
      { id: "other-script", src: "/other.js" },
    ]);
    assertEquals(result.frontmatter.og, { image: "layout.jpg" });
    assertEquals(result.emissionHead?.metas, [
      { name: "viewport", content: "width=900" },
      { property: "og:title", content: "Head OG" },
    ]);
    assertEquals(result.marksViewport, true);
  });

  it("deduplicates exact repeatables and their structured aliases", () => {
    const result = mergeCollectedHeadWithShell(
      {
        og: {
          image: "/same.png",
          "image:alt": "Alternative",
        },
        meta: [
          { name: "Author", content: "Same author" },
          { name: "author", content: "Different author" },
          { property: "og:image", content: "/same.png" },
        ],
        links: [
          { rel: "preload", href: "/same.woff2", as: "font" },
          { rel: "preload", href: "/other.woff2", as: "font" },
        ],
        icons: [
          { href: "/favicon.svg" },
          { href: "/other.svg" },
        ],
        styles: [
          { href: "/shared.css", media: "print" },
          { content: ".same{}", media: "screen" },
          { content: ".other{}" },
        ],
      },
      {},
      {
        metas: [
          { name: "author", content: "Same author" },
          { property: "og:image", content: "/same.png" },
        ],
        links: [
          { rel: "PRELOAD", href: "/same.woff2", as: "font" },
          { rel: "icon", href: "/favicon.svg" },
          { rel: "stylesheet", href: "/shared.css", media: "print" },
        ],
        styles: [{ content: ".same{}", media: "screen" }],
        scripts: [],
      },
    );

    assertEquals(result.frontmatter.meta, [
      { name: "author", content: "Different author" },
    ]);
    assertEquals(result.frontmatter.og, {
      "image:alt": "Alternative",
    });
    assertEquals(result.frontmatter.links, [
      { rel: "preload", href: "/other.woff2", as: "font" },
    ]);
    assertEquals(result.frontmatter.icons, [{ href: "/other.svg" }]);
    assertEquals(result.frontmatter.styles, [{ content: ".other{}" }]);
  });

  it("deduplicates identical anonymous scripts but preserves distinct behavior", () => {
    const result = mergeCollectedHeadWithShell(
      {
        scripts: [
          { content: "boot()", type: "module", nonce: "shell" },
          { content: "boot()", type: "text/javascript" },
          { content: "other()" },
        ],
      },
      {},
      {
        metas: [],
        links: [],
        styles: [],
        scripts: [{ content: "boot()", type: "module", nonce: "head" }],
      },
    );

    assertEquals(result.frontmatter.scripts, [
      { content: "boot()", type: "text/javascript" },
      { content: "other()" },
    ]);
  });

  it("normalizes singleton values and keeps media-qualified theme colors distinct", () => {
    const result = mergeCollectedHeadWithShell(
      {
        themeColor: "red",
        meta: [{ name: "Viewport", content: "width=400" }],
        links: [{ rel: "CANONICAL", href: "https://example.com/old" }],
      },
      {},
      {
        metas: [
          { name: "viewport", content: "width=900" },
          { name: "theme-color", content: "blue" },
          {
            name: "theme-color",
            content: "black",
            media: "(prefers-color-scheme: dark)",
          },
          { charset: "utf-8" },
        ],
        links: [{
          rel: "canonical",
          href: "https://example.com/current",
        }],
        styles: [],
        scripts: [],
      },
    );

    assertEquals(result.frontmatter.themeColor, undefined);
    assertEquals(result.frontmatter.meta, []);
    assertEquals(result.frontmatter.links, []);
    assertEquals(result.emissionHead?.metas, [
      { name: "viewport", content: "width=900" },
      { name: "theme-color", content: "blue" },
      {
        name: "theme-color",
        content: "black",
        media: "(prefers-color-scheme: dark)",
      },
    ]);
  });
});
