/**
 * SSR document ownership predicates.
 *
 * The API/page classifier and `SSRHandler` must agree on which pathnames SSR
 * renders (or sheds). Dotted application paths need page metadata to decide
 * ownership: a dynamic page may accept `record.v2` or `photo.png` as its ID.
 * Static files take precedence, while an undeclared extension path remains
 * with another handler or the final 404.
 *
 * @module server/handlers/request/ssr/document-ownership
 */

/** Paths that can be declared pages after static files and API routes are checked. */
export function isDocumentPathnameCandidate(pathname: string): boolean {
  return !pathname.startsWith("/_");
}

/** Paths SSR can own without checking for an explicitly declared page. */
export function ssrOwnsDocumentPathname(pathname: string): boolean {
  // SSRHandler's route pattern is /^(?!\/_).*/, so /_veryfront/ and every
  // other /_ infrastructure path never reaches its render path.
  if (!isDocumentPathnameCandidate(pathname)) return false;

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
