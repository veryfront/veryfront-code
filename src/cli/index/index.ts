export type { BuildCommandArgs, GenerateCommandArgs, ParsedArgs } from "./types.ts";
export { parseArrayArg, parseCliArgs } from "./arg-parser.ts";
export { routeCommand } from "./command-router.ts";

// Handler exports from command subdirectories
export { handleBuildCommand } from "../commands/build/handler.ts";
export { handleGenerateCommand } from "../commands/generate/handler.ts";
export { handleDevCommand } from "../commands/dev/handler.ts";

// Command exports
export * from "../commands/analyze-chunks/index.ts";
export * from "../commands/build.ts";
export * from "../commands/clean/index.ts";
export * from "../commands/dev/index.ts";
export * from "../commands/doctor/index.ts";
export * from "../commands/generate/index.ts";
export * from "../commands/init/index.ts";
export * from "../commands/routes/index.ts";

export * from "../utils/index.ts";
