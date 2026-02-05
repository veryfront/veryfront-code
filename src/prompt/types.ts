// Re-export schema-based type
export type { PromptConfig } from "./schemas/index.ts";

export interface Prompt {
  id: string;
  description: string;
  /** Example message text to use as a chat suggestion */
  suggestion?: string;
  getContent: (variables?: Record<string, unknown>) => Promise<string>;
}
