import type { Embedding } from "#veryfront/embedding/index.ts";
import { createEmbeddingFacade } from "#veryfront/embedding/embedding.ts";
import { createVeryfrontCloudInferenceEmbeddingModel } from "#veryfront/embedding/veryfront-cloud/provider.ts";
import { getHostEnvExcludingEnvFile } from "#veryfront/platform/compat/process.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

const PROBE_ENABLED = "VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_STAGE";
const PROBE_ID = "VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_ID";
const PROBE_PROJECT_ID = "VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_PROJECT_ID";
const PROBE_WORKER_ID = "VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_WORKER_ID";
const PROBE_CHILD_TOOL_CALL_ID =
  "VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_CHILD_TOOL_CALL_ID";
const PROBE_EXPIRES_AT = "VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_EXPIRES_AT";
const PROBE_OPERATION_TIMEOUT_MS =
  "VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_OPERATION_TIMEOUT_MS";
const DEFAULT_OPERATION_TIMEOUT_MS = 5_000;
const MAX_OPERATION_TIMEOUT_MS = 30_000;
const MAX_ACTIVATION_WINDOW_MS = 6 * 60 * 60 * 1_000;
const PROBE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RuntimeAbortSignalTimeout = AbortSignal.timeout;
const RuntimeError = Error;
const RuntimeArrayIsArray = Array.isArray;
const RuntimeArrayPrototypeSome = Array.prototype.some;
const RuntimeArrayPrototypeSort = Array.prototype.sort;
const RuntimeAtob = atob;
const RuntimeJSONParse = JSON.parse;
const RuntimeJSONstringify = JSON.stringify;
const RuntimeObjectKeys = Object.keys;
const RuntimeMathFround = Math.fround;
const RuntimeStringPrototypeReplace = String.prototype.replace;
const RuntimeStringPrototypeReplaceAll = String.prototype.replaceAll;
const RuntimeStringPrototypeIncludes = String.prototype.includes;
const RuntimeStringPrototypeSplit = String.prototype.split;
const RuntimeReflectApply = Reflect.apply;
const RuntimeMapPrototypeClear = Map.prototype.clear;
const RuntimeMapPrototypeDelete = Map.prototype.delete;
const RuntimeMapPrototypeGet = Map.prototype.get;
const RuntimeMapPrototypeSet = Map.prototype.set;
const RuntimeEncodeURIComponent = encodeURIComponent;
const RuntimeURL = URL;
const RuntimeURLPrototypeOriginGet = Object.getOwnPropertyDescriptor(URL.prototype, "origin")!.get!;
const RuntimeURLPrototypeHrefGet = Object.getOwnPropertyDescriptor(URL.prototype, "href")!.get!;
const CANONICAL_KNOWLEDGE_BRANCH = "main";
const CANONICAL_KNOWLEDGE_MODEL = {
  name: "text-embedding-3-small",
  provider: "openai",
  dimension: 1536,
} as const;

export interface AgentWorkerRuntimeOwnershipProbeCredentials {
  authToken: string;
  runEventToken: string;
  runTerminalToken: string;
}

export interface AgentWorkerRuntimeOwnershipProbeRun {
  runId: string;
  canonicalRunId: string;
  projectId: string | null;
  agentId: string;
  latestExternalEventSequence: number;
  leaseExpiresAtMs?: number | null;
}

export type AgentWorkerRuntimeOwnershipProbePhase =
  | "canonical-source-index"
  | "replaced-generation-denial"
  | "expired-lease-denial"
  | "cancelled-child-denial";

export type AgentWorkerRuntimeOwnershipProbeReceiptStatus = "ok" | "skipped" | "error";

export interface AgentWorkerRuntimeOwnershipProbeReceipt {
  probe: "agent-worker-runtime-ownership";
  probeId: string;
  phase: AgentWorkerRuntimeOwnershipProbePhase;
  status: AgentWorkerRuntimeOwnershipProbeReceiptStatus;
  workerId: string;
  runId: string;
  canonicalRunId: string;
  projectId?: string;
  beforeHash?: string;
  afterHash?: string;
  sourcePath?: string;
  sourceHash?: string;
  sourceVersionHash?: string;
  indexRequestHash?: string;
  indexResponseHash?: string;
  eventBeforeHash?: string;
  eventAfterHash?: string;
  eventResponseHash?: string;
  childCreateResponseHash?: string;
  deniedStatus?: number;
  reason?: string;
  errorType?: string;
}

export interface AgentWorkerRuntimeOwnershipProbeActivation {
  probeId: string;
  projectId: string;
  workerId?: string;
  childToolCallId?: string;
  expiresAtMs: number;
  operationTimeoutMs: number;
}

export type AgentWorkerRuntimeOwnershipProbeReceiptSink = (
  receipt: AgentWorkerRuntimeOwnershipProbeReceipt,
) => void;
export type AgentWorkerRuntimeOwnershipProbeEnvReader = (key: string) => string | undefined;

export interface AgentWorkerRuntimeOwnershipProbeClaimInput {
  apiUrl: string;
  fetch: typeof fetch;
  workerId: string;
  run: AgentWorkerRuntimeOwnershipProbeRun;
  credentials: AgentWorkerRuntimeOwnershipProbeCredentials;
  embedder?: Embedding;
}

export interface AgentWorkerRuntimeOwnershipProbeRenewInput
  extends AgentWorkerRuntimeOwnershipProbeClaimInput {
  previousCredentials?: AgentWorkerRuntimeOwnershipProbeCredentials;
}

export interface AgentWorkerRuntimeOwnershipProbeLeaseLostInput
  extends AgentWorkerRuntimeOwnershipProbeClaimInput {
  currentCredentials?: AgentWorkerRuntimeOwnershipProbeCredentials;
}

export interface AgentWorkerRuntimeOwnershipProbeCancelledInput
  extends AgentWorkerRuntimeOwnershipProbeClaimInput {}

export interface AgentWorkerRuntimeOwnershipProbeResult {
  latestExternalEventSequence?: number;
}

interface RetainedCanonicalSourceIndexProof {
  sourcePath: string;
  sourceHash: string;
  sourceVersionHash: string;
  sourceFileId: string;
  sourceVersionId: string;
  indexRequestHash: string;
  indexResponseHash: string;
  content: string;
  sourceWire: string;
  indexWire: string;
  readAuthToken: string;
  indexStateHash: string;
  beforeHash: string;
}

export interface AgentWorkerRuntimeOwnershipProbe {
  afterClaim(
    input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  ): Promise<AgentWorkerRuntimeOwnershipProbeResult | void>;
  afterRenew(
    input: AgentWorkerRuntimeOwnershipProbeRenewInput,
  ): Promise<AgentWorkerRuntimeOwnershipProbeResult | void>;
  afterLeaseLost(input: AgentWorkerRuntimeOwnershipProbeLeaseLostInput): Promise<void>;
  afterCancelled(input: AgentWorkerRuntimeOwnershipProbeCancelledInput): Promise<void>;
  afterTerminal?(input: AgentWorkerRuntimeOwnershipProbeClaimInput): Promise<void>;
}

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
  readEnv: AgentWorkerRuntimeOwnershipProbeEnvReader,
  nowMs: number,
): AgentWorkerRuntimeOwnershipProbeActivation | undefined {
  if (readEnv(PROBE_ENABLED) !== "1") return undefined;

  const probeId = readEnv(PROBE_ID) ?? "agent-worker-stage-probe";
  const projectId = readEnv(PROBE_PROJECT_ID);
  const workerId = readEnv(PROBE_WORKER_ID);
  const childToolCallId = readEnv(PROBE_CHILD_TOOL_CALL_ID);
  const expiresAtMs = parseExpiry(readEnv(PROBE_EXPIRES_AT));
  const timeoutMs = parsePositiveInteger(readEnv(PROBE_OPERATION_TIMEOUT_MS)) ??
    DEFAULT_OPERATION_TIMEOUT_MS;

  if (!PROBE_ID_RE.test(probeId)) return undefined;
  if (projectId === undefined || projectId.trim() === "") return undefined;
  if (workerId !== undefined && workerId.trim() === "") return undefined;
  if (childToolCallId !== undefined && childToolCallId.trim() === "") return undefined;
  if (expiresAtMs === undefined || expiresAtMs <= nowMs) return undefined;
  if (expiresAtMs - nowMs > MAX_ACTIVATION_WINDOW_MS) return undefined;

  return {
    probeId,
    projectId,
    workerId,
    childToolCallId,
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
  if (error instanceof DOMException) return "DOMException";
  if (error instanceof Error) return "Error";
  return typeof error;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function readJwtPayload(token: string): Record<string, unknown> | undefined {
  const part = (RuntimeReflectApply(RuntimeStringPrototypeSplit, token, ["."]) as string[])[1];
  if (!part) return undefined;
  try {
    const base64 = RuntimeReflectApply(RuntimeStringPrototypeReplaceAll, part, [
      "-",
      "+",
    ]) as string;
    const normalized = RuntimeReflectApply(RuntimeStringPrototypeReplaceAll, base64, [
      "_",
      "/",
    ]) as string;
    const payload = RuntimeJSONParse(RuntimeAtob(normalized)) as unknown;
    return payload !== null && typeof payload === "object" && !RuntimeArrayIsArray(payload)
      ? payload as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function responseText(body: unknown): string {
  return stableJson(body).toLowerCase();
}

function readProblemSlug(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const slug = record.slug;
  if (typeof slug === "string") return slug.toLowerCase();
  const type = record.type;
  if (typeof type === "string") return type.toLowerCase().split("/").at(-1);
  return undefined;
}

function readProblemCode(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const code = (body as Record<string, unknown>).code;
  return typeof code === "string" ? code.toLowerCase() : undefined;
}

function isCurrentWorkerAuthorityProblem(body: unknown): boolean {
  const slug = readProblemSlug(body);
  const code = readProblemCode(body);
  const text = responseText(body);
  if (slug === "invalid-token" || slug === "authorization-denied") return true;
  if (code === "invalid_token" || code === "authorization_denied" || code === "run_forbidden") {
    return true;
  }
  return (
    text.includes("execution generation is no longer current") ||
    text.includes("generation is no longer current") ||
    text.includes("stale generation") ||
    text.includes("expired generation") ||
    text.includes("superseded generation") ||
    text.includes("lease is no longer current") ||
    text.includes("no longer holds a detached lease") ||
    text.includes("credential cannot") ||
    text.includes("credential is not authorized") ||
    text.includes("current generation required") ||
    text.includes("permission") ||
    text.includes("authority")
  );
}

function isReplayAuthorityDenied(response: { status: number; body: unknown }): boolean {
  if (response.status === 401 || response.status === 403) {
    return isCurrentWorkerAuthorityProblem(response.body) || responseText(response.body).length > 0;
  }
  if (response.status !== 409) return false;
  return isCurrentWorkerAuthorityProblem(response.body);
}

function workerGenerationHeaders(
  credentials: AgentWorkerRuntimeOwnershipProbeCredentials,
): Record<string, string> {
  const runEventPayload = readJwtPayload(credentials.runEventToken);
  const terminalPayload = readJwtPayload(credentials.runTerminalToken);
  const generation = typeof runEventPayload?.dispatchNonce === "string"
    ? runEventPayload.dispatchNonce
    : typeof terminalPayload?.dispatchNonce === "string"
    ? terminalPayload.dispatchNonce
    : undefined;
  if (!generation) {
    throw new Error("worker generation authority is unavailable");
  }
  return { "X-Veryfront-Worker-Generation": generation };
}

function buildProbeRequestUrl(apiUrl: string, path: string): string {
  const base = RuntimeReflectApply(RuntimeStringPrototypeReplace, apiUrl, [/\/$/, ""]) as string;
  const baseUrl = new RuntimeURL(base);
  const url = new RuntimeURL(`${base}${path}`);
  const baseOrigin = RuntimeReflectApply(RuntimeURLPrototypeOriginGet, baseUrl, []) as string;
  const urlOrigin = RuntimeReflectApply(RuntimeURLPrototypeOriginGet, url, []) as string;
  if (urlOrigin !== baseOrigin) {
    throw new Error("Agent worker runtime ownership probe URL origin changed");
  }
  return RuntimeReflectApply(RuntimeURLPrototypeHrefGet, url, []) as string;
}

async function requestJsonWire(
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  method: "GET" | "POST" | "PUT",
  path: string,
  token: string,
  bodyWire?: string,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; ok: boolean; body: unknown }> {
  if (pastProbeDeadline(input)) {
    throw new DOMException("Probe operation deadline exceeded", "TimeoutError");
  }
  const signal = RuntimeAbortSignalTimeout(inputTimeout(input));
  const response = await input.fetch(buildProbeRequestUrl(input.apiUrl, path), {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: bodyWire,
  });
  return { status: response.status, ok: response.ok, body: await readResponseBody(response) };
}

async function requestJson(
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  method: "GET" | "POST" | "PUT",
  path: string,
  token: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; ok: boolean; body: unknown }> {
  return await requestJsonWire(
    input,
    method,
    path,
    token,
    body === undefined ? undefined : privateJsonStringify(body),
    extraHeaders,
  );
}

type InstrumentedProbeInput = AgentWorkerRuntimeOwnershipProbeClaimInput & {
  activation?: AgentWorkerRuntimeOwnershipProbeActivation;
  deadlineMs?: number;
};

function inputTimeout(input: AgentWorkerRuntimeOwnershipProbeClaimInput): number {
  const instrumented = input as InstrumentedProbeInput;
  const maxTimeout = instrumented.activation?.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  if (instrumented.deadlineMs === undefined) return maxTimeout;
  return Math.max(1, Math.min(maxTimeout, instrumented.deadlineMs - Date.now()));
}

function pastProbeDeadline(input: AgentWorkerRuntimeOwnershipProbeClaimInput): boolean {
  const deadlineMs = (input as InstrumentedProbeInput).deadlineMs;
  return deadlineMs !== undefined && Date.now() >= deadlineMs;
}

function hasProbeEvent(body: unknown, identity: string): boolean {
  const candidates = body !== null && typeof body === "object" && "data" in body
    ? (body as { data?: unknown }).data
    : body;
  if (!RuntimeArrayIsArray(candidates)) return false;
  return RuntimeReflectApply(RuntimeArrayPrototypeSome, candidates, [
    (item: unknown) => stableJson(item).includes(identity),
  ]) as boolean;
}

interface EventSnapshot {
  ok: boolean;
  status?: number;
  body: unknown;
  hash: string;
  containsIdentity: boolean;
  reason?: string;
}

function findStringField(value: unknown, keys: readonly string[], depth = 0): string | undefined {
  if (depth > 8 || value === null || typeof value !== "object") return undefined;
  if (RuntimeArrayIsArray(value)) {
    for (const item of value) {
      const found = findStringField(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  for (const key of RuntimeObjectKeys(record)) {
    const found = findStringField(record[key], keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findToolCallId(value: unknown): string | undefined {
  return findStringField(value, [
    "tool_call_id",
    "toolCallId",
    "public_tool_call_id",
    "publicToolCallId",
  ]);
}

function readNextCursor(body: unknown): string | undefined {
  if (body === null || typeof body !== "object" || !("page_info" in body)) return undefined;
  const pageInfo = (body as { page_info?: unknown }).page_info;
  if (pageInfo === null || typeof pageInfo !== "object" || !("next" in pageInfo)) return undefined;
  const next = (pageInfo as { next?: unknown }).next;
  return typeof next === "string" && next.length > 0 ? next : undefined;
}

function isEventPage(body: unknown): boolean {
  return body !== null && typeof body === "object" && "data" in body &&
    RuntimeArrayIsArray((body as { data?: unknown }).data);
}

function errorMessageIncludes(error: unknown, expected: string): boolean {
  if (error === null || typeof error !== "object") return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" &&
    (RuntimeReflectApply(RuntimeStringPrototypeIncludes, message, [expected]) as boolean);
}

function fatalCursorError(message: string, cause?: unknown): Error {
  return cause === undefined ? new RuntimeError(message) : new RuntimeError(message, { cause });
}

function readLatestExternalEventSequence(body: unknown): number | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const direct =
    (body as { latest_external_event_sequence?: unknown }).latest_external_event_sequence;
  if (typeof direct === "number" && Number.isSafeInteger(direct) && direct >= 0) return direct;
  const run = (body as { run?: unknown }).run;
  if (run !== null && typeof run === "object") {
    const nested =
      (run as { latest_external_event_sequence?: unknown }).latest_external_event_sequence;
    if (typeof nested === "number" && Number.isSafeInteger(nested) && nested >= 0) return nested;
  }
  return undefined;
}

async function readEventSnapshot(
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  token: string,
  identity?: string,
): Promise<EventSnapshot> {
  const bodies: unknown[] = [];
  let containsIdentity = false;
  let cursor: string | undefined;
  let status: number | undefined;
  for (let page = 0; page < 20; page += 1) {
    if (pastProbeDeadline(input)) {
      return {
        ok: false,
        status,
        body: { pages: bodies },
        hash: await safeHash({ pages: bodies }),
        containsIdentity,
        reason: "operation-deadline-exceeded",
      };
    }
    const query = cursor === undefined
      ? "?limit=100"
      : `?limit=100&cursor=${RuntimeEncodeURIComponent(cursor)}`;
    const response = await requestJson(
      input,
      "GET",
      `${eventPath(input.run.canonicalRunId)}${query}`,
      token,
    );
    status = response.status;
    bodies.push(response.body);
    if (!response.ok) {
      return {
        ok: false,
        status,
        body: { pages: bodies },
        hash: await safeHash({ pages: bodies }),
        containsIdentity,
        reason: "event-read-failed",
      };
    }
    if (!isEventPage(response.body)) {
      return {
        ok: false,
        status,
        body: { pages: bodies },
        hash: await safeHash({ pages: bodies }),
        containsIdentity,
        reason: "invalid-event-page",
      };
    }
    if (identity !== undefined && hasProbeEvent(response.body, identity)) containsIdentity = true;
    cursor = readNextCursor(response.body);
    if (cursor === undefined) {
      return {
        ok: true,
        status,
        body: { pages: bodies },
        hash: await safeHash({ pages: bodies }),
        containsIdentity,
      };
    }
  }
  return {
    ok: false,
    status,
    body: { pages: bodies },
    hash: await safeHash({ pages: bodies }),
    containsIdentity,
    reason: "event-pagination-limit",
  };
}

async function retryEventAppendForCursor(
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  token: string,
  bodyWire: string,
  idempotencyKey: string,
): Promise<number | undefined> {
  try {
    const retried = await requestJsonWire(
      input,
      "POST",
      eventPath(input.run.canonicalRunId),
      token,
      bodyWire,
      { "Idempotency-Key": idempotencyKey },
    );
    return retried.ok ? readLatestExternalEventSequence(retried.body) : undefined;
  } catch (error) {
    throw fatalCursorError(
      "Agent worker runtime ownership probe append outcome is ambiguous",
      error,
    );
  }
}

async function probeEventIdempotencyKey(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  identity: string,
  phase: string,
): Promise<string> {
  const hash = await computeHash(
    `${activation.probeId}:${input.workerId}:${input.run.canonicalRunId}:${identity}:${phase}`,
  );
  return `agent-worker-event:${hash}`;
}

function eventPath(canonicalRunId: string): string {
  return `/runs/${RuntimeEncodeURIComponent(canonicalRunId)}/events`;
}

function sourcePath(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  identity: string,
): string {
  return `knowledge/agent-worker-runtime-ownership-probe-20261011/${activation.probeId}/${input.run.canonicalRunId}/${identity}/ownership.md`;
}

function sourceApiPath(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  path: string,
): string {
  return `/projects/${RuntimeEncodeURIComponent(activation.projectId)}/files/${
    RuntimeEncodeURIComponent(path)
  }`;
}

function sourceIndexApiPath(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  path: string,
): string {
  return `/projects/${RuntimeEncodeURIComponent(activation.projectId)}/branches/${
    RuntimeEncodeURIComponent(CANONICAL_KNOWLEDGE_BRANCH)
  }/files/${RuntimeEncodeURIComponent(path)}/index`;
}

function readSourceContent(body: unknown): string | undefined {
  if (body !== null && typeof body === "object") {
    const content = (body as { content?: unknown }).content;
    if (typeof content === "string") return content;
  }
  return undefined;
}

function readSourceVersionId(body: unknown): string | undefined {
  return readStringFieldFromRecord(body, ["version_id", "versionId"]);
}

function readSourceFileId(body: unknown): string | undefined {
  return readStringFieldFromRecord(body, ["id", "file_id", "fileId"]);
}

function readStringFieldFromRecord(body: unknown, fields: readonly string[]): string | undefined {
  if (body !== null && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const field of fields) {
      const value = record[field];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return undefined;
}

function readNumberFieldFromRecord(body: unknown, field: string): number | undefined {
  if (body !== null && typeof body === "object") {
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  }
  return undefined;
}

function readSourceVersionMaterial(body: unknown): unknown {
  if (body === null || typeof body !== "object") return body;
  return {
    id: (body as { id?: unknown }).id,
    version_id: (body as { version_id?: unknown }).version_id,
    versionId: (body as { versionId?: unknown }).versionId,
    checksum: (body as { checksum?: unknown }).checksum,
    path: (body as { path?: unknown }).path,
  };
}

function sourceContent(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  identity: string,
  path: string,
): string {
  return [
    "# Agent worker runtime ownership probe",
    "",
    `probe: ${activation.probeId}`,
    `identity: ${identity}`,
    `worker: ${input.workerId}`,
    `run: ${input.run.runId}`,
    `canonicalRun: ${input.run.canonicalRunId}`,
    `project: ${activation.projectId}`,
    `path: ${path}`,
    "",
    "This staging-only document proves the current external worker claim can publish canonical source and commit the matching knowledge index.",
  ].join("\n");
}

function defaultCanonicalEmbedder(input: AgentWorkerRuntimeOwnershipProbeClaimInput): Embedding {
  const modelId = `${CANONICAL_KNOWLEDGE_MODEL.provider}/${CANONICAL_KNOWLEDGE_MODEL.name}`;
  return createEmbeddingFacade(
    {},
    `veryfront-cloud/${modelId}`,
    createVeryfrontCloudInferenceEmbeddingModel(modelId, input.credentials.authToken, {
      apiBaseUrl: input.apiUrl,
      assertInferenceCredentialActive: () => {
        if (pastProbeDeadline(input)) {
          throw new DOMException("Probe operation deadline exceeded", "TimeoutError");
        }
      },
    }),
  );
}

function normalizedEmbeddingModel(model: string): string {
  return model.startsWith("veryfront-cloud/") ? model.slice("veryfront-cloud/".length) : model;
}

function validateCanonicalEmbedder(embedder: Embedding): void {
  const normalized = normalizedEmbeddingModel(embedder.model);
  const expected = `${CANONICAL_KNOWLEDGE_MODEL.provider}/${CANONICAL_KNOWLEDGE_MODEL.name}`;
  if (normalized !== expected) {
    throw new Error("canonical embedding provider or model is unavailable");
  }
}

async function canonicalIndexBody(
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  versionId: string,
  content: string,
) {
  const embedder = input.embedder ?? defaultCanonicalEmbedder(input);
  validateCanonicalEmbedder(embedder);
  if (pastProbeDeadline(input)) {
    throw new DOMException("Probe operation deadline exceeded", "TimeoutError");
  }
  const vectors = await embedder.embedMany([content], {
    signal: RuntimeAbortSignalTimeout(inputTimeout(input)),
  });
  if (pastProbeDeadline(input)) {
    throw new DOMException("Probe operation deadline exceeded", "TimeoutError");
  }
  const vector = vectors[0];
  if (
    vectors.length !== 1 || !RuntimeArrayIsArray(vector) ||
    vector.length !== CANONICAL_KNOWLEDGE_MODEL.dimension ||
    RuntimeArrayPrototypeSome.call(
      vector,
      (value) =>
        typeof value !== "number" || !Number.isFinite(value) ||
        !Number.isFinite(RuntimeMathFround(value)),
    )
  ) {
    throw new Error("canonical embedding provider returned an invalid 1536-dimensional vector");
  }
  return {
    expected_version_id: versionId,
    chunks: [{
      chunk_index: 0,
      content,
      start_offset: 0,
      end_offset: content.length,
      token_count: Math.max(1, Math.ceil(content.length / 4)),
      metadata: {
        probe: "agent-worker-runtime-ownership",
        indexed_by: "external-agent-worker",
      },
      vector,
    }],
    model: CANONICAL_KNOWLEDGE_MODEL,
  };
}

function validateCanonicalIndexResponse(
  body: unknown,
  input: {
    fileId: string;
    versionId: string;
    sourcePath: string;
    sourceChecksum?: string;
    indexedChunkCount: number;
  },
): string | undefined {
  const fileId = readStringFieldFromRecord(body, ["file_id", "fileId"]);
  if (fileId !== input.fileId) return "canonical-index-file-mismatch";
  const versionId = readStringFieldFromRecord(body, ["version_id", "versionId"]);
  if (versionId !== input.versionId) return "canonical-index-version-mismatch";
  const path = readStringFieldFromRecord(body, ["path"]);
  if (path !== input.sourcePath) return "canonical-index-path-mismatch";
  const indexedChunkCount = readNumberFieldFromRecord(body, "indexed_chunk_count");
  if (indexedChunkCount !== input.indexedChunkCount) return "canonical-index-chunk-count-mismatch";
  const checksum = readStringFieldFromRecord(body, ["checksum"]);
  if (
    input.sourceChecksum !== undefined && checksum !== undefined &&
    checksum !== input.sourceChecksum
  ) {
    return "canonical-index-checksum-mismatch";
  }
  if (body === null || typeof body !== "object") return "canonical-index-response-invalid";
  const model = (body as { model?: unknown }).model;
  if (model === null || typeof model !== "object") return "canonical-index-model-missing";
  const modelName = (model as { name?: unknown }).name;
  const modelProvider = (model as { provider?: unknown }).provider;
  const modelDimension = (model as { dimension?: unknown }).dimension;
  if (
    modelName !== CANONICAL_KNOWLEDGE_MODEL.name ||
    modelProvider !== CANONICAL_KNOWLEDGE_MODEL.provider ||
    modelDimension !== CANONICAL_KNOWLEDGE_MODEL.dimension
  ) {
    return "canonical-index-model-mismatch";
  }
  return undefined;
}

function validateCanonicalIndexStateResponse(
  body: unknown,
  input: { sourcePath: string; fileId: string; versionId: string },
): string | undefined {
  if (body === null || typeof body !== "object") {
    return "canonical-index-state-response-invalid";
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return "canonical-index-state-response-invalid";
  const matching = data.find((item) => {
    if (item === null || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return record.path === input.sourcePath;
  });
  if (matching === undefined || matching === null || typeof matching !== "object") {
    return "canonical-index-state-missing";
  }
  const record = matching as Record<string, unknown>;
  if (record.file_id !== input.fileId) {
    return "canonical-index-state-file-mismatch";
  }
  if (record.file_version_id !== input.versionId) {
    return "canonical-index-state-version-mismatch";
  }
  if (record.index_ready !== true) {
    return "canonical-index-state-not-ready";
  }
  return undefined;
}

function isCancellationOrStopRejection(body: unknown): boolean {
  const text = stableJson(body).toLowerCase();
  return text.includes("cancel") || text.includes("stopped") || text.includes("stop");
}

async function readCanonicalIndexStateHash(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  sourcePathValue: string,
  fileId: string,
  versionId: string,
  token: string,
): Promise<string> {
  const response = await requestJson(
    input,
    "POST",
    `/projects/${RuntimeEncodeURIComponent(activation.projectId)}/knowledge/index-status`,
    token,
    {
      paths: [sourcePathValue],
      lookup_target: { kind: "preview_branch", branch_id: null },
    },
  );
  if (!response.ok) {
    throw new Error(`canonical index state readback failed with HTTP ${response.status}`);
  }
  const invalidIndexStateReason = validateCanonicalIndexStateResponse(response.body, {
    sourcePath: sourcePathValue,
    fileId,
    versionId,
  });
  if (invalidIndexStateReason !== undefined) {
    throw new Error(invalidIndexStateReason);
  }
  return await safeHash(response.body);
}

async function publishCanonicalSourceAndIndex(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  identity: string,
): Promise<{
  sourcePath: string;
  sourceHash: string;
  sourceVersionHash: string;
  indexRequestHash: string;
  indexResponseHash: string;
  replayProof: RetainedCanonicalSourceIndexProof;
}> {
  const path = sourcePath(activation, input, identity);
  const content = sourceContent(activation, input, identity, path);
  const sourceHash = await computeHash(content);
  const sourceWire = privateJsonStringify({ content });
  const source = sourceApiPath(activation, path);
  const published = await requestJsonWire(
    input,
    "PUT",
    source,
    input.credentials.authToken,
    sourceWire,
  );
  if (!published.ok) {
    throw new Error(`canonical source write failed with HTTP ${published.status}`);
  }
  const readback = await requestJson(input, "GET", source, input.credentials.authToken);
  if (!readback.ok) {
    throw new Error(`canonical source readback failed with HTTP ${readback.status}`);
  }
  if (readSourceContent(readback.body) !== content) {
    throw new Error("canonical source readback did not match the published body");
  }
  const versionId = readSourceVersionId(readback.body);
  if (versionId === undefined) {
    throw new Error("canonical source readback did not include an immutable version id");
  }
  const fileId = readSourceFileId(readback.body);
  if (fileId === undefined) {
    throw new Error("canonical source readback did not include an immutable file id");
  }
  const indexBody = await canonicalIndexBody(input, versionId, content);
  const indexWire = privateJsonStringify(indexBody);
  const indexRequestHash = await computeHash(indexWire);
  const indexed = await requestJsonWire(
    input,
    "POST",
    sourceIndexApiPath(activation, path),
    input.credentials.runEventToken,
    indexWire,
  );
  if (!indexed.ok) {
    throw new Error(`canonical index commit failed with HTTP ${indexed.status}`);
  }
  const sourceChecksum = readStringFieldFromRecord(readback.body, ["checksum"]);
  const invalidIndexReason = validateCanonicalIndexResponse(indexed.body, {
    fileId,
    versionId,
    sourcePath: path,
    sourceChecksum,
    indexedChunkCount: 1,
  });
  if (invalidIndexReason !== undefined) {
    throw new Error(invalidIndexReason);
  }
  const sourceVersionHash = await safeHash(readSourceVersionMaterial(readback.body));
  const indexResponseHash = await safeHash(indexed.body);
  const indexStateHash = await readCanonicalIndexStateHash(
    activation,
    input,
    path,
    fileId,
    versionId,
    input.credentials.authToken,
  );
  const beforeHash = await safeHash({
    sourceVersionHash,
    indexRequestHash,
    indexResponseHash,
    indexStateHash,
  });
  return {
    sourcePath: path,
    sourceHash,
    sourceVersionHash,
    indexRequestHash,
    indexResponseHash,
    replayProof: {
      sourcePath: path,
      sourceHash,
      sourceVersionHash,
      sourceFileId: fileId,
      sourceVersionId: versionId,
      indexRequestHash,
      indexResponseHash,
      content,
      sourceWire,
      indexWire,
      readAuthToken: input.credentials.authToken,
      indexStateHash,
      beforeHash,
    },
  };
}

async function proveCanonicalSourceIndexReplayDenied(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  identity: string,
  replayCredentials: AgentWorkerRuntimeOwnershipProbeCredentials,
): Promise<{
  sourcePath: string;
  sourceHash: string;
  sourceVersionHash: string;
  indexRequestHash: string;
  indexResponseHash: string;
  beforeHash: string;
  afterHash: string;
  deniedStatus: number;
  deniedByStatus: boolean;
}> {
  const path = sourcePath(activation, input, identity);
  const content = sourceContent(activation, input, identity, path);
  const sourceHash = await computeHash(content);
  const sourceWire = privateJsonStringify({ content });
  const source = sourceApiPath(activation, path);
  const generationHeaders = workerGenerationHeaders(replayCredentials);

  const published = await requestJsonWire(
    input,
    "PUT",
    source,
    input.credentials.authToken,
    sourceWire,
  );
  if (!published.ok) {
    throw new Error(`canonical replay source setup failed with HTTP ${published.status}`);
  }
  const readback = await requestJson(input, "GET", source, input.credentials.authToken);
  if (!readback.ok || readSourceContent(readback.body) !== content) {
    throw new Error("canonical replay source setup readback failed");
  }
  const versionId = readSourceVersionId(readback.body);
  if (versionId === undefined) {
    throw new Error("canonical replay source setup did not include an immutable version id");
  }
  const fileId = readSourceFileId(readback.body);
  if (fileId === undefined) {
    throw new Error("canonical replay source setup did not include an immutable file id");
  }
  const indexBody = await canonicalIndexBody(input, versionId, content);
  const indexWire = privateJsonStringify(indexBody);
  const indexRequestHash = await computeHash(indexWire);
  const indexed = await requestJsonWire(
    input,
    "POST",
    sourceIndexApiPath(activation, path),
    input.credentials.runEventToken,
    indexWire,
  );
  if (!indexed.ok) {
    throw new Error(`canonical replay index setup failed with HTTP ${indexed.status}`);
  }
  const sourceChecksum = readStringFieldFromRecord(readback.body, ["checksum"]);
  const invalidIndexReason = validateCanonicalIndexResponse(indexed.body, {
    fileId,
    versionId,
    sourcePath: path,
    sourceChecksum,
    indexedChunkCount: 1,
  });
  if (invalidIndexReason !== undefined) throw new Error(invalidIndexReason);

  const sourceVersionHash = await safeHash(readSourceVersionMaterial(readback.body));
  const indexResponseHash = await safeHash(indexed.body);
  const indexStateHash = await readCanonicalIndexStateHash(
    activation,
    input,
    path,
    fileId,
    versionId,
    input.credentials.authToken,
  );
  const beforeHash = await safeHash({
    sourceVersionHash,
    indexRequestHash,
    indexResponseHash,
    indexStateHash,
  });

  const replaySource = await requestJsonWire(
    input,
    "PUT",
    source,
    replayCredentials.authToken,
    sourceWire,
    generationHeaders,
  );
  const replayIndex = await requestJsonWire(
    input,
    "POST",
    sourceIndexApiPath(activation, path),
    replayCredentials.runEventToken,
    indexWire,
    generationHeaders,
  );
  const afterReadback = await requestJson(input, "GET", source, input.credentials.authToken);
  if (!afterReadback.ok || readSourceContent(afterReadback.body) !== content) {
    throw new Error("canonical replay source after-readback failed");
  }
  const afterSourceVersionHash = await safeHash(readSourceVersionMaterial(afterReadback.body));
  const afterIndexStateHash = await readCanonicalIndexStateHash(
    activation,
    input,
    path,
    fileId,
    versionId,
    input.credentials.authToken,
  );
  const afterHash = await safeHash({
    sourceVersionHash: afterSourceVersionHash,
    indexRequestHash,
    indexResponseHash,
    indexStateHash: afterIndexStateHash,
  });
  const sourceDenied = isReplayAuthorityDenied(replaySource);
  const indexDenied = isReplayAuthorityDenied(replayIndex);
  return {
    sourcePath: path,
    sourceHash,
    sourceVersionHash,
    indexRequestHash,
    indexResponseHash,
    beforeHash,
    afterHash,
    deniedStatus: sourceDenied ? replaySource.status : replayIndex.status,
    deniedByStatus: sourceDenied && indexDenied && beforeHash === afterHash,
  };
}

async function proveRetainedCanonicalSourceIndexReplayDenied(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  proof: RetainedCanonicalSourceIndexProof,
  replayCredentials: AgentWorkerRuntimeOwnershipProbeCredentials,
): Promise<{
  sourcePath: string;
  sourceHash: string;
  sourceVersionHash: string;
  indexRequestHash: string;
  indexResponseHash: string;
  beforeHash: string;
  afterHash: string;
  deniedStatus: number;
  deniedByStatus: boolean;
}> {
  const generationHeaders = workerGenerationHeaders(replayCredentials);
  const replaySource = await requestJsonWire(
    input,
    "PUT",
    sourceApiPath(activation, proof.sourcePath),
    replayCredentials.authToken,
    proof.sourceWire,
    generationHeaders,
  );
  const replayIndex = await requestJsonWire(
    input,
    "POST",
    sourceIndexApiPath(activation, proof.sourcePath),
    replayCredentials.runEventToken,
    proof.indexWire,
    generationHeaders,
  );
  const afterReadback = await requestJson(
    input,
    "GET",
    sourceApiPath(activation, proof.sourcePath),
    proof.readAuthToken,
  );
  if (!afterReadback.ok || readSourceContent(afterReadback.body) !== proof.content) {
    throw new Error("retained canonical replay source after-readback failed");
  }
  const afterSourceVersionHash = await safeHash(readSourceVersionMaterial(afterReadback.body));
  const afterIndexStateHash = await readCanonicalIndexStateHash(
    activation,
    input,
    proof.sourcePath,
    proof.sourceFileId,
    proof.sourceVersionId,
    proof.readAuthToken,
  );
  const afterHash = await safeHash({
    sourceVersionHash: afterSourceVersionHash,
    indexRequestHash: proof.indexRequestHash,
    indexResponseHash: proof.indexResponseHash,
    indexStateHash: afterIndexStateHash,
  });
  const sourceDenied = isReplayAuthorityDenied(replaySource);
  const indexDenied = isReplayAuthorityDenied(replayIndex);
  return {
    sourcePath: proof.sourcePath,
    sourceHash: proof.sourceHash,
    sourceVersionHash: proof.sourceVersionHash,
    indexRequestHash: proof.indexRequestHash,
    indexResponseHash: proof.indexResponseHash,
    beforeHash: proof.beforeHash,
    afterHash,
    deniedStatus: sourceDenied ? replaySource.status : replayIndex.status,
    deniedByStatus: sourceDenied && indexDenied && proof.beforeHash === afterHash,
  };
}

function scoped(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  options: { requireLiveLeaseBudget?: boolean } = {},
): string | undefined {
  if (Date.now() >= activation.expiresAtMs) return "activation-expired";
  if (options.requireLiveLeaseBudget !== false) {
    if (input.run.leaseExpiresAtMs !== undefined && input.run.leaseExpiresAtMs !== null) {
      if (Date.now() >= input.run.leaseExpiresAtMs - 1_000) return "lease-deadline-expired";
    }
  }
  if (activation.workerId !== undefined && activation.workerId !== input.workerId) {
    return "worker-scope-mismatch";
  }
  if (input.run.projectId !== activation.projectId) return "project-scope-mismatch";
  return undefined;
}

function toReceiptBase(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  phase: AgentWorkerRuntimeOwnershipProbePhase,
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
): Omit<AgentWorkerRuntimeOwnershipProbeReceipt, "status"> {
  return {
    probe: "agent-worker-runtime-ownership",
    probeId: activation.probeId,
    phase,
    workerId: input.workerId,
    runId: input.run.runId,
    canonicalRunId: input.run.canonicalRunId,
    projectId: input.run.projectId ?? undefined,
  };
}

function phaseDeadlineMs(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  options: { includeLeaseDeadline?: boolean } = {},
): number {
  let deadlineMs = Math.min(Date.now() + activation.operationTimeoutMs, activation.expiresAtMs);
  if (options.includeLeaseDeadline !== false) {
    if (input.run.leaseExpiresAtMs !== undefined && input.run.leaseExpiresAtMs !== null) {
      deadlineMs = Math.min(deadlineMs, input.run.leaseExpiresAtMs - 1_000);
    }
  }
  return deadlineMs;
}

function withActivation(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  options: { includeLeaseDeadline?: boolean } = {},
): InstrumentedProbeInput {
  return {
    apiUrl: input.apiUrl,
    fetch: input.fetch,
    workerId: input.workerId,
    run: input.run,
    credentials: input.credentials,
    ...(input.embedder ? { embedder: input.embedder } : {}),
    activation,
    deadlineMs: phaseDeadlineMs(activation, input, options),
  };
}

async function currentWriteIndex(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  sink: AgentWorkerRuntimeOwnershipProbeReceiptSink,
  input: AgentWorkerRuntimeOwnershipProbeClaimInput,
  retainedCanonicalByRun: Map<string, RetainedCanonicalSourceIndexProof>,
): Promise<AgentWorkerRuntimeOwnershipProbeResult | void> {
  const base = toReceiptBase(activation, "canonical-source-index", input);
  const skipReason = scoped(activation, input);
  if (skipReason) {
    sink({ ...base, status: "skipped", reason: skipReason });
    return;
  }
  let committedLatestExternalEventSequence: number | undefined;
  let appendAttempted = false;
  let retryAppendWire: string | undefined;
  let retryAppendIdempotencyKey: string | undefined;
  try {
    const instrumented = withActivation(activation, input);
    const before = await readEventSnapshot(
      instrumented,
      input.credentials.authToken,
    );
    if (!before.ok) {
      sink({ ...base, status: "error", eventBeforeHash: before.hash, reason: before.reason });
      return;
    }
    const identity = `${activation.probeId}:${input.workerId}:${input.run.runId}:${Date.now()}`;
    const canonical = await publishCanonicalSourceAndIndex(activation, instrumented, identity);
    RuntimeReflectApply(RuntimeMapPrototypeSet, retainedCanonicalByRun, [
      input.run.runId,
      canonical.replayProof,
    ]);
    const event = {
      type: "RUNTIME_EVENT_RECORDED",
      runtime: "veryfront",
      kind: "veryfront.agent_worker.runtime_ownership.canonical_source_index",
      value: {
        probe: "agent-worker-runtime-ownership",
        probeId: activation.probeId,
        identity,
        workerId: input.workerId,
        runId: input.run.runId,
        canonicalRunId: input.run.canonicalRunId,
        sourcePath: canonical.sourcePath,
        sourceHash: canonical.sourceHash,
      },
    };
    if (pastProbeDeadline(instrumented)) {
      sink({
        ...base,
        status: "error",
        eventBeforeHash: before.hash,
        sourcePath: canonical.sourcePath,
        sourceHash: canonical.sourceHash,
        sourceVersionHash: canonical.sourceVersionHash,
        indexRequestHash: canonical.indexRequestHash,
        indexResponseHash: canonical.indexResponseHash,
        reason: "operation-deadline-exceeded",
      });
      return;
    }
    const appendBody = { events: [event] };
    const appendIdempotencyKey = await probeEventIdempotencyKey(
      activation,
      input,
      identity,
      "claim",
    );
    retryAppendWire = privateJsonStringify(appendBody);
    retryAppendIdempotencyKey = appendIdempotencyKey;
    appendAttempted = true;
    const appended = await requestJsonWire(
      instrumented,
      "POST",
      eventPath(input.run.canonicalRunId),
      input.credentials.runEventToken,
      retryAppendWire,
      { "Idempotency-Key": appendIdempotencyKey },
    );
    if (!appended.ok) {
      sink({
        ...base,
        status: appended.status === 401 || appended.status === 403 ? "skipped" : "error",
        eventBeforeHash: before.hash,
        sourcePath: canonical.sourcePath,
        sourceHash: canonical.sourceHash,
        sourceVersionHash: canonical.sourceVersionHash,
        indexRequestHash: canonical.indexRequestHash,
        indexResponseHash: canonical.indexResponseHash,
        eventResponseHash: await safeHash(appended.body),
        deniedStatus: appended.status,
        reason: appended.status === 401 || appended.status === 403
          ? "event-writer-denied"
          : "append-failed",
      });
      return;
    }
    committedLatestExternalEventSequence = readLatestExternalEventSequence(appended.body);
    if (committedLatestExternalEventSequence === undefined) {
      committedLatestExternalEventSequence = await retryEventAppendForCursor(
        instrumented,
        input.credentials.runEventToken,
        retryAppendWire,
        appendIdempotencyKey,
      );
    }
    if (committedLatestExternalEventSequence === undefined) {
      sink({
        ...base,
        status: "error",
        eventBeforeHash: before.hash,
        sourcePath: canonical.sourcePath,
        sourceHash: canonical.sourceHash,
        sourceVersionHash: canonical.sourceVersionHash,
        indexRequestHash: canonical.indexRequestHash,
        indexResponseHash: canonical.indexResponseHash,
        eventResponseHash: await safeHash(appended.body),
        reason: "append-cursor-unavailable",
      });
      throw fatalCursorError("Agent worker runtime ownership probe append cursor is unavailable");
    }
    const after = await readEventSnapshot(
      instrumented,
      input.credentials.authToken,
      identity,
    );
    const ok = after.ok && after.containsIdentity;
    sink({
      ...base,
      status: ok ? "ok" : "error",
      eventBeforeHash: before.hash,
      eventAfterHash: after.hash,
      sourcePath: canonical.sourcePath,
      sourceHash: canonical.sourceHash,
      sourceVersionHash: canonical.sourceVersionHash,
      indexRequestHash: canonical.indexRequestHash,
      indexResponseHash: canonical.indexResponseHash,
      eventResponseHash: await safeHash(appended.body),
      reason: ok ? undefined : after.reason ?? "probe-event-not-indexed",
    });
    return { latestExternalEventSequence: committedLatestExternalEventSequence };
  } catch (error) {
    if (
      errorMessageIncludes(error, "append cursor is unavailable") ||
      errorMessageIncludes(error, "append outcome is ambiguous")
    ) {
      throw error;
    }
    sink({ ...base, status: "error", errorType: classifyError(error) });
    if (committedLatestExternalEventSequence !== undefined) {
      return { latestExternalEventSequence: committedLatestExternalEventSequence };
    }
    if (appendAttempted) {
      if (retryAppendWire !== undefined && retryAppendIdempotencyKey !== undefined) {
        committedLatestExternalEventSequence = await retryEventAppendForCursor(
          withActivation(activation, input),
          input.credentials.runEventToken,
          retryAppendWire,
          retryAppendIdempotencyKey,
        );
        if (committedLatestExternalEventSequence !== undefined) {
          return { latestExternalEventSequence: committedLatestExternalEventSequence };
        }
      }
      throw fatalCursorError("Agent worker runtime ownership probe append outcome is ambiguous");
    }
  }
}

async function replacedGenerationDenied(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  sink: AgentWorkerRuntimeOwnershipProbeReceiptSink,
  input: AgentWorkerRuntimeOwnershipProbeRenewInput,
): Promise<AgentWorkerRuntimeOwnershipProbeResult | void> {
  const base = toReceiptBase(activation, "replaced-generation-denial", input);
  const skipReason = scoped(activation, input);
  if (skipReason) {
    sink({ ...base, status: "skipped", reason: skipReason });
    return;
  }
  if (!input.previousCredentials) {
    sink({ ...base, status: "skipped", reason: "no-previous-generation" });
    return;
  }
  if (input.previousCredentials.runEventToken === input.credentials.runEventToken) {
    sink({ ...base, status: "skipped", reason: "same-generation" });
    return;
  }
  let committedLatestExternalEventSequence: number | undefined;
  let appendOutcomeAmbiguous = false;
  let retryAppendWire: string | undefined;
  let retryAppendIdempotencyKey: string | undefined;
  try {
    const instrumented = withActivation(activation, input);
    const before = await readEventSnapshot(
      instrumented,
      input.credentials.authToken,
    );
    if (!before.ok) {
      sink({ ...base, status: "error", eventBeforeHash: before.hash, reason: before.reason });
      return;
    }
    const staleIdentity =
      `${activation.probeId}:stale:${input.workerId}:${input.run.runId}:${Date.now()}`;
    const canonicalReplay = await proveCanonicalSourceIndexReplayDenied(
      activation,
      instrumented,
      staleIdentity,
      input.previousCredentials,
    );
    const appendBody = {
      events: [{
        type: "RUNTIME_EVENT_RECORDED",
        runtime: "veryfront",
        kind: "veryfront.agent_worker.runtime_ownership.stale_generation",
        value: {
          probe: "agent-worker-runtime-ownership",
          probeId: activation.probeId,
          staleIdentity,
        },
      }],
    };
    const appendIdempotencyKey = await probeEventIdempotencyKey(
      activation,
      input,
      staleIdentity,
      "renew",
    );
    retryAppendWire = privateJsonStringify(appendBody);
    retryAppendIdempotencyKey = appendIdempotencyKey;
    appendOutcomeAmbiguous = true;
    const denied = await requestJsonWire(
      instrumented,
      "POST",
      eventPath(input.run.canonicalRunId),
      input.previousCredentials.runEventToken,
      retryAppendWire,
      { "Idempotency-Key": appendIdempotencyKey },
    );
    appendOutcomeAmbiguous = false;
    committedLatestExternalEventSequence = denied.ok
      ? readLatestExternalEventSequence(denied.body)
      : undefined;
    if (denied.ok && committedLatestExternalEventSequence === undefined) {
      committedLatestExternalEventSequence = await retryEventAppendForCursor(
        instrumented,
        input.previousCredentials.runEventToken,
        retryAppendWire,
        appendIdempotencyKey,
      );
    }
    if (denied.ok && committedLatestExternalEventSequence === undefined) {
      sink({
        ...base,
        status: "error",
        eventBeforeHash: before.hash,
        eventResponseHash: await safeHash(denied.body),
        deniedStatus: denied.status,
        reason: "append-cursor-unavailable",
      });
      throw fatalCursorError("Agent worker runtime ownership probe append cursor is unavailable");
    }
    const after = await readEventSnapshot(
      instrumented,
      input.credentials.authToken,
      staleIdentity,
    );
    const eventBeforeHash = before.hash;
    const eventAfterHash = after.hash;
    const deniedByStatus = isReplayAuthorityDenied(denied);
    const eventsUnchanged = before.ok && after.ok && eventBeforeHash === eventAfterHash &&
      !after.containsIdentity;
    const ok = deniedByStatus && eventsUnchanged && canonicalReplay.deniedByStatus;
    sink({
      ...base,
      status: ok ? "ok" : "error",
      beforeHash: canonicalReplay.beforeHash,
      afterHash: canonicalReplay.afterHash,
      sourcePath: canonicalReplay.sourcePath,
      sourceHash: canonicalReplay.sourceHash,
      sourceVersionHash: canonicalReplay.sourceVersionHash,
      indexRequestHash: canonicalReplay.indexRequestHash,
      indexResponseHash: canonicalReplay.indexResponseHash,
      eventBeforeHash,
      eventAfterHash,
      eventResponseHash: await safeHash(denied.body),
      deniedStatus: denied.status,
      reason: ok ? undefined : "stale-generation-mutated-source-index-or-events",
    });
    if (!deniedByStatus && committedLatestExternalEventSequence !== undefined) {
      return { latestExternalEventSequence: committedLatestExternalEventSequence };
    }
  } catch (error) {
    if (
      errorMessageIncludes(error, "append cursor is unavailable") ||
      errorMessageIncludes(error, "append outcome is ambiguous")
    ) {
      throw error;
    }
    sink({ ...base, status: "error", errorType: classifyError(error) });
    if (committedLatestExternalEventSequence !== undefined) {
      return { latestExternalEventSequence: committedLatestExternalEventSequence };
    }
    if (appendOutcomeAmbiguous) {
      if (retryAppendWire !== undefined && retryAppendIdempotencyKey !== undefined) {
        committedLatestExternalEventSequence = await retryEventAppendForCursor(
          withActivation(activation, input),
          input.previousCredentials.runEventToken,
          retryAppendWire,
          retryAppendIdempotencyKey,
        );
        if (committedLatestExternalEventSequence !== undefined) {
          return { latestExternalEventSequence: committedLatestExternalEventSequence };
        }
      }
      throw fatalCursorError(
        "Agent worker runtime ownership probe stale generation outcome is ambiguous",
      );
    }
  }
}

async function expiredLeaseDenied(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  sink: AgentWorkerRuntimeOwnershipProbeReceiptSink,
  input: AgentWorkerRuntimeOwnershipProbeLeaseLostInput,
  retainedCanonicalByRun: Map<string, RetainedCanonicalSourceIndexProof>,
): Promise<void> {
  const base = toReceiptBase(activation, "expired-lease-denial", input);
  const skipReason = scoped(activation, input, { requireLiveLeaseBudget: false });
  if (skipReason) {
    sink({ ...base, status: "skipped", reason: skipReason });
    return;
  }
  try {
    const instrumented = withActivation(activation, input, { includeLeaseDeadline: false });
    const staleIdentity =
      `${activation.probeId}:expired:${input.workerId}:${input.run.runId}:${Date.now()}`;
    const retained = RuntimeReflectApply(RuntimeMapPrototypeGet, retainedCanonicalByRun, [
      input.run.runId,
    ]) as RetainedCanonicalSourceIndexProof | undefined;
    const canonicalReplay = retained
      ? await proveRetainedCanonicalSourceIndexReplayDenied(
        activation,
        instrumented,
        retained,
        input.credentials,
      )
      : input.currentCredentials
      ? await proveCanonicalSourceIndexReplayDenied(
        activation,
        { ...instrumented, credentials: input.currentCredentials },
        staleIdentity,
        input.credentials,
      )
      : (() => {
        throw new Error(
          "current or retained worker authority is required to prove expired lease source/index immutability",
        );
      })();
    const denied = await requestJson(
      instrumented,
      "POST",
      eventPath(input.run.canonicalRunId),
      input.credentials.runEventToken,
      {
        events: [{
          type: "RUNTIME_EVENT_RECORDED",
          runtime: "veryfront",
          kind: "veryfront.agent_worker.runtime_ownership.expired_lease",
          value: {
            probe: "agent-worker-runtime-ownership",
            probeId: activation.probeId,
            staleIdentity,
          },
        }],
      },
      workerGenerationHeaders(input.credentials),
    );
    const deniedByStatus = isReplayAuthorityDenied(denied);
    const ok = deniedByStatus && canonicalReplay.deniedByStatus;
    sink({
      ...base,
      status: ok ? "ok" : "error",
      beforeHash: canonicalReplay.beforeHash,
      afterHash: canonicalReplay.afterHash,
      sourcePath: canonicalReplay.sourcePath,
      sourceHash: canonicalReplay.sourceHash,
      sourceVersionHash: canonicalReplay.sourceVersionHash,
      indexRequestHash: canonicalReplay.indexRequestHash,
      indexResponseHash: canonicalReplay.indexResponseHash,
      eventResponseHash: await safeHash(denied.body),
      deniedStatus: denied.status,
      reason: ok ? undefined : "expired-lease-source-index-or-event-write-not-denied",
    });
  } catch (error) {
    sink({ ...base, status: "error", errorType: classifyError(error) });
  }
}

async function cancelledChildIdempotencyKey(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  input: AgentWorkerRuntimeOwnershipProbeCancelledInput,
): Promise<string> {
  const hash = await computeHash(
    `${activation.probeId}:${input.workerId}:${input.run.runId}:cancelled-child`,
  );
  return `agent-worker-child:${hash}`;
}

async function cancelledChildDenied(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  sink: AgentWorkerRuntimeOwnershipProbeReceiptSink,
  input: AgentWorkerRuntimeOwnershipProbeCancelledInput,
): Promise<void> {
  const base = toReceiptBase(activation, "cancelled-child-denial", input);
  const skipReason = scoped(activation, input);
  if (skipReason) {
    sink({ ...base, status: "skipped", reason: skipReason });
    return;
  }
  try {
    const instrumented = withActivation(activation, input);
    const before = await readEventSnapshot(
      instrumented,
      input.credentials.authToken,
    );
    if (!before.ok) {
      sink({ ...base, status: "error", eventBeforeHash: before.hash, reason: before.reason });
      return;
    }
    const toolCallId = activation.childToolCallId ?? findToolCallId(before.body);
    if (toolCallId === undefined) {
      sink({
        ...base,
        status: "error",
        eventBeforeHash: before.hash,
        reason: "missing-child-invocation-reference",
      });
      return;
    }
    const child = await requestJson(
      instrumented,
      "POST",
      "/runs",
      input.credentials.authToken,
      {
        project_id: input.run.projectId,
        target: { type: "task", id: "agent-worker-runtime-ownership-probe" },
        parent_run_id: input.run.canonicalRunId,
        tool_call_id: toolCallId,
        title: "agent worker runtime ownership stale child denial probe",
        input: { probe: "agent-worker-runtime-ownership", probeId: activation.probeId },
      },
      {
        "Idempotency-Key": await cancelledChildIdempotencyKey(activation, input),
        "X-Veryfront-Run-Terminal-Token": input.credentials.runTerminalToken,
      },
    );
    const after = await readEventSnapshot(
      instrumented,
      input.credentials.authToken,
    );
    const beforeHash = before.hash;
    const afterHash = after.hash;
    const deniedByStatus = child.status === 401 || child.status === 403 ||
      (child.status === 409 && isCancellationOrStopRejection(child.body));
    const unchanged = before.ok && after.ok && beforeHash === afterHash;
    sink({
      ...base,
      status: deniedByStatus && unchanged ? "ok" : "error",
      beforeHash,
      afterHash,
      childCreateResponseHash: await safeHash(child.body),
      deniedStatus: child.status,
      reason: deniedByStatus && unchanged
        ? undefined
        : before.reason ?? after.reason ?? "cancelled-child-create-not-denied",
    });
  } catch (error) {
    sink({ ...base, status: "error", errorType: classifyError(error) });
  }
}

function redactReceiptForDefaultLog(
  receipt: AgentWorkerRuntimeOwnershipProbeReceipt,
): AgentWorkerRuntimeOwnershipProbeReceipt {
  return {
    ...receipt,
    projectId: receipt.projectId === undefined ? undefined : "[redacted]",
    workerId: "[redacted]",
    runId: "[redacted]",
    canonicalRunId: "[redacted]",
    sourcePath: receipt.sourcePath === undefined ? undefined : "[redacted]",
  };
}

function defaultReceiptSink(receipt: AgentWorkerRuntimeOwnershipProbeReceipt): void {
  console.info(
    "[agent-worker-runtime-ownership-probe] receipt",
    redactReceiptForDefaultLog(receipt),
  );
}

export function createAgentWorkerRuntimeOwnershipProbe(
  activation: AgentWorkerRuntimeOwnershipProbeActivation,
  sink: AgentWorkerRuntimeOwnershipProbeReceiptSink = defaultReceiptSink,
): AgentWorkerRuntimeOwnershipProbe {
  const retainedCanonicalByRun = new Map<string, RetainedCanonicalSourceIndexProof>();
  const clearExpiredRetention = () => {
    if (Date.now() >= activation.expiresAtMs) {
      RuntimeReflectApply(RuntimeMapPrototypeClear, retainedCanonicalByRun, []);
    }
  };
  return {
    afterClaim: (input) => {
      clearExpiredRetention();
      return currentWriteIndex(activation, sink, input, retainedCanonicalByRun);
    },
    afterRenew: (input) => {
      clearExpiredRetention();
      return replacedGenerationDenied(activation, sink, input);
    },
    async afterLeaseLost(input) {
      clearExpiredRetention();
      try {
        await expiredLeaseDenied(activation, sink, input, retainedCanonicalByRun);
      } finally {
        RuntimeReflectApply(RuntimeMapPrototypeDelete, retainedCanonicalByRun, [input.run.runId]);
      }
    },
    async afterCancelled(input) {
      clearExpiredRetention();
      try {
        await cancelledChildDenied(activation, sink, input);
      } finally {
        RuntimeReflectApply(RuntimeMapPrototypeDelete, retainedCanonicalByRun, [input.run.runId]);
      }
    },
    afterTerminal(input) {
      clearExpiredRetention();
      RuntimeReflectApply(RuntimeMapPrototypeDelete, retainedCanonicalByRun, [input.run.runId]);
      return Promise.resolve();
    },
  };
}

export function createAgentWorkerRuntimeOwnershipProbeFromHostEnv(
  nowMs: number = Date.now(),
  readEnv: AgentWorkerRuntimeOwnershipProbeEnvReader = getHostEnvExcludingEnvFile,
  sink?: AgentWorkerRuntimeOwnershipProbeReceiptSink,
): AgentWorkerRuntimeOwnershipProbe | undefined {
  const activation = readActivationFromEnv(readEnv, nowMs);
  if (!activation) return undefined;
  return createAgentWorkerRuntimeOwnershipProbe(activation, sink);
}
