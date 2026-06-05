import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

const integrationNames = [
  "gmail",
  "slack",
  "github",
  "calendar",
  "jira",
  "notion",
  "servicenow",
  "confluence",
  "linear",
  "gitlab",
  "outlook",
  "teams",
  "figma",
  "sheets",
  "airtable",
  "supabase",
  "neon",
  "sharepoint",
  "stripe",
  "salesforce",
  "twitter",
  "onedrive",
  "bitbucket",
  "sentry",
  "posthog",
  "zendesk",
  "asana",
  "harvest",
  "hubspot",
  "monday",
  "zoom",
  "trello",
  "box",
  "shopify",
  "clickup",
  "intercom",
  "pipedrive",
  "mailchimp",
  "webex",
  "freshdesk",
  "quickbooks",
  "xero",
  "drive",
  "docs-google",
  "snowflake",
  "mixpanel",
  "twilio",
  "anthropic",
  "aws",
] as const;

export const getIntegrationNameSchema = defineSchema((v) => v.enum(integrationNames));
/** Zod schema for integration name. */
export const IntegrationNameSchema = lazySchema(getIntegrationNameSchema);

export const getEnvVarSchema = defineSchema((v) =>
  v.object({
    name: v.string(),
    description: v.string(),
    required: v.boolean(),
    sensitive: v.boolean().optional(),
    placeholder: v.string().optional(),
    docsUrl: v.string().optional(),
    default: v.string().optional(),
  })
);
/** Zod schema for env var. */
export const EnvVarSchema = lazySchema(getEnvVarSchema);

export const getOAuthFieldSchema = defineSchema((v) =>
  v.object({
    name: v.string(),
    label: v.string(),
    type: v.string(),
    required: v.boolean(),
    envVar: v.string(),
    default: v.string().optional(),
  })
);
/** Zod schema for oauth field. */
export const OAuthFieldSchema = lazySchema(getOAuthFieldSchema);

export const getOAuthConfigSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["oauth2", "oauth1", "api-key"]),
    provider: v.string().optional(),
    authorizationUrl: v.string().optional(),
    tokenUrl: v.string().optional(),
    scopes: v.array(v.string()).optional(),
    callbackPath: v.string().optional(),
    tokenAuthMethod: v.string().optional(),
    pkce: v.boolean().optional(),
    usePKCE: v.boolean().optional(),
    supportsRefreshToken: v.boolean().optional(),
    requiredApis: v
      .array(v.object({ name: v.string(), enableUrl: v.string() }))
      .optional(),
    additionalParams: v.record(v.string(), v.string()).optional(),
    additionalAuthParams: v.record(v.string(), v.string()).optional(),
    fields: v.array(getOAuthFieldSchema()).optional(),
    envVars: v
      .record(v.string(), v.object({ description: v.string(), required: v.boolean() }))
      .optional(),
    keyName: v.string().optional(),
    headerName: v.string().optional(),
    headerPrefix: v.string().optional(),
    tokenName: v.string().optional(),
    docsUrl: v.string().optional(),
  })
);
/** Zod schema for oauth config. */
export const OAuthConfigSchema = lazySchema(getOAuthConfigSchema);

export const getIntegrationEndpointParamSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["string", "number", "boolean", "string[]", "object", "array"]),
    in: v.enum(["path", "query", "header", "body"]),
    description: v.string(),
    required: v.boolean().optional(),
    default: v.unknown().optional(),
    // For query params only: the HTTP query parameter name to send when it differs
    // from the agent-facing parameter key (e.g. input query -> query param $search).
    queryName: v.string().optional(),
    // For query params only: provider-specific formatting applied to the value
    // before sending. Microsoft Graph message $search requires the entire AQS
    // query to be enclosed in double quotes.
    queryValueFormat: v.enum(["microsoft-graph-search"]).optional(),
    // For header params only: the HTTP header name to send when it differs from
    // the agent-facing parameter key (e.g. input account_id → header Harvest-Account-Id).
    headerName: v.string().optional(),
  })
);
export const IntegrationEndpointParamSchema = lazySchema(getIntegrationEndpointParamSchema);

export const getIntegrationEndpointBodyFieldSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["string", "number", "boolean", "object", "array"]),
    description: v.string(),
    required: v.boolean().optional(),
    default: v.unknown().optional(),
  })
);
export const IntegrationEndpointBodyFieldSchema = lazySchema(getIntegrationEndpointBodyFieldSchema);

export const getIntegrationEndpointResponseEnrichmentSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["gmail-message-metadata"]),
    url: v.string(),
    idField: v.string().optional(),
    metadataHeaders: v.array(v.string()).optional(),
    maxItems: v.number().optional(),
  })
);
export const IntegrationEndpointResponseEnrichmentSchema = lazySchema(
  getIntegrationEndpointResponseEnrichmentSchema,
);

export const getIntegrationEndpointHistoricalSummaryFieldSchema = defineSchema((v) =>
  v.object({
    name: v.string(),
    kind: v.enum(["scalar", "string-array", "contact", "contact-array", "object"]).optional(),
    maxLength: v.number().optional(),
  })
);
export const IntegrationEndpointHistoricalSummaryFieldSchema = lazySchema(
  getIntegrationEndpointHistoricalSummaryFieldSchema,
);

export const getIntegrationEndpointHistoricalSummarySchema = defineSchema((v) =>
  v.object({
    collectionKeys: v.array(v.string()),
    collectionName: v.string(),
    itemFields: v.array(getIntegrationEndpointHistoricalSummaryFieldSchema()),
    outputFields: v.array(getIntegrationEndpointHistoricalSummaryFieldSchema()).optional(),
    singleItem: v.boolean().optional(),
    omitted: v.string(),
  })
);
export const IntegrationEndpointHistoricalSummarySchema = lazySchema(
  getIntegrationEndpointHistoricalSummarySchema,
);

export const getIntegrationEndpointSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["rest", "graphql"]).optional(),
    method: v.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: v.string(),
    query: v.string().optional(),
    params: v.record(v.string(), getIntegrationEndpointParamSchema()).optional(),
    body: v.record(v.string(), getIntegrationEndpointBodyFieldSchema()).optional(),
    contentType: v.string().optional(),
    response: v.object({
      transform: v.string().optional(),
      enrich: getIntegrationEndpointResponseEnrichmentSchema().optional(),
      historicalSummary: getIntegrationEndpointHistoricalSummarySchema().optional(),
    }).optional(),
  })
);
export const IntegrationEndpointSchema = lazySchema(getIntegrationEndpointSchema);

export const getIntegrationToolSchema = defineSchema((v) =>
  v.object({
    id: v.string().optional(),
    name: v.string(),
    description: v.string(),
    requiresWrite: v.boolean().optional(),
    file: v.string().optional(),
    endpoint: getIntegrationEndpointSchema().optional(),
  })
);
/** Zod schema for integration tool. */
export const IntegrationToolSchema = lazySchema(getIntegrationToolSchema);

export const getIntegrationPromptSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    title: v.string(),
    prompt: v.string(),
    category: v.string().optional(),
    icon: v.string().optional(),
  })
);
/** Zod schema for integration prompt. */
export const IntegrationPromptSchema = lazySchema(getIntegrationPromptSchema);

export const getIntegrationConfigSchema = defineSchema((v) =>
  v.object({
    name: getIntegrationNameSchema(),
    displayName: v.string(),
    icon: v.string().optional(),
    description: v.string(),
    auth: getOAuthConfigSchema(),
    envVars: v.array(getEnvVarSchema()).optional(),
    /**
     * Optional map of npm packages to semver ranges. When this integration is
     * selected during `veryfront init`, these deps are merged into the
     * generated project's `package.json#dependencies`. Use this for templates
     * that import packages beyond the init scaffold's defaults (react,
     * react-dom, veryfront, zod).
     */
    npmDependencies: v.record(v.string(), v.string()).optional(),
    tools: v.array(getIntegrationToolSchema()),
    prompts: v.array(getIntegrationPromptSchema()).optional(),
    suggestedWith: v.array(v.string()).optional(),
    dependencies: v.record(v.string(), v.string()).optional(),
    category: v.string().optional(),
  })
);
/** Zod schema for integration config. */
export const IntegrationConfigSchema = lazySchema(getIntegrationConfigSchema);

/** Public API contract for integration name. */
export type IntegrationName = InferSchema<ReturnType<typeof getIntegrationNameSchema>>;
/** Configuration used by env var. */
export type EnvVarConfig = InferSchema<ReturnType<typeof getEnvVarSchema>>;
/** Public API contract for oauth field. */
export type OAuthField = InferSchema<ReturnType<typeof getOAuthFieldSchema>>;
/** Configuration used by oauth. */
export type OAuthConfig = InferSchema<ReturnType<typeof getOAuthConfigSchema>>;
/** Public API contract for integration tool meta. */
export type IntegrationToolMeta = InferSchema<ReturnType<typeof getIntegrationToolSchema>>;
/** Provider-declared summary contract for old tool outputs kept actionable across turns. */
export type IntegrationEndpointHistoricalSummary = InferSchema<
  ReturnType<typeof getIntegrationEndpointHistoricalSummarySchema>
>;
/** Public API contract for integration prompt. */
export type IntegrationPrompt = InferSchema<ReturnType<typeof getIntegrationPromptSchema>>;
/** Configuration used by integration. */
export type IntegrationConfig = InferSchema<ReturnType<typeof getIntegrationConfigSchema>>;
