import {
  HTTP_CONTENT_TYPE_IMAGE_GIF,
  HTTP_CONTENT_TYPE_IMAGE_ICO,
  HTTP_CONTENT_TYPE_IMAGE_JPEG,
  HTTP_CONTENT_TYPE_IMAGE_PNG,
  HTTP_CONTENT_TYPE_IMAGE_SVG,
  HTTP_CONTENT_TYPE_IMAGE_WEBP,
} from "#veryfront/utils";

export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".cjs": "application/javascript; charset=utf-8",
  ".ts": "application/typescript; charset=utf-8",
  ".tsx": "application/typescript; charset=utf-8",
  ".jsx": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".scss": "text/x-scss; charset=utf-8",
  ".sass": "text/x-sass; charset=utf-8",
  ".less": "text/x-less; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonld": "application/ld+json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".toml": "application/toml; charset=utf-8",
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
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".mkv": "video/x-matroska",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".bz2": "application/x-bzip2",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".wasm": "application/wasm",
};

export function getContentType(extension: string): string {
  return CONTENT_TYPES[extension.toLowerCase()] || "application/octet-stream";
}

export function getContentTypeForPath(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) {
    return "application/octet-stream";
  }
  const ext = path.slice(lastDot);
  return getContentType(ext);
}

const COMPRESSIBLE_PATTERNS = ["javascript", "json", "xml", "svg"];
const COMPRESSED_PATTERNS = ["gzip", "zip", "compressed", "jpeg", "jpg", "png", "webp", "avif"];

export function isCompressible(contentType: string): boolean {
  if (contentType.startsWith("text/")) return true;
  if (COMPRESSIBLE_PATTERNS.some((p) => contentType.includes(p))) return true;
  if (COMPRESSED_PATTERNS.some((p) => contentType.includes(p))) return false;
  return false;
}

export function isCacheable(contentType: string): boolean {
  if (contentType.startsWith("image/")) return true;
  if (contentType.startsWith("font/")) return true;
  if (contentType.includes("javascript")) return true;
  if (contentType.includes("css")) return true;
  if (contentType.includes("html")) return false;
  if (contentType.includes("json")) return false;
  return false;
}
