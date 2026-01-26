/**
 * Build Orchestrator Module
 *
 * Main orchestration module that coordinates the entire build process:
 * - Initializes build context
 * - Sets up build environment
 * - Collects routes
 * - Runs code splitting
 * - Executes build
 * - Generates outputs
 * - Performs cleanup
 */
import type { BuildOptions, BuildStats } from "../../../server/build-types.js";
import { cleanupCaches, cleanupRenderer, logBuildCompletion } from "./build-cleanup.js";
/**
 * Main build production orchestrator
 */
export declare function buildProduction(options: BuildOptions): Promise<BuildStats>;
export { cleanupCaches, cleanupRenderer, logBuildCompletion };
//# sourceMappingURL=build-orchestrator.d.ts.map