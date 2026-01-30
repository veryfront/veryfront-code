/**
 * Shared helpers for MCP advanced tools.
 */
import { type FileSystem } from "../../../platform/compat/fs.js";
export type RouteType = "page" | "layout" | "api" | "error" | "loading" | "not-found";
export interface RouteInfo {
    path: string;
    type: RouteType;
    file: string;
    methods?: string[];
}
export interface ProjectContext {
    name: string;
    router: "app" | "pages";
    routes: RouteInfo[];
    directories: {
        app?: string;
        pages?: string;
        components?: string;
        lib?: string;
        ai?: string;
    };
    hasAI: boolean;
    integrations: string[];
    features: string[];
}
export interface ScaffoldResult {
    success: boolean;
    files: Array<{
        path: string;
        created: boolean;
    }>;
    message: string;
}
export declare function getFs(): FileSystem;
export declare function getProjectDir(projectPath?: string): string;
export declare function ensureDir(path: string): Promise<void>;
export declare function directoryExists(path: string): Promise<boolean>;
export declare function fileExists(path: string): Promise<boolean>;
export declare function toComponentName(slug: string): string;
export declare function toSlug(name: string): string;
export declare function formatError(error: unknown): string;
export declare function scanDirectory(dir: string, baseRoute: string, routes: RouteInfo[], fs: FileSystem): Promise<void>;
export declare const ROUTE_FILTER_MAP: Record<string, RouteType[]>;
//# sourceMappingURL=helpers.d.ts.map