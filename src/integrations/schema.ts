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
  "sap",
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
  "persona",
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
  "openai",
  "todoist",
  "calendly",
  "google-analytics",
  "klaviyo",
  "datadog",
  "paypal",
  "activecampaign",
  "algolia",
  "amplitude",
  "apollo",
  "ashby",
  "attio",
  "basecamp",
  "brevo",
  "circleci",
  "close",
  "cloudflare",
  "coda",
  "dialpad",
  "digitalocean",
  "exa",
  "fathom",
  "firecrawl",
  "fireflies",
  "folk",
  "gemini",
  "gong",
  "google-chat",
  "gusto",
  "jotform",
  "lever",
  "metabase",
  "mistral",
  "pagerduty",
  "perplexity",
  "productboard",
  "razorpay",
  "resend",
  "salesflare",
  "segment",
  "sendgrid",
  "shortcut",
  "square",
  "tavily",
  "typeform",
  "apify",
  "assemblyai",
  "axiom",
  "betterstack",
  "browserbase",
  "buildkite",
  "checkly",
  "clickhouse",
  "cohere",
  "deepgram",
  "elevenlabs",
  "fal",
  "fireworks-ai",
  "fly-io",
  "grafana-cloud",
  "groq",
  "heroku",
  "huggingface",
  "langfuse",
  "langsmith",
  "launchdarkly",
  "mongodb-atlas",
  "netlify",
  "new-relic",
  "openrouter",
  "pinecone",
  "planetscale",
  "qdrant",
  "railway",
  "redis-cloud",
  "render",
  "replicate",
  "snyk",
  "stability-ai",
  "together-ai",
  "vercel",
  "weaviate",
  "bamboohr",
  "cal-com",
  "customer-io",
  "discord",
  "docusign",
  "gocardless",
  "google-bigquery",
  "google-contacts",
  "help-scout",
  "telegram",
  "whatsapp",
  "woocommerce",
  "zoho-crm",
  "adyen",
  "azure-blob-storage",
  "bigcommerce",
  "brave-search",
  "chargebee",
  "databricks",
  "deel",
  "front",
  "google-cloud-storage",
  "google-forms",
  "gorgias",
  "greenhouse",
  "guru",
  "mollie",
  "paddle",
  "pandadoc",
  "personio",
  "portkey",
  "power-bi",
  "ramp",
  "rippling",
  "serpapi",
  "shopware",
  "surveymonkey",
  "tally",
  "wix",
  "workable",
  "azure",
  "azure-document-intelligence",
  "billbee",
  "cleverreach",
  "datev",
  "factorial",
  "finapi",
  "gcp",
  "hetzner",
  "ionos",
  "klarna",
  "lexoffice",
  "mindee",
  "moss",
  "neo4j",
  "north-data",
  "qonto",
  "sendcloud",
  "sevdesk",
  "skribble",
  "stackit",
  "trusted-shops",
  "unstructured",
  "unzer",
  "voyage-ai",
  "xentral",
  "alphavantage",
  "daytona",
  "e2b",
  "polygon",
  "sprites",
] as const;

export const getIntegrationNameSchema = defineSchema((v) => v.enum(integrationNames));
/** Zod schema for integration name. */
export const IntegrationNameSchema = lazySchema(getIntegrationNameSchema);

/**
 * Every registered integration name. The single source of truth for catalog
 * surfaces (CLI validation, MCP listings) — derive from this instead of
 * maintaining parallel name lists.
 */
export const ALL_INTEGRATION_NAMES = integrationNames;

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
    type: v.enum(["oauth2", "oauth1", "api-key", "basic"]),
    provider: v.string().optional(),
    authorizationUrl: v.string().optional(),
    tokenUrl: v.string().optional(),
    /**
     * OAuth2 grant type. Defaults to the authorization-code user flow;
     * machine-to-machine connectors set "client_credentials" (no user redirect,
     * tokens minted from <NAME>_CLIENT_ID / <NAME>_CLIENT_SECRET project env vars).
     */
    grantType: v.enum(["authorization_code", "client_credentials"]).optional(),
    scopes: v.array(v.string()).optional(),
    optionalScopes: v.array(v.string()).optional(),
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
    /**
     * api-key: extra secret headers beyond the primary key, mapped from header
     * name to the project env var holding the value (e.g. Datadog's
     * DD-APPLICATION-KEY → DD_APP_KEY).
     */
    additionalHeaders: v.record(v.string(), v.string()).optional(),
    /**
     * api-key: send the credential as this query parameter instead of a header,
     * for providers without header auth (e.g. SerpApi's api_key).
     */
    queryParamName: v.string().optional(),
    /** basic: project env vars holding the HTTP Basic username and password. */
    usernameKey: v.string().optional(),
    passwordKey: v.string().optional(),
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
    // "base64": the string value is base64-decoded before sending. With
    // bodyMode "form-data" the field becomes a binary part; with "raw" the
    // decoded bytes become the request body.
    encoding: v.enum(["base64"]).optional(),
    // For form-data binary parts: the name of the body field that holds the
    // part's filename. That field is consumed (not sent as its own part).
    partFilenameField: v.string().optional(),
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
    kind: v.enum(["scalar", "string-array", "named-array", "contact", "contact-array", "object"])
      .optional(),
    path: v.array(v.string()).optional(),
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
    // "passthrough": body declares exactly one object/array field whose value is
    // sent as the entire request body. For APIs that take arbitrary flat payloads
    // (e.g. Salesforce sObject writes, ServiceNow table records). Default: each
    // body field becomes a key of a JSON object.
    // "form-data": body fields are sent as multipart/form-data parts in
    // declaration order; fields with encoding "base64" become binary parts.
    // "raw": body declares exactly one field whose value is sent verbatim as
    // the request body (base64-decoded when encoding is set), with contentType.
    bodyMode: v.enum(["passthrough", "form-data", "raw"]).optional(),
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

export const getIntegrationSetupGuideSchema = defineSchema((v) =>
  v.object({
    title: v.string().optional(),
    steps: v.array(
      v.object({
        step: v.number().optional(),
        title: v.string(),
        description: v.string(),
        url: v.string().optional(),
        docsUrl: v.string().optional(),
        code: v.string().optional(),
      }),
    ),
    notes: v.array(v.string()).optional(),
    documentation: v.string().optional(),
  })
);
/** Setup steps shown when an integration's credentials are missing. */
export const IntegrationSetupGuideSchema = lazySchema(getIntegrationSetupGuideSchema);

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
    setupGuide: getIntegrationSetupGuideSchema().optional(),
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
