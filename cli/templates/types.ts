import type {
  EnvVarConfig,
  IntegrationConfig,
  IntegrationName,
} from "../../src/integrations/schema.ts";

export type {
  EnvVarConfig,
  IntegrationConfig,
  IntegrationName,
  IntegrationPrompt,
  IntegrationToolMeta,
  OAuthConfig,
  OAuthField,
} from "../../src/integrations/schema.ts";

export interface TemplateFile {
  path: string;
  content: string;
}

export interface TemplateConfig {
  envVars?: EnvVarConfig[];
}

export type TemplateName =
  | "ai-agent"
  | "ai-rag-agent"
  | "multi-agent-system"
  | "agentic-workflow"
  | "coding-agent"
  | "saas-starter"
  | "minimal"
  | "pages-router"
  | "app-router";

export type FeatureName = "ai" | "auth" | "workflows" | "mdx" | "redis" | "blob";

export interface FeatureConfig {
  name: FeatureName;
  description: string;
  requires?: FeatureName[];
  conflicts?: FeatureName[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  envVars?: EnvVarConfig[];
  configMerge?: Record<string, unknown>;
  tips?: string[];
}

export interface ResolvedFeature {
  config: FeatureConfig;
  files: TemplateFile[];
}

export interface ResolvedIntegration {
  config: IntegrationConfig;
  files: TemplateFile[];
}

export type UseCaseName =
  | "productivity"
  | "developer"
  | "support"
  | "social"
  | "custom";

export type ChatUIStyle = "full-page" | "sidebar" | "widget" | "cards";

export interface UseCaseConfig {
  name: UseCaseName;
  displayName: string;
  description: string;
  integrations: IntegrationName[];
  defaultPrompts: string[];
  chatUI: ChatUIStyle;
  icon?: string;
}
