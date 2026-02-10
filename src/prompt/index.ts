/**
 * Prompt definition and registry. Provides a factory function to declare
 * prompts that are discoverable and exposable over MCP.
 *
 * @module prompt
 */

export type { Prompt, PromptConfig } from "./types.ts";
export { prompt } from "./factory.ts";
export { promptRegistry } from "./registry.ts";
