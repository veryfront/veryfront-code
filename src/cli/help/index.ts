/**
 * CLI help system - Barrel exports
 * @module
 */

// Public API
export { showMainHelp } from "./main-help.ts";
export { showCommandHelp } from "./command-help.ts";
export { showAsciiLogo } from "./logo.ts";

// Types
export type { CommandHelp, CommandOption, CommandRegistry } from "./types.ts";

// Command definitions (for extension/testing)
export { COMMANDS } from "./command-definitions.ts";
