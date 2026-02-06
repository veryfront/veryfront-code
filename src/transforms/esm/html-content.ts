/**
 * Check if content appears to be HTML instead of JavaScript.
 * esm.sh can return HTTP 200 with HTML error pages when packages fail to build.
 */
export function looksLikeHtmlContent(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<HTML") ||
    /<title>ESM[^<]*<\/title>/i.test(content.slice(0, 500))
  );
}
