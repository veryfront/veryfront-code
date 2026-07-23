/**
 * Declare and register bounded prompt templates exposed through MCP.
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
 *
 * Prompt variables are inserted verbatim after type and size validation. Keep
 * untrusted values clearly separated from instructions in the template.
 */

export type {
  Prompt,
  PromptArgument,
  PromptConfig,
  PromptGenerate,
  PromptRenderContext,
} from "./types.ts";
export { prompt } from "./factory.ts";
export { promptRegistry } from "./registry.ts";
