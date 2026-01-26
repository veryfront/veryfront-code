import {
  HTTP_CONTENT_TYPE_IMAGE_GIF,
  HTTP_CONTENT_TYPE_IMAGE_ICO,
  HTTP_CONTENT_TYPE_IMAGE_JPEG,
  HTTP_CONTENT_TYPE_IMAGE_PNG,
  HTTP_CONTENT_TYPE_IMAGE_SVG,
  HTTP_CONTENT_TYPE_IMAGE_WEBP,
} from "../../../utils/constants/http.js";

export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": HTTP_CONTENT_TYPE_IMAGE_PNG,
  ".jpg": HTTP_CONTENT_TYPE_IMAGE_JPEG,
  ".jpeg": HTTP_CONTENT_TYPE_IMAGE_JPEG,
  ".gif": HTTP_CONTENT_TYPE_IMAGE_GIF,
  ".svg": HTTP_CONTENT_TYPE_IMAGE_SVG,
  ".ico": HTTP_CONTENT_TYPE_IMAGE_ICO,
  ".webp": HTTP_CONTENT_TYPE_IMAGE_WEBP,
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};
