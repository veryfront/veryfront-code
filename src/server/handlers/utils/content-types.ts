/**
 * Content type utilities
 */

import {
  HTTP_CONTENT_TYPE_IMAGE_GIF,
  HTTP_CONTENT_TYPE_IMAGE_ICO,
  HTTP_CONTENT_TYPE_IMAGE_JPEG,
  HTTP_CONTENT_TYPE_IMAGE_PNG,
  HTTP_CONTENT_TYPE_IMAGE_SVG,
  HTTP_CONTENT_TYPE_IMAGE_WEBP,
} from "@veryfront/utils";

/**
 * Content type mappings by file extension
 */
export const CONTENT_TYPES: Record<string, string> = {
  // Documents
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",

  // Scripts
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".cjs": "application/javascript; charset=utf-8",
  ".ts": "application/typescript; charset=utf-8",
  ".tsx": "application/typescript; charset=utf-8",
  ".jsx": "application/javascript; charset=utf-8",

  // Styles
  ".css": "text/css; charset=utf-8",
  ".scss": "text/x-scss; charset=utf-8",
  ".sass": "text/x-sass; charset=utf-8",
  ".less": "text/x-less; charset=utf-8",

  // Data
  ".json": "application/json; charset=utf-8",
  ".jsonld": "application/ld+json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".toml": "application/toml; charset=utf-8",

  // Images
  ".png": HTTP_CONTENT_TYPE_IMAGE_PNG,
  ".jpg": HTTP_CONTENT_TYPE_IMAGE_JPEG,
  ".jpeg": HTTP_CONTENT_TYPE_IMAGE_JPEG,
  ".gif": HTTP_CONTENT_TYPE_IMAGE_GIF,
  ".svg": HTTP_CONTENT_TYPE_IMAGE_SVG,
  ".ico": HTTP_CONTENT_TYPE_IMAGE_ICO,
  ".webp": HTTP_CONTENT_TYPE_IMAGE_WEBP,
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",

  // Fonts
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",

  // Audio
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",

  // Video
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".mkv": "video/x-matroska",

  // Archives
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".bz2": "application/x-bzip2",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",

  // Documents
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",

  // WebAssembly
  ".wasm": "application/wasm",
};

/**
 * Get content type for file extension
 */
export function getContentType(extension: string): string {
  return CONTENT_TYPES[extension.toLowerCase()] || "application/octet-stream";
}

/**
 * Get content type from file path
 */
export function getContentTypeForPath(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) {
    return "application/octet-stream";
  }
  const ext = path.slice(lastDot);
  return getContentType(ext);
}

/**
 * Check if content type is compressible
 */
export function isCompressible(contentType: string): boolean {
  // Text-based formats are compressible
  if (contentType.startsWith("text/")) return true;
  if (contentType.includes("javascript")) return true;
  if (contentType.includes("json")) return true;
  if (contentType.includes("xml")) return true;
  if (contentType.includes("svg")) return true;

  // Already compressed formats
  if (contentType.includes("gzip")) return false;
  if (contentType.includes("zip")) return false;
  if (contentType.includes("compressed")) return false;
  if (contentType.includes("jpeg")) return false;
  if (contentType.includes("jpg")) return false;
  if (contentType.includes("png")) return false;
  if (contentType.includes("webp")) return false;
  if (contentType.includes("avif")) return false;

  return false;
}

/**
 * Check if content type is cacheable
 */
export function isCacheable(contentType: string): boolean {
  // Images, fonts, and static assets are generally cacheable
  if (contentType.startsWith("image/")) return true;
  if (contentType.startsWith("font/")) return true;
  if (contentType.includes("javascript")) return true;
  if (contentType.includes("css")) return true;

  // Dynamic content is not cacheable by default
  if (contentType.includes("html")) return false;
  if (contentType.includes("json")) return false;

  return false;
}
