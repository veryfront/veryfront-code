import { z } from "zod";

function parseBooleanFlag(value: string): boolean {
  return value === "true";
}

function splitAllowedOrigins(value: string): string[] {
  return value.split(",").map((origin) => origin.trim());
}

const booleanFlagSchema = z.string().default("false").transform(parseBooleanFlag);

const agentServiceRegistrationModeInputSchema = z
  .enum(["auto", "enabled", "disabled", "true", "false"])
  .default("auto")
  .transform((value) => {
    if (value === "true") return "enabled";
    if (value === "false") return "disabled";
    return value;
  });

export const agentServiceConfigSchema = z.object({
  VERYFRONT_API_URL: z.string().url().default("https://api.veryfront.com"),
  VERYFRONT_API_TOKEN: z.string().min(1).optional(),
  VERYFRONT_PROJECT_ID: z.string().min(1).optional(),
  VERYFRONT_AGENT_SERVICE_URL: z.string().url().optional(),
  VERYFRONT_AGENT_SERVICE_KEY: z.string().min(1).max(128).optional(),
  VERYFRONT_AGENT_SERVICE_REGISTRATION: agentServiceRegistrationModeInputSchema,
  VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: z.coerce.number().positive().default(30_000),
  VERYFRONT_AGENT_SERVICE_REGION: z.string().min(1).max(128).optional(),
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
  VERYFRONT_API_TOKEN: env.VERYFRONT_API_TOKEN,
  VERYFRONT_PROJECT_ID: env.VERYFRONT_PROJECT_ID,
  VERYFRONT_AGENT_SERVICE_URL: env.VERYFRONT_AGENT_SERVICE_URL,
  VERYFRONT_AGENT_SERVICE_KEY: env.VERYFRONT_AGENT_SERVICE_KEY,
  VERYFRONT_AGENT_SERVICE_REGISTRATION: env.VERYFRONT_AGENT_SERVICE_REGISTRATION,
  VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: env.VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS,
  VERYFRONT_AGENT_SERVICE_REGION: env.VERYFRONT_AGENT_SERVICE_REGION,
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
