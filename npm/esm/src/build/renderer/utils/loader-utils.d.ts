import type * as esbuild from "esbuild";
type FileType = "mdx" | "tsx" | "ts" | "jsx" | "js" | "css" | "json";
export declare function getLoaderFromPath(path: string): esbuild.Loader;
export declare function getFileType(path: string): FileType;
export declare function getSlugFromPath(path: string): string;
export {};
//# sourceMappingURL=loader-utils.d.ts.map