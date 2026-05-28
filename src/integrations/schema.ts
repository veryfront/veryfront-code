import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

const integrationNames = [
  "gmail",
  "slack",
  "github",
  "calendar",
  "jira",
  "notion",
  "confluence",
  "linear",
  "gitlab",
  "outlook",
  "teams",
  "figma",
  "sheets",
  "airtable",
  "sharepoint",
  "onedrive",
  "asana",
  "drive",
  "docs-google",
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

export const getIntegrationEndpointSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["rest", "graphql"]).optional(),
    method: v.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: v.string(),
    query: v.string().optional(),
    params: v.record(v.string(), getIntegrationEndpointParamSchema()).optional(),
    body: v.record(v.string(), getIntegrationEndpointBodyFieldSchema()).optional(),
    contentType: v.string().optional(),
    response: v.object({ transform: v.string().optional() }).optional(),
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
/** Public API contract for integration prompt. */
export type IntegrationPrompt = InferSchema<ReturnType<typeof getIntegrationPromptSchema>>;
/** Configuration used by integration. */
export type IntegrationConfig = InferSchema<ReturnType<typeof getIntegrationConfigSchema>>;
