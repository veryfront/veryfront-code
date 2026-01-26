/****
 * ESBuild context creation and configuration
 * @module code-splitter/build-context
 */
import { type BuildContext } from "esbuild";
import type { SplitOptions } from "./types.js";
/** Gets list of external dependencies to exclude from bundle */
export declare function getExternalDependencies(customExternal?: string[], moduleResolution?: "cdn" | "self-hosted" | "bundled"): string[];
/** Creates a browser shim file for global compatibility */
export declare function createShimFile(outDir: string): Promise<string>;
/** Creates an ESBuild context with code splitting configuration */
export declare function createBuildContext(options: SplitOptions, entryPoints: Record<string, string>): Promise<BuildContext>;
//# sourceMappingURL=build-context.d.ts.map