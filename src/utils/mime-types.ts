/**
 * Inline implementation of the `mime-types` module surface veryfront uses.
 *
 * Replaces the npm `mime-types` dep per spec §8.3 with a static lookup table
 * covering the extensions veryfront serves (web assets, fonts, images, MDX,
 * WASM, source maps). For unknown extensions `lookup()` returns `false`, which
 * matches the original module's sentinel value.
 */

/**
 * Canonical extension → MIME mapping. Order matters for reverse lookup via
 * `extension()`: the first extension encountered for a given MIME wins, so
 * list the preferred canonical extension first (e.g. `html` before `htm`,
 * `jpg` before `jpeg`). `json` is listed before `map` so source-map MIMEs
 * still resolve to a reasonable extension via forward lookup, while
 * `extension("application/json")` returns `"json"`.
 */
const TABLE: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  json: "application/json",
  map: "application/json",
  jsonld: "application/ld+json",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/vnd.microsoft.icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  mdx: "text/markdown",
  wasm: "application/wasm",
};

// Reverse lookup: mime → first-listed extension from TABLE.
const EXT_BY_MIME: Record<string, string> = (() => {
  const reverse: Record<string, string> = {};
  for (const [ext, mime] of Object.entries(TABLE)) {
    if (!(mime in reverse)) reverse[mime] = ext;
  }
  return reverse;
})();

/**
 * Look up the MIME type for a file path or bare extension. Accepts values
 * with or without a leading dot. Returns `false` when no mapping is known.
 */
export function lookup(path: string): string | false {
  const dot = path.lastIndexOf(".");
  const ext = (dot >= 0 ? path.slice(dot + 1) : path).toLowerCase();
  return TABLE[ext] ?? false;
}

/**
 * Return `"UTF-8"` for MIME types whose payload is text (text/*, JS, JSON).
 * Returns `false` otherwise — matching the original module's sentinel.
 */
export function charset(mime: string): string | false {
  if (
    mime.startsWith("text/") ||
    mime === "application/javascript" ||
    mime === "application/json"
  ) {
    return "UTF-8";
  }
  return false;
}

/**
 * Reverse of `lookup()`: given a MIME type, return a canonical file extension
 * (without leading dot) or `false` when unknown.
 */
export function extension(mime: string): string | false {
  return EXT_BY_MIME[mime] ?? false;
}

export default { lookup, charset, extension };
