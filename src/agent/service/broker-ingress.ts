import {
  getProjectEventPersistenceSchema,
  type ProjectEventPersistence,
} from "../hosted/event-persistence-contract.ts";
import {
  createRunBoundAgentManualPause,
  registerHostedAgentPauseFactory,
} from "../hosted/manual-pause-credential.ts";
import { resolveHostOwnedSourceApiBaseUrl } from "#veryfront/config/host-api-base.ts";
import {
  INGRESS_RUN_STOP_TOKEN_HEADER,
  INGRESS_RUN_TERMINAL_TOKEN_HEADER,
  readIngressCredential,
  readInvocationIngressCredentials,
} from "#veryfront/security/http/ingress-credentials.ts";
import { MAX_ROOT_RUN_EVENT_WRITER_TOKEN_BYTES } from "../conversation/run-event-limits.ts";
import { parseBrokerSignedRunPath } from "./broker-run-route.ts";
import { containsBrokerCredential } from "#veryfront/agent/service/broker-credentials.ts";
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
const ownDescriptor = Object.getOwnPropertyDescriptor;
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
const forbiddenForwardedAuthorityFields = new Set([
  "authorization",
  "authtoken",
  "inferenceauthtoken",
  "sourceauthtoken",
  "terminalauthtoken",
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
  | "BROKER_RUN_NOT_ACTIVE"
  | "BROKER_UNAVAILABLE"
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
  readonly sourceProject?: Readonly<NonNullable<RuntimeAgentRunInvocation["sourceProject"]>>;
  readonly agentEntrypoint?: RuntimeAgentRunInvocation["agentEntrypoint"];
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
  readonly sourceAuthToken?: string;
  readonly terminalAuthToken?: string;
  readonly authorization: TAuthorization;
  readonly rawBody: string;
  /** Signed API negotiation; never part of executor data. */
  readonly projectEventPersistence?: Readonly<ProjectEventPersistence>;
}

/** Signed identity and credentials supplied to the trusted scope verifier. */
export interface BrokerIngressScopeInput {
  /** Source owner; consuming execution authority must also be checked against run.project. */
  readonly owner: HostedExecutorOwner;
  readonly claims: Readonly<ControlPlaneClaims>;
  readonly run: RuntimeAgentRunContext;
  readonly sourceProject?: Readonly<NonNullable<RuntimeAgentRunInvocation["sourceProject"]>>;
  readonly authorization: string;
  readonly apiAuthToken: string;
  readonly sourceAuthToken?: string;
  readonly terminalAuthToken?: string;
  readonly runEventToken: string;
}

/** Broker-owned verification policy for one expected run and source. */
export interface BrokerRuntimeAgentIngressOptions<TAuthorization> {
  publicKeyPem: string;
  audience: string;
  /** Source runtime project verified by the signature, independent of a shared run's consuming project. */
  projectId: string;
  expectedRunId: string;
  expectedSurface: ControlPlaneSurface;
  boundSource: HostedRuntimeSourceIdentity | undefined;
  /** Host registry lookup after signature and source-namespace verification; a fixed binding takes precedence. */
  resolveBoundSource?(input: {
    sourceProject: Readonly<RuntimeAgentRunContext["project"]>;
    requestedSource: RuntimeAgentRunInvocation["agentSource"];
  }): HostedRuntimeSourceIdentity | undefined;
  expectedOwner: HostedExecutorOwner;
  authorizeScope(
    input: BrokerIngressScopeInput,
  ): TAuthorization | undefined | Promise<TAuthorization | undefined>;
  signal?: AbortSignal;
  readTimeoutMs?: number;
  /** Trusted host destination and transport for private run pause control. Never read from the invocation. */
  pauseApiBaseUrl?: string;
  pauseFetch?: typeof fetch;
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
  const actualPath = new URL(request.url).pathname;
  if (request.method !== "POST" || parseBrokerSignedRunPath(actualPath) !== expectedRunId) {
    throw new BrokerIngressError(400, "BROKER_INGRESS_TARGET_MISMATCH");
  }
  const inboundAuthorization = readIngressCredential(request, "authorization");
  const signature = request.headers.get(CONTROL_PLANE_JWS_HEADER);
  const runEventToken = readIngressCredential(request, RUN_EVENT_APPEND_TOKEN_HEADER);
  const stopToken = readIngressCredential(request, INGRESS_RUN_STOP_TOKEN_HEADER);
  const terminalAuthToken = readIngressCredential(request, INGRESS_RUN_TERMINAL_TOKEN_HEADER);
  // A header credential takes the place of its body field; a differing body
  // field fails validation below.
  const ingressCredentials = readInvocationIngressCredentials(request);
  if (
    (stopToken && stopToken.length > 16 * 1024) ||
    (terminalAuthToken && terminalAuthToken.length > 16 * 1024)
  ) {
    throw new BrokerIngressError(401, "BROKER_INGRESS_AUTH_REQUIRED");
  }
  if (
    !inboundAuthorization || inboundAuthorization.length > 16 * 1024 || !signature ||
    !runEventToken || runEventToken.length > MAX_ROOT_RUN_EVENT_WRITER_TOKEN_BYTES
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
  const invocationResult = safeParseRuntimeAgentRunInvocationValue(
    bodyValue,
    ingressCredentials,
  );
  if (!invocationResult.success) {
    throw new BrokerIngressError(400, "BROKER_INGRESS_INVALID_BODY");
  }
  const invocation = invocationResult.data;
  // These are operator-signed transport fields, not forwarded project properties.
  if (ownDescriptor(bodyValue as object, "managedRecoveryAdmission")?.value !== undefined) {
    // This broker does not implement durable native recovery ownership.
    throw new BrokerIngressError(503, "BROKER_UNAVAILABLE");
  }
  const negotiation = ownDescriptor(bodyValue as object, "projectEventPersistence");
  let projectEventPersistence: Readonly<ProjectEventPersistence> | undefined;
  if (negotiation) {
    const parsed = getProjectEventPersistenceSchema().safeParse(negotiation.value);
    if (!parsed.success) throw new BrokerIngressError(400, "BROKER_INGRESS_INVALID_BODY");
    const cursor = invocation.run.eventCursor;
    if (
      cursor && (
        parsed.data.canonicalRunId.toLowerCase() !== cursor.canonicalRunId.toLowerCase() ||
        parsed.data.latestEventId < cursor.latestEventId ||
        parsed.data.latestExternalEventSequence < cursor.latestExternalEventSequence
      )
    ) throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
    projectEventPersistence = Object.freeze(parsed.data);
  }

  if (invocation.run.runId !== expectedRunId) {
    throw new BrokerIngressError(400, "CONTROL_PLANE_RUN_ID_MISMATCH");
  }
  const sourceProject = invocation.sourceProject ?? invocation.run.project;
  if (
    sourceProject.projectId !== options.projectId ||
    sourceProject.projectSlug !== options.audience ||
    claims.project_id !== sourceProject.projectId ||
    claims.aud !== sourceProject.projectSlug
  ) throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
  let boundSource = options.boundSource;
  if (boundSource === undefined && options.resolveBoundSource) {
    try {
      boundSource = options.resolveBoundSource({
        sourceProject: Object.freeze({ ...sourceProject }),
        requestedSource: Object.freeze({ ...invocation.agentSource }),
      });
    } catch {
      throw new BrokerIngressError(500, "BROKER_INGRESS_SCOPE_FAILED");
    }
  }
  const sourceError = verifyHostedRuntimeSourceBinding(boundSource, invocation.agentSource);
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
      ...(invocation.sourceProject
        ? { sourceProject: Object.freeze({ ...invocation.sourceProject }) }
        : {}),
      authorization: inboundAuthorization,
      apiAuthToken,
      ...(invocation.credentials?.sourceAuthToken
        ? { sourceAuthToken: invocation.credentials.sourceAuthToken }
        : {}),
      ...(terminalAuthToken ? { terminalAuthToken } : {}),
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
      ...(invocation.sourceProject ? { sourceProject: invocation.sourceProject } : {}),
      ...(invocation.agentEntrypoint ? { agentEntrypoint: invocation.agentEntrypoint } : {}),
      ...(invocation.agentConfig ? { agentConfig: invocation.agentConfig } : {}),
      input: toRuntimeRunAgentInput(parsedInbound.data),
    } satisfies BrokerRuntimeAgentExecutorInput,
  );
  if (
    containsBrokerCredential(executorValue, [
      inboundAuthorization,
      apiAuthToken,
      runEventToken,
      invocation.credentials?.inferenceAuthToken,
      invocation.credentials?.sourceAuthToken,
      stopToken,
      terminalAuthToken,
    ])
  ) {
    throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
  }
  const ingress: BrokerRuntimeAgentIngress<TAuthorization> = {
    privateAuthority: Object.freeze({
      owner,
      claims: Object.freeze({ ...claims }),
      inboundAuthorization,
      apiAuthToken,
      runEventToken,
      ...(invocation.credentials?.inferenceAuthToken
        ? { inferenceAuthToken: invocation.credentials.inferenceAuthToken }
        : {}),
      ...(invocation.credentials?.sourceAuthToken
        ? { sourceAuthToken: invocation.credentials.sourceAuthToken }
        : {}),
      ...(terminalAuthToken ? { terminalAuthToken } : {}),
      authorization,
      rawBody,
      ...(projectEventPersistence ? { projectEventPersistence } : {}),
    }),
    executor: executorValue,
  };
  if (stopToken) {
    registerHostedAgentPauseFactory(
      ingress,
      (signal, settlementSignal) =>
        createRunBoundAgentManualPause({
          apiUrl: options.pauseApiBaseUrl ?? resolveHostOwnedSourceApiBaseUrl(),
          fetch: options.pauseFetch,
          runId: expectedRunId,
          token: stopToken,
          signal,
          settlementSignal,
        }),
    );
  }
  return ingress;
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
