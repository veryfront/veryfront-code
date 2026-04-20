/**
 * Inline implementation of the `mime-types` module surface veryfront uses.
 *
 * API-compatible with the MIT-licensed `mime-types` npm package — this is a
 * clean-room rewrite against the public API; no source was copied. MIME
 * values are IANA-assigned identifiers (not copyrightable).
 *
 * Replaces the npm `mime-types` dep per spec §8.3 with a static lookup table.
 * Covers the extensions veryfront serves internally (web assets, fonts, MDX,
 * WASM, source maps) plus the common upload formats users pass to the
 * `veryfront uploads` CLI — CSV, ZIP archives, office docs, audio/video —
 * so `lookupMimeType()` doesn't silently collapse them to
 * `application/octet-stream`. For unknown extensions `lookup()` still
 * returns `false`, matching the original module's sentinel value.
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
  // Web markup / styles / scripts
  html: "text/html",
  htm: "text/html",
  xhtml: "application/xhtml+xml",
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  cjs: "application/javascript",
  json: "application/json",
  map: "application/json",
  jsonld: "application/ld+json",
  xml: "application/xml",
  rss: "application/rss+xml",
  atom: "application/atom+xml",
  // Images
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/vnd.microsoft.icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  // Fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  // Documents
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  mdx: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  // Archives
  zip: "application/zip",
  gz: "application/gzip",
  tgz: "application/gzip",
  tar: "application/x-tar",
  "7z": "application/x-7z-compressed",
  bz2: "application/x-bzip2",
  rar: "application/vnd.rar",
  // Audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/ogg",
  // Video
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  // Config / data
  yaml: "text/yaml",
  yml: "text/yaml",
  toml: "application/toml",
  // WASM + source maps
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
