export { main } from "./cli-main.ts";
export type { BuildCommandArgs, GenerateCommandArgs, ParsedArgs } from "./types.ts";
export { parseArrayArg, parseCliArgs } from "./arg-parser.ts";
export { handleBuildCommand } from "./build-handler.ts";
export { handleGenerateCommand } from "./generate-handler.ts";
export { handleDevCommand } from "./dev-handler.ts";
export { routeCommand } from "./command-router.ts";

export * from "../commands/analyze-chunks.ts";
export * from "../commands/build.ts";
export * from "../commands/clean.ts";
export * from "../commands/dev.ts";
export * from "../commands/doctor/index.ts";
export * from "../commands/generate.ts";
export * from "../commands/init/index.ts";
export * from "../commands/routes.ts";
export * from "../commands/code.ts";

export * from "../utils/index.ts";
