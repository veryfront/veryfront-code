/**
 * Centralized file type detection and handling for build module
 * Consolidates all file type checking logic in one place
 */
import { extname } from "../../platform/compat/path/index.js";
/**
 * All supported file extensions
 */
export const FILE_EXTENSIONS = {
    IMAGE: [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg"],
    SCRIPT: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"],
    STYLE: [".css", ".scss", ".sass", ".less"],
    DOCUMENT: [".md", ".mdx"],
};
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
};
function getLowerExt(filePath) {
    return extname(filePath).toLowerCase();
}
function isInArray(arr, value) {
    return arr.includes(value);
}
/**
 * Check if file is an image based on extension
 */
export function isImageFile(filePath) {
    return isInArray(FILE_EXTENSIONS.IMAGE, getLowerExt(filePath));
}
/**
 * Check if file is a script based on extension
 */
export function isScriptFile(filePath) {
    return isInArray(FILE_EXTENSIONS.SCRIPT, getLowerExt(filePath));
}
/**
 * Check if file is a style file based on extension
 */
export function isStyleFile(filePath) {
    return isInArray(FILE_EXTENSIONS.STYLE, getLowerExt(filePath));
}
/**
 * Check if file is a document (markdown/mdx) based on extension
 */
export function isDocumentFile(filePath) {
    return isInArray(FILE_EXTENSIONS.DOCUMENT, getLowerExt(filePath));
}
const IMAGE_FORMAT_MAP = {
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
export function getOptimizedImageFormat(originalFormat) {
    const format = originalFormat.toLowerCase().replace(".", "");
    return IMAGE_FORMAT_MAP[format] ?? "jpeg";
}
/**
 * Get esbuild loader type from file path
 */
export function getEsbuildLoader(filePath) {
    const ext = getLowerExt(filePath);
    return ESBUILD_LOADERS[ext] ?? "text";
}
export function getFileCategory(filePath) {
    if (isImageFile(filePath))
        return "image";
    if (isScriptFile(filePath))
        return "script";
    if (isStyleFile(filePath))
        return "style";
    if (isDocumentFile(filePath))
        return "document";
    return "other";
}
/**
 * Check if file needs transpilation
 */
export function needsTranspilation(filePath) {
    const ext = getLowerExt(filePath);
    return ext === ".ts" || ext === ".tsx" || ext === ".jsx" || ext === ".mdx";
}
/**
 * Check if file is a TypeScript file
 */
export function isTypeScriptFile(filePath) {
    const ext = getLowerExt(filePath);
    return ext === ".ts" || ext === ".tsx";
}
/**
 * Check if file is a JSX/TSX file
 */
export function isJSXFile(filePath) {
    const ext = getLowerExt(filePath);
    return ext === ".jsx" || ext === ".tsx";
}
/**
 * Check if file is an MDX file
 */
export function isMDXFile(filePath) {
    return getLowerExt(filePath) === ".mdx";
}
const MIME_TYPES = {
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
export function getMimeType(filePath) {
    return MIME_TYPES[getLowerExt(filePath)] ?? "application/octet-stream";
}
