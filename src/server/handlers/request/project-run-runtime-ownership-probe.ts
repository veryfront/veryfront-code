import { getHostEnvExcludingEnvFile } from "#veryfront/platform/compat/process.ts";
import { serverLogger } from "#veryfront/utils";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import type { HandlerContext } from "#veryfront/types";

const RUNTIME_OWNERSHIP_PROBE_ENABLED = "VERYFRONT_RUNTIME_OWNERSHIP_PROBE_STAGE";
const RUNTIME_OWNERSHIP_PROBE_ID = "VERYFRONT_RUNTIME_OWNERSHIP_PROBE_ID";
const RUNTIME_OWNERSHIP_PROBE_PROJECT_ID = "VERYFRONT_RUNTIME_OWNERSHIP_PROBE_PROJECT_ID";
const RUNTIME_OWNERSHIP_PROBE_ENVIRONMENT_ID = "VERYFRONT_RUNTIME_OWNERSHIP_PROBE_ENVIRONMENT_ID";
const RUNTIME_OWNERSHIP_PROBE_EXPIRES_AT = "VERYFRONT_RUNTIME_OWNERSHIP_PROBE_EXPIRES_AT";
const RUNTIME_OWNERSHIP_PROBE_OPERATION_TIMEOUT_MS =
  "VERYFRONT_RUNTIME_OWNERSHIP_PROBE_OPERATION_TIMEOUT_MS";
const DEFAULT_OPERATION_TIMEOUT_MS = 5_000;
const MAX_OPERATION_TIMEOUT_MS = 30_000;
const MAX_ACTIVATION_WINDOW_MS = 6 * 60 * 60 * 1_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROBE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const activeProbeFlights = new Set<string>();
const RuntimeAbortSignalTimeout = AbortSignal.timeout;
const RuntimeEncodeURIComponent = encodeURIComponent;
const RuntimeArrayIsArray = Array.isArray;
const RuntimeArrayPrototypeSort = Array.prototype.sort;
const RuntimeJSONstringify = JSON.stringify;
const RuntimeObjectCreate = Object.create;
const RuntimeObjectDefineProperty = Object.defineProperty;
const RuntimeObjectKeys = Object.keys;
const RuntimeObjectPrototypeIsPrototypeOf = Object.prototype.isPrototypeOf;
const RuntimeReflectApply = Reflect.apply;
const RuntimeSetPrototypeAdd = Set.prototype.add;
const RuntimeSetPrototypeDelete = Set.prototype.delete;
const RuntimeSetPrototypeHas = Set.prototype.has;
const RuntimeErrorPrototype = Error.prototype;
const RuntimeDOMExceptionPrototype = DOMException.prototype;
const RuntimeRegExpPrototypeExec = RegExp.prototype.exec;
const HTTP_STATUS_RE = /(?:^|\D)(\d{3})(?:\D|$)/;

export interface RuntimeOwnershipProbeApiClient {
  get<T>(
    path: string,
    params?: Record<string, string>,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
  post?<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>;
  put<T>(
    path: string,
    body?: unknown,
    options?: { signal?: AbortSignal; params?: Record<string, string> },
  ): Promise<T>;
}

export interface RuntimeOwnershipProbeRunRequest {
  runId: string;
  projectId: string;
  canonicalRunId?: string;
}

export interface RuntimeOwnershipProbeSessionInput {
  request: RuntimeOwnershipProbeRunRequest;
  ctx: HandlerContext;
  nowMs: number;
  readNowMs?(): number;
  retainedEventToken: boolean;
  eventAuthorityCanonicalRunId?: string;
  createCanonicalClient(signal: AbortSignal): RuntimeOwnershipProbeApiClient;
  createReadbackClient?(signal: AbortSignal): RuntimeOwnershipProbeApiClient;
  createEventAppendClient?(signal: AbortSignal): RuntimeOwnershipProbeApiClient;
  createHeartbeatClient?(signal: AbortSignal): RuntimeOwnershipProbeApiClient;
  canonicalBranchId?: string;
}

export interface RuntimeOwnershipProbeSession {
  beforeExecute(): Promise<void>;
  afterStopAcknowledged(): Promise<void>;
}

export interface RuntimeOwnershipProbe {
  createSession(input: RuntimeOwnershipProbeSessionInput): RuntimeOwnershipProbeSession | undefined;
}

export type RuntimeOwnershipProbePhase = "current" | "stale-after-cancel";
export type RuntimeOwnershipProbeReceiptStatus = "ok" | "skipped" | "error";

export interface RuntimeOwnershipProbeReceipt {
  probe: "project-run-runtime-ownership";
  probeId: string;
  phase: RuntimeOwnershipProbePhase;
  status: RuntimeOwnershipProbeReceiptStatus;
  projectId: string;
  runId: string;
  environmentId: string;
  sourcePath: string;
  sourceHash?: string;
  beforeHash?: string;
  afterHash?: string;
  versionHash?: string;
  responseHash?: string;
  eventBeforeHash?: string;
  eventAfterHash?: string;
  eventResponseHash?: string;
  heartbeatResponseHash?: string;
  runBeforeHash?: string;
  runAfterHash?: string;
  reason?: string;
  errorType?: string;
}

export interface RuntimeOwnershipProbeActivation {
  probeId: string;
  projectId: string;
  environmentId: string;
  expiresAtMs: number;
  operationTimeoutMs: number;
}

export type RuntimeOwnershipProbeReceiptSink = (receipt: RuntimeOwnershipProbeReceipt) => void;
export type RuntimeOwnershipProbeEnvReader = (key: string) => string | undefined;

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseExpiry(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readActivationFromEnv(
  readEnv: RuntimeOwnershipProbeEnvReader,
  nowMs: number,
): RuntimeOwnershipProbeActivation | undefined {
  if (readEnv(RUNTIME_OWNERSHIP_PROBE_ENABLED) !== "1") return undefined;

  const probeId = readEnv(RUNTIME_OWNERSHIP_PROBE_ID) ?? "host-owned-stage-probe";
  const projectId = readEnv(RUNTIME_OWNERSHIP_PROBE_PROJECT_ID);
  const environmentId = readEnv(RUNTIME_OWNERSHIP_PROBE_ENVIRONMENT_ID);
  const expiresAtMs = parseExpiry(readEnv(RUNTIME_OWNERSHIP_PROBE_EXPIRES_AT));
  const timeoutMs = parsePositiveInteger(readEnv(RUNTIME_OWNERSHIP_PROBE_OPERATION_TIMEOUT_MS)) ??
    DEFAULT_OPERATION_TIMEOUT_MS;

  if (!PROBE_ID_RE.test(probeId)) return undefined;
  if (projectId === undefined || projectId.trim() === "") return undefined;
  if (environmentId === undefined || environmentId.trim() === "") return undefined;
  if (expiresAtMs === undefined || expiresAtMs <= nowMs) return undefined;
  if (expiresAtMs - nowMs > MAX_ACTIVATION_WINDOW_MS) return undefined;

  return {
    probeId,
    projectId,
    environmentId,
    expiresAtMs,
    operationTimeoutMs: Math.min(timeoutMs, MAX_OPERATION_TIMEOUT_MS),
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return RuntimeJSONstringify(value);
  if (RuntimeArrayIsArray(value)) {
    let output = "[";
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) output += ",";
      output += stableJson(value[index]);
    }
    return output + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = RuntimeReflectApply(
    RuntimeArrayPrototypeSort,
    RuntimeObjectKeys(record),
    [],
  ) as string[];
  let output = "{";
  for (let index = 0; index < keys.length; index += 1) {
    if (index > 0) output += ",";
    const key = keys[index]!;
    output += `${RuntimeJSONstringify(key)}:${stableJson(record[key])}`;
  }
  return output + "}";
}

async function safeHash(value: unknown): Promise<string> {
  return await computeHash(stableJson(value));
}

function classifyError(error: unknown): string {
  const valueType = typeof error;
  if (error === null || (valueType !== "object" && valueType !== "function")) return valueType;
  try {
    if (
      RuntimeReflectApply(RuntimeObjectPrototypeIsPrototypeOf, RuntimeDOMExceptionPrototype, [
        error,
      ]) as boolean
    ) {
      return "DOMException";
    }
  } catch {
    // Ignore hostile prototype traps and fall through to a fixed category.
  }
  try {
    if (
      RuntimeReflectApply(RuntimeObjectPrototypeIsPrototypeOf, RuntimeErrorPrototype, [
        error,
      ]) as boolean
    ) {
      return "Error";
    }
  } catch {
    // Ignore hostile prototype traps and fall through to a fixed category.
  }
  return valueType;
}

function defaultReceiptSink(receipt: RuntimeOwnershipProbeReceipt): void {
  serverLogger.info("[project-run-runtime-ownership-probe] receipt", receipt);
}

function isStagingContext(
  ctx: HandlerContext,
  activation: RuntimeOwnershipProbeActivation,
): boolean {
  if (ctx.projectId !== undefined && ctx.projectId !== activation.projectId) return false;
  if (ctx.environmentId !== activation.environmentId) return false;
  if (ctx.resolvedEnvironment === "production") return false;
  if (ctx.environmentName !== undefined && ctx.environmentName.toLowerCase() !== "staging") {
    return false;
  }
  return true;
}

function canonicalSourcePath(
  activation: RuntimeOwnershipProbeActivation,
  admittedRunId: string,
): string {
  return `knowledge/context-runtime-host-owned-stage-probe-20261011/${activation.probeId}/${admittedRunId}/ownership.json`;
}

interface CanonicalSnapshot {
  status: "ok";
  content: string;
  contentHash: string;
  versionHash?: string;
}

interface CanonicalAbsentSnapshot {
  status: "absent";
}

interface CanonicalReadErrorSnapshot {
  status: "error";
  errorType: string;
}

type CanonicalReadSnapshot =
  | CanonicalSnapshot
  | CanonicalAbsentSnapshot
  | CanonicalReadErrorSnapshot;

function httpStatusFromError(error: unknown): number | undefined {
  const isError = RuntimeReflectApply(RuntimeObjectPrototypeIsPrototypeOf, RuntimeErrorPrototype, [
    error,
  ]) as boolean;
  if (!isError) return undefined;
  let message: unknown;
  try {
    message = (error as { message?: unknown }).message;
  } catch {
    return undefined;
  }
  if (typeof message !== "string") return undefined;
  const match = RuntimeReflectApply(RuntimeRegExpPrototypeExec, HTTP_STATUS_RE, [message]) as
    | RegExpExecArray
    | null;
  if (!match) return undefined;
  const status = Number(match[1]);
  return Number.isInteger(status) ? status : undefined;
}

function isAuthorizationRejection(error: unknown): boolean {
  const status = httpStatusFromError(error);
  return status === 401 || status === 403;
}

function isAuthorizationOrConflictRejection(error: unknown): boolean {
  const status = httpStatusFromError(error);
  return status === 401 || status === 403 || status === 409;
}

function readCanonicalContent(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") {
    const content = (value as { content?: unknown }).content;
    return typeof content === "string" ? content : undefined;
  }
  return undefined;
}

interface RunEventListSnapshot {
  status: "ok";
  hash: string;
  containsProbeEvent: boolean;
}

interface RunSnapshot {
  status: "ok";
  hash: string;
}

type ReadbackSnapshot =
  | RunEventListSnapshot
  | RunSnapshot
  | CanonicalAbsentSnapshot
  | CanonicalReadErrorSnapshot;

function runPath(runId: string): string {
  return `/runs/${RuntimeEncodeURIComponent(runId)}`;
}

function runEventsPath(runId: string): string {
  return `${runPath(runId)}/events`;
}

function runHeartbeatsPath(runId: string): string {
  return `${runPath(runId)}/heartbeats`;
}

function readEventsArray(value: unknown): unknown[] | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const data = (value as { data?: unknown }).data;
  return RuntimeArrayIsArray(data) ? data : undefined;
}

async function readRunEventsSnapshot(
  client: RuntimeOwnershipProbeApiClient,
  runId: string,
  signal: AbortSignal,
  eventKind: string,
): Promise<RunEventListSnapshot | CanonicalReadErrorSnapshot> {
  let cursor: string | undefined;
  let pageHashes = "";
  let containsProbeEvent = false;
  for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
    try {
      const params: Record<string, string> = { limit: "100" };
      if (cursor !== undefined) params.cursor = cursor;
      const response = await client.get<unknown>(runEventsPath(runId), params, { signal });
      const events = readEventsArray(response);
      if (events === undefined) return { status: "error", errorType: "InvalidRunEventsReadback" };
      for (let index = 0; index < events.length; index++) {
        const event = events[index];
        if (
          event !== null && typeof event === "object" &&
          ((event as { event_type?: unknown }).event_type === "RUNTIME_EVENT_RECORDED" ||
            (event as { payload?: { type?: unknown } }).payload?.type ===
              "RUNTIME_EVENT_RECORDED") &&
          (event as { payload?: { kind?: unknown } }).payload?.kind === eventKind
        ) {
          containsProbeEvent = true;
        }
      }
      pageHashes += await safeHash(response) + "\n";
      const pageInfo = response !== null && typeof response === "object"
        ? (response as { page_info?: { next?: unknown } }).page_info
        : undefined;
      const next = pageInfo !== undefined && typeof pageInfo.next === "string"
        ? pageInfo.next
        : null;
      if (next === null) {
        return { status: "ok", hash: await computeHash(pageHashes), containsProbeEvent };
      }
      cursor = next;
    } catch (error) {
      return { status: "error", errorType: classifyError(error) };
    }
  }
  return { status: "error", errorType: "RunEventsReadbackPageLimit" };
}

async function readRunSnapshot(
  client: RuntimeOwnershipProbeApiClient,
  runId: string,
  signal: AbortSignal,
): Promise<RunSnapshot | CanonicalReadErrorSnapshot> {
  try {
    const response = await client.get<unknown>(runPath(runId), undefined, { signal });
    if (response === null || typeof response !== "object") {
      return { status: "error", errorType: "InvalidRunReadback" };
    }
    return { status: "ok", hash: await safeHash(response) };
  } catch (error) {
    return { status: "error", errorType: classifyError(error) };
  }
}

function eventKindForPhase(
  activation: RuntimeOwnershipProbeActivation,
  phase: RuntimeOwnershipProbePhase,
): string {
  return `veryfront.runtime-ownership.${activation.probeId}.${phase}`;
}

function eventPayloadForPhase(
  activation: RuntimeOwnershipProbeActivation,
  phase: RuntimeOwnershipProbePhase,
  runId: string,
) {
  const value = RuntimeObjectCreate(null) as Record<string, unknown>;
  value.probe = "project-run-runtime-ownership";
  value.probeId = activation.probeId;
  value.phase = phase;
  value.runId = runId;
  const payload = RuntimeObjectCreate(null) as Record<string, unknown>;
  payload.type = "RUNTIME_EVENT_RECORDED";
  payload.runtime = "veryfront";
  payload.kind = eventKindForPhase(activation, phase);
  payload.value = value;
  return payload;
}

function eventAppendBodyForPhase(
  activation: RuntimeOwnershipProbeActivation,
  phase: RuntimeOwnershipProbePhase,
  runId: string,
) {
  const events = [eventPayloadForPhase(activation, phase, runId)];
  RuntimeObjectDefineProperty(events, "toJSON", {
    configurable: true,
    value() {
      return events;
    },
  });
  const body = RuntimeObjectCreate(null) as { events: unknown[] };
  body.events = events;
  return body;
}

function heartbeatBody() {
  const body = RuntimeObjectCreate(null) as { lease_duration_seconds: number };
  body.lease_duration_seconds = 60;
  return body;
}

async function readCanonicalSnapshot(
  client: RuntimeOwnershipProbeApiClient,
  apiPath: string,
  signal: AbortSignal,
  params?: Record<string, string>,
): Promise<CanonicalReadSnapshot> {
  try {
    const response = await client.get<unknown>(apiPath, params, { signal });
    const content = readCanonicalContent(response);
    if (content === undefined) return { status: "error", errorType: "InvalidCanonicalReadback" };
    if (response === null || typeof response !== "object") {
      return { status: "error", errorType: "InvalidCanonicalReadback" };
    }
    const versionId = (response as { version_id?: unknown }).version_id;
    if (typeof versionId !== "string" || versionId.length === 0) {
      return { status: "error", errorType: "InvalidCanonicalReadback" };
    }
    const versionMaterial = {
      id: (response as { id?: unknown }).id,
      version_id: versionId,
      checksum: (response as { checksum?: unknown }).checksum,
      path: (response as { path?: unknown }).path,
    };
    return {
      status: "ok",
      content,
      contentHash: await computeHash(content),
      versionHash: await safeHash(versionMaterial),
    };
  } catch (error) {
    if (httpStatusFromError(error) === 404) return { status: "absent" };
    return { status: "error", errorType: classifyError(error) };
  }
}

export function createProjectRunRuntimeOwnershipProbe(
  activation: RuntimeOwnershipProbeActivation,
  sink: RuntimeOwnershipProbeReceiptSink = defaultReceiptSink,
): RuntimeOwnershipProbe {
  return {
    createSession(input) {
      if (input.nowMs >= activation.expiresAtMs) return undefined;
      if (input.request.projectId !== activation.projectId) return undefined;
      const admittedRunId = input.request.canonicalRunId;
      if (admittedRunId === undefined || !UUID_RE.test(admittedRunId)) return undefined;
      if (!isStagingContext(input.ctx, activation)) return undefined;

      let currentContentHash: string | undefined;
      let currentVersionHash: string | undefined;
      const sourcePath = canonicalSourcePath(activation, admittedRunId);
      const runPhase = async (phase: RuntimeOwnershipProbePhase): Promise<void> => {
        const baseReceipt = {
          probe: "project-run-runtime-ownership" as const,
          probeId: activation.probeId,
          phase,
          projectId: activation.projectId,
          runId: admittedRunId,
          environmentId: activation.environmentId,
          sourcePath,
        };
        if (!input.retainedEventToken || input.eventAuthorityCanonicalRunId === undefined) {
          sink({ ...baseReceipt, status: "skipped", reason: "missing-event-writer-authority" });
          return;
        }
        if (input.eventAuthorityCanonicalRunId.toLowerCase() !== admittedRunId.toLowerCase()) {
          sink({ ...baseReceipt, status: "skipped", reason: "event-writer-authority-mismatch" });
          return;
        }
        if (input.readNowMs?.() !== undefined && input.readNowMs() >= activation.expiresAtMs) {
          sink({ ...baseReceipt, status: "skipped", reason: "activation-expired" });
          return;
        }

        const flightKey = `${activation.probeId}:${admittedRunId}:${phase}`;
        if (
          RuntimeReflectApply(RuntimeSetPrototypeHas, activeProbeFlights, [flightKey]) as boolean
        ) {
          sink({ ...baseReceipt, status: "skipped", reason: "phase-already-running" });
          return;
        }
        RuntimeReflectApply(RuntimeSetPrototypeAdd, activeProbeFlights, [flightKey]);
        try {
          const signal = RuntimeAbortSignalTimeout(activation.operationTimeoutMs);
          const canonicalClient = input.createCanonicalClient(signal);
          const readbackClient = input.createReadbackClient?.(signal) ?? canonicalClient;
          const eventAppendClient = input.createEventAppendClient?.(signal) ?? canonicalClient;
          const heartbeatClient = input.createHeartbeatClient?.(signal) ?? readbackClient;
          const apiPath = `/projects/${RuntimeEncodeURIComponent(activation.projectId)}/files/${
            RuntimeEncodeURIComponent(sourcePath)
          }`;
          const content = "project-run-runtime-ownership" + "\n" + activation.probeId + "\n" +
            phase +
            "\n" + admittedRunId + "\n" + sourcePath;
          const sourceHash = await computeHash(content);
          const eventKind = eventKindForPhase(activation, phase);
          const canonicalParams = input.canonicalBranchId === undefined
            ? undefined
            : { branch_id: input.canonicalBranchId };
          const before = await readCanonicalSnapshot(
            readbackClient,
            apiPath,
            signal,
            canonicalParams,
          );
          if (before.status === "error") {
            sink({
              ...baseReceipt,
              status: "error",
              sourceHash,
              reason: "canonical-readback-before-failed",
              errorType: before.errorType,
            });
            return;
          }
          const eventBefore = await readRunEventsSnapshot(
            readbackClient,
            admittedRunId,
            signal,
            eventKind,
          );
          if (eventBefore.status !== "ok") {
            sink({
              ...baseReceipt,
              status: "error",
              sourceHash,
              beforeHash: before.status === "ok" ? before.contentHash : undefined,
              reason: "event-readback-before-failed",
              errorType: eventBefore.errorType,
            });
            return;
          }
          const runBefore = await readRunSnapshot(readbackClient, admittedRunId, signal);
          if (runBefore.status !== "ok") {
            sink({
              ...baseReceipt,
              status: "error",
              sourceHash,
              beforeHash: before.status === "ok" ? before.contentHash : undefined,
              eventBeforeHash: eventBefore.hash,
              reason: "run-readback-before-failed",
              errorType: runBefore.errorType,
            });
            return;
          }

          const body = RuntimeObjectCreate(null) as { content?: string };
          body.content = content;
          let canonicalResponse: unknown;
          try {
            canonicalResponse = await canonicalClient.put<unknown>(apiPath, body, {
              signal,
              params: canonicalParams,
            });
          } catch (error) {
            if (phase !== "stale-after-cancel") throw error;
            if (!isAuthorizationRejection(error)) {
              sink({
                ...baseReceipt,
                status: "error",
                sourceHash,
                beforeHash: before.status === "ok" ? before.contentHash : undefined,
                eventBeforeHash: eventBefore.hash,
                runBeforeHash: runBefore.hash,
                reason: "stale-write-failed-without-authorization-rejection",
                errorType: classifyError(error),
              });
              return;
            }
            const afterDenied = await readCanonicalSnapshot(
              readbackClient,
              apiPath,
              signal,
              canonicalParams,
            );
            if (afterDenied.status !== "ok") {
              sink({
                ...baseReceipt,
                status: "error",
                sourceHash,
                beforeHash: before.status === "ok" ? before.contentHash : undefined,
                eventBeforeHash: eventBefore.hash,
                runBeforeHash: runBefore.hash,
                reason: afterDenied.status === "absent"
                  ? "stale-write-denied-readback-absent"
                  : "stale-write-denied-readback-failed",
                errorType: afterDenied.status === "error"
                  ? afterDenied.errorType
                  : classifyError(error),
              });
              return;
            }
            if (
              currentContentHash === undefined || afterDenied.contentHash !== currentContentHash
            ) {
              sink({
                ...baseReceipt,
                status: "error",
                sourceHash,
                beforeHash: before.status === "ok" ? before.contentHash : undefined,
                afterHash: afterDenied.contentHash,
                versionHash: afterDenied.versionHash,
                eventBeforeHash: eventBefore.hash,
                runBeforeHash: runBefore.hash,
                reason: "stale-write-denied-readback-mismatch",
                errorType: classifyError(error),
              });
              return;
            }
            if (
              currentVersionHash === undefined || afterDenied.versionHash !== currentVersionHash
            ) {
              sink({
                ...baseReceipt,
                status: "error",
                sourceHash,
                beforeHash: before.status === "ok" ? before.contentHash : undefined,
                afterHash: afterDenied.contentHash,
                versionHash: afterDenied.versionHash,
                eventBeforeHash: eventBefore.hash,
                runBeforeHash: runBefore.hash,
                reason: "stale-write-denied-readback-version-mismatch",
                errorType: classifyError(error),
              });
              return;
            }
            canonicalResponse = undefined;
          }
          const after = await readCanonicalSnapshot(
            readbackClient,
            apiPath,
            signal,
            canonicalParams,
          );
          if (after.status !== "ok") {
            sink({
              ...baseReceipt,
              status: "error",
              sourceHash,
              beforeHash: before.status === "ok" ? before.contentHash : undefined,
              eventBeforeHash: eventBefore.hash,
              runBeforeHash: runBefore.hash,
              reason: after.status === "absent"
                ? "canonical-readback-after-absent"
                : "canonical-readback-after-failed",
              errorType: after.status === "error" ? after.errorType : undefined,
              responseHash: await safeHash(canonicalResponse),
            });
            return;
          }
          if (phase === "current" && after.contentHash !== sourceHash) {
            sink({
              ...baseReceipt,
              status: "error",
              sourceHash,
              beforeHash: before.status === "ok" ? before.contentHash : undefined,
              afterHash: after.contentHash,
              versionHash: after.versionHash,
              eventBeforeHash: eventBefore.hash,
              runBeforeHash: runBefore.hash,
              reason: "canonical-readback-content-mismatch",
              responseHash: await safeHash(canonicalResponse),
            });
            return;
          }
          if (phase === "stale-after-cancel") {
            if (after.contentHash === sourceHash) {
              sink({
                ...baseReceipt,
                status: "error",
                sourceHash,
                beforeHash: before.status === "ok" ? before.contentHash : undefined,
                afterHash: after.contentHash,
                versionHash: after.versionHash,
                eventBeforeHash: eventBefore.hash,
                runBeforeHash: runBefore.hash,
                reason: "stale-write-accepted-after-cancel",
                responseHash: await safeHash(canonicalResponse),
              });
              return;
            }
            if (
              currentContentHash === undefined || after.contentHash !== currentContentHash
            ) {
              sink({
                ...baseReceipt,
                status: "error",
                sourceHash,
                beforeHash: before.status === "ok" ? before.contentHash : undefined,
                afterHash: after.contentHash,
                versionHash: after.versionHash,
                eventBeforeHash: eventBefore.hash,
                runBeforeHash: runBefore.hash,
                reason: "stale-write-readback-mismatch",
                responseHash: await safeHash(canonicalResponse),
              });
              return;
            }
            if (currentVersionHash === undefined || after.versionHash !== currentVersionHash) {
              sink({
                ...baseReceipt,
                status: "error",
                sourceHash,
                beforeHash: before.status === "ok" ? before.contentHash : undefined,
                afterHash: after.contentHash,
                versionHash: after.versionHash,
                eventBeforeHash: eventBefore.hash,
                runBeforeHash: runBefore.hash,
                reason: "stale-write-readback-version-mismatch",
                responseHash: await safeHash(canonicalResponse),
              });
              return;
            }
          }

          if (eventAppendClient.post === undefined) {
            sink({
              ...baseReceipt,
              status: "error",
              sourceHash,
              beforeHash: before.status === "ok" ? before.contentHash : undefined,
              afterHash: after.contentHash,
              versionHash: after.versionHash,
              eventBeforeHash: eventBefore.hash,
              runBeforeHash: runBefore.hash,
              reason: "event-append-client-unavailable",
            });
            return;
          }
          let eventResponse: unknown;
          try {
            eventResponse = await eventAppendClient.post<unknown>(
              runEventsPath(admittedRunId),
              eventAppendBodyForPhase(activation, phase, admittedRunId),
              { signal },
            );
          } catch (error) {
            if (phase !== "stale-after-cancel" || !isAuthorizationOrConflictRejection(error)) {
              sink({
                ...baseReceipt,
                status: "error",
                sourceHash,
                beforeHash: before.status === "ok" ? before.contentHash : undefined,
                afterHash: after.contentHash,
                versionHash: after.versionHash,
                eventBeforeHash: eventBefore.hash,
                runBeforeHash: runBefore.hash,
                reason: phase === "stale-after-cancel"
                  ? "stale-event-append-failed-without-expected-rejection"
                  : "event-append-failed",
                errorType: classifyError(error),
              });
              return;
            }
          }
          const eventAfter = await readRunEventsSnapshot(
            readbackClient,
            admittedRunId,
            signal,
            eventKind,
          );
          if (eventAfter.status !== "ok") {
            sink({
              ...baseReceipt,
              status: "error",
              sourceHash,
              beforeHash: before.status === "ok" ? before.contentHash : undefined,
              afterHash: after.contentHash,
              versionHash: after.versionHash,
              eventBeforeHash: eventBefore.hash,
              runBeforeHash: runBefore.hash,
              reason: "event-readback-after-failed",
              errorType: eventAfter.errorType,
            });
            return;
          }
          if (phase === "current" && !eventAfter.containsProbeEvent) {
            sink({
              ...baseReceipt,
              status: "error",
              sourceHash,
              beforeHash: before.status === "ok" ? before.contentHash : undefined,
              afterHash: after.contentHash,
              versionHash: after.versionHash,
              eventBeforeHash: eventBefore.hash,
              eventAfterHash: eventAfter.hash,
              runBeforeHash: runBefore.hash,
              eventResponseHash: await safeHash(eventResponse),
              reason: "event-readback-missing-current-append",
            });
            return;
          }
          if (phase === "stale-after-cancel") {
            if (eventAfter.containsProbeEvent || eventAfter.hash !== eventBefore.hash) {
              sink({
                ...baseReceipt,
                status: "error",
                sourceHash,
                beforeHash: before.status === "ok" ? before.contentHash : undefined,
                afterHash: after.contentHash,
                versionHash: after.versionHash,
                eventBeforeHash: eventBefore.hash,
                eventAfterHash: eventAfter.hash,
                runBeforeHash: runBefore.hash,
                eventResponseHash: await safeHash(eventResponse),
                reason: "stale-event-append-mutated-events",
              });
              return;
            }
          }

          if (heartbeatClient.post === undefined) {
            sink({
              ...baseReceipt,
              status: "error",
              sourceHash,
              beforeHash: before.status === "ok" ? before.contentHash : undefined,
              afterHash: after.contentHash,
              versionHash: after.versionHash,
              eventBeforeHash: eventBefore.hash,
              eventAfterHash: eventAfter.hash,
              eventResponseHash: await safeHash(eventResponse),
              runBeforeHash: runBefore.hash,
              reason: "heartbeat-client-unavailable",
            });
            return;
          }
          let heartbeatResponse: unknown;
          try {
            heartbeatResponse = await heartbeatClient.post<unknown>(
              runHeartbeatsPath(admittedRunId),
              heartbeatBody(),
              { signal },
            );
          } catch (error) {
            if (phase !== "stale-after-cancel" || !isAuthorizationOrConflictRejection(error)) {
              sink({
                ...baseReceipt,
                status: "error",
                sourceHash,
                beforeHash: before.status === "ok" ? before.contentHash : undefined,
                afterHash: after.contentHash,
                versionHash: after.versionHash,
                eventBeforeHash: eventBefore.hash,
                eventAfterHash: eventAfter.hash,
                eventResponseHash: await safeHash(eventResponse),
                runBeforeHash: runBefore.hash,
                reason: phase === "stale-after-cancel"
                  ? "stale-heartbeat-failed-without-expected-rejection"
                  : "heartbeat-failed",
                errorType: classifyError(error),
              });
              return;
            }
          }
          const runAfter = await readRunSnapshot(readbackClient, admittedRunId, signal);
          if (runAfter.status !== "ok") {
            sink({
              ...baseReceipt,
              status: "error",
              sourceHash,
              beforeHash: before.status === "ok" ? before.contentHash : undefined,
              afterHash: after.contentHash,
              versionHash: after.versionHash,
              eventBeforeHash: eventBefore.hash,
              eventAfterHash: eventAfter.hash,
              eventResponseHash: await safeHash(eventResponse),
              runBeforeHash: runBefore.hash,
              heartbeatResponseHash: await safeHash(heartbeatResponse),
              reason: "run-readback-after-failed",
              errorType: runAfter.errorType,
            });
            return;
          }
          if (phase === "stale-after-cancel" && runAfter.hash !== runBefore.hash) {
            sink({
              ...baseReceipt,
              status: "error",
              sourceHash,
              beforeHash: before.status === "ok" ? before.contentHash : undefined,
              afterHash: after.contentHash,
              versionHash: after.versionHash,
              eventBeforeHash: eventBefore.hash,
              eventAfterHash: eventAfter.hash,
              eventResponseHash: await safeHash(eventResponse),
              runBeforeHash: runBefore.hash,
              runAfterHash: runAfter.hash,
              heartbeatResponseHash: await safeHash(heartbeatResponse),
              reason: "stale-heartbeat-mutated-run",
            });
            return;
          }

          if (phase === "current") {
            currentContentHash = after.contentHash;
            currentVersionHash = after.versionHash;
          }
          sink({
            ...baseReceipt,
            status: "ok",
            sourceHash,
            beforeHash: before.status === "ok" ? before.contentHash : undefined,
            afterHash: after.contentHash,
            versionHash: after.versionHash ?? currentVersionHash,
            responseHash: await safeHash(canonicalResponse),
            eventBeforeHash: eventBefore.hash,
            eventAfterHash: eventAfter.hash,
            eventResponseHash: await safeHash(eventResponse),
            heartbeatResponseHash: await safeHash(heartbeatResponse),
            runBeforeHash: runBefore.hash,
            runAfterHash: runAfter.hash,
            reason: phase === "stale-after-cancel" ? "stale-current-surfaces-preserved" : undefined,
          });
        } catch (error) {
          sink({ ...baseReceipt, status: "error", errorType: classifyError(error) });
        } finally {
          RuntimeReflectApply(RuntimeSetPrototypeDelete, activeProbeFlights, [flightKey]);
        }
      };

      return {
        beforeExecute: () => runPhase("current"),
        afterStopAcknowledged: () => runPhase("stale-after-cancel"),
      };
    },
  };
}

export function createProjectRunRuntimeOwnershipProbeFromHostEnv(
  nowMs: number,
  readEnv: RuntimeOwnershipProbeEnvReader = getHostEnvExcludingEnvFile,
  sink: RuntimeOwnershipProbeReceiptSink = defaultReceiptSink,
): RuntimeOwnershipProbe | undefined {
  const activation = readActivationFromEnv(readEnv, nowMs);
  return activation ? createProjectRunRuntimeOwnershipProbe(activation, sink) : undefined;
}

export function __resetProjectRunRuntimeOwnershipProbeFlightsForTests(): void {
  activeProbeFlights.clear();
}
