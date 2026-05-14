import { defineSchema } from "../../schemas/define.ts";
import { lazySchema } from "../../schemas/lazy.ts";

function parseBooleanFlag(value: string): boolean {
  return value === "true";
}

function splitAllowedOrigins(value: string): string[] {
  return value.split(",").map((origin) => origin.trim());
}

export type AgentServiceRegistrationMode = "auto" | "enabled" | "disabled";

export type AgentServiceConfig = {
  VERYFRONT_API_URL: string;
  VERYFRONT_MCP_URL: string;
  VERYFRONT_API_TOKEN?: string;
  VERYFRONT_PROJECT_ID?: string;
  VERYFRONT_AGENT_SERVICE_URL?: string;
  VERYFRONT_AGENT_SERVICE_KEY?: string;
  VERYFRONT_AGENT_SERVICE_REGISTRATION: AgentServiceRegistrationMode;
  VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: number;
  VERYFRONT_AGENT_SERVICE_REGION?: string;
  VERYFRONT_STUDIO_MCP_URL: string;
  VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT: boolean;
  VERYFRONT_ENABLE_DURABLE_TASK: boolean;
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  OAUTH_PUBLIC_KEY?: string;
  ALLOWED_ORIGINS: string[];
  OTEL_ENABLED: boolean;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
};

export type AgentServiceConfigInput = Record<string, string | number | undefined>;

const getAgentServiceConfigSchema = defineSchema<AgentServiceConfig>((v) => {
  const booleanFlagSchema = v.string().default("false").transform(parseBooleanFlag);
  const agentServiceRegistrationModeInputSchema = v
    .enum(["auto", "enabled", "disabled", "true", "false"] as const)
    .default("auto")
    .transform((value) => {
      if (value === "true") return "enabled";
      if (value === "false") return "disabled";
      return value as AgentServiceRegistrationMode;
    });

  return v.object({
    VERYFRONT_API_URL: v.string().url().default("https://api.veryfront.com"),
    VERYFRONT_API_TOKEN: v.string().min(1).optional(),
    VERYFRONT_PROJECT_ID: v.string().min(1).optional(),
    VERYFRONT_AGENT_SERVICE_URL: v.string().url().optional(),
    VERYFRONT_AGENT_SERVICE_KEY: v.string().min(1).max(128).optional(),
    VERYFRONT_AGENT_SERVICE_REGISTRATION: agentServiceRegistrationModeInputSchema,
    VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: v.coerce.number().positive().default(30_000),
    VERYFRONT_AGENT_SERVICE_REGION: v.string().min(1).max(128).optional(),
    NODE_ENV: v.enum(["development", "test", "production"] as const).default("development"),
    PORT: v.coerce.number().default(3001),
    OAUTH_PUBLIC_KEY: v.string().optional(),
    VERYFRONT_STUDIO_MCP_URL: v.string().default(""),
    VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT: booleanFlagSchema,
    VERYFRONT_ENABLE_DURABLE_TASK: booleanFlagSchema,
    ALLOWED_ORIGINS: v.string().default("http://localhost:3000,http://veryfront.me:3000"),
    OTEL_ENABLED: booleanFlagSchema,
    OTEL_EXPORTER_OTLP_ENDPOINT: v.string().optional(),
  }).transform((env) => ({
    VERYFRONT_API_URL: env.VERYFRONT_API_URL,
    VERYFRONT_MCP_URL: `${env.VERYFRONT_API_URL}/mcp`,
    VERYFRONT_API_TOKEN: env.VERYFRONT_API_TOKEN,
    VERYFRONT_PROJECT_ID: env.VERYFRONT_PROJECT_ID,
    VERYFRONT_AGENT_SERVICE_URL: env.VERYFRONT_AGENT_SERVICE_URL,
    VERYFRONT_AGENT_SERVICE_KEY: env.VERYFRONT_AGENT_SERVICE_KEY,
    VERYFRONT_AGENT_SERVICE_REGISTRATION: env.VERYFRONT_AGENT_SERVICE_REGISTRATION,
    VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS:
      env.VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS,
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
});

export const agentServiceConfigSchema = lazySchema(getAgentServiceConfigSchema);

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
