/**
 * Centralized file type detection and handling for build module
 * Consolidates all file type checking logic in one place
 */
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
export declare const FILE_EXTENSIONS: {
    readonly IMAGE: readonly [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg"];
    readonly SCRIPT: readonly [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];
    readonly STYLE: readonly [".css", ".scss", ".sass", ".less"];
    readonly DOCUMENT: readonly [".md", ".mdx"];
};
/**
 * esbuild loader types mapping
 */
export declare const ESBUILD_LOADERS: {
    readonly ".js": "js";
    readonly ".jsx": "jsx";
    readonly ".ts": "ts";
    readonly ".tsx": "tsx";
    readonly ".mjs": "js";
    readonly ".cjs": "js";
    readonly ".json": "json";
    readonly ".css": "css";
    readonly ".scss": "css";
    readonly ".sass": "css";
    readonly ".less": "css";
    readonly ".md": "text";
    readonly ".mdx": "tsx";
    readonly ".svg": "text";
    readonly ".html": "text";
};
/**
 * Check if file is an image based on extension
 */
export declare function isImageFile(filePath: string): boolean;
/**
 * Check if file is a script based on extension
 */
export declare function isScriptFile(filePath: string): boolean;
/**
 * Check if file is a style file based on extension
 */
export declare function isStyleFile(filePath: string): boolean;
/**
 * Check if file is a document (markdown/mdx) based on extension
 */
export declare function isDocumentFile(filePath: string): boolean;
/**
 * Get optimized image format based on input format
 */
export declare function getOptimizedImageFormat(originalFormat: string): ImageFormat;
/**
 * Get esbuild loader type from file path
 */
export declare function getEsbuildLoader(filePath: string): string;
/**
 * Get file type category
 */
export type FileCategory = "image" | "script" | "style" | "document" | "other";
export declare function getFileCategory(filePath: string): FileCategory;
/**
 * Check if file needs transpilation
 */
export declare function needsTranspilation(filePath: string): boolean;
/**
 * Check if file is a TypeScript file
 */
export declare function isTypeScriptFile(filePath: string): boolean;
/**
 * Check if file is a JSX/TSX file
 */
export declare function isJSXFile(filePath: string): boolean;
/**
 * Check if file is an MDX file
 */
export declare function isMDXFile(filePath: string): boolean;
/**
 * Get MIME type for file
 */
export declare function getMimeType(filePath: string): string;
//# sourceMappingURL=file-types.d.ts.map