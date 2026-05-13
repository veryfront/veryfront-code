import { z } from "zod";

function parseBooleanFlag(value: string): boolean {
  return value === "true";
}

function splitAllowedOrigins(value: string): string[] {
  return value.split(",").map((origin) => origin.trim());
}

const booleanFlagSchema = z.string().default("false").transform(parseBooleanFlag);

export const agentServiceConfigSchema = z.object({
  VERYFRONT_API_URL: z.string().url().default("https://api.veryfront.com"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  OAUTH_PUBLIC_KEY: z.string().optional(),
  VERYFRONT_STUDIO_MCP_URL: z.string().default(""),
  VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT: booleanFlagSchema,
  VERYFRONT_ENABLE_DURABLE_TASK: booleanFlagSchema,
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000,http://veryfront.me:3000"),
  OTEL_ENABLED: booleanFlagSchema,
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
}).transform((env) => ({
  VERYFRONT_API_URL: env.VERYFRONT_API_URL,
  VERYFRONT_MCP_URL: `${env.VERYFRONT_API_URL}/mcp`,
  VERYFRONT_STUDIO_MCP_URL: env.VERYFRONT_STUDIO_MCP_URL,
  VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT: env.VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT,
  VERYFRONT_ENABLE_DURABLE_TASK: env.VERYFRONT_ENABLE_DURABLE_TASK,
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
  OAUTH_PUBLIC_KEY: env.OAUTH_PUBLIC_KEY,
  ALLOWED_ORIGINS: splitAllowedOrigins(env.ALLOWED_ORIGINS),
  OTEL_ENABLED: env.OTEL_ENABLED,
  OTEL_EXPORTER_OTLP_ENDPOINT: env.OTEL_EXPORTER_OTLP_ENDPOINT,
}));

export type AgentServiceConfig = z.infer<typeof agentServiceConfigSchema>;
export type AgentServiceConfigInput = z.input<typeof agentServiceConfigSchema>;

export const hostedAgentServiceConfigSchema = agentServiceConfigSchema;
export type HostedAgentServiceConfig = AgentServiceConfig;
export type HostedAgentServiceConfigInput = AgentServiceConfigInput;

export function parseAgentServiceConfig(
  input: AgentServiceConfigInput,
): AgentServiceConfig {
  return agentServiceConfigSchema.parse(input);
}

export function parseHostedAgentServiceConfig(
  input: HostedAgentServiceConfigInput,
): HostedAgentServiceConfig {
  return parseAgentServiceConfig(input);
}
