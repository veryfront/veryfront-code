/**
 * Type definitions for init command
 * @module
 */

import type { FeatureName, IntegrationName } from "../../templates/types.ts";

/**
 * Available project templates
 */
export type InitTemplate = "ai" | "app" | "blog" | "docs" | "minimal";

/**
 * Pre-filled environment variable values for programmatic scaffolding
 */
export interface EnvValues {
  [key: string]: string;
}

/**
 * Options for initializing a new project
 */
export interface InitOptions {
  /**
   * Project name or path (relative or absolute).
   * If omitted, scaffolds into CWD.
   */
  name?: string;

  /**
   * Template name. Defaults to "minimal".
   */
  template?: InitTemplate;

  /**
   * Skip automatic dependency installation after scaffolding.
   * @default false
   */
  skipInstall?: boolean;

  /**
   * Skip prompting for environment variables.
   * @default false
   */
  skipEnvPrompt?: boolean;

  /**
   * Features to add to the base template via --with flag.
   */
  features?: FeatureName[];

  /**
   * Service integrations to add via --integrations flag.
   * Using this implies template: "ai"
   */
  integrations?: IntegrationName[];

  /**
   * Pre-filled environment variable values.
   * Use this to provide credentials programmatically (e.g., from CI/CD).
   * Keys should match expected env var names like GOOGLE_CLIENT_ID, SLACK_CLIENT_SECRET, etc.
   */
  env?: EnvValues;
}
