import { ensureBuiltinSchemaValidator } from "../../extensions/builtin-extensions.ts";
import { defineSchema } from "../../schemas/define.ts";
import { lazySchema } from "../../schemas/lazy.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { AgentServiceRegistrationMode } from "./registration.ts";

function parseBooleanFlag(value: "true" | "false"): boolean {
  return value === "true";
}

function splitAllowedOrigins(value: string): string[] {
  const origins = new Set<string>();
  for (const rawOrigin of value.split(",")) {
    const origin = rawOrigin.trim();
    if (origin === "*") {
      origins.add(origin);
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new TypeError("Allowed origins must be HTTP or HTTPS origins");
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username ||
      parsed.password || parsed.origin === "null" ||
      (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash
    ) {
      throw new TypeError("Allowed origins must be HTTP or HTTPS origins");
    }
    origins.add(parsed.origin);
  }
  if (origins.size === 0) {
    throw new TypeError("At least one allowed origin is required");
  }
  return [...origins];
}

function normalizeHttpBaseUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute HTTP or HTTPS URL`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password ||
    url.search || url.hash
  ) {
    throw new TypeError(`${label} must be an absolute HTTP or HTTPS URL without credentials`);
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname === "" ? "" : pathname}`;
}

/** Configuration used by agent service. */
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
  POD_NAME?: string;
  POD_UID?: string;
  POD_IP?: string;
  VERYFRONT_STUDIO_MCP_URL: string;
  VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT: boolean;
  VERYFRONT_ENABLE_DURABLE_TASK: boolean;
  VERYFRONT_CONTEXT_COMPACTION_ENABLED: boolean;
  VERYFRONT_CONTEXT_COMPACTION_TOKEN_BUDGET: number;
  VERYFRONT_CONTEXT_COMPACTION_RESERVE_TOKENS: number;
  VERYFRONT_CONTEXT_COMPACTION_RECENT_TAIL_TOKENS: number;
  VERYFRONT_CONTEXT_COMPACTION_MINIMUM_RECENT_TURNS: number;
  VERYFRONT_CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS: number;
  VERYFRONT_CONTEXT_COMPACTION_SUMMARY_INPUT_TOKENS: number;
  VERYFRONT_CONTEXT_COMPACTION_SUMMARY_MODEL?: string;
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  OAUTH_PUBLIC_KEY?: string;
  ALLOWED_ORIGINS: string[];
  OTEL_ENABLED: boolean;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
};

/** Input payload for agent service config. */
export type AgentServiceConfigInput = Record<string, string | number | undefined>;

const getAgentServiceConfigSchema = defineSchema<AgentServiceConfig>((v) => {
  const booleanFlagSchema = v.enum(["true", "false"] as const).default("false").transform(
    parseBooleanFlag,
  );
  const agentServiceRegistrationModeInputSchema = v
    .enum(["auto", "enabled", "disabled", "true", "false"] as const)
    .default("auto")
    .transform((value) => {
      if (value === "true") return "enabled";
      if (value === "false") return "disabled";
      return value as AgentServiceRegistrationMode;
    });

  return v.object({
    VERYFRONT_API_URL: v.string().url().default("https://api.veryfront.com").transform((value) =>
      normalizeHttpBaseUrl(value, "VERYFRONT_API_URL")
    ),
    VERYFRONT_API_TOKEN: v.string().min(1).optional(),
    VERYFRONT_PROJECT_ID: v.string().min(1).optional(),
    VERYFRONT_AGENT_SERVICE_URL: v.string().url().transform((value) =>
      normalizeHttpBaseUrl(value, "VERYFRONT_AGENT_SERVICE_URL")
    ).optional(),
    VERYFRONT_AGENT_SERVICE_KEY: v.string().min(1).max(128).optional(),
    VERYFRONT_AGENT_SERVICE_REGISTRATION: agentServiceRegistrationModeInputSchema,
    VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: v.coerce.number().int().positive().max(
      2_147_483_647,
    ).default(30_000),
    VERYFRONT_AGENT_SERVICE_REGION: v.string().min(1).max(128).optional(),
    POD_NAME: v.string().min(1).max(128).optional(),
    POD_UID: v.string().min(1).max(128).optional(),
    POD_IP: v.string().min(1).max(128).optional(),
    NODE_ENV: v.enum(["development", "test", "production"] as const).default("development"),
    PORT: v.coerce.number().int().min(0).max(65_535).default(3001),
    OAUTH_PUBLIC_KEY: v.string().min(1).max(65_536).optional(),
    VERYFRONT_STUDIO_MCP_URL: v.string().max(2_048).default("").transform((value) =>
      value === "" ? "" : normalizeHttpBaseUrl(value, "VERYFRONT_STUDIO_MCP_URL")
    ),
    VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT: booleanFlagSchema,
    VERYFRONT_ENABLE_DURABLE_TASK: booleanFlagSchema,
    VERYFRONT_CONTEXT_COMPACTION_ENABLED: v.enum(["true", "false"] as const).default("true")
      .transform(parseBooleanFlag),
    VERYFRONT_CONTEXT_COMPACTION_TOKEN_BUDGET: v.coerce.number().int().positive().default(180_000),
    VERYFRONT_CONTEXT_COMPACTION_RESERVE_TOKENS: v.coerce.number().int().nonnegative().default(
      32_000,
    ),
    VERYFRONT_CONTEXT_COMPACTION_RECENT_TAIL_TOKENS: v.coerce.number().int().positive().default(
      40_000,
    ),
    VERYFRONT_CONTEXT_COMPACTION_MINIMUM_RECENT_TURNS: v.coerce.number().int().positive().default(
      2,
    ),
    VERYFRONT_CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS: v.coerce.number().int().positive().default(
      8_000,
    ),
    VERYFRONT_CONTEXT_COMPACTION_SUMMARY_INPUT_TOKENS: v.coerce.number().int().positive().default(
      64_000,
    ),
    VERYFRONT_CONTEXT_COMPACTION_SUMMARY_MODEL: v.string().min(1).optional(),
    ALLOWED_ORIGINS: v.string().min(1).max(16_384).default(
      "http://localhost:3000,http://veryfront.me:3000",
    ),
    OTEL_ENABLED: booleanFlagSchema,
    OTEL_EXPORTER_OTLP_ENDPOINT: v.string().max(2_048).transform((value) =>
      normalizeHttpBaseUrl(value, "OTEL_EXPORTER_OTLP_ENDPOINT")
    ).optional(),
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
    POD_NAME: env.POD_NAME,
    POD_UID: env.POD_UID,
    POD_IP: env.POD_IP,
    VERYFRONT_STUDIO_MCP_URL: env.VERYFRONT_STUDIO_MCP_URL,
    VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT: env.VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT,
    VERYFRONT_ENABLE_DURABLE_TASK: env.VERYFRONT_ENABLE_DURABLE_TASK,
    VERYFRONT_CONTEXT_COMPACTION_ENABLED: env.VERYFRONT_CONTEXT_COMPACTION_ENABLED,
    VERYFRONT_CONTEXT_COMPACTION_TOKEN_BUDGET: env.VERYFRONT_CONTEXT_COMPACTION_TOKEN_BUDGET,
    VERYFRONT_CONTEXT_COMPACTION_RESERVE_TOKENS: env.VERYFRONT_CONTEXT_COMPACTION_RESERVE_TOKENS,
    VERYFRONT_CONTEXT_COMPACTION_RECENT_TAIL_TOKENS:
      env.VERYFRONT_CONTEXT_COMPACTION_RECENT_TAIL_TOKENS,
    VERYFRONT_CONTEXT_COMPACTION_MINIMUM_RECENT_TURNS:
      env.VERYFRONT_CONTEXT_COMPACTION_MINIMUM_RECENT_TURNS,
    VERYFRONT_CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS:
      env.VERYFRONT_CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
    VERYFRONT_CONTEXT_COMPACTION_SUMMARY_INPUT_TOKENS:
      env.VERYFRONT_CONTEXT_COMPACTION_SUMMARY_INPUT_TOKENS,
    VERYFRONT_CONTEXT_COMPACTION_SUMMARY_MODEL: env.VERYFRONT_CONTEXT_COMPACTION_SUMMARY_MODEL,
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    OAUTH_PUBLIC_KEY: env.OAUTH_PUBLIC_KEY,
    ALLOWED_ORIGINS: splitAllowedOrigins(env.ALLOWED_ORIGINS),
    OTEL_ENABLED: env.OTEL_ENABLED,
    OTEL_EXPORTER_OTLP_ENDPOINT: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }));
});

/** Zod schema for agent service config. */
export const agentServiceConfigSchema: Schema<AgentServiceConfig> = lazySchema(
  getAgentServiceConfigSchema,
);

/** Zod schema for hosted agent service config. */
export const hostedAgentServiceConfigSchema: Schema<HostedAgentServiceConfig> =
  agentServiceConfigSchema;
/** Configuration used by hosted agent service. */
export type HostedAgentServiceConfig = AgentServiceConfig;
/** Input payload for hosted agent service config. */
export type HostedAgentServiceConfigInput = AgentServiceConfigInput;

/** Configuration used by parse agent service. */
export function parseAgentServiceConfig(
  input: AgentServiceConfigInput,
): AgentServiceConfig {
  ensureBuiltinSchemaValidator();
  return agentServiceConfigSchema.parse(input);
}

/** Configuration used by parse hosted agent service. */
export function parseHostedAgentServiceConfig(
  input: HostedAgentServiceConfigInput,
): HostedAgentServiceConfig {
  return parseAgentServiceConfig(input);
}
