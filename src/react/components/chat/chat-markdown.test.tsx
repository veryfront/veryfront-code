import * as React from "react";
import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
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
    assertEquals(warnings, [MISSING_MARKDOWN_RENDERER_WARNING]);
    // The message has to be actionable on its own.
    assertStringIncludes(MISSING_MARKDOWN_RENDERER_WARNING, "MarkdownRendererProvider");
    assertStringIncludes(MISSING_MARKDOWN_RENDERER_WARNING, "app/markdown-renderer.tsx");
    assertStringIncludes(MISSING_MARKDOWN_RENDERER_WARNING, "guides/chat-ui");
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

  it("stays quiet when a provider disabled rendering", () => {
    // `<MarkdownRendererProvider renderer={null}>` is the documented way to turn
    // an inherited renderer off. That is a choice, not a missing renderer.
    const { html, warnings } = renderCapturingWarnings(
      <MarkdownRendererProvider renderer={null}>
        <ChatMarkdown># Heading</ChatMarkdown>
      </MarkdownRendererProvider>,
    );

    assertStringIncludes(html, 'data-vf-markdown-renderer="plain"');
    assertEquals(warnings, []);
  });

  it("stays quiet when the renderer is inherited from an ancestor provider", () => {
    // An ancestor provider installs a real renderer, so the second child
    // inherits it and neither child is a missing-renderer case.
    const { warnings } = renderCapturingWarnings(
      <MarkdownRendererProvider renderer={AppRenderer}>
        <ChatMarkdown renderer={null}>plain on purpose</ChatMarkdown>
        <ChatMarkdown>inherits the renderer</ChatMarkdown>
      </MarkdownRendererProvider>,
    );

    assertEquals(warnings, []);
  });

  it("stays quiet outside development", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const runtime = globalThis as { __VERYFRONT_SSR__?: boolean };
    const originalEnv = Deno.env.get("NODE_ENV");

    const originalSSR = runtime.__VERYFRONT_SSR__;

    console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
    runtime.__VERYFRONT_SSR__ = true;
    Deno.env.set("NODE_ENV", "production");
    try {
      renderToString(<ChatMarkdown># Heading</ChatMarkdown>);
    } finally {
      console.warn = originalWarn;
      if (originalSSR === undefined) delete runtime.__VERYFRONT_SSR__;
      else runtime.__VERYFRONT_SSR__ = originalSSR;
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
    // The renderer receives the unmodified source, not pre-parsed output.
    assertStringIncludes(html, '<article data-app-renderer="true"># Heading</article>');
  });
});
