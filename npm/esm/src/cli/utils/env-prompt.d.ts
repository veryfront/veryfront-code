/****
 * Environment variable prompting utilities for CLI scaffolding
 * @module
 */
import type { EnvVarConfig } from "../templates/index.js";
export interface EnvPromptOptions {
    /** Whether to run in interactive mode (prompt for values) */
    interactive?: boolean;
    /** Whether to skip prompting entirely */
    skipPrompt?: boolean;
    /** Pre-filled environment variable values (from config file) */
    prefilledValues?: Record<string, string>;
}
export interface EnvPromptResult {
    /** Content for .env file */
    envContent: string;
    /** Content for .env.example file */
    envExampleContent: string;
    /** Map of env var names to their values */
    values: Record<string, string>;
}
/**
 * Prompts the user for environment variable values during scaffolding
 *
 * @param envVars - Array of environment variable configurations
 * @param options - Prompting options
 * @returns Object containing .env content, .env.example content, and values map
 */
export declare function promptForEnvVars(envVars: EnvVarConfig[], options?: EnvPromptOptions): Promise<EnvPromptResult>;
/**
 * Generates content for .gitignore to ensure .env is not committed
 */
export declare function generateGitignoreContent(existingContent?: string): string;
//# sourceMappingURL=env-prompt.d.ts.map