/**
 * SSR document ownership predicate.
 *
 * The API/page classifier and `SSRHandler` must agree on which pathnames SSR
 * renders (or sheds): the classifier defers the memory-pressure response to
 * SSR only for requests that actually reach it. A pathname outside this
 * predicate, including `/_`-prefixed infrastructure paths and extension paths
 * such as `GET /file.md`, belongs to another handler (for example
 * `MarkdownPreviewHandler`), which serves it whether or not the renderer is
 * under pressure, so it must still get its source freshness up front.
 *
 * @module server/handlers/request/ssr/document-ownership
 */

/** True when `SSRHandler` is the handler that renders or sheds this pathname. */
export function ssrOwnsDocumentPathname(pathname: string): boolean {
  // SSRHandler's route pattern is /^(?!\/_).*/, so /_veryfront/ and every
  // other /_ infrastructure path never reaches its render path.
  if (pathname.startsWith("/_")) return false;

  // Extension paths fall through SSR to their own handlers; .veryfront paths
  // are virtual documents that SSR does render.
  const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(pathname) &&
    !pathname.includes("/.veryfront/") &&
    !pathname.startsWith("/.veryfront");
  return !hasFileExtension;
}

/** True when the preview Markdown handler renders the pathname as an HTML document. */
export function markdownPreviewOwnsDocumentPathname(pathname: string): boolean {
  return pathname.endsWith(".md") &&
    !pathname.includes("/pages/") &&
    !pathname.includes("/app/") &&
    !pathname.startsWith("/_");
}
