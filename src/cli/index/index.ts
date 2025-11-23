/**
 * CLI module - Barrel exports
 *
 * @module cli/index
 */

// Main entry point
export { main } from "./cli-main.ts";

// Types
export type { BuildCommandArgs, GenerateCommandArgs, ParsedArgs } from "./types.ts";

// Utilities
export { parseArrayArg, parseCliArgs } from "./arg-parser.ts";
export { exitProcess } from "../utils/index.ts";
export { handleBuildCommand } from "./build-handler.ts";
export { handleGenerateCommand } from "./generate-handler.ts";
export { handleDevCommand } from "./dev-handler.ts";
export { routeCommand } from "./command-router.ts";

// Command exports (re-export from commands)
export * from "../commands/analyze-chunks.ts";
export * from "../commands/build.ts";
export * from "../commands/clean.ts";
export * from "../commands/dev.ts";
export * from "../commands/doctor/index.ts";
export * from "../commands/generate.ts";
export * from "../commands/init/index.ts";
export * from "../commands/routes.ts";

// Utility exports
export * from "../utils/index.ts";
