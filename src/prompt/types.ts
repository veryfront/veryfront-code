export interface PromptConfig {
  id?: string;
  description: string;
  content?: string;
  generate?: (variables: Record<string, unknown>) => string | Promise<string>;
}

export interface Prompt {
  id: string;
  description: string;
  getContent: (variables?: Record<string, unknown>) => Promise<string>;
}
