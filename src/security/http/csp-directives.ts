/**
 * Canonical Content-Security-Policy directive names.
 *
 * Kept as a leaf module so both the policy builder and the config validator
 * read the same list. A project that misspells a directive is told at config
 * load rather than discovering it as a silently missing protection in
 * production — an unrecognized directive name is ignored by browsers, so
 * without this check `fontSource: [...]` would look configured and do nothing.
 *
 * @module security/http/csp-directives
 */

/** Every directive a project may name in `security.csp`. */
export const CSP_DIRECTIVE_NAMES: readonly string[] = Object.freeze([
  "base-uri",
  "block-all-mixed-content",
  "child-src",
  "connect-src",
  "default-src",
  "fenced-frame-src",
  "font-src",
  "form-action",
  "frame-ancestors",
  "frame-src",
  "img-src",
  "manifest-src",
  "media-src",
  "object-src",
  "prefetch-src",
  "report-to",
  "report-uri",
  "require-trusted-types-for",
  "sandbox",
  "script-src",
  "script-src-attr",
  "script-src-elem",
  "style-src",
  "style-src-attr",
  "style-src-elem",
  "trusted-types",
  "upgrade-insecure-requests",
  "worker-src",
]);

const CSP_DIRECTIVE_NAME_SET: ReadonlySet<string> = new Set(CSP_DIRECTIVE_NAMES);

/**
 * A short, representative sample for error messages. Listing all 28 directives
 * buries the fix; these are the ones projects actually reach for.
 */
export const EXAMPLE_CSP_DIRECTIVES: readonly string[] = Object.freeze([
  "styleSrc",
  "fontSrc",
  "imgSrc",
  "connectSrc",
  "frameSrc",
]);

/**
 * Normalize a configured key to its directive name.
 *
 * `fontSrc` and `font-src` address the same directive; projects may write
 * either, and camelCase matches the surrounding config style.
 */
export function toCspDirectiveName(key: string): string {
  return key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

/** True when a configured key names a real CSP directive. */
export function isCspDirectiveName(key: string): boolean {
  return CSP_DIRECTIVE_NAME_SET.has(toCspDirectiveName(key));
}
