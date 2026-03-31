import { z } from "zod";

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
  "discord",
  "hubspot",
  "stripe",
  "dropbox",
  "salesforce",
  "twitter",
  "onedrive",
  "bitbucket",
  "sentry",
  "posthog",
  "zendesk",
  "asana",
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

export const IntegrationNameSchema = z.enum(integrationNames);

export const EnvVarSchema = z.object({
  name: z.string(),
  description: z.string(),
  required: z.boolean(),
  sensitive: z.boolean().optional(),
  placeholder: z.string().optional(),
  docsUrl: z.string().optional(),
  default: z.string().optional(),
});

export const OAuthFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.string(),
  required: z.boolean(),
  envVar: z.string(),
  default: z.string().optional(),
});

export const OAuthConfigSchema = z.object({
  type: z.enum(["oauth2", "oauth1", "api-key"]),
  provider: z.string().optional(),
  authorizationUrl: z.string().optional(),
  tokenUrl: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  callbackPath: z.string().optional(),
  tokenAuthMethod: z.string().optional(),
  pkce: z.boolean().optional(),
  usePKCE: z.boolean().optional(),
  supportsRefreshToken: z.boolean().optional(),
  requiredApis: z
    .array(z.object({ name: z.string(), enableUrl: z.string() }))
    .optional(),
  additionalParams: z.record(z.string(), z.string()).optional(),
  additionalAuthParams: z.record(z.string(), z.string()).optional(),
  fields: z.array(OAuthFieldSchema).optional(),
  envVars: z
    .record(z.string(), z.object({ description: z.string(), required: z.boolean() }))
    .optional(),
  keyName: z.string().optional(),
  headerName: z.string().optional(),
  headerPrefix: z.string().optional(),
  tokenName: z.string().optional(),
  docsUrl: z.string().optional(),
});

export const IntegrationEndpointParamSchema = z.object({
  type: z.enum(["string", "number", "boolean", "string[]", "object", "array"]),
  in: z.enum(["path", "query", "header", "body"]),
  description: z.string(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

export const IntegrationEndpointBodyFieldSchema = z.object({
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  description: z.string(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

export const IntegrationEndpointSchema = z.object({
  type: z.enum(["rest", "graphql"]).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string(),
  query: z.string().optional(),
  params: z.record(z.string(), IntegrationEndpointParamSchema).optional(),
  body: z.record(z.string(), IntegrationEndpointBodyFieldSchema).optional(),
  contentType: z.string().optional(),
  response: z.object({ transform: z.string().optional() }).optional(),
});

export const IntegrationToolSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string(),
  requiresWrite: z.boolean().optional(),
  file: z.string().optional(),
  endpoint: IntegrationEndpointSchema.optional(),
});

export const IntegrationPromptSchema = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  category: z.string().optional(),
  icon: z.string().optional(),
});

export const IntegrationConfigSchema = z.object({
  name: IntegrationNameSchema,
  displayName: z.string(),
  icon: z.string().optional(),
  description: z.string(),
  auth: OAuthConfigSchema,
  envVars: z.array(EnvVarSchema).optional(),
  tools: z.array(IntegrationToolSchema),
  prompts: z.array(IntegrationPromptSchema).optional(),
  suggestedWith: z.array(z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  category: z.string().optional(),
});

export type IntegrationName = z.infer<typeof IntegrationNameSchema>;
export type EnvVarConfig = z.infer<typeof EnvVarSchema>;
export type OAuthField = z.infer<typeof OAuthFieldSchema>;
export type OAuthConfig = z.infer<typeof OAuthConfigSchema>;
export type IntegrationToolMeta = z.infer<typeof IntegrationToolSchema>;
export type IntegrationPrompt = z.infer<typeof IntegrationPromptSchema>;
export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;
