/**
 * Centralized file type detection and handling for build module
 * Consolidates all file type checking logic in one place
 */

import { extname } from "../../platform/compat/path/index.js";

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

type ImageExtension = (typeof FILE_EXTENSIONS.IMAGE)[number];
type ScriptExtension = (typeof FILE_EXTENSIONS.SCRIPT)[number];
type StyleExtension = (typeof FILE_EXTENSIONS.STYLE)[number];
type DocumentExtension = (typeof FILE_EXTENSIONS.DOCUMENT)[number];

function getLowerExt(filePath: string): string {
  return extname(filePath).toLowerCase();
}

function isInArray<T extends string>(arr: readonly T[], value: string): value is T {
  return (arr as readonly string[]).includes(value);
}

/**
 * Check if file is an image based on extension
 */
export function isImageFile(filePath: string): boolean {
  return isInArray<ImageExtension>(FILE_EXTENSIONS.IMAGE, getLowerExt(filePath));
}

/**
 * Check if file is a script based on extension
 */
export function isScriptFile(filePath: string): boolean {
  return isInArray<ScriptExtension>(FILE_EXTENSIONS.SCRIPT, getLowerExt(filePath));
}

/**
 * Check if file is a style file based on extension
 */
export function isStyleFile(filePath: string): boolean {
  return isInArray<StyleExtension>(FILE_EXTENSIONS.STYLE, getLowerExt(filePath));
}

/**
 * Check if file is a document (markdown/mdx) based on extension
 */
export function isDocumentFile(filePath: string): boolean {
  return isInArray<DocumentExtension>(FILE_EXTENSIONS.DOCUMENT, getLowerExt(filePath));
}

const IMAGE_FORMAT_MAP: Record<string, ImageFormat> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  avif: "avif",
  gif: "gif",
  svg: "svg",
};

/**
 * Get optimized image format based on input format
 */
export function getOptimizedImageFormat(originalFormat: string): ImageFormat {
  const format = originalFormat.toLowerCase().replace(".", "");
  return IMAGE_FORMAT_MAP[format] ?? "jpeg";
}

/**
 * Get esbuild loader type from file path
 */
export function getEsbuildLoader(filePath: string): string {
  const ext = getLowerExt(filePath);
  return ESBUILD_LOADERS[ext as keyof typeof ESBUILD_LOADERS] ?? "text";
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
  const ext = getLowerExt(filePath);
  return ext === ".ts" || ext === ".tsx" || ext === ".jsx" || ext === ".mdx";
}

/**
 * Check if file is a TypeScript file
 */
export function isTypeScriptFile(filePath: string): boolean {
  const ext = getLowerExt(filePath);
  return ext === ".ts" || ext === ".tsx";
}

/**
 * Check if file is a JSX/TSX file
 */
export function isJSXFile(filePath: string): boolean {
  const ext = getLowerExt(filePath);
  return ext === ".jsx" || ext === ".tsx";
}

/**
 * Check if file is an MDX file
 */
export function isMDXFile(filePath: string): boolean {
  return getLowerExt(filePath) === ".mdx";
}

const MIME_TYPES: Record<string, string> = {
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

/**
 * Get MIME type for file
 */
export function getMimeType(filePath: string): string {
  return MIME_TYPES[getLowerExt(filePath)] ?? "application/octet-stream";
}
