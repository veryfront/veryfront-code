/**
 * Up command - Push and deploy in one step
 */

export { parseUpArgs, UpArgsSchema, upCommand } from "./command.ts";
export type { UpOptions } from "./command.ts";
export { handleUpCommand } from "./handler.ts";
