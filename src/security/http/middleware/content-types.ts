/**
 * Content type mappings
 *
 * @module security/middleware/content-types
 */

import {
  HTTP_CONTENT_TYPE_IMAGE_GIF,
  HTTP_CONTENT_TYPE_IMAGE_ICO,
  HTTP_CONTENT_TYPE_IMAGE_JPEG,
  HTTP_CONTENT_TYPE_IMAGE_PNG,
  HTTP_CONTENT_TYPE_IMAGE_SVG,
  HTTP_CONTENT_TYPE_IMAGE_WEBP,
} from "#veryfront/utils/constants/http.ts";

/**
 * MIME type mappings for common file extensions
 *
 * Maps file extensions (with leading dot) to their MIME types.
 * Includes charset for text-based formats.
 *
 * @example
 * ```ts
 * const contentType = CONTENT_TYPES['.html']
 * console.log(contentType) // 'text/html; charset=utf-8'
 * ```
 */
export const CONTENT_TYPES: Record<string, string> = {
  // Text formats
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",

  // JavaScript
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",

  // Data formats
  ".json": "application/json; charset=utf-8",

  // Images
  ".png": HTTP_CONTENT_TYPE_IMAGE_PNG,
  ".jpg": HTTP_CONTENT_TYPE_IMAGE_JPEG,
  ".jpeg": HTTP_CONTENT_TYPE_IMAGE_JPEG,
  ".gif": HTTP_CONTENT_TYPE_IMAGE_GIF,
  ".svg": HTTP_CONTENT_TYPE_IMAGE_SVG,
  ".ico": HTTP_CONTENT_TYPE_IMAGE_ICO,
  ".webp": HTTP_CONTENT_TYPE_IMAGE_WEBP,

  // Fonts
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};
