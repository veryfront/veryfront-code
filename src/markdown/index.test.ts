import "#veryfront/schemas/_test-setup.ts";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as markdownModule from "./index.ts";
import * as publicMarkdownModule from "veryfront/markdown";
import * as markdownComponentModule from "#veryfront/react/components/chat/markdown.tsx";
import type { Components, PluggableList } from "veryfront/markdown";

const componentsContract: Components = {};
const pluginContract: PluggableList = [];
const invalidComponentsContract: Components = {
  // @ts-expect-error Renderers must accept the props for their HTML element.
  p: (_props: { required: string }) => null,
};
const invalidPluginContract: PluggableList = [
  // @ts-expect-error Plugin lists only accept unified-compatible plugins.
  42,
];
void invalidComponentsContract;
void invalidPluginContract;

const expectedRuntimeExports = ["Markdown"];

describe("markdown/index.ts exports", () => {
  it("preserves the runtime export surface for veryfront/markdown", () => {
    assertEquals(Object.keys(markdownModule).sort(), expectedRuntimeExports);
  });

  it("keeps the Markdown re-export wired to the source component module", () => {
    assertStrictEquals(markdownModule.Markdown, markdownComponentModule.Markdown);
  });

  it("keeps the documented veryfront/markdown entrypoint aligned with the barrel module", () => {
    assertEquals(Object.keys(publicMarkdownModule).sort(), expectedRuntimeExports);
    assertStrictEquals(publicMarkdownModule.Markdown, markdownModule.Markdown);
    assertEquals(componentsContract, {});
    assertEquals(pluginContract, []);
  });

  it("renders through the public entrypoint", () => {
    const html = renderToString(
      React.createElement(publicMarkdownModule.Markdown, {
        children: "Public **Markdown** entrypoint.",
      }),
    );

    assertEquals(html.includes("Public <strong>Markdown</strong> entrypoint."), true);
  });
});
