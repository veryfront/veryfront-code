import * as React from "react";
import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import type { MarkdownRendererProps } from "./markdown.tsx";
import { MarkdownRendererProvider } from "./markdown.tsx";
import { ChatMarkdown } from "./chat-markdown.tsx";
import {
  MISSING_MARKDOWN_RENDERER_WARNING,
  resetMissingMarkdownRendererWarning,
} from "./missing-renderer-warning.ts";

function AppRenderer({ source }: MarkdownRendererProps): React.ReactElement {
  return <article data-app-renderer="true">{source}</article>;
}

/** Render while capturing `console.warn`, in a forced development environment. */
function renderCapturingWarnings(node: React.ReactElement): { html: string; warnings: string[] } {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  const runtime = globalThis as { __VERYFRONT_SSR__?: boolean };
  const originalSSR = runtime.__VERYFRONT_SSR__;
  const originalEnv = Deno.env.get("NODE_ENV");

  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
  runtime.__VERYFRONT_SSR__ = true;
  Deno.env.set("NODE_ENV", "development");
  try {
    return { html: renderToString(node), warnings };
  } finally {
    console.warn = originalWarn;
    if (originalSSR === undefined) delete runtime.__VERYFRONT_SSR__;
    else runtime.__VERYFRONT_SSR__ = originalSSR;
    if (originalEnv === undefined) Deno.env.delete("NODE_ENV");
    else Deno.env.set("NODE_ENV", originalEnv);
  }
}

describe("ChatMarkdown — missing renderer warning", () => {
  afterEach(() => resetMissingMarkdownRendererWarning());

  it("warns when chat falls back to plain source", () => {
    const { html, warnings } = renderCapturingWarnings(<ChatMarkdown># Heading</ChatMarkdown>);

    assertStringIncludes(html, 'data-vf-markdown-renderer="plain"');
    assertEquals(warnings.length, 1);
    assertStringIncludes(warnings[0]!, "no Markdown renderer");
    // The message has to be actionable on its own.
    assertStringIncludes(warnings[0]!, "MarkdownRendererProvider");
    assertStringIncludes(warnings[0]!, "app/markdown-renderer.tsx");
  });

  it("warns once, not once per message", () => {
    const { warnings } = renderCapturingWarnings(
      <>
        <ChatMarkdown>first</ChatMarkdown>
        <ChatMarkdown>second</ChatMarkdown>
        <ChatMarkdown>third</ChatMarkdown>
      </>,
    );

    assertEquals(warnings.length, 1);
  });

  it("stays quiet when a renderer is installed", () => {
    const { html, warnings } = renderCapturingWarnings(
      <MarkdownRendererProvider renderer={AppRenderer}>
        <ChatMarkdown># Heading</ChatMarkdown>
      </MarkdownRendererProvider>,
    );

    assertStringIncludes(html, 'data-app-renderer="true"');
    assertEquals(warnings, []);
  });

  it("stays quiet when plain source was requested explicitly", () => {
    // `renderer={null}` is a deliberate choice, not a missing renderer.
    const { html, warnings } = renderCapturingWarnings(
      <ChatMarkdown renderer={null}># Heading</ChatMarkdown>,
    );

    assertStringIncludes(html, 'data-vf-markdown-renderer="plain"');
    assertEquals(warnings, []);
  });

  it("stays quiet outside development", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const runtime = globalThis as { __VERYFRONT_SSR__?: boolean };
    const originalEnv = Deno.env.get("NODE_ENV");

    console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
    runtime.__VERYFRONT_SSR__ = true;
    Deno.env.set("NODE_ENV", "production");
    try {
      renderToString(<ChatMarkdown># Heading</ChatMarkdown>);
    } finally {
      console.warn = originalWarn;
      delete runtime.__VERYFRONT_SSR__;
      if (originalEnv === undefined) Deno.env.delete("NODE_ENV");
      else Deno.env.set("NODE_ENV", originalEnv);
    }

    assertEquals(warnings, []);
  });

  it("renders the same output as Markdown", () => {
    const { html } = renderCapturingWarnings(
      <MarkdownRendererProvider renderer={AppRenderer}>
        <ChatMarkdown className="vf-custom"># Heading</ChatMarkdown>
      </MarkdownRendererProvider>,
    );

    assertStringIncludes(html, "vf-custom");
    assert(html.includes('data-source="# Heading"') === false, "renderer receives source as child");
    assertStringIncludes(html, "# Heading");
  });
});
