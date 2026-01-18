/**
 * Prompt Types
 *
 * Type definitions for prompt templates.
 *
 * @module veryfront/prompt
 */

/**
 * Prompt template configuration
 */
export interface PromptConfig {
  /** Prompt ID (optional, inferred from filename) */
  id?: string;

  /** Prompt description */
  description: string;

  /** Static prompt content */
  content?: string;

  /**
   * Dynamic prompt generator
   */
  generate?: (variables: Record<string, unknown>) => string | Promise<string>;
}

/**
 * Prompt instance
 */
export interface Prompt {
  /** Prompt ID */
  id: string;

  /** Prompt description */
  description: string;

  /**
   * Get prompt content
   */
  getContent: (variables?: Record<string, unknown>) => Promise<string>;
}
