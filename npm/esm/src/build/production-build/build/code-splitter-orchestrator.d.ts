/**
 * Code Splitter Orchestrator Module
 *
 * Handles code splitting orchestration:
 * - Configuring the code splitter
 * - Running the splitting process
 * - Managing chunk manifests
 */
import { type ChunkManifest } from "../../bundler/index.js";
import type { RouteInfo } from "../../../server/build-types.js";
export interface SplitResult {
    manifest: ChunkManifest | null;
    chunks: number;
}
/**
 * Run code splitting on the provided routes
 */
export declare function runCodeSplitting(projectDir: string, outputDir: string, routes: RouteInfo[], enableSplitting: boolean, dryRun: boolean): Promise<SplitResult>;
//# sourceMappingURL=code-splitter-orchestrator.d.ts.map