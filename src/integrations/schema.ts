import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { isBoundedJsonValue } from "#veryfront/integrations/bounded-json.ts";

const MAX_CONNECTOR_TOOLS = 512;
const MAX_INTEGRATION_COLLECTION_ITEMS = 512;
const MAX_INTEGRATION_STRING_LENGTH = 8_192;
const MAX_INTEGRATION_URL_LENGTH = 2_048;
const MAX_INTEGRATION_RECORD_ENTRIES = 512;
const MAX_RESPONSE_LIMIT = 10_000;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_PROVIDER_FIELD_LENGTH = 128;
const MAX_TYPE_NAME_LENGTH = 64;
const MAX_SCOPE_LENGTH = 512;
const MAX_CODE_LENGTH = 65_536;
const MAX_SUMMARY_FIELDS = 256;
const MAX_SUMMARY_PATH_SEGMENTS = 64;
const MAX_DEFAULT_JSON_DEPTH = 32;
const MAX_DEFAULT_JSON_NODES = 2_048;
const MAX_NPM_PACKAGE_NAME_LENGTH = 214;
const MAX_NPM_VERSION_RANGE_LENGTH = 512;
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CANONICAL_TOOL_LOCAL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const NPM_PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const NPM_REGISTRY_RANGE_PATTERN = /^[0-9A-Za-z.*+<>=^~| -]+$/;

function hasBoundedRecordEntries(value: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(value).length <= MAX_INTEGRATION_RECORD_ENTRIES;
}

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isSafeHttpMetadataValue(value: string): boolean {
  return value === value.trim() && !containsAsciiControlCharacter(value);
}

function isSafeOAuthCallbackPath(value: string): boolean {
  return value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !containsAsciiControlCharacter(value);
}

function isSafeNpmRegistryRange(value: string): boolean {
  return value.length > 0 &&
    value.length <= MAX_NPM_VERSION_RANGE_LENGTH &&
    value === value.trim() &&
    !containsAsciiControlCharacter(value) &&
    !value.includes("..") &&
    NPM_REGISTRY_RANGE_PATTERN.test(value);
}

function isBoundedIntegrationDefault(value: unknown): boolean {
  return isBoundedJsonValue(value, {
    maxDepth: MAX_DEFAULT_JSON_DEPTH,
    maxNodes: MAX_DEFAULT_JSON_NODES,
    maxKeyLength: MAX_IDENTIFIER_LENGTH,
    maxStringLength: MAX_INTEGRATION_STRING_LENGTH,
  });
}

function doesDefaultMatchDeclaredType(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "string[]":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return false;
  }
}

function isHttpUrl(value: string): boolean {
  if (containsAsciiControlCharacter(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      !url.username &&
      !url.password;
  } catch {
    return false;
  }
}

function isIntegrationEndpointUrl(value: string): boolean {
  const metadataPrefix = value.match(/^{{\s*oauth\.raw\.[A-Za-z0-9_.-]+\s*}}\//)?.[0];
  if (metadataPrefix) {
    return isHttpUrl(`https://oauth-metadata.invalid/${value.slice(metadataPrefix.length)}`);
  }
  return isHttpUrl(value);
}

function isSafeConnectorRelativePath(value: string): boolean {
  if (value.startsWith("/") || value.includes("\\") || containsAsciiControlCharacter(value)) {
    return false;
  }
  const segments = value.split("/");
  return segments.length > 0 && segments.every((segment) =>
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)
  );
}

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

Object.freeze(integrationNames);

export const getIntegrationNameSchema = defineSchema((v) => v.enum(integrationNames));
/** Zod schema for integration name. */
export const IntegrationNameSchema = lazySchema(getIntegrationNameSchema);

/**
 * Every accepted integration name, including compatibility-reserved names that
 * do not currently have catalog metadata. Derive validation registries from
 * this list instead of maintaining parallel name lists.
 */
export const ALL_INTEGRATION_NAMES = integrationNames;

export const getEnvVarSchema = defineSchema((v) =>
  v.object({
    name: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    description: v.string().min(1).max(MAX_INTEGRATION_STRING_LENGTH),
    required: v.boolean(),
    sensitive: v.boolean().optional(),
    placeholder: v.string().max(MAX_INTEGRATION_STRING_LENGTH).optional(),
    docsUrl: v.string().min(1).max(MAX_INTEGRATION_URL_LENGTH).refine(
      isHttpUrl,
      "Expected an HTTP or HTTPS documentation URL",
    ).optional(),
    default: v.string().max(MAX_INTEGRATION_STRING_LENGTH).optional(),
  }).strict()
);
/** Zod schema for env var. */
export const EnvVarSchema = lazySchema(getEnvVarSchema);

export const getOAuthFieldSchema = defineSchema((v) =>
  v.object({
    name: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    label: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    type: v.string().min(1).max(MAX_TYPE_NAME_LENGTH),
    required: v.boolean(),
    envVar: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    default: v.string().max(MAX_INTEGRATION_STRING_LENGTH).optional(),
  }).strict()
);
/** Zod schema for oauth field. */
export const OAuthFieldSchema = lazySchema(getOAuthFieldSchema);

export const getOAuthConfigSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["oauth2", "oauth1", "api-key", "basic"]),
    provider: v.string().min(1).max(MAX_PROVIDER_FIELD_LENGTH).optional(),
    authorizationUrl: v.string().min(1).max(MAX_INTEGRATION_URL_LENGTH).refine(
      isHttpUrl,
      "Expected an HTTP or HTTPS authorization URL",
    ).optional(),
    tokenUrl: v.string().min(1).max(MAX_INTEGRATION_URL_LENGTH).refine(
      isHttpUrl,
      "Expected an HTTP or HTTPS token URL",
    ).optional(),
    /**
     * OAuth2 grant type. Defaults to the authorization-code user flow;
     * machine-to-machine connectors set "client_credentials" (no user redirect,
     * tokens minted from <NAME>_CLIENT_ID / <NAME>_CLIENT_SECRET project env vars).
     */
    grantType: v.enum(["authorization_code", "client_credentials"]).optional(),
    scopes: v.array(v.string().min(1).max(MAX_SCOPE_LENGTH)).max(
      MAX_INTEGRATION_COLLECTION_ITEMS,
    )
      .refine(hasUniqueStrings, "OAuth scopes must be unique").optional(),
    optionalScopes: v.array(v.string().min(1).max(MAX_SCOPE_LENGTH)).max(
      MAX_INTEGRATION_COLLECTION_ITEMS,
    )
      .refine(hasUniqueStrings, "Optional OAuth scopes must be unique")
      .optional(),
    callbackPath: v.string().min(1).max(MAX_INTEGRATION_URL_LENGTH).refine(
      isSafeOAuthCallbackPath,
      "Expected an origin-relative OAuth callback path without query or fragment data",
    ).optional(),
    tokenAuthMethod: v.string().min(1).max(MAX_PROVIDER_FIELD_LENGTH).optional(),
    pkce: v.boolean().optional(),
    usePKCE: v.boolean().optional(),
    supportsRefreshToken: v.boolean().optional(),
    requiredApis: v
      .array(
        v.object({
          name: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
          enableUrl: v.string().min(1).max(MAX_INTEGRATION_URL_LENGTH).refine(
            isHttpUrl,
            "Expected an HTTP or HTTPS API enablement URL",
          ),
        }).strict(),
      )
      .max(MAX_INTEGRATION_COLLECTION_ITEMS)
      .optional(),
    additionalParams: v.record(
      v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      v.string().max(MAX_INTEGRATION_STRING_LENGTH),
    ).refine(
      hasBoundedRecordEntries,
      "Too many additional OAuth parameters",
    ).optional(),
    additionalAuthParams: v.record(
      v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      v.string().max(MAX_INTEGRATION_STRING_LENGTH),
    ).refine(
      hasBoundedRecordEntries,
      "Too many additional OAuth authorization parameters",
    ).optional(),
    fields: v.array(getOAuthFieldSchema()).max(MAX_INTEGRATION_COLLECTION_ITEMS).optional(),
    envVars: v
      .record(
        v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
        v.object({
          description: v.string().min(1).max(MAX_INTEGRATION_STRING_LENGTH),
          required: v.boolean(),
        }).strict(),
      )
      .refine(hasBoundedRecordEntries, "Too many OAuth environment variables")
      .optional(),
    keyName: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
    headerName: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).regex(
      HTTP_HEADER_NAME_PATTERN,
      "Expected a valid HTTP header name",
    ).optional(),
    headerPrefix: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).refine(
      isSafeHttpMetadataValue,
      "Expected an HTTP header prefix without surrounding whitespace or control characters",
    ).optional(),
    /**
     * api-key: extra secret headers beyond the primary key, mapped from header
     * name to the project env var holding the value (e.g. Datadog's
     * DD-APPLICATION-KEY to DD_APP_KEY).
     */
    additionalHeaders: v.record(
      v.string().min(1).max(MAX_IDENTIFIER_LENGTH).regex(
        HTTP_HEADER_NAME_PATTERN,
        "Expected a valid HTTP header name",
      ),
      v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    ).refine(
      hasBoundedRecordEntries,
      "Too many additional authentication headers",
    ).optional(),
    /**
     * api-key: send the credential as this query parameter instead of a header,
     * for providers without header auth (e.g. SerpApi's api_key).
     */
    queryParamName: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
    /** basic: project env vars holding the HTTP Basic username and password. */
    usernameKey: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
    passwordKey: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
    tokenName: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
    docsUrl: v.string().min(1).max(MAX_INTEGRATION_URL_LENGTH).refine(
      isHttpUrl,
      "Expected an HTTP or HTTPS documentation URL",
    ).optional(),
  }).strict()
);
/** Zod schema for oauth config. */
export const OAuthConfigSchema = lazySchema(getOAuthConfigSchema);

export const getIntegrationEndpointParamSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["string", "number", "boolean", "string[]", "object", "array"]),
    in: v.enum(["path", "query", "header", "body"]),
    description: v.string().min(1).max(MAX_INTEGRATION_STRING_LENGTH),
    required: v.boolean().optional(),
    default: v.unknown().refine(
      isBoundedIntegrationDefault,
      "Expected a bounded JSON default value",
    ).optional(),
    // For query params only: the HTTP query parameter name to send when it differs
    // from the agent-facing parameter key (e.g. input query -> query param $search).
    queryName: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
    // For query params only: provider-specific formatting applied to the value
    // before sending. Microsoft Graph message $search requires the entire AQS
    // query to be enclosed in double quotes.
    queryValueFormat: v.enum(["microsoft-graph-search"]).optional(),
    // For header params only: the HTTP header name to send when it differs from
    // the agent-facing parameter key (e.g. input account_id maps to the
    // Harvest-Account-Id header).
    headerName: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).regex(
      HTTP_HEADER_NAME_PATTERN,
      "Expected a valid HTTP header name",
    ).optional(),
  }).strict().superRefine((param, ctx) => {
    if (param.default !== undefined && !doesDefaultMatchDeclaredType(param.type, param.default)) {
      ctx.addIssue({
        path: ["default"],
        message: "Default value must match the declared parameter type",
      });
    }
  })
);
export const IntegrationEndpointParamSchema = lazySchema(getIntegrationEndpointParamSchema);

export const getIntegrationEndpointBodyFieldSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["string", "number", "boolean", "object", "array"]),
    description: v.string().min(1).max(MAX_INTEGRATION_STRING_LENGTH),
    required: v.boolean().optional(),
    default: v.unknown().refine(
      isBoundedIntegrationDefault,
      "Expected a bounded JSON default value",
    ).optional(),
    // "base64": the string value is base64-decoded before sending. With
    // bodyMode "form-data" the field becomes a binary part; with "raw" the
    // decoded bytes become the request body.
    encoding: v.enum(["base64"]).optional(),
    // For form-data binary parts: the name of the body field that holds the
    // part's filename. That field is consumed (not sent as its own part).
    partFilenameField: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
  }).strict().superRefine((field, ctx) => {
    if (field.default !== undefined && !doesDefaultMatchDeclaredType(field.type, field.default)) {
      ctx.addIssue({
        path: ["default"],
        message: "Default value must match the declared body-field type",
      });
    }
  })
);
export const IntegrationEndpointBodyFieldSchema = lazySchema(getIntegrationEndpointBodyFieldSchema);

export const getIntegrationEndpointResponseEnrichmentSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["gmail-message-metadata"]),
    url: v.string().min(1).max(MAX_INTEGRATION_URL_LENGTH).refine(
      isHttpUrl,
      "Expected an HTTP or HTTPS enrichment URL",
    ),
    idField: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
    metadataHeaders: v.array(v.string().min(1).max(MAX_IDENTIFIER_LENGTH)).max(
      MAX_INTEGRATION_COLLECTION_ITEMS,
    )
      .optional(),
    maxItems: v.number().int().positive().max(MAX_RESPONSE_LIMIT).optional(),
  }).strict()
);
export const IntegrationEndpointResponseEnrichmentSchema = lazySchema(
  getIntegrationEndpointResponseEnrichmentSchema,
);

export const getIntegrationEndpointHistoricalSummaryFieldSchema = defineSchema((v) =>
  v.object({
    name: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    kind: v.enum(["scalar", "string-array", "named-array", "contact", "contact-array", "object"])
      .optional(),
    path: v.array(v.string().min(1).max(MAX_IDENTIFIER_LENGTH)).max(MAX_SUMMARY_PATH_SEGMENTS)
      .optional(),
    maxLength: v.number().int().positive().max(MAX_RESPONSE_LIMIT).optional(),
  }).strict()
);
export const IntegrationEndpointHistoricalSummaryFieldSchema = lazySchema(
  getIntegrationEndpointHistoricalSummaryFieldSchema,
);

export const getIntegrationEndpointHistoricalSummarySchema = defineSchema((v) =>
  v.object({
    collectionKeys: v.array(v.string().min(1).max(MAX_IDENTIFIER_LENGTH)).max(
      MAX_SUMMARY_PATH_SEGMENTS,
    ),
    collectionName: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    itemFields: v.array(getIntegrationEndpointHistoricalSummaryFieldSchema()).max(
      MAX_SUMMARY_FIELDS,
    ),
    outputFields: v.array(getIntegrationEndpointHistoricalSummaryFieldSchema()).max(
      MAX_SUMMARY_FIELDS,
    ).optional(),
    singleItem: v.boolean().optional(),
    omitted: v.string().min(1).max(MAX_INTEGRATION_STRING_LENGTH),
  }).strict()
);
/** Validates provider-declared summaries used to retain compact historical tool results. */
export const IntegrationEndpointHistoricalSummarySchema = lazySchema(
  getIntegrationEndpointHistoricalSummarySchema,
);

export const getIntegrationEndpointSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["rest", "graphql"]).optional(),
    method: v.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: v.string().min(1).max(MAX_INTEGRATION_URL_LENGTH).refine(
      isIntegrationEndpointUrl,
      "Expected an HTTP, HTTPS, or OAuth-metadata endpoint URL",
    ),
    query: v.string().min(1).max(MAX_CODE_LENGTH).optional(),
    params: v.record(
      v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      getIntegrationEndpointParamSchema(),
    ).refine(
      hasBoundedRecordEntries,
      "Too many endpoint parameters",
    ).optional(),
    body: v.record(
      v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      getIntegrationEndpointBodyFieldSchema(),
    ).refine(
      hasBoundedRecordEntries,
      "Too many endpoint body fields",
    ).optional(),
    // "passthrough": body declares exactly one object/array field whose value is
    // sent as the entire request body. For APIs that take arbitrary flat payloads
    // (e.g. Salesforce sObject writes, ServiceNow table records). Default: each
    // body field becomes a key of a JSON object.
    // "form-data": body fields are sent as multipart/form-data parts in
    // declaration order; fields with encoding "base64" become binary parts.
    // "raw": body declares exactly one field whose value is sent verbatim as
    // the request body (base64-decoded when encoding is set), with contentType.
    bodyMode: v.enum(["passthrough", "form-data", "raw"]).optional(),
    contentType: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).refine(
      isSafeHttpMetadataValue,
      "Expected a content type without surrounding whitespace or control characters",
    ).optional(),
    response: v.object({
      transform: v.string().max(MAX_CODE_LENGTH).optional(),
      enrich: getIntegrationEndpointResponseEnrichmentSchema().optional(),
      historicalSummary: getIntegrationEndpointHistoricalSummarySchema().optional(),
    }).strict().optional(),
  }).strict().superRefine((endpoint, ctx) => {
    if (
      (endpoint.bodyMode === "raw" || endpoint.bodyMode === "passthrough") &&
      Object.keys(endpoint.body ?? {}).length !== 1
    ) {
      ctx.addIssue({
        path: ["body"],
        message: `${endpoint.bodyMode} request bodies must declare exactly one field`,
      });
    }
    if (endpoint.type === "graphql" && !endpoint.query) {
      ctx.addIssue({ path: ["query"], message: "GraphQL endpoints must declare a query" });
    }
    for (const [name, param] of Object.entries(endpoint.params ?? {})) {
      if (param.in === "path" && !endpoint.url.includes(`{${name}}`)) {
        ctx.addIssue({
          path: ["params", name],
          message: "Path parameters must have a matching URL placeholder",
        });
      }
      if (param.queryName !== undefined && param.in !== "query") {
        ctx.addIssue({
          path: ["params", name, "queryName"],
          message: "queryName is valid only for query parameters",
        });
      }
      if (param.queryValueFormat !== undefined && param.in !== "query") {
        ctx.addIssue({
          path: ["params", name, "queryValueFormat"],
          message: "queryValueFormat is valid only for query parameters",
        });
      }
      if (param.headerName !== undefined && param.in !== "header") {
        ctx.addIssue({
          path: ["params", name, "headerName"],
          message: "headerName is valid only for header parameters",
        });
      }
    }
    for (const match of endpoint.url.matchAll(/\{([A-Za-z0-9][A-Za-z0-9_-]*)\}/g)) {
      const name = match[1];
      if (!name) continue;
      const param = endpoint.params?.[name];
      if (!param || param.in !== "path") {
        ctx.addIssue({
          path: ["params", name],
          message: "URL placeholders must declare a matching path parameter",
        });
      }
    }
    for (const [name, field] of Object.entries(endpoint.body ?? {})) {
      if (
        field.partFilenameField !== undefined &&
        (field.partFilenameField === name ||
          !Object.hasOwn(endpoint.body ?? {}, field.partFilenameField) ||
          endpoint.body?.[field.partFilenameField]?.type !== "string" ||
          field.encoding !== "base64" ||
          endpoint.bodyMode !== "form-data")
      ) {
        ctx.addIssue({
          path: ["body", name, "partFilenameField"],
          message: "Binary filename fields must reference another declared body field",
        });
      }
    }
  })
);
export const IntegrationEndpointSchema = lazySchema(getIntegrationEndpointSchema);

export const getIntegrationToolSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
    name: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    description: v.string().min(1).max(MAX_INTEGRATION_STRING_LENGTH),
    requiresWrite: v.boolean().optional(),
    file: v.string().min(1).max(MAX_INTEGRATION_URL_LENGTH).refine(
      isSafeConnectorRelativePath,
      "Expected a connector-relative file path",
    ).optional(),
    endpoint: getIntegrationEndpointSchema().optional(),
  }).strict()
);
/** Zod schema for integration tool. */
export const IntegrationToolSchema = lazySchema(getIntegrationToolSchema);

export const getIntegrationSetupGuideSchema = defineSchema((v) =>
  v.object({
    title: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
    steps: v.array(
      v.object({
        step: v.number().int().positive().max(MAX_INTEGRATION_COLLECTION_ITEMS).optional(),
        title: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
        description: v.string().min(1).max(MAX_INTEGRATION_STRING_LENGTH),
        url: v.string().min(1).max(MAX_INTEGRATION_URL_LENGTH).refine(
          isHttpUrl,
          "Expected an HTTP or HTTPS setup URL",
        ).optional(),
        docsUrl: v.string().min(1).max(MAX_INTEGRATION_URL_LENGTH).refine(
          isHttpUrl,
          "Expected an HTTP or HTTPS documentation URL",
        ).optional(),
        code: v.string().max(MAX_CODE_LENGTH).optional(),
      }).strict(),
    ).max(MAX_INTEGRATION_COLLECTION_ITEMS),
    notes: v.array(v.string().min(1).max(MAX_INTEGRATION_STRING_LENGTH)).max(
      MAX_SUMMARY_FIELDS,
    ).optional(),
    documentation: v.string().max(MAX_CODE_LENGTH).optional(),
  }).strict()
);
/** Setup steps shown when an integration's credentials are missing. */
export const IntegrationSetupGuideSchema = lazySchema(getIntegrationSetupGuideSchema);

export const getIntegrationPromptSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    title: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    prompt: v.string().min(1).max(MAX_CODE_LENGTH),
    category: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
    icon: v.string().min(1).max(MAX_INTEGRATION_URL_LENGTH).optional(),
  }).strict()
);
/** Zod schema for integration prompt. */
export const IntegrationPromptSchema = lazySchema(getIntegrationPromptSchema);

export const getIntegrationConfigSchema = defineSchema((v) =>
  v.object({
    name: getIntegrationNameSchema(),
    displayName: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    icon: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      "Expected a connector-local icon filename",
    ).optional(),
    description: v.string().min(1).max(MAX_INTEGRATION_STRING_LENGTH),
    auth: getOAuthConfigSchema(),
    envVars: v.array(getEnvVarSchema()).max(MAX_INTEGRATION_COLLECTION_ITEMS).optional(),
    /**
     * Optional map of npm packages to semver ranges. When this integration is
     * selected during `veryfront init`, these deps are merged into the
     * generated project's `package.json#dependencies`. Use this for templates
     * that import packages beyond the init scaffold's defaults (react,
     * react-dom, veryfront, zod).
     */
    npmDependencies: v.record(
      v.string().min(1).max(MAX_NPM_PACKAGE_NAME_LENGTH).regex(
        NPM_PACKAGE_NAME_PATTERN,
        "Expected a valid npm package name",
      ),
      v.string().refine(
        isSafeNpmRegistryRange,
        "Expected a registry package version or semver range",
      ),
    ).refine(
      hasBoundedRecordEntries,
      "Too many integration npm dependencies",
    ).optional(),
    tools: v.array(getIntegrationToolSchema()).max(MAX_CONNECTOR_TOOLS),
    prompts: v.array(getIntegrationPromptSchema()).max(MAX_INTEGRATION_COLLECTION_ITEMS).optional(),
    suggestedWith: v.array(v.string().min(1).max(MAX_IDENTIFIER_LENGTH)).max(
      MAX_INTEGRATION_COLLECTION_ITEMS,
    )
      .optional(),
    dependencies: v.record(
      v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      v.string().min(1).max(MAX_INTEGRATION_STRING_LENGTH),
    ).refine(
      hasBoundedRecordEntries,
      "Too many integration dependencies",
    ).optional(),
    category: v.string().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
    setupGuide: getIntegrationSetupGuideSchema().optional(),
  }).strict().superRefine((connector, ctx) => {
    const toolIds = connector.tools
      .map((tool) => tool.id)
      .filter((id): id is string => id !== undefined);
    if (!hasUniqueStrings(toolIds)) {
      ctx.addIssue({ path: ["tools"], message: "Integration tool IDs must be unique" });
    }
    for (const [index, tool] of connector.tools.entries()) {
      if (!tool.id) continue;
      const prefix = `${connector.name}__`;
      const localId = tool.id.startsWith(prefix) ? tool.id.slice(prefix.length) : "";
      if (!CANONICAL_TOOL_LOCAL_ID_PATTERN.test(localId) || localId.includes("__")) {
        ctx.addIssue({
          path: ["tools", index, "id"],
          message: `Integration tool IDs must use the ${prefix}tool_id namespace`,
        });
      }
    }
    const envVarNames = (connector.envVars ?? []).map((envVar) => envVar.name);
    if (!hasUniqueStrings(envVarNames)) {
      ctx.addIssue({ path: ["envVars"], message: "Integration env var names must be unique" });
    }
    const promptIds = (connector.prompts ?? []).map((prompt) => prompt.id);
    if (!hasUniqueStrings(promptIds)) {
      ctx.addIssue({ path: ["prompts"], message: "Integration prompt IDs must be unique" });
    }
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
