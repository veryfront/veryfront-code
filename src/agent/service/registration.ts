import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "../../schemas/define.ts";
import { lazySchema } from "../../schemas/lazy.ts";
import {
  CONFIG_INVALID,
  isVeryfrontError,
  NETWORK_ERROR,
  retryWithBackoff,
} from "#veryfront/errors";
import { computeHash } from "#veryfront/utils";

/** Public API contract for agent service registration mode. */
export type AgentServiceRegistrationMode = "auto" | "enabled" | "disabled";
/** Configuration used by agent service registration. */
export type AgentServiceRegistrationConfig = {
  VERYFRONT_API_URL: string;
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
};
/** Input payload for resolved agent service registration. */
export type ResolvedAgentServiceRegistrationInput = {
  apiUrl: string;
  authToken: string;
  serviceName: string;
  serviceKey: string;
  scopeKind: "global" | "project";
  projectId?: string;
  agentId?: string;
  baseUrl: string;
  invokeUrl: string;
  version?: string;
  runtime?: string;
  region?: string;
  heartbeatIntervalMs: number;
};
/** Public API contract for agent push runtime service rest. */
export type AgentPushRuntimeServiceRest = {
  id: string;
  service_name: string;
  service_key: string;
  scope_kind: "global" | "project";
  scope_key: string;
  project_id: string | null;
  agent_id: string | null;
  base_url: string;
  invoke_url: string;
  status: "active" | "disabled";
  capabilities?: unknown | null;
  metadata?: unknown | null;
  version: string | null;
  runtime: string | null;
  region: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
};
/** Request payload for register agent push runtime service. */
export type RegisterAgentPushRuntimeServiceRequest = {
  service_name: string;
  service_key: string;
  scope_kind: "global" | "project";
  project_id?: string;
  agent_id?: string;
  base_url: string;
  invoke_url: string;
  version?: string;
  runtime?: string;
  region?: string;
};

function agentServiceRegistrationMode(
  v: SchemaValidator,
): Schema<AgentServiceRegistrationMode> {
  return v.enum(["auto", "enabled", "disabled"] as const);
}

export const agentServiceRegistrationModeSchema = lazySchema(
  defineSchema<AgentServiceRegistrationMode>(agentServiceRegistrationMode),
);

/** Zod schema for agent service registration config. */
export const agentServiceRegistrationConfigSchema = lazySchema(
  defineSchema<AgentServiceRegistrationConfig>((v) =>
    v.object({
      VERYFRONT_API_URL: v.string().url(),
      VERYFRONT_API_TOKEN: v.string().min(1).optional(),
      VERYFRONT_PROJECT_ID: v.string().min(1).optional(),
      VERYFRONT_AGENT_SERVICE_URL: v.string().url().optional(),
      VERYFRONT_AGENT_SERVICE_KEY: v.string().min(1).max(128).optional(),
      VERYFRONT_AGENT_SERVICE_REGISTRATION: agentServiceRegistrationMode(v),
      VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: v.number().positive(),
      VERYFRONT_AGENT_SERVICE_REGION: v.string().min(1).max(128).optional(),
      POD_NAME: v.string().min(1).max(128).optional(),
      POD_UID: v.string().min(1).max(128).optional(),
      POD_IP: v.string().min(1).max(128).optional(),
    })
  ),
);

/** Zod schema for resolved agent service registration input. */
export const resolvedAgentServiceRegistrationInputSchema = lazySchema(
  defineSchema<ResolvedAgentServiceRegistrationInput>((v) =>
    v.object({
      apiUrl: v.string().url(),
      authToken: v.string().min(1),
      serviceName: v.string().min(1).max(128),
      serviceKey: v.string().min(1).max(128),
      scopeKind: v.enum(["global", "project"] as const),
      projectId: v.string().min(1).optional(),
      agentId: v.string().min(1).max(128).optional(),
      baseUrl: v.string().url(),
      invokeUrl: v.string().url(),
      version: v.string().min(1).max(128).optional(),
      runtime: v.string().min(1).max(128).optional(),
      region: v.string().min(1).max(128).optional(),
      heartbeatIntervalMs: v.number().positive(),
    })
  ),
);

function agentPushRuntimeServiceRest(
  v: SchemaValidator,
): Schema<AgentPushRuntimeServiceRest> {
  return v.object({
    id: v.string().uuid(),
    service_name: v.string(),
    service_key: v.string(),
    scope_kind: v.enum(["global", "project"] as const),
    scope_key: v.string(),
    project_id: v.string().nullable(),
    agent_id: v.string().nullable(),
    base_url: v.string().url(),
    invoke_url: v.string().url(),
    status: v.enum(["active", "disabled"] as const),
    capabilities: v.unknown().nullable(),
    metadata: v.unknown().nullable(),
    version: v.string().nullable(),
    runtime: v.string().nullable(),
    region: v.string().nullable(),
    last_heartbeat_at: v.string().nullable(),
    created_at: v.string(),
    updated_at: v.string(),
  });
}

const agentPushRuntimeServiceResponseSchema = lazySchema(
  defineSchema<{ service: AgentPushRuntimeServiceRest }>((v) =>
    v.object({
      service: agentPushRuntimeServiceRest(v),
    })
  ),
);

const registerAgentPushRuntimeServiceRequestSchema = lazySchema(
  defineSchema<RegisterAgentPushRuntimeServiceRequest>((v) =>
    v.object({
      service_name: v.string().min(1).max(128),
      service_key: v.string().min(1).max(128),
      scope_kind: v.enum(["global", "project"] as const),
      project_id: v.string().optional(),
      agent_id: v.string().optional(),
      base_url: v.string().url(),
      invoke_url: v.string().url(),
      version: v.string().optional(),
      runtime: v.string().optional(),
      region: v.string().optional(),
    })
  ),
);

/** Public API contract for agent service registration logger. */
export type AgentServiceRegistrationLogger = {
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

/** Options accepted by resolve agent service registration input. */
export type ResolveAgentServiceRegistrationInputOptions = {
  config: AgentServiceRegistrationConfig;
  serviceName: string;
  agentId?: string;
  version?: string;
  runtime?: string;
};

/** Public API contract for agent service registration lifecycle. */
export type AgentServiceRegistrationLifecycle = {
  serviceId: string;
  service: AgentPushRuntimeServiceRest;
  heartbeat: () => Promise<void>;
  stop: () => void;
};

/** Options accepted by create agent service registration lifecycle. */
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

/** Total heartbeat attempts for one tick, including the first. */
const HEARTBEAT_MAX_ATTEMPTS = 3;
/** Backoff before the first retry when the heartbeat interval leaves room for it. */
const HEARTBEAT_RETRY_BASE_DELAY_MS = 250;
/**
 * Share of one heartbeat interval the retry backoff may occupy.
 *
 * This bounds the waits between attempts and nothing else. Keeping backoff well
 * inside the interval leaves the rest of the tick budget for the attempts.
 */
const HEARTBEAT_RETRY_BUDGET_RATIO = 0.25;
/**
 * Share of one heartbeat interval a whole tick — every attempt and every
 * backoff wait — may occupy. The remainder is headroom, so a tick that spends
 * its entire budget still settles before the next beat is due.
 */
const HEARTBEAT_TICK_BUDGET_RATIO = 0.9;

/** Bounded retry plan for one heartbeat tick. */
export type HeartbeatRetrySchedule = {
  /** Total attempts, including the first. */
  maxAttempts: number;
  /** Backoff after each attempt that may still be retried, in attempt order. */
  delaysMs: readonly number[];
  /**
   * Deadline for a single attempt.
   *
   * A hung request fails nothing, so without this the tick never settles and
   * the consecutive-failure counter never advances — the service looks alive to
   * itself while doing nothing (veryfront-issue-inbox#728). Cooperative: it
   * aborts the attempt's signal, which the request has to observe.
   */
  attemptTimeoutMs: number;
};

/**
 * Build the plan for one heartbeat tick: a doubling backoff scaled down so the
 * waits fit inside {@link HEARTBEAT_RETRY_BUDGET_RATIO} of the configured
 * interval, and an attempt deadline sized from whatever the waits leave of
 * {@link HEARTBEAT_TICK_BUDGET_RATIO} — so a tick always settles inside its own
 * interval however short that interval is.
 */
export function heartbeatRetrySchedule(heartbeatIntervalMs: number): HeartbeatRetrySchedule {
  // Doubling weights 1, 2, 4, … over the maxAttempts - 1 waits sum to 2^(n-1) - 1.
  const totalWeight = 2 ** (HEARTBEAT_MAX_ATTEMPTS - 1) - 1;
  const budgetMs = heartbeatIntervalMs * HEARTBEAT_RETRY_BUDGET_RATIO;
  const unitDelayMs = Math.max(
    0,
    Math.min(HEARTBEAT_RETRY_BASE_DELAY_MS, Math.floor(budgetMs / totalWeight)),
  );
  const delaysMs = Array.from(
    { length: HEARTBEAT_MAX_ATTEMPTS - 1 },
    (_unused, attempt) => unitDelayMs * 2 ** attempt,
  );
  const totalDelayMs = delaysMs.reduce((sum, delayMs) => sum + delayMs, 0);
  // Whatever the backoff leaves of the tick budget, split evenly across the
  // attempts. Deliberately as generous as that allows: escalation still waits
  // for three failed ticks, and a tick is paced by the interval, so shortening
  // this buys no earlier escalation and only risks reporting a merely slow
  // control plane as a dead one.
  const attemptTimeoutMs = Math.max(
    1,
    Math.floor(
      (heartbeatIntervalMs * HEARTBEAT_TICK_BUDGET_RATIO - totalDelayMs) / HEARTBEAT_MAX_ATTEMPTS,
    ),
  );
  return { maxAttempts: HEARTBEAT_MAX_ATTEMPTS, delaysMs, attemptTimeoutMs };
}

async function stableServiceKey(input: {
  serviceName: string;
  agentId?: string;
  baseUrl: string;
  scopeKind: "global" | "project";
  projectId?: string;
  podIdentity?: string;
}): Promise<string> {
  const keySource = [
    input.serviceName,
    input.agentId ?? "default",
    input.scopeKind,
    input.projectId ?? "global",
    input.baseUrl,
    input.podIdentity ?? "no-pod-identity",
  ].join("|");
  const hash = (await computeHash(keySource)).slice(0, 32);
  return `${input.serviceName}:${hash}`.slice(0, 128);
}

function requireExplicitRegistrationValue(
  value: string | undefined,
  envName: string,
): string {
  if (!value) {
    throw CONFIG_INVALID.create({
      detail: `${envName} is required when VERYFRONT_AGENT_SERVICE_REGISTRATION=enabled`,
    });
  }
  return value;
}

/** Input payload for resolve agent service registration. */
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
  const podIdentity = config.POD_UID ?? config.POD_NAME ?? config.POD_IP;
  const serviceKey = config.VERYFRONT_AGENT_SERVICE_KEY ?? await stableServiceKey({
    serviceName: options.serviceName,
    agentId: options.agentId,
    baseUrl,
    scopeKind,
    projectId: config.VERYFRONT_PROJECT_ID,
    podIdentity,
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
    throw NETWORK_ERROR.create({
      detail: `Agent runtime registration request failed with HTTP ${response.status}`,
      context: { httpStatus: response.status },
    });
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

type HeartbeatRequest = {
  apiUrl: string;
  authToken: string;
  serviceId: string;
  heartbeatIntervalMs: number;
};

async function sendHeartbeatRequest(
  input: HeartbeatRequest,
  fetchImpl: typeof globalThis.fetch,
  abortSignal: AbortSignal | undefined,
): Promise<AgentPushRuntimeServiceRest> {
  let response: Response;
  try {
    response = await fetchImpl(getHeartbeatEndpoint(input.apiUrl, input.serviceId), {
      method: "POST",
      headers: createHeaders(input.authToken),
      signal: abortSignal,
    });
  } catch (cause) {
    // No response, so the request never reached a handler and applied nothing.
    // It carries no httpStatus, which is what marks it transport-level below.
    throw NETWORK_ERROR.create({
      detail: getErrorMessage(cause),
      cause,
    });
  }
  return await readAgentPushRuntimeServiceResponse(response);
}

/** Upstream response status recorded on a heartbeat failure, if it got one. */
function readUpstreamHttpStatus(context: unknown): number | undefined {
  if (typeof context !== "object" || context === null) return undefined;
  const httpStatus = (context as { httpStatus?: unknown }).httpStatus;
  return typeof httpStatus === "number" ? httpStatus : undefined;
}

/**
 * A control-plane 5xx is transient — a dropped pooler connection clears within
 * a second — and the heartbeat is idempotent, so repeating it is safe. So is a
 * failure with no status: it never produced a response, so nothing was applied.
 * A 4xx (unknown service id, rejected token) is a real error that repeating
 * only delays, and any other error slug is not ours to retry.
 */
function isRetryableHeartbeatFailure(error: unknown): boolean {
  if (!isVeryfrontError(error) || error.slug !== NETWORK_ERROR.slug) return false;
  const httpStatus = readUpstreamHttpStatus(error.context);
  return httpStatus === undefined || (httpStatus >= 500 && httpStatus <= 599);
}

async function heartbeatAgentPushRuntimeService(
  input: HeartbeatRequest,
  fetchImpl: typeof globalThis.fetch,
  options: {
    logger?: AgentServiceRegistrationLogger;
    /** Aborts the in-flight request and any pending backoff on teardown. */
    abortSignal?: AbortSignal;
  } = {},
): Promise<AgentPushRuntimeServiceRest> {
  const schedule = heartbeatRetrySchedule(input.heartbeatIntervalMs);
  return await retryWithBackoff((signal) => sendHeartbeatRequest(input, fetchImpl, signal), {
    maxAttempts: schedule.maxAttempts,
    abortSignal: options.abortSignal,
    timeoutMs: schedule.attemptTimeoutMs,
    computeDelay: (attempt) => schedule.delaysMs[attempt] ?? 0,
    shouldRetry: isRetryableHeartbeatFailure,
    onRetry: ({ error, attempt, delay, isTimeout }) => {
      options.logger?.warn?.("Agent service heartbeat retrying after transient failure", {
        serviceId: input.serviceId,
        attempt: attempt + 1,
        retryInMs: delay,
        timedOut: isTimeout,
        error: getErrorMessage(error),
      });
    },
  });
}

/** Create agent service registration lifecycle. */
export async function createAgentServiceRegistrationLifecycle(
  options: CreateAgentServiceRegistrationLifecycleOptions,
): Promise<AgentServiceRegistrationLifecycle> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const input = resolvedAgentServiceRegistrationInputSchema.parse(options);
  const service = await registerAgentPushRuntimeService(input, fetchImpl);
  let stopped = false;
  const teardown = new AbortController();

  const heartbeat = async () => {
    if (stopped) {
      return;
    }
    try {
      await heartbeatAgentPushRuntimeService(
        {
          apiUrl: input.apiUrl,
          authToken: input.authToken,
          serviceId: service.id,
          heartbeatIntervalMs: input.heartbeatIntervalMs,
        },
        fetchImpl,
        { logger: options.logger, abortSignal: teardown.signal },
      );
    } catch (error) {
      // stop() aborts the in-flight request and any pending backoff. That is a
      // teardown, not a heartbeat failure, so it must not reach the counter.
      if (stopped) {
        return;
      }
      throw error;
    }
  };

  let consecutiveHeartbeatFailures = 0;
  let heartbeatInFlight = false;

  const interval = setInterval(() => {
    // Retries make a tick outlive its interval whenever the control plane is
    // slow. Starting another tick on top would double the load on a service
    // that is already struggling, and would let the failure counter advance
    // out of order, so the beat is skipped instead.
    if (heartbeatInFlight) {
      options.logger?.warn?.("Agent service heartbeat tick skipped, previous tick still running", {
        serviceId: service.id,
      });
      return;
    }
    heartbeatInFlight = true;
    void heartbeat().then(() => {
      consecutiveHeartbeatFailures = 0;
    }).catch((error: unknown) => {
      consecutiveHeartbeatFailures++;
      // Escalate from warn to error after repeated failures — persistent heartbeat
      // loss means the control plane considers this service dead while it keeps running.
      if (consecutiveHeartbeatFailures >= 3) {
        options.logger?.error?.("Agent service heartbeat failing persistently", {
          serviceId: service.id,
          consecutiveFailures: consecutiveHeartbeatFailures,
          error: getErrorMessage(error),
        });
      } else {
        options.logger?.warn?.("Agent service heartbeat failed", {
          serviceId: service.id,
          error: getErrorMessage(error),
        });
      }
    }).finally(() => {
      heartbeatInFlight = false;
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
      teardown.abort();
    },
  };
}
