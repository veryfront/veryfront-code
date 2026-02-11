export interface TemplateFile {
  path: string;
  content: string;
}

export interface EnvVarConfig {
  name: string;
  description: string;
  required: boolean;
  sensitive?: boolean;
  placeholder?: string;
  docsUrl?: string;
  default?: string;
}

export interface TemplateConfig {
  envVars?: EnvVarConfig[];
}

export type TemplateName =
  | "chat"
  | "rag"
  | "multi-agent"
  | "workflow"
  | "coding-agent"
  | "saas"
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

export type IntegrationName =
  | "gmail"
  | "slack"
  | "github"
  | "calendar"
  | "jira"
  | "notion"
  | "servicenow"
  | "confluence"
  | "linear"
  | "gitlab"
  | "outlook"
  | "teams"
  | "figma"
  | "sheets"
  | "airtable"
  | "supabase"
  | "neon"
  | "sharepoint"
  | "discord"
  | "hubspot"
  | "stripe"
  | "dropbox"
  | "salesforce"
  | "twitter"
  | "onedrive"
  | "bitbucket"
  | "sentry"
  | "posthog"
  | "zendesk"
  | "asana"
  | "monday"
  | "zoom"
  | "trello"
  | "box"
  | "shopify"
  | "clickup"
  | "intercom"
  | "pipedrive"
  | "mailchimp"
  | "webex"
  | "freshdesk"
  | "quickbooks"
  | "xero"
  | "drive"
  | "docs-google"
  | "snowflake"
  | "mixpanel"
  | "twilio"
  | "anthropic"
  | "aws";

export interface OAuthField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  envVar: string;
  default?: string;
}

export interface OAuthConfig {
  type: "oauth2" | "oauth1" | "api-key";
  provider?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  callbackPath?: string;
  tokenAuthMethod?: string;
  pkce?: boolean;
  usePKCE?: boolean;
  supportsRefreshToken?: boolean;
  requiredApis?: { name: string; enableUrl: string }[];
  additionalParams?: Record<string, string>;
  additionalAuthParams?: Record<string, string>;
  fields?: OAuthField[];
  envVars?: Record<string, { description: string; required: boolean }>;
  keyName?: string;
  headerName?: string;
  headerPrefix?: string;
  tokenName?: string;
  docsUrl?: string;
}

export interface IntegrationToolMeta {
  id?: string;
  name: string;
  description: string;
  requiresWrite?: boolean;
  file?: string;
}

export interface IntegrationPrompt {
  id: string;
  title: string;
  prompt: string;
  category?: string;
  icon?: string;
}

export interface IntegrationConfig {
  name: IntegrationName;
  displayName: string;
  icon?: string;
  description: string;
  auth: OAuthConfig;
  envVars?: EnvVarConfig[];
  tools: IntegrationToolMeta[];
  prompts?: IntegrationPrompt[];
  suggestedWith?: string[];
  dependencies?: Record<string, string>;
  category?: string;
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
