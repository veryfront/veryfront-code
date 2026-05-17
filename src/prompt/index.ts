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
 *
 * const content = await summarize.getContent({
 *   style: "technical",
 *   text: "The runtime loads tools before an agent step starts.",
 * });
 * ```
 */

export type { Prompt, PromptConfig } from "./types.ts";
export { prompt } from "./factory.ts";
export { promptRegistry } from "./registry.ts";
