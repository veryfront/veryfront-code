
import { extname } from "std/path/mod.ts";

export type ImageFormat = "jpeg" | "jpg" | "png" | "webp" | "avif" | "gif" | "svg";

export type ScriptFormat = "js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs";

export type StyleFormat = "css" | "scss" | "sass" | "less";

export type DocumentFormat = "md" | "mdx";

export const FILE_EXTENSIONS = {
  IMAGE: [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg"] as const,
  SCRIPT: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"] as const,
  STYLE: [".css", ".scss", ".sass", ".less"] as const,
  DOCUMENT: [".md", ".mdx"] as const,
} as const;

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

export function isImageFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return FILE_EXTENSIONS.IMAGE.includes(ext as any);
}

export function isScriptFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return FILE_EXTENSIONS.SCRIPT.includes(ext as any);
}

export function isStyleFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return FILE_EXTENSIONS.STYLE.includes(ext as any);
}

export function isDocumentFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return FILE_EXTENSIONS.DOCUMENT.includes(ext as any);
}

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
      return "jpeg";
  }
}

export function getEsbuildLoader(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return ESBUILD_LOADERS[ext as keyof typeof ESBUILD_LOADERS] || "text";
}

export type FileCategory = "image" | "script" | "style" | "document" | "other";

export function getFileCategory(filePath: string): FileCategory {
  if (isImageFile(filePath)) return "image";
  if (isScriptFile(filePath)) return "script";
  if (isStyleFile(filePath)) return "style";
  if (isDocumentFile(filePath)) return "document";
  return "other";
}

export function needsTranspilation(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === ".ts" || ext === ".tsx" || ext === ".jsx" || ext === ".mdx";
}

export function isTypeScriptFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === ".ts" || ext === ".tsx";
}

export function isJSXFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === ".jsx" || ext === ".tsx";
}

export function isMDXFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === ".mdx";
}

export function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".js": "application/javascript",
    ".jsx": "application/javascript",
    ".ts": "application/typescript",
    ".tsx": "application/typescript",
    ".mjs": "application/javascript",
    ".cjs": "application/javascript",
    ".json": "application/json",
    ".css": "text/css",
    ".scss": "text/x-scss",
    ".sass": "text/x-sass",
    ".less": "text/x-less",
    ".md": "text/markdown",
    ".mdx": "text/mdx",
    ".html": "text/html",
    ".xml": "application/xml",
  };

  return mimeTypes[ext] || "application/octet-stream";
}
