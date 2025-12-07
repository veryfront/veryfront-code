/**
 * Shared types for CLI templates
 */

export interface TemplateFile {
  path: string;
  content: string;
}

/**
 * Configuration for an environment variable required by a template
 */
export interface EnvVarConfig {
  /** Environment variable name (e.g., "OPENAI_API_KEY") */
  name: string;
  /** Human-readable description shown during prompting */
  description: string;
  /** Whether this env var is required for the template to function */
  required: boolean;
  /** Whether to mask input (for API keys/secrets) */
  sensitive?: boolean;
  /** Placeholder value for .env.example */
  placeholder?: string;
  /** URL to documentation for obtaining this value */
  docsUrl?: string;
}

/**
 * Template configuration including env var requirements
 */
export interface TemplateConfig {
  /** Environment variables this template needs */
  envVars?: EnvVarConfig[];
}

export type TemplateName =
  | "blog"
  | "docs"
  | "app"
  | "minimal"
  | "ai"
  | "pages-router"
  | "app-router";

// ============================================================================
// Composable Features (--with flag support)
// ============================================================================

/**
 * Feature names that can be added to base templates via --with flag
 */
export type FeatureName = "ai" | "auth" | "workflows" | "mdx" | "redis" | "blob";

/**
 * Feature configuration stored in feature.json
 */
export interface FeatureConfig {
  /** Feature name */
  name: FeatureName;

  /** Human-readable description */
  description: string;

  /** Features this one depends on (must be applied first) */
  requires?: FeatureName[];

  /** Features this conflicts with (cannot be used together) */
  conflicts?: FeatureName[];

  /** Dependencies to add to package.json/deno.json */
  dependencies?: Record<string, string>;

  /** Dev dependencies to add */
  devDependencies?: Record<string, string>;

  /** Environment variables this feature needs */
  envVars?: EnvVarConfig[];

  /** Config to merge into veryfront.config.js */
  configMerge?: Record<string, unknown>;

  /** Post-install tips to show */
  tips?: string[];
}

/**
 * Resolved feature with files loaded
 */
export interface ResolvedFeature {
  config: FeatureConfig;
  files: TemplateFile[];
}

// ============================================================================
// Service Integrations (--integrations flag support)
// ============================================================================

/**
 * Integration names that can be added via --integrations flag
 */
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
  // New integrations
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
  // 50+ integrations
  | "drive"
  | "docs-google"
  | "snowflake"
  | "mixpanel"
  | "twilio"
  | "anthropic"
  | "aws";

/**
 * OAuth configuration for an integration
 */
export interface OAuthConfig {
  /** OAuth type (oauth2, oauth1, api-key) */
  type: "oauth2" | "oauth1" | "api-key";
  /** OAuth provider name for known providers */
  provider?: string;
  /** Authorization URL */
  authorizationUrl?: string;
  /** Token URL */
  tokenUrl?: string;
  /** Required OAuth scopes */
  scopes: string[];
  /** Callback path for OAuth redirect */
  callbackPath: string;
}

/**
 * Tool metadata for an integration
 */
export interface IntegrationToolMeta {
  /** Tool ID (matches filename without extension) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Tool description */
  description: string;
  /** Whether this tool requires write access */
  requiresWrite?: boolean;
}

/**
 * Pre-built prompt/action for an integration
 */
export interface IntegrationPrompt {
  /** Prompt ID */
  id: string;
  /** Display title (e.g., "Summarize today's emails") */
  title: string;
  /** The actual prompt text */
  prompt: string;
  /** Category for grouping */
  category?: "productivity" | "development" | "research" | "social";
  /** Icon name */
  icon?: string;
}

/**
 * Integration configuration stored in connector.json
 */
export interface IntegrationConfig {
  /** Integration name */
  name: IntegrationName;

  /** Human-readable display name */
  displayName: string;

  /** Icon filename */
  icon: string;

  /** Description of the integration */
  description: string;

  /** OAuth configuration */
  auth: OAuthConfig;

  /** Environment variables required */
  envVars: EnvVarConfig[];

  /** Tools this integration provides */
  tools: IntegrationToolMeta[];

  /** Pre-built prompts/actions */
  prompts?: IntegrationPrompt[];

  /** Other integrations this works well with */
  suggestedWith?: IntegrationName[];
}

/**
 * Resolved integration with files loaded
 */
export interface ResolvedIntegration {
  config: IntegrationConfig;
  files: TemplateFile[];
}

// ============================================================================
// Use-Case Templates (--usecase flag support)
// ============================================================================

/**
 * Use-case template names
 */
export type UseCaseName =
  | "productivity"
  | "developer"
  | "support"
  | "social"
  | "custom";

/**
 * Chat UI style options
 */
export type ChatUIStyle = "full-page" | "sidebar" | "widget" | "cards";

/**
 * Use-case template configuration
 */
export interface UseCaseConfig {
  /** Use-case name */
  name: UseCaseName;

  /** Human-readable display name */
  displayName: string;

  /** Description */
  description: string;

  /** Default integrations for this use-case */
  integrations: IntegrationName[];

  /** Default prompts to include */
  defaultPrompts: string[];

  /** Recommended chat UI style */
  chatUI: ChatUIStyle;

  /** Icon for display */
  icon?: string;
}
