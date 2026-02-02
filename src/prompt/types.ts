export interface PromptConfig {
  id?: string;
  description: string;
  content?: string;
  generate?: (variables: Record<string, unknown>) => string | Promise<string>;
  /** Example message text to use as a chat suggestion */
  suggestion?: string;
}

export interface Prompt {
  id: string;
  description: string;
  /** Example message text to use as a chat suggestion */
  suggestion?: string;
  getContent: (variables?: Record<string, unknown>) => Promise<string>;
}
