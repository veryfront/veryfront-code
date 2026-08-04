/**
 * Markdown as chat renders it.
 *
 * Identical to `Markdown`, plus a development warning when a chat surface falls
 * back to plain source. Chat is the one place where the plain-source default is
 * almost always unintended, so the signal lives here rather than in
 * `veryfront/markdown`, where plain source is a supported contract.
 *
 * @module react/components/chat/chat-markdown
 */

import * as React from "react";
import type { MarkdownProps } from "./markdown.tsx";
import { Markdown, useInstalledMarkdownRenderer } from "./markdown.tsx";
import { warnMissingMarkdownRenderer } from "./missing-renderer-warning.ts";

/** Render Markdown on a chat surface. */
export function ChatMarkdown({ renderer, ...props }: MarkdownProps): React.ReactElement {
  const installed = useInstalledMarkdownRenderer();
  // `renderer={null}` is an explicit request for plain source, so it is not a
  // missing renderer. Only an absent prop with nothing installed is.
  if (renderer === undefined && installed === null) {
    warnMissingMarkdownRenderer();
  }
  return <Markdown {...props} renderer={renderer} />;
}
ChatMarkdown.displayName = "ChatMarkdown";
