import type { FeatureName, IntegrationName } from "../../templates/types.ts";

export type InitTemplate =
  | "ai-agent"
  | "chat-with-your-docs"
  | "multi-agent-system"
  | "agentic-workflow"
  | "coding-agent"
  | "saas-starter"
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
  /** Deploy to cloud after scaffolding */
  deploy?: boolean;
  /** Overwrite existing directory */
  force?: boolean;
}
