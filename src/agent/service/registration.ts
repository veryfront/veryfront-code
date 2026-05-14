import { z } from "zod";

export const agentServiceRegistrationModeSchema = z.enum([
  "auto",
  "enabled",
  "disabled",
]);

export const agentServiceRegistrationConfigSchema = z.object({
  VERYFRONT_API_URL: z.string().url(),
  VERYFRONT_API_TOKEN: z.string().min(1).optional(),
  VERYFRONT_PROJECT_ID: z.string().min(1).optional(),
  VERYFRONT_AGENT_SERVICE_URL: z.string().url().optional(),
  VERYFRONT_AGENT_SERVICE_KEY: z.string().min(1).max(128).optional(),
  VERYFRONT_AGENT_SERVICE_REGISTRATION: agentServiceRegistrationModeSchema,
  VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: z.number().positive(),
  VERYFRONT_AGENT_SERVICE_REGION: z.string().min(1).max(128).optional(),
});

export const resolvedAgentServiceRegistrationInputSchema = z.object({
  apiUrl: z.string().url(),
  authToken: z.string().min(1),
  serviceName: z.string().min(1).max(128),
  serviceKey: z.string().min(1).max(128),
  scopeKind: z.enum(["global", "project"]),
  projectId: z.string().min(1).optional(),
  agentId: z.string().min(1).max(128).optional(),
  baseUrl: z.string().url(),
  invokeUrl: z.string().url(),
  version: z.string().min(1).max(128).optional(),
  runtime: z.string().min(1).max(128).optional(),
  region: z.string().min(1).max(128).optional(),
  heartbeatIntervalMs: z.number().positive(),
});

const agentPushRuntimeServiceRestSchema = z.object({
  id: z.string().uuid(),
  service_name: z.string(),
  service_key: z.string(),
  scope_kind: z.enum(["global", "project"]),
  scope_key: z.string(),
  project_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  base_url: z.string().url(),
  invoke_url: z.string().url(),
  status: z.enum(["active", "disabled"]),
  capabilities: z.unknown().nullable(),
  metadata: z.unknown().nullable(),
  version: z.string().nullable(),
  runtime: z.string().nullable(),
  region: z.string().nullable(),
  last_heartbeat_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const agentPushRuntimeServiceResponseSchema = z.object({
  service: agentPushRuntimeServiceRestSchema,
});

const registerAgentPushRuntimeServiceRequestSchema = z.object({
  service_name: z.string().min(1).max(128),
  service_key: z.string().min(1).max(128),
  scope_kind: z.enum(["global", "project"]),
  project_id: z.string().optional(),
  agent_id: z.string().optional(),
  base_url: z.string().url(),
  invoke_url: z.string().url(),
  version: z.string().optional(),
  runtime: z.string().optional(),
  region: z.string().optional(),
});

export type AgentServiceRegistrationMode = z.infer<typeof agentServiceRegistrationModeSchema>;
export type AgentServiceRegistrationConfig = z.infer<typeof agentServiceRegistrationConfigSchema>;
export type ResolvedAgentServiceRegistrationInput = z.infer<
  typeof resolvedAgentServiceRegistrationInputSchema
>;
export type AgentPushRuntimeServiceRest = z.infer<typeof agentPushRuntimeServiceRestSchema>;
export type RegisterAgentPushRuntimeServiceRequest = z.infer<
  typeof registerAgentPushRuntimeServiceRequestSchema
>;

export type AgentServiceRegistrationLogger = {
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

export type ResolveAgentServiceRegistrationInputOptions = {
  config: AgentServiceRegistrationConfig;
  serviceName: string;
  agentId?: string;
  version?: string;
  runtime?: string;
};

export type AgentServiceRegistrationLifecycle = {
  serviceId: string;
  service: AgentPushRuntimeServiceRest;
  heartbeat: () => Promise<void>;
  stop: () => void;
};

export type CreateAgentServiceRegistrationLifecycleOptions =
  & ResolvedAgentServiceRegistrationInput
  & {
    fetch?: typeof globalThis.fetch;
    logger?: AgentServiceRegistrationLogger;
  };

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function defaultInvokeUrl(baseUrl: string): string {
  return new URL("/api/runs", baseUrl).toString();
}

function getRegistrationEndpoint(apiUrl: string): string {
  return new URL("/agent-runtimes/push-services", apiUrl).toString();
}

function getHeartbeatEndpoint(apiUrl: string, serviceId: string): string {
  return new URL(`/agent-runtimes/push-services/${serviceId}/heartbeat`, apiUrl).toString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function stableServiceKey(input: {
  serviceName: string;
  agentId?: string;
  baseUrl: string;
  scopeKind: "global" | "project";
  projectId?: string;
}): Promise<string> {
  const keySource = [
    input.serviceName,
    input.agentId ?? "default",
    input.scopeKind,
    input.projectId ?? "global",
    input.baseUrl,
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keySource));
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  return `${input.serviceName}:${hash}`.slice(0, 128);
}

function requireExplicitRegistrationValue(
  value: string | undefined,
  envName: string,
): string {
  if (!value) {
    throw new Error(`${envName} is required when VERYFRONT_AGENT_SERVICE_REGISTRATION=enabled`);
  }
  return value;
}

export async function resolveAgentServiceRegistrationInput(
  options: ResolveAgentServiceRegistrationInputOptions,
): Promise<ResolvedAgentServiceRegistrationInput | null> {
  const config = agentServiceRegistrationConfigSchema.parse(options.config);
  const enabled = config.VERYFRONT_AGENT_SERVICE_REGISTRATION === "enabled";
  const token = enabled
    ? requireExplicitRegistrationValue(config.VERYFRONT_API_TOKEN, "VERYFRONT_API_TOKEN")
    : config.VERYFRONT_API_TOKEN;
  const serviceUrl = enabled
    ? requireExplicitRegistrationValue(
      config.VERYFRONT_AGENT_SERVICE_URL,
      "VERYFRONT_AGENT_SERVICE_URL",
    )
    : config.VERYFRONT_AGENT_SERVICE_URL;

  if (config.VERYFRONT_AGENT_SERVICE_REGISTRATION === "disabled") {
    return null;
  }
  if (!token || !serviceUrl) {
    return null;
  }

  const scopeKind = config.VERYFRONT_PROJECT_ID ? "project" : "global";
  const baseUrl = normalizeBaseUrl(serviceUrl);
  const serviceKey = config.VERYFRONT_AGENT_SERVICE_KEY ?? await stableServiceKey({
    serviceName: options.serviceName,
    agentId: options.agentId,
    baseUrl,
    scopeKind,
    projectId: config.VERYFRONT_PROJECT_ID,
  });

  return resolvedAgentServiceRegistrationInputSchema.parse({
    apiUrl: config.VERYFRONT_API_URL,
    authToken: token,
    serviceName: options.serviceName,
    serviceKey,
    scopeKind,
    projectId: config.VERYFRONT_PROJECT_ID,
    agentId: options.agentId,
    baseUrl,
    invokeUrl: defaultInvokeUrl(baseUrl),
    version: options.version,
    runtime: options.runtime,
    region: config.VERYFRONT_AGENT_SERVICE_REGION,
    heartbeatIntervalMs: config.VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS,
  });
}

async function readAgentPushRuntimeServiceResponse(
  response: Response,
): Promise<AgentPushRuntimeServiceRest> {
  if (!response.ok) {
    throw new Error(`Agent runtime registration request failed with HTTP ${response.status}`);
  }

  const parsed = agentPushRuntimeServiceResponseSchema.parse(await response.json());
  return parsed.service;
}

function createHeaders(authToken: string): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${authToken}`);
  headers.set("Content-Type", "application/json");
  return headers;
}

function buildRegistrationRequest(
  input: ResolvedAgentServiceRegistrationInput,
): RegisterAgentPushRuntimeServiceRequest {
  return registerAgentPushRuntimeServiceRequestSchema.parse({
    service_name: input.serviceName,
    service_key: input.serviceKey,
    scope_kind: input.scopeKind,
    project_id: input.projectId,
    agent_id: input.agentId,
    base_url: input.baseUrl,
    invoke_url: input.invokeUrl,
    version: input.version,
    runtime: input.runtime,
    region: input.region,
  });
}

async function registerAgentPushRuntimeService(
  input: ResolvedAgentServiceRegistrationInput,
  fetchImpl: typeof globalThis.fetch,
): Promise<AgentPushRuntimeServiceRest> {
  const response = await fetchImpl(getRegistrationEndpoint(input.apiUrl), {
    method: "POST",
    headers: createHeaders(input.authToken),
    body: JSON.stringify(buildRegistrationRequest(input)),
  });
  return await readAgentPushRuntimeServiceResponse(response);
}

async function heartbeatAgentPushRuntimeService(
  input: { apiUrl: string; authToken: string; serviceId: string },
  fetchImpl: typeof globalThis.fetch,
): Promise<AgentPushRuntimeServiceRest> {
  const response = await fetchImpl(getHeartbeatEndpoint(input.apiUrl, input.serviceId), {
    method: "POST",
    headers: createHeaders(input.authToken),
  });
  return await readAgentPushRuntimeServiceResponse(response);
}

export async function createAgentServiceRegistrationLifecycle(
  options: CreateAgentServiceRegistrationLifecycleOptions,
): Promise<AgentServiceRegistrationLifecycle> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const input = resolvedAgentServiceRegistrationInputSchema.parse(options);
  const service = await registerAgentPushRuntimeService(input, fetchImpl);
  let stopped = false;

  const heartbeat = async () => {
    if (stopped) {
      return;
    }
    await heartbeatAgentPushRuntimeService({
      apiUrl: input.apiUrl,
      authToken: input.authToken,
      serviceId: service.id,
    }, fetchImpl);
  };

  const interval = setInterval(() => {
    void heartbeat().catch((error: unknown) => {
      options.logger?.warn?.("Agent service heartbeat failed", {
        serviceId: service.id,
        error: getErrorMessage(error),
      });
    });
  }, input.heartbeatIntervalMs);

  options.logger?.info?.("Agent service registered with control plane", {
    serviceId: service.id,
    serviceName: service.service_name,
    scopeKind: service.scope_kind,
    projectId: service.project_id,
  });

  return {
    serviceId: service.id,
    service,
    heartbeat,
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
}
