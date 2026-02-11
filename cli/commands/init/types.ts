import type { FeatureName, IntegrationName } from "../../templates/types.ts";

export type InitTemplate =
  | "chat"
  | "rag"
  | "multi-agent"
  | "workflow"
  | "coding-agent"
  | "saas"
  | "minimal";

export type EnvValues = Record<string, string>;

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
