/**
 * Chat's Markdown surface: core `Markdown` with the built-in
 * `@veryfront/ext-markdown-react` renderer as the default.
 *
 * Chat renders assistant output, so semantic Markdown is the expected default
 * there. Resolution order is explicit prop, then an application-installed
 * renderer, then the built-in extension. `renderer={null}` still selects plain
 * source, and `veryfront/markdown` on its own is unchanged.
 *
 * @module react/components/chat/chat-markdown
 */

import * as React from "react";
// Imported by path rather than as `@veryfront/ext-markdown-react/renderer`: a
// bare specifier is resolved as a remote package by the browser module
// pipeline, which cannot fetch a first-party extension. The package is still a
// root npm dependency, so its own dependencies resolve for consumers.
import { MarkdownRenderer as ReactMarkdownRenderer } from "../../../../extensions/ext-markdown-react/src/renderer.tsx";
import type { CodeBlockProps, MarkdownProps, MarkdownRenderer } from "./markdown.tsx";
import { Markdown, useMarkdownRenderer } from "./markdown.tsx";
import { CodeBlock } from "../ui/code-block.tsx";

/** The renderer chat installs when the application installs none. */
export const defaultChatMarkdownRenderer = ReactMarkdownRenderer as MarkdownRenderer;

/**
 * Fenced code in chat renders through the shared code block (language label,
 * copy button, optional syntax-highlight renderer). The renderer extension owns
 * parsing only, so this presentation stays on the chat side.
 */
function renderChatCodeBlock({ language, code }: CodeBlockProps): React.ReactNode {
  return <CodeBlock code={code} language={language} />;
}

/** Render Markdown with chat's default renderer resolution. */
export function ChatMarkdown(
  { renderer, renderCodeBlock, ...props }: MarkdownProps,
): React.ReactElement {
  const installed = useMarkdownRenderer();
  // `renderer === null` is an explicit request for plain source and must not
  // fall through to the installed or built-in renderer.
  const resolved = renderer !== undefined ? renderer : (installed ?? defaultChatMarkdownRenderer);
  return (
    <Markdown
      {...props}
      renderer={resolved}
      // The plain-source contract rejects renderer-only options, so only pass
      // a code-block override when a renderer is actually in play.
      renderCodeBlock={resolved ? (renderCodeBlock ?? renderChatCodeBlock) : renderCodeBlock}
    />
  );
}
ChatMarkdown.displayName = "ChatMarkdown";
