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
export { devCommand } from "./dev.ts";
export { generateCommand } from "./generate.ts";
export { studioCommand } from "./studio.ts";
export { analyzeChunksCommand } from "./analyze-chunks.ts";
export { cleanCommand } from "./clean.ts";
export { lockCommand } from "./lock.ts";
export { routesCommand } from "./routes.ts";
export { issuesCommand } from "./issues.ts";
export { pullCommand } from "./pull.ts";
export { pushCommand } from "./push.ts";
export { mergeCommand } from "./merge.ts";
export { deployCommand } from "./deploy.ts";
export { upCommand } from "./up.ts";
export { newCommand } from "./new.ts";
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
