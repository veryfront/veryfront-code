/**
 * Cross-runtime React path resolution.
 *
 * Provides consistent React module resolution for Bun/Node SSR.
 * This ensures the same React instance is used by both user components
 * and react-dom-server, preventing "Objects are not valid as a React child"
 * or "Cannot read properties of null (reading 'useState')" errors.
 *
 * @module
 */
export declare function getLocalReactPaths(): Record<string, string>;
export declare function isReactSpecifier(specifier: string): boolean;
export declare function clearReactPathsCache(): void;
//# sourceMappingURL=react-paths.d.ts.map