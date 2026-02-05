/**
 * CLI Commands - Central export for all CLI commands
 *
 * Commands are organized in subdirectories with:
 * - index.ts: Barrel file re-exporting command and handler
 * - handler.ts: Command handler (argument processing)
 * - Other files: Command implementation
 */

// Command implementations (used by handlers and router)
export { buildCommand } from "./build.ts";
export { devCommand } from "./dev/index.ts";
export { generateCommand } from "./generate/index.ts";
export { studioCommand } from "./studio/index.ts";
export { analyzeChunksCommand, handleAnalyzeChunksCommand } from "./analyze-chunks/index.ts";
export { cleanCommand, handleCleanCommand } from "./clean/index.ts";
export { handleLockCommand, lockCommand } from "./lock/index.ts";
export { handleRoutesCommand, routesCommand } from "./routes/index.ts";
export { handleIssuesCommand, issuesCommand } from "./issues/index.ts";
export { handlePullCommand, parsePullArgs, pullCommand } from "./pull/index.ts";
export { handlePushCommand, parsePushArgs, pushCommand } from "./push/index.ts";
export { handleMergeCommand, mergeCommand, parseMergeArgs } from "./merge/index.ts";
export { deployCommand, handleDeployCommand, parseDeployArgs } from "./deploy/index.ts";
export { handleUpCommand, parseUpArgs, UpArgsSchema, upCommand } from "./up/index.ts";
export type { UpOptions } from "./up/index.ts";
export { handleNewCommand, newCommand, parseNewArgs } from "./new/index.ts";
export { promptProjectName } from "./main.ts";

// Command handlers (for routing)
export { handleBuildCommand } from "./build/handler.ts";
export { handleDevCommand } from "./dev/handler.ts";
export { handleGenerateCommand } from "./generate/handler.ts";
export { handleStudioCommand } from "./studio/handler.ts";
export { handleStartCommand } from "./start/handler.ts";

// Subdirectory exports (init, doctor, install, demo need special handling)
export { initCommand } from "./init/index.ts";
export { doctorCommand } from "./doctor/index.ts";
export { installCommand, uninstallCommand } from "./install/index.ts";
