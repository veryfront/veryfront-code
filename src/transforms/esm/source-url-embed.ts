/**
 * Source URL embedding for cache resilience.
 *
 * Embeds source URLs in cached bundles as preserved comments for self-contained
 * recovery when distributed cache has orphaned references.
 *
 * @module transforms/esm/source-url-embed
 */

import { gunzipSync } from "node:zlib";
import { rendererLogger as logger } from "#veryfront/utils";

/** Preserved comment format that survives minification */
export const VF_SOURCE_PREFIX = "/*! @vf-source: ";
export const VF_SOURCE_SUFFIX = " */\n";

/**
 * Embed the source URL in bundle code as a preserved comment.
 * This enables recovery when URL mapping is missing from distributed cache.
 */
export function embedSourceUrl(code: string, sourceUrl: string): string {
  if (code.startsWith(VF_SOURCE_PREFIX)) return code;
  return `${VF_SOURCE_PREFIX}${sourceUrl}${VF_SOURCE_SUFFIX}${code}`;
}

/**
 * Extract the embedded source URL from bundle code.
 */
export function extractSourceUrl(code: string): string | null {
  if (!code.startsWith(VF_SOURCE_PREFIX)) return null;
  const endIndex = code.indexOf(VF_SOURCE_SUFFIX);
  if (endIndex === -1) return null;
  return code.slice(VF_SOURCE_PREFIX.length, endIndex).trim();
}

/**
 * Check if code has an embedded source URL.
 */
export function _hasEmbeddedSourceUrl(code: string): boolean {
  return code.startsWith(VF_SOURCE_PREFIX);
}

/**
 * Decode gzip-compressed cache content.
 * Returns the decompressed string, or null if decompression fails.
 */
export function decodeGzipContent(content: string): string | null {
  const base64Data = content.startsWith("gz:")
    ? content.slice(3)
    : content.startsWith("gzip:")
    ? content.slice(5)
    : null;

  if (!base64Data) return null;

  try {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const decompressed = gunzipSync(bytes);
    return new TextDecoder().decode(decompressed);
  } catch (error) {
    logger.debug("[HTTP-CACHE] Failed to decode gzip content", { error });
    return null;
  }
}

/**
 * Try to decode content if it's gzip-encoded, otherwise return as-is.
 * Returns [decodedContent, wasGzipped] tuple.
 */
export function _maybeDecodeGzip(content: string): [string, boolean] {
  if (!content.startsWith("gz:") && !content.startsWith("gzip:")) return [content, false];

  const decoded = decodeGzipContent(content);
  if (decoded) return [decoded, true];

  return [content, false];
}
