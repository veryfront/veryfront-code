/**
 * Development warning for a chat surface rendering Markdown with no renderer
 * installed.
 *
 * `veryfront/markdown` presents plain escaped source by design, which is the
 * right default for a standalone `Markdown`. In chat it is almost always a
 * mistake: the assistant writes Markdown and the reader sees `## Heading`. The
 * project scaffolds a renderer, so this only fires for a project created before
 * that existed, or one that removed the provider.
 *
 * @module react/components/chat/missing-renderer-warning
 */

import { isDevelopment } from "#veryfront/platform/environment.ts";

interface VeryfrontChatRuntimeGlobal {
  __RSC_DEV__?: boolean;
  __VERYFRONT_DEV__?: boolean;
  __VERYFRONT_SSR__?: boolean;
}

/** Message shown once when chat falls back to plain Markdown source. */
export const MISSING_MARKDOWN_RENDERER_WARNING =
  "[Veryfront] Chat is showing raw Markdown source because no Markdown renderer " +
  "is installed. Install one for the chat subtree:\n" +
  '  import { MarkdownRendererProvider } from "veryfront/markdown";\n' +
  "  <MarkdownRendererProvider renderer={MarkdownRenderer}><Chat /></MarkdownRendererProvider>\n" +
  "New projects scaffold this in app/markdown-renderer.tsx. See " +
  "https://veryfront.com/docs/code/guides/chat-ui#render-markdown-in-chat";

let warnedMissingMarkdownRenderer = false;

/**
 * Whether this render is a development one. Mirrors the optimized-image check:
 * the server reads the process environment, the browser reads the flag the
 * page handler writes into the document.
 */
function isChatDevelopment(): boolean {
  const runtime = globalThis as VeryfrontChatRuntimeGlobal;
  const isServer = runtime.__VERYFRONT_SSR__ === true || typeof window === "undefined";
  if (isServer) return isDevelopment();
  return runtime.__VERYFRONT_DEV__ === true || runtime.__RSC_DEV__ === true;
}

/**
 * Warn once per process when a chat surface renders Markdown without a
 * renderer. Silent in production, and silent when the caller asked for plain
 * source explicitly.
 */
export function warnMissingMarkdownRenderer(): void {
  if (warnedMissingMarkdownRenderer || !isChatDevelopment()) return;
  warnedMissingMarkdownRenderer = true;
  console.warn(MISSING_MARKDOWN_RENDERER_WARNING);
}

/** Reset the warn-once latch. Test-only. */
export function resetMissingMarkdownRendererWarning(): void {
  warnedMissingMarkdownRenderer = false;
}
