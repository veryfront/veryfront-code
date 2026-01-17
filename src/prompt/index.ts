/**
 * Veryfront Prompt Module
 *
 * Create and manage prompt templates with variable interpolation.
 *
 * @example
 * ```typescript
 * import { prompt, promptRegistry } from 'veryfront/prompt';
 *
 * // Create a prompt template
 * const greeting = prompt({
 *   id: 'greeting',
 *   description: 'Greeting prompt',
 *   content: 'Hello {name}, welcome to {company}!',
 * });
 *
 * // Get content with variables
 * const content = await greeting.getContent({
 *   name: 'John',
 *   company: 'Acme',
 * });
 *
 * // Register for discovery
 * promptRegistry.register('greeting', greeting);
 * ```
 *
 * @module veryfront/prompt
 */

// Types
export type { Prompt, PromptConfig } from "./types.ts";

// Factory
export { prompt } from "./factory.ts";

// Registry
export { promptRegistry } from "./registry.ts";
