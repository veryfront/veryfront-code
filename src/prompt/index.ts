/**
 * Declare and register prompts exposable over MCP.
 *
 * @module prompt
 *
 * @example
 * ```ts
 * import { prompt } from "veryfront/prompt";
 *
 * const summarize = prompt({
 *   id: "summarize",
 *   description: "Summarize text in a chosen style",
 *   content: "Summarize the following text in {style} style:\n\n{text}",
 * });
 * ```
 */

export type { Prompt, PromptConfig } from "./types.ts";
export { prompt } from "./factory.ts";
export { promptRegistry } from "./registry.ts";
