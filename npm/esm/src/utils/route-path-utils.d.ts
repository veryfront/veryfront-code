/**************************
 * Route Path Utilities
 *
 * Consolidated utilities for route path handling, dynamic segment detection,
 * and route parameter extraction. Used across page rendering, routing, and build.
 **************************/
/** Supported page file extensions */
export declare const PAGE_EXTENSIONS: readonly [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"];
/** Supported component file extensions (subset of page extensions) */
export declare const COMPONENT_EXTENSIONS: readonly [".tsx", ".jsx", ".ts", ".js"];
/** Regex for matching and removing file extensions */
export declare const EXTENSION_REGEX: RegExp;
/**
 * Check if a segment name is a dynamic route segment.
 * Handles both directory names like "[id]" and file names like "[id].tsx"
 */
export declare function isDynamicSegment(name: string): boolean;
/**
 * Check if a route pattern contains any dynamic segments
 */
export declare function isDynamicRoute(pattern: string): boolean;
/**
 * Check if a segment is a catch-all segment ([...slug] or [[...slug]])
 */
export declare function isCatchAllSegment(name: string): boolean;
/**
 * Remove file extension from a path
 */
export declare function removeFileExtension(path: string): string;
/**
 * Extract parameter name from a dynamic segment.
 * "[id]" -> "id"
 * "[...slug]" -> "slug"
 * "[[...params]]" -> "params"
 */
export declare function extractParamName(segment: string): string;
/**
 * Router type detection result
 */
export interface RouterBasePath {
    type: "app" | "pages" | null;
    relativePath: string | null;
}
/**
 * Extract the router base path from a page entity ID.
 * Detects whether it's an App Router (/app/) or Pages Router (/pages/) path.
 */
export declare function extractRouterBasePath(pageEntityId: string): RouterBasePath;
/**
 * Result of route parameter extraction
 */
export interface ExtractedRouteParams {
    params: Record<string, string | string[]>;
    matched: boolean;
}
/**
 * Extract route parameters from a page entity ID and URL slug.
 * Handles both App Router and Pages Router patterns.
 *
 * @param pageEntityId - The page entity ID (file path)
 * @param slug - The URL slug to match against
 * @returns Extracted parameters and whether matching succeeded
 */
export declare function extractRouteParams(pageEntityId: string, slug: string): ExtractedRouteParams;
/**
 * Extract relative path from an absolute path by removing the project directory prefix.
 *
 * @param absolutePath - The absolute file path
 * @param projectDir - The project root directory
 * @returns The relative path within the project
 */
export declare function extractRelativePath(absolutePath: string, projectDir: string): string;
/**
 * Extract route params using pattern matching (for slug-mapper).
 * This is a more flexible version that works with route patterns directly.
 *
 * @param pattern - The route pattern (e.g., "[id]/posts/[...slug]")
 * @param slug - The URL slug to match
 * @returns Extracted params or null if no match
 */
export declare function extractParamsFromPattern(pattern: string, slug: string): Record<string, string | string[]> | null;
/**
 * Check if a pattern matches a slug
 */
export declare function matchesPattern(pattern: string, slug: string): boolean;
//# sourceMappingURL=route-path-utils.d.ts.map