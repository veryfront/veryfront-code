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
/** Minimum time allowed for a control-plane heartbeat attempt. */
const HEARTBEAT_MIN_ATTEMPT_TIMEOUT_MS = 5_000;
/**
 * Share of one heartbeat interval the retry backoff may occupy.
 *
 * This bounds only the waits between attempts. Each request has its own
 * interval-derived deadline, so a complete retry sequence can still outlive
 * one interval. The in-flight guard below prevents overlap in that case.
 */
const HEARTBEAT_RETRY_BUDGET_RATIO = 0.25;

/** Bounded retry plan for one heartbeat tick. */
export type HeartbeatRetrySchedule = {
  /** Total attempts, including the first. */
  maxAttempts: number;
  /** Backoff after each attempt that may still be retried, in attempt order. */
  delaysMs: readonly number[];
};

/**
 * Build the doubling backoff for one heartbeat tick, scaled down so the whole
 * sequence of waits fits inside {@link HEARTBEAT_RETRY_BUDGET_RATIO} of the
 * configured interval however short that interval is.
 */
export function heartbeatRetrySchedule(heartbeatIntervalMs: number): HeartbeatRetrySchedule {
  // Doubling weights 1, 2, 4, … over the maxAttempts - 1 waits sum to 2^(n-1) - 1.
  const totalWeight = 2 ** (HEARTBEAT_MAX_ATTEMPTS - 1) - 1;
  const budgetMs = heartbeatIntervalMs * HEARTBEAT_RETRY_BUDGET_RATIO;
  const unitDelayMs = Math.max(
    0,
    Math.min(HEARTBEAT_RETRY_BASE_DELAY_MS, Math.floor(budgetMs / totalWeight)),
  );
  return {
    maxAttempts: HEARTBEAT_MAX_ATTEMPTS,
    delaysMs: Array.from(
      { length: HEARTBEAT_MAX_ATTEMPTS - 1 },
      (_unused, attempt) => unitDelayMs * 2 ** attempt,
    ),
  };
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

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    // The headers landed but the body did not: the deadline fired while the
    // JSON was still arriving, or the connection reset mid-body. No complete
    // response came back and nothing upstream was applied, so this is as
    // transport-level as a failed connect and gets the same retries. It
    // carries no httpStatus, which is what marks it retryable.
    throw NETWORK_ERROR.create({ detail: getErrorMessage(cause), cause });
  }

  // Outside that wrapper on purpose. A body that arrived intact but does not
  // match the schema is a permanent protocol mismatch, not a transient one.
  // Wrapping it as a transport error would make every tick spend all three
  // attempts on a response that will never parse.
  const parsed = agentPushRuntimeServiceResponseSchema.parse(payload);
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
  abortSignal?: AbortSignal,
): Promise<AgentPushRuntimeServiceRest> {
  const response = await fetchImpl(getRegistrationEndpoint(input.apiUrl), {
    method: "POST",
    headers: createHeaders(input.authToken),
    body: JSON.stringify(buildRegistrationRequest(input)),
    signal: abortSignal,
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
    // A caller-supplied fetch may reject with an error that is already ours,
    // and that error already carries its own slug and httpStatus. Reclassifying
    // it would drop the status that keeps a 4xx from being retried.
    if (isVeryfrontError(cause)) throw cause;
    // Anything else means no response, so the request never reached a handler
    // and applied nothing. It carries no httpStatus, which is what marks it
    // transport-level below.
    throw NETWORK_ERROR.create({
      detail: getErrorMessage(cause),
      cause,
    });
  }
  // Deliberately outside the wrapper above. The read does its own transport
  // mapping, so a failed body read is still retried, while a non-ok status
  // keeps its httpStatus and a schema mismatch stays permanent.
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

/**
 * A heartbeat 404 means the control plane no longer knows this service id: the
 * registry row was evicted, the environment was reset, or a redeploy wiped it.
 * Repeating the heartbeat can never succeed, so the lifecycle registers again
 * instead of counting the tick toward the persistent-failure escalation.
 */
function isLostRegistrationHeartbeatFailure(error: unknown): boolean {
  if (!isVeryfrontError(error) || error.slug !== NETWORK_ERROR.slug) return false;
  return readUpstreamHttpStatus(error.context) === 404;
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
    // Derive the deadline from the configured interval, but keep enough room
    // for a known-valid slow control-plane response. Raising the interval for a
    // slower link still raises the deadline, while the floor prevents a short
    // interval from falsely escalating a healthy service.
    timeoutMs: Math.max(input.heartbeatIntervalMs, HEARTBEAT_MIN_ATTEMPT_TIMEOUT_MS),
    computeDelay: (attempt) => schedule.delaysMs[attempt] ?? 0,
    shouldRetry: isRetryableHeartbeatFailure,
    onRetry: ({ error, attempt, delay }) => {
      options.logger?.warn?.("Agent service heartbeat retrying after transient failure", {
        serviceId: input.serviceId,
        attempt: attempt + 1,
        retryInMs: delay,
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
  let service = await registerAgentPushRuntimeService(input, fetchImpl);
  let stopped = false;
  const teardown = new AbortController();
  let heartbeatInFlight: Promise<void> | undefined;
  let heartbeatSkipLogged = false;
  let awaitingHeartbeatAfterReregistration = false;
  const recoveredHeartbeats = new WeakSet<Promise<void>>();

  const heartbeat = () => {
    if (heartbeatInFlight) return heartbeatInFlight;

    heartbeatSkipLogged = false;
    heartbeatInFlight = (async () => {
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
        awaitingHeartbeatAfterReregistration = false;
      } catch (error) {
        // stop() aborts the in-flight request and any pending backoff. That is a
        // teardown, not a heartbeat failure, so it must not reach the counter.
        if (stopped) {
          return;
        }
        if (isLostRegistrationHeartbeatFailure(error)) {
          // The service_key upsert makes registering again idempotent, and the
          // next tick heartbeats against the adopted id. Only the first recovery
          // is exempted: another 404 before any heartbeat succeeds means the
          // control plane is repeatedly losing registrations and must escalate.
          try {
            const registeredService = await retryWithBackoff(
              (signal) => registerAgentPushRuntimeService(input, fetchImpl, signal),
              {
                maxAttempts: 1,
                abortSignal: teardown.signal,
                timeoutMs: Math.max(
                  input.heartbeatIntervalMs,
                  HEARTBEAT_MIN_ATTEMPT_TIMEOUT_MS,
                ),
              },
            );
            if (stopped) {
              return;
            }
            if (!awaitingHeartbeatAfterReregistration && heartbeatInFlight) {
              recoveredHeartbeats.add(heartbeatInFlight);
            }
            awaitingHeartbeatAfterReregistration = true;
            service = registeredService;
            lifecycle.serviceId = registeredService.id;
            lifecycle.service = registeredService;
            options.logger?.info?.(
              "Agent service re-registered after the control plane lost its registration",
              { serviceId: service.id },
            );
          } catch (registrationError) {
            if (stopped) {
              return;
            }
            // A failed re-registration keeps counting toward the escalation, so
            // a genuinely dead control plane still surfaces persistently.
            options.logger?.warn?.("Agent service re-registration failed", {
              serviceId: service.id,
              error: getErrorMessage(registrationError),
            });
            throw registrationError;
          }
          if (stopped) {
            return;
          }
        }
        throw error;
      }
    })().finally(() => {
      heartbeatInFlight = undefined;
    });
    return heartbeatInFlight;
  };

  let consecutiveHeartbeatFailures = 0;

  const interval = setInterval(() => {
    // Retries make a tick outlive its interval whenever the control plane is
    // slow. Starting another tick on top would double the load on a service
    // that is already struggling, and would let the failure counter advance
    // out of order, so the beat is skipped instead.
    if (heartbeatInFlight) {
      if (!heartbeatSkipLogged) {
        heartbeatSkipLogged = true;
        options.logger?.warn?.(
          "Agent service heartbeat tick skipped, previous tick still running",
          { serviceId: service.id },
        );
      }
      return;
    }
    const scheduledHeartbeat = heartbeat();
    void scheduledHeartbeat.then(() => {
      consecutiveHeartbeatFailures = 0;
    }).catch((error: unknown) => {
      if (recoveredHeartbeats.has(scheduledHeartbeat)) {
        consecutiveHeartbeatFailures = 0;
        return;
      }
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
    });
  }, input.heartbeatIntervalMs);

  const lifecycle: AgentServiceRegistrationLifecycle = {
    serviceId: service.id,
    service,
    heartbeat,
    stop: () => {
      stopped = true;
      clearInterval(interval);
      teardown.abort();
    },
  };

  options.logger?.info?.("Agent service registered with control plane", {
    serviceId: service.id,
    serviceName: service.service_name,
    scopeKind: service.scope_kind,
    projectId: service.project_id,
  });

  return lifecycle;
}
