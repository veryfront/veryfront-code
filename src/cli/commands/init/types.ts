import type { FeatureName, IntegrationName } from "../../templates/types.ts";

export type InitTemplate = "ai" | "app" | "blog" | "docs" | "minimal";

export interface EnvValues {
  [key: string]: string;
}

export interface InitOptions {
  name?: string;
  template?: InitTemplate;
  skipInstall?: boolean;
  skipEnvPrompt?: boolean;
  features?: FeatureName[];
  integrations?: IntegrationName[];
  env?: EnvValues;
  /** Suppress output messages */
  quiet?: boolean;
}
