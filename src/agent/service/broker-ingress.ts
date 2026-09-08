import type { ControlPlaneClaims, ControlPlaneSurface } from "#veryfront/channels/control-plane.ts";
import {
  CONTROL_PLANE_JWS_HEADER,
  verifyControlPlaneJws,
} from "#veryfront/channels/control-plane.ts";
import {
  buildRuntimeAgentControlPlaneStreamRequestFromInvocation,
  getRuntimeAgentRunIdSchema,
  type RuntimeAgentRunContext,
  type RuntimeAgentRunInvocation,
  safeParseRuntimeAgentRunInvocationValue,
} from "#veryfront/agent/runtime/agent-invocation-contract.ts";
import {
  getInternalAgentControlPlaneStreamRequestSchema,
  type RuntimeRunAgentInput,
  toRuntimeRunAgentInput,
} from "#veryfront/internal-agents/schema.ts";
import {
  isRequestBodyTooLargeError,
  readBodyBytesWithLimit,
} from "#veryfront/security/input-validation/limits.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  getHostedExecutorOwnerSchema,
  type HostedExecutorOwner,
} from "#veryfront/agent/hosted/executor-session-schema.ts";
import {
  type HostedRuntimeSourceIdentity,
  verifyHostedRuntimeSourceBinding,
} from "#veryfront/agent/hosted/runtime-source-binding.ts";

const BROKER_INGRESS_MAX_BODY_BYTES = DEFAULT_MAX_BODY_SIZE_BYTES;
const RUN_EVENT_APPEND_TOKEN_HEADER = "x-veryfront-run-event-token";
const DEFAULT_BODY_READ_TIMEOUT_MS = 30_000;
const MAX_BODY_READ_TIMEOUT_MS = 60_000;
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
const forbiddenForwardedAuthorityFields = new Set([
  "authorization",
  "authtoken",
  "inferenceauthtoken",
  "credential",
  "credentials",
  "runeventtoken",
]);

/** Fixed, credential-free ingress failure identifiers. */
export type BrokerIngressErrorCode =
  | "BROKER_INGRESS_INVALID_BODY"
  | "BROKER_INGRESS_BODY_TOO_LARGE"
  | "BROKER_INGRESS_ABORTED"
  | "BROKER_INGRESS_TIMEOUT"
  | "BROKER_INGRESS_AUTH_REQUIRED"
  | "BROKER_INGRESS_AUTH_INVALID"
  | "BROKER_INGRESS_SCOPE_DENIED"
  | "BROKER_INGRESS_SCOPE_FAILED"
  | "BROKER_INGRESS_TARGET_MISMATCH"
  | "CONTROL_PLANE_RUN_ID_MISMATCH"
  | "CONTROL_PLANE_AGENT_SOURCE_UNBOUND"
  | "CONTROL_PLANE_AGENT_SOURCE_UNSUPPORTED"
  | "CONTROL_PLANE_AGENT_SOURCE_MISMATCH";

/**
 * Local HTTP-boundary errors intentionally avoid the application error registry:
 * only a fixed code/status is exposed, never body, credential, or verifier diagnostics.
 * These errors stay in the broker and are not executor-channel error contracts.
 */
export class BrokerIngressError extends Error {
  constructor(readonly status: number, readonly errorCode: BrokerIngressErrorCode) {
    super(errorCode);
    this.name = "BrokerIngressError";
  }
}

/** Validated application data that can cross the executor channel. */
export interface BrokerRuntimeAgentExecutorInput {
  readonly owner: HostedExecutorOwner;
  readonly run: Omit<RuntimeAgentRunContext, "validatedClaims"> & {
    validatedClaims?: RuntimeAgentRunContext["validatedClaims"];
  };
  readonly taskId?: string;
  readonly agentSource: RuntimeAgentRunInvocation["agentSource"];
  readonly agentConfig?: RuntimeAgentRunInvocation["agentConfig"];
  readonly input: RuntimeRunAgentInput;
}

/** HTTP credentials and verified authority retained exclusively in the broker. */
export interface BrokerRuntimeAgentPrivateAuthority<TAuthorization> {
  readonly owner: HostedExecutorOwner;
  readonly claims: Readonly<ControlPlaneClaims>;
  readonly inboundAuthorization: string;
  readonly apiAuthToken: string;
  readonly runEventToken: string;
  readonly inferenceAuthToken?: string;
  readonly authorization: TAuthorization;
  readonly rawBody: string;
}

/** Signed identity and credentials supplied to the trusted scope verifier. */
export interface BrokerIngressScopeInput {
  readonly owner: HostedExecutorOwner;
  readonly claims: Readonly<ControlPlaneClaims>;
  readonly run: RuntimeAgentRunContext;
  readonly authorization: string;
  readonly apiAuthToken: string;
  readonly runEventToken: string;
}

/** Broker-owned verification policy for one expected run and source. */
export interface BrokerRuntimeAgentIngressOptions<TAuthorization> {
  publicKeyPem: string;
  audience: string;
  projectId: string;
  expectedRunId: string;
  expectedSurface: ControlPlaneSurface;
  boundSource: HostedRuntimeSourceIdentity | undefined;
  expectedOwner: HostedExecutorOwner;
  authorizeScope(
    input: BrokerIngressScopeInput,
  ): TAuthorization | undefined | Promise<TAuthorization | undefined>;
  signal?: AbortSignal;
  readTimeoutMs?: number;
}

/** Separate private authority and executor-safe invocation data. */
export interface BrokerRuntimeAgentIngress<TAuthorization> {
  privateAuthority: BrokerRuntimeAgentPrivateAuthority<TAuthorization>;
  executor: BrokerRuntimeAgentExecutorInput;
}

/** Read and verify a signed invocation once before constructing executor-safe data. */
export async function parseBrokerRuntimeAgentIngress<TAuthorization>(
  request: Request,
  options: BrokerRuntimeAgentIngressOptions<TAuthorization>,
): Promise<BrokerRuntimeAgentIngress<TAuthorization>> {
  const expectedRunId = getRuntimeAgentRunIdSchema().parse(options.expectedRunId);
  const expectedPath = `/api/control-plane/runs/${expectedRunId}/stream`;
  const actualPath = new URL(request.url).pathname;
  if (request.method !== "POST" || actualPath !== expectedPath) {
    throw new BrokerIngressError(400, "BROKER_INGRESS_TARGET_MISMATCH");
  }
  const inboundAuthorization = request.headers.get("authorization");
  const signature = request.headers.get(CONTROL_PLANE_JWS_HEADER);
  const runEventToken = request.headers.get(RUN_EVENT_APPEND_TOKEN_HEADER);
  if (
    !inboundAuthorization || inboundAuthorization.length > 16 * 1024 || !signature ||
    !runEventToken || runEventToken.length > 16 * 1024
  ) {
    throw new BrokerIngressError(401, "BROKER_INGRESS_AUTH_REQUIRED");
  }
  const ownerResult = getHostedExecutorOwnerSchema().safeParse(options.expectedOwner);
  if (!ownerResult.success) throw new TypeError("Invalid broker ingress owner");
  const owner = Object.freeze(ownerResult.data);
  if (owner.scopeKind === "project" && owner.projectId !== options.projectId) {
    throw new TypeError("Broker ingress owner does not match its project scope");
  }

  const timeoutMs = options.readTimeoutMs ?? DEFAULT_BODY_READ_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_BODY_READ_TIMEOUT_MS) {
    throw new TypeError("Invalid broker ingress body timeout");
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signals = [request.signal, timeoutSignal, ...(options.signal ? [options.signal] : [])];
  const readSignal = AbortSignal.any(signals);
  let rawBody: string;
  try {
    const bytes = await readBodyBytesWithLimit(request, BROKER_INGRESS_MAX_BODY_BYTES, {
      signal: readSignal,
    });
    rawBody = fatalDecoder.decode(bytes);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      throw new BrokerIngressError(413, "BROKER_INGRESS_BODY_TOO_LARGE");
    }
    if (readSignal.aborted) {
      throw new BrokerIngressError(
        timeoutSignal.aborted && !request.signal.aborted && !options.signal?.aborted ? 408 : 499,
        timeoutSignal.aborted && !request.signal.aborted && !options.signal?.aborted
          ? "BROKER_INGRESS_TIMEOUT"
          : "BROKER_INGRESS_ABORTED",
      );
    }
    throw new BrokerIngressError(400, "BROKER_INGRESS_INVALID_BODY");
  }

  let claims: ControlPlaneClaims;
  try {
    claims = await verifyControlPlaneJws(signature, rawBody, {
      audience: options.audience,
      expectedProjectId: options.projectId,
      expectedSubject: expectedRunId,
      expectedSurface: options.expectedSurface,
      maxAgeSeconds: 60,
      publicKeyPem: options.publicKeyPem,
      requestMethod: request.method,
      requestPath: actualPath,
    });
  } catch {
    throw new BrokerIngressError(401, "BROKER_INGRESS_AUTH_INVALID");
  }

  let bodyValue: unknown;
  try {
    bodyValue = JSON.parse(rawBody);
  } catch {
    throw new BrokerIngressError(400, "BROKER_INGRESS_INVALID_BODY");
  }
  const invocationResult = safeParseRuntimeAgentRunInvocationValue(bodyValue);
  if (!invocationResult.success) {
    throw new BrokerIngressError(400, "BROKER_INGRESS_INVALID_BODY");
  }
  const invocation = invocationResult.data;
  if (invocation.run.runId !== expectedRunId) {
    throw new BrokerIngressError(400, "CONTROL_PLANE_RUN_ID_MISMATCH");
  }
  if (
    invocation.run.project.projectId !== options.projectId ||
    invocation.run.project.projectSlug !== options.audience ||
    claims.project_id !== invocation.run.project.projectId ||
    claims.aud !== invocation.run.project.projectSlug
  ) throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
  const sourceError = verifyHostedRuntimeSourceBinding(options.boundSource, invocation.agentSource);
  if (sourceError) throw new BrokerIngressError(sourceError.status, sourceError.errorCode);

  const inbound = buildRuntimeAgentControlPlaneStreamRequestFromInvocation(invocation);
  const parsedInbound = getInternalAgentControlPlaneStreamRequestSchema().safeParse(inbound);
  if (!parsedInbound.success) throw new BrokerIngressError(400, "BROKER_INGRESS_INVALID_BODY");
  const apiAuthToken = invocation.credentials?.authToken;
  if (!apiAuthToken) throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
  if (containsForwardedAuthority(parsedInbound.data.forwardedProps)) {
    throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
  }

  let authorization: TAuthorization | undefined;
  try {
    authorization = await options.authorizeScope({
      owner,
      claims: Object.freeze({ ...claims }),
      run: invocation.run,
      authorization: inboundAuthorization,
      apiAuthToken,
      runEventToken,
    });
  } catch {
    throw new BrokerIngressError(500, "BROKER_INGRESS_SCOPE_FAILED");
  }
  if (authorization === undefined) {
    throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
  }

  const executorValue = snapshotExecutorValue(
    {
      owner,
      run: invocation.run,
      ...(invocation.taskId ? { taskId: invocation.taskId } : {}),
      agentSource: invocation.agentSource,
      ...(invocation.agentConfig ? { agentConfig: invocation.agentConfig } : {}),
      input: toRuntimeRunAgentInput(parsedInbound.data),
    } satisfies BrokerRuntimeAgentExecutorInput,
  );
  for (
    const token of [
      inboundAuthorization,
      apiAuthToken,
      runEventToken,
      invocation.credentials?.inferenceAuthToken,
    ]
  ) {
    if (token && containsString(executorValue, token)) {
      throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
    }
  }
  return {
    privateAuthority: Object.freeze({
      owner,
      claims: Object.freeze({ ...claims }),
      inboundAuthorization,
      apiAuthToken,
      runEventToken,
      ...(invocation.credentials?.inferenceAuthToken
        ? { inferenceAuthToken: invocation.credentials.inferenceAuthToken }
        : {}),
      authorization,
      rawBody,
    }),
    executor: executorValue,
  };
}

function snapshotExecutorValue<T>(value: T): T {
  const snapshot = snapshotBoundedJsonValue(value);
  if (!snapshot.success) throw new BrokerIngressError(400, "BROKER_INGRESS_INVALID_BODY");
  // The bounded copy preserves the assembled, schema-validated DTO structure.
  return snapshot.value as T;
}

function containsForwardedAuthority(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForwardedAuthority);
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenForwardedAuthorityFields.has(key.replace(/[-_]/g, "").toLowerCase())) return true;
    if (containsForwardedAuthority(entry)) return true;
  }
  return false;
}

function containsString(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  if (!value || typeof value !== "object") return false;
  return Array.isArray(value)
    ? value.some((entry) => containsString(entry, expected))
    : Object.values(value).some((entry) => containsString(entry, expected));
}
