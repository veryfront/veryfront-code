import type { RSCPayload } from "./types.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";
import { HASH_SEED_FNV1A } from "#veryfront/utils";

const FNV1A_PRIME = 16_777_619;
const FNV1A_OFFSET_BASIS_64 = 14_695_981_039_346_656_037n;
const FNV1A_PRIME_64 = 1_099_511_628_211n;
const FNV1A_MASK_64 = (1n << 64n) - 1n;
const MAX_SAFE_CACHE_AGE_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 4);
const RAW_TEXT_ELEMENTS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

function updateHash(hash: number, value: string): number {
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV1A_PRIME);
  }
  return hash;
}

function updateHash64(hash: bigint, value: string): bigint {
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * FNV1A_PRIME_64) & FNV1A_MASK_64;
  }
  return hash;
}

function updateLengthDelimitedHash64(
  hash: bigint,
  label: string,
  value: string,
): bigint {
  hash = updateHash64(hash, label);
  hash = updateHash64(hash, ":");
  hash = updateHash64(hash, String(value.length));
  hash = updateHash64(hash, ":");
  return updateHash64(hash, value);
}

function hashText(value: string): string {
  return (updateHash(HASH_SEED_FNV1A, value) >>> 0).toString(36);
}

export class RSCProductionOptimizer {
  static optimizePayload(payload: RSCPayload): RSCPayload {
    return {
      html: RSCProductionOptimizer.minifyHTML(payload.html),
      clientRefs: { ...payload.clientRefs },
      assets: payload.assets
        ? {
          css: payload.assets.css ? [...payload.assets.css] : undefined,
          js: payload.assets.js ? [...payload.assets.js] : undefined,
        }
        : undefined,
      tree: undefined,
    };
  }

  private static minifyHTML(html: string): string {
    return stripHtmlComments(html).trim();
  }

  static getCacheHeaders(
    options: { isStatic?: boolean; maxAge?: number } = {},
  ): Record<string, string> {
    const { isStatic = false, maxAge = 0 } = options;

    if (
      !isStatic ||
      !Number.isSafeInteger(maxAge) ||
      maxAge <= 0 ||
      maxAge > MAX_SAFE_CACHE_AGE_SECONDS
    ) {
      return {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      };
    }

    return {
      "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`,
      "CDN-Cache-Control": `max-age=${maxAge * 4}`,
    };
  }

  static generateETag(payload: RSCPayload): string {
    let hash = FNV1A_OFFSET_BASIS_64;

    hash = updateLengthDelimitedHash64(hash, "html", payload.html);

    for (const key of Object.keys(payload.clientRefs).sort()) {
      hash = updateLengthDelimitedHash64(hash, "client-ref-key", key);
      hash = updateLengthDelimitedHash64(
        hash,
        "client-ref-value",
        payload.clientRefs[key] ?? "",
      );
    }

    for (const asset of payload.assets?.css ?? []) {
      hash = updateLengthDelimitedHash64(hash, "css-asset", asset);
    }

    for (const asset of payload.assets?.js ?? []) {
      hash = updateLengthDelimitedHash64(hash, "js-asset", asset);
    }

    return `"${hash.toString(36).padStart(13, "0")}"`;
  }

  static checkETag(requestETag: string | null, payloadETag: string): boolean {
    if (!requestETag) return false;

    const normalizeETag = (etag: string): string => {
      let normalized = etag.trim();
      if (normalized.startsWith("W/")) normalized = normalized.slice(2).trimStart();
      if (normalized.startsWith('"') && normalized.endsWith('"')) {
        normalized = normalized.slice(1, -1);
      }
      return normalized;
    };
    const normalizedPayloadETag = normalizeETag(payloadETag);

    return requestETag.split(",").some((candidate) => {
      const trimmed = candidate.trim();
      return trimmed === "*" || normalizeETag(trimmed) === normalizedPayloadETag;
    });
  }

  static optimizeClientRefs(
    clientRefs: Record<string, string>,
    cdnPrefix?: string,
  ): Record<string, string> {
    if (!cdnPrefix) return clientRefs;

    return Object.fromEntries(
      Object.entries(clientRefs).map(([id, path]) => [id, `${cdnPrefix}${path}`]),
    );
  }

  static bundlePayloads(payloads: Map<string, RSCPayload>): {
    bundles: Record<string, RSCPayload>;
    manifest: Record<string, string[]>;
  } {
    const bundles: Record<string, RSCPayload> = {};
    const manifest: Record<string, string[]> = {};
    const baseCounts = new Map<string, number>();

    for (const route of payloads.keys()) {
      const base = RSCProductionOptimizer.generateBundleId(route);
      baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
    }

    for (const [route, payload] of payloads) {
      const base = RSCProductionOptimizer.generateBundleId(route);
      let bundleId = (baseCounts.get(base) ?? 0) > 1 ? `${base}_${hashText(route)}` : base;
      let collisionIndex = 1;
      while (Object.hasOwn(bundles, bundleId)) {
        bundleId = `${base}_${hashText(route)}_${collisionIndex++}`;
      }
      bundles[bundleId] = RSCProductionOptimizer.optimizePayload(payload);
      manifest[route] = Object.keys(payload.clientRefs);
    }

    return { bundles, manifest };
  }

  private static generateBundleId(route: string): string {
    return route.replace(/[^a-zA-Z0-9]/g, "_");
  }

  static generatePreloadLinks(clientRefs: Record<string, string>): string[] {
    return Object.values(clientRefs).map(
      (path) => `<link rel="modulepreload" href="${escapeHtml(path)}" as="script" crossorigin>`,
    );
  }

  /**
   * CSP directives for RSC JSON responses.
   * Note: For HTML responses, use the security config with nonce support instead.
   * This is intentionally strict since RSC responses are JSON, not HTML with inline scripts.
   */
  static getCSPDirectives(): Record<string, string[]> {
    return {
      "default-src": ["'none'"],
      "script-src": ["'self'", "https://esm.sh"],
      "style-src": ["'self'"],
      "connect-src": ["'self'", "https://esm.sh"],
      "img-src": ["'self'", "data:", "https:"],
      "font-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "form-action": ["'none'"],
      "frame-ancestors": ["'none'"],
      "upgrade-insecure-requests": [],
    };
  }

  static generateCSP(): string {
    const directives = RSCProductionOptimizer.getCSPDirectives();

    return Object.entries(directives)
      .map(([key, values]) => (values.length === 0 ? key : `${key} ${values.join(" ")}`))
      .join("; ");
  }
}

function stripHtmlComments(html: string): string {
  let cursor = 0;
  let rawTextElement: string | undefined;
  const output: string[] = [];

  while (cursor < html.length) {
    if (rawTextElement) {
      if (rawTextElement === "plaintext") {
        output.push(html.slice(cursor));
        break;
      }

      const closingTag = findRawTextClosingTag(html, rawTextElement, cursor);
      if (closingTag < 0) {
        output.push(html.slice(cursor));
        break;
      }
      output.push(html.slice(cursor, closingTag));
      cursor = closingTag;
      rawTextElement = undefined;
      continue;
    }

    if (html.startsWith("<!--", cursor)) {
      const commentEnd = html.indexOf("-->", cursor + 4);
      if (commentEnd < 0) {
        output.push(html.slice(cursor));
        break;
      }
      cursor = commentEnd + 3;
      continue;
    }

    if (html[cursor] !== "<") {
      const nextTag = html.indexOf("<", cursor);
      const end = nextTag < 0 ? html.length : nextTag;
      output.push(html.slice(cursor, end));
      cursor = end;
      continue;
    }

    const tagEnd = findTagEnd(html, cursor + 1);
    if (tagEnd < 0) {
      output.push(html.slice(cursor));
      break;
    }

    const tag = html.slice(cursor, tagEnd + 1);
    output.push(tag);
    const openedRawTextElement = getOpenedRawTextElement(tag);
    if (openedRawTextElement) rawTextElement = openedRawTextElement;
    cursor = tagEnd + 1;
  }

  return output.join("");
}

function findTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function getOpenedRawTextElement(tag: string): string | undefined {
  let cursor = 1;
  while (cursor < tag.length && isHtmlWhitespace(tag[cursor])) cursor++;
  if (
    tag[cursor] === "/" ||
    tag[cursor] === "!" ||
    tag[cursor] === "?" ||
    tag[cursor] === undefined
  ) {
    return undefined;
  }

  const nameStart = cursor;
  while (cursor < tag.length && isTagNameCharacter(tag[cursor])) cursor++;
  if (cursor === nameStart) return undefined;
  const name = tag.slice(nameStart, cursor).toLowerCase();
  if (!RAW_TEXT_ELEMENTS.has(name)) return undefined;
  return name;
}

function findRawTextClosingTag(
  html: string,
  tagName: string,
  start: number,
): number {
  let candidate = html.indexOf("<", start);
  while (candidate >= 0) {
    const nameStart = candidate + 2;
    const following = html[nameStart + tagName.length];
    if (
      html[candidate + 1] === "/" &&
      matchesAsciiCaseInsensitive(html, nameStart, tagName) &&
      (following === ">" ||
        following === "/" ||
        isHtmlWhitespace(following))
    ) {
      return candidate;
    }
    candidate = html.indexOf("<", candidate + 1);
  }
  return -1;
}

function matchesAsciiCaseInsensitive(
  value: string,
  start: number,
  expectedLowercase: string,
): boolean {
  if (start + expectedLowercase.length > value.length) return false;
  for (let index = 0; index < expectedLowercase.length; index++) {
    const code = value.charCodeAt(start + index);
    const lowercaseCode = code >= 65 && code <= 90 ? code + 32 : code;
    if (lowercaseCode !== expectedLowercase.charCodeAt(index)) return false;
  }
  return true;
}

function isHtmlWhitespace(value: string | undefined): boolean {
  return value === " " ||
    value === "\t" ||
    value === "\n" ||
    value === "\r" ||
    value === "\f";
}

function isTagNameCharacter(value: string | undefined): boolean {
  if (!value) return false;
  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    value === ":" ||
    value === "-";
}
