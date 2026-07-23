import type { PromptArgument, PromptRenderContext } from "./schemas/prompt.schema.ts";

export type {
  PromptArgument,
  PromptConfig,
  PromptGenerate,
  PromptRenderContext,
} from "./schemas/prompt.schema.ts";

/** Public API contract for prompt. */
export interface Prompt {
  /** Stable prompt identifier used by discovery and MCP clients. */
  id: string;
  /** Human-readable description shown to prompt clients. */
  description: string;
  /** Example message text to use as a chat suggestion. */
  suggestion?: string;
  /** Argument metadata advertised to MCP clients. */
  arguments?: PromptArgument[];
  /** Render prompt content from bounded caller variables. */
  getContent: (
    variables?: Record<string, unknown>,
    context?: PromptRenderContext,
  ) => Promise<string>;
}
