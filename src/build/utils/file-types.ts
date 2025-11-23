/**
 * Centralized file type detection and handling for build module
 * Consolidates all file type checking logic in one place
 */

import { extname } from "std/path/mod.ts";

/**
 * Supported image formats
 */
export type ImageFormat = "jpeg" | "jpg" | "png" | "webp" | "avif" | "gif" | "svg";

/**
 * Supported script formats
 */
export type ScriptFormat = "js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs";

/**
 * Supported style formats
 */
export type StyleFormat = "css" | "scss" | "sass" | "less";

/**
 * Supported document formats
 */
export type DocumentFormat = "md" | "mdx";

/**
 * All supported file extensions
 */
export const FILE_EXTENSIONS = {
  IMAGE: [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg"] as const,
  SCRIPT: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"] as const,
  STYLE: [".css", ".scss", ".sass", ".less"] as const,
  DOCUMENT: [".md", ".mdx"] as const,
} as const;

/**
 * esbuild loader types mapping
 */
export const ESBUILD_LOADERS = {
  ".js": "js",
  ".jsx": "jsx",
  ".ts": "ts",
  ".tsx": "tsx",
  ".mjs": "js",
  ".cjs": "js",
  ".json": "json",
  ".css": "css",
  ".scss": "css",
  ".sass": "css",
  ".less": "css",
  ".md": "text",
  ".mdx": "tsx",
  ".svg": "text",
  ".html": "text",
} as const;

/**
 * Check if file is an image based on extension
 */
export function isImageFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return FILE_EXTENSIONS.IMAGE.includes(ext as any);
}

/**
 * Check if file is a script based on extension
 */
export function isScriptFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return FILE_EXTENSIONS.SCRIPT.includes(ext as any);
}

/**
 * Check if file is a style file based on extension
 */
export function isStyleFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return FILE_EXTENSIONS.STYLE.includes(ext as any);
}

/**
 * Check if file is a document (markdown/mdx) based on extension
 */
export function isDocumentFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return FILE_EXTENSIONS.DOCUMENT.includes(ext as any);
}

/**
 * Get optimized image format based on input format
 */
export function getOptimizedImageFormat(originalFormat: string): ImageFormat {
  const format = originalFormat.toLowerCase().replace(".", "");
  switch (format) {
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "avif":
      return "avif";
    case "gif":
      return "gif";
    case "svg":
      return "svg";
    default:
      // Default to JPEG for unknown formats
      return "jpeg";
  }
}

/**
 * Get esbuild loader type from file path
 */
export function getEsbuildLoader(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return ESBUILD_LOADERS[ext as keyof typeof ESBUILD_LOADERS] || "text";
}

/**
 * Get file type category
 */
export type FileCategory = "image" | "script" | "style" | "document" | "other";

export function getFileCategory(filePath: string): FileCategory {
  if (isImageFile(filePath)) return "image";
  if (isScriptFile(filePath)) return "script";
  if (isStyleFile(filePath)) return "style";
  if (isDocumentFile(filePath)) return "document";
  return "other";
}

/**
 * Check if file needs transpilation
 */
export function needsTranspilation(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === ".ts" || ext === ".tsx" || ext === ".jsx" || ext === ".mdx";
}

/**
 * Check if file is a TypeScript file
 */
export function isTypeScriptFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === ".ts" || ext === ".tsx";
}

/**
 * Check if file is a JSX/TSX file
 */
export function isJSXFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === ".jsx" || ext === ".tsx";
}

/**
 * Check if file is an MDX file
 */
export function isMDXFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === ".mdx";
}

/**
 * Get MIME type for file
 */
export function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    // Images
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    // Scripts
    ".js": "application/javascript",
    ".jsx": "application/javascript",
    ".ts": "application/typescript",
    ".tsx": "application/typescript",
    ".mjs": "application/javascript",
    ".cjs": "application/javascript",
    ".json": "application/json",
    // Styles
    ".css": "text/css",
    ".scss": "text/x-scss",
    ".sass": "text/x-sass",
    ".less": "text/x-less",
    // Documents
    ".md": "text/markdown",
    ".mdx": "text/mdx",
    ".html": "text/html",
    ".xml": "application/xml",
  };

  return mimeTypes[ext] || "application/octet-stream";
}
