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
}
