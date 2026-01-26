/**
 * Entry point creation and path conversion utilities
 * @module code-splitter/entry-points
 */
import type { SplitOptions } from "./types.js";
export interface EntryPointsResult {
    entryPoints: Record<string, string>;
    routeMap: Map<string, string>;
}
export declare function createEntryPoints(routes: SplitOptions["routes"]): EntryPointsResult;
export declare function convertPathToName(path: string): string;
//# sourceMappingURL=entry-points.d.ts.map