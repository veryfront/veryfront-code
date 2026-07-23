import { getVeryfrontCloudBootstrap } from "#veryfront/platform/cloud/resolver.ts";
import {
  requestWithRetry,
  type ResolvedVeryfrontAPIRequestPolicy,
  type RetryConfig,
  snapshotAPIRequestPolicy,
  validateRetryConfig,
} from "#veryfront/platform/adapters/veryfront-api-client/retry-handler.ts";
import {
  API_CLIENT_ERROR,
  VeryfrontError,
} from "#veryfront/platform/adapters/veryfront-api-client/types.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { getJsonValueSchema } from "#veryfront/schemas/primitives.ts";
import {
  type CancelRunResponse,
  CancelRunResponseSchema,
  type CreateRunResponse,
  CreateRunResponseSchema,
  type Run,
  type RunEventList,
  RunEventListSchema,
  type RunList,
  RunListSchema,
  type RunRuntimeTargetKind,
  RunSchema,
} from "./schemas.ts";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;
const DEFAULT_KNOWLEDGE_INGEST_RUN_NAME = "Ingest knowledge";
const MAX_IDENTIFIER_LENGTH = 4_096;
const MAX_CURSOR_LENGTH = 16_384;
const MAX_AUTH_TOKEN_LENGTH = 16_384;
const MAX_KNOWLEDGE_ITEMS = 10_000;
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;

/** Atomic request identity returned by a context-aware runs client. */
export interface RunsRequestIdentity {
  /** Bearer token for the current request. */
  readonly authToken: string;
  /** Project slug or identifier paired with the token. */
  readonly projectReference: string;
}

/** Retry policy for idempotent Runs API requests. */
export interface RunsRetryConfig {
  /** Maximum number of retry attempts after the first request. */
  maxRetries?: number;
  /** Initial retry delay in milliseconds. */
  initialDelay?: number;
  /** Maximum retry delay in milliseconds. */
  maxDelay?: number;
}

/** Lifecycle and response limits for Runs API operations. */
export interface RunsRequestPolicy {
  /** Abort signal that cancels requests and pending retries. */
  signal?: AbortSignal;
  /** Maximum duration of one HTTP attempt, in milliseconds. */
  timeoutMs?: number;
  /** Maximum duration of the complete operation, in milliseconds. */
  totalTimeoutMs?: number;
  /** Maximum bytes accepted from one HTTP response body. */
  maxResponseBytes?: number;
}

/** Configuration used by the Veryfront runs client. */
export interface VeryfrontRunsClientConfig {
  /** Base URL for the Runs API. */
  apiUrl?: string;
  /** Static bearer token for single-identity clients. */
  authToken?: string;
  /** Static project slug or identifier for project-scoped requests. */
  projectReference?: string;
  /** Resolve auth and project identity together for the current asynchronous request context. */
  requestIdentityProvider?: () => RunsRequestIdentity | undefined;
  /** Retry policy for idempotent requests. */
  retry?: RunsRetryConfig;
  /** Default cancellation, timeout, and response-size policy. */
  requestPolicy?: RunsRequestPolicy;
}

/** Options accepted by project-scoped run requests. */
export interface ProjectScopedOptions {
  /** Project slug or identifier that overrides the client default. */
  projectReference?: string;
}

/** Runtime target fields accepted by run creation APIs. */
export interface RunRuntimeTargetOptions {
  /** Runtime target category. */
  runtimeTargetKind?: RunRuntimeTargetKind;
  /** Environment identifier required for an `environment` target. */
  runtimeTargetEnvironmentId?: string | null;
  /** Branch identifier required for a `preview_branch` target. */
  runtimeTargetBranchId?: string | null;
}

/** Fields shared by task, workflow, and eval run creation. */
export interface RunCreateBaseInput {
  /** Project that owns the run. */
  projectId: string;
  /** Caller-defined idempotent run identifier. */
  publicId?: string;
  /** Parent run identifier for a child run. */
  parentRunId?: string;
}

/** Input payload for creating a task run. */
export interface CreateTaskRunInput extends RunCreateBaseInput, RunRuntimeTargetOptions {
  /** Human-readable run name. */
  name?: string;
  /** Task target in `task:<task-id>` format. */
  target: `task:${string}`;
  /** Optional batch identifier. */
  batchId?: string;
  /** JSON-compatible task configuration. */
  config?: Record<string, unknown>;
  /** Execution timeout in seconds. */
  timeoutSeconds?: number;
  /** Maximum retry backoff count. */
  backoffLimit?: number;
}

/** Input payload for creating a workflow run. */
export interface CreateWorkflowRunInput extends RunCreateBaseInput, RunRuntimeTargetOptions {
  /** Workflow definition identifier. */
  workflowId: string;
  /** Workflow target in `workflow:<workflow-id>` format. */
  target: `workflow:${string}`;
  /** JSON-compatible workflow input. */
  input?: Record<string, unknown>;
  /** Runtime-specific workflow start mode. */
  startMode?: string;
}

/** Input payload for creating an eval run. */
export interface CreateEvalRunInput extends RunCreateBaseInput, RunRuntimeTargetOptions {
  /** Eval target in `eval:<eval-id>` format. */
  target: `eval:${string}`;
  /** JSON-compatible eval input. */
  input?: Record<string, unknown>;
  /** JSON-compatible eval configuration. */
  config?: Record<string, unknown>;
  /** Runtime-specific eval start mode. */
  startMode?: string;
}

/** Input payload for knowledge ingest by upload IDs. */
export interface KnowledgeIngestByUploadIdsInput
  extends Omit<CreateTaskRunInput, "target" | "config"> {
  /** Upload identifiers to ingest. */
  uploadIds: string[];
}

/** Input payload for knowledge ingest by upload paths. */
export interface KnowledgeIngestByUploadPathsInput
  extends Omit<CreateTaskRunInput, "target" | "config"> {
  /** Uploaded file paths to ingest. */
  uploadPaths: string[];
}

/** Input payload for knowledge ingest by upload prefix. */
export interface KnowledgeIngestByUploadPrefixInput
  extends Omit<CreateTaskRunInput, "target" | "config"> {
  /** Uploaded path prefix to ingest. */
  uploadPrefix: string;
}

/** Options for listing project runs. */
export interface ListRunsOptions extends ProjectScopedOptions {
  /** Opaque pagination cursor. */
  cursor?: string;
  /** Positive maximum number of runs to return. */
  limit?: number;
}

/** Options for listing events after a known event. */
export interface ListRunEventsOptions {
  /** Return events after this non-negative event identifier. */
  afterEventId?: number;
  /** Positive maximum number of events to return. */
  limit?: number;
}

interface ResolvedRunsClientConfig {
  readonly apiUrl?: string;
  readonly authToken?: string;
  readonly projectReference?: string;
  readonly requestIdentityProvider?: () => RunsRequestIdentity | undefined;
  readonly retry: Readonly<RetryConfig>;
  readonly requestPolicy: Readonly<ResolvedVeryfrontAPIRequestPolicy>;
}

interface RunsOperationContext {
  readonly apiUrl: string;
  readonly authToken: string;
  readonly projectReference?: string;
}

interface RequestJsonOptions {
  readonly method?: "GET" | "POST";
  readonly body?: Record<string, unknown>;
  readonly operation: string;
  readonly route: string;
  readonly requiresProject?: boolean;
}

function invalidRunsInput(detail: string, status = 400): Error {
  return API_CLIENT_ERROR.create({ detail, status });
}

function snapshotProperties(
  value: unknown,
  label: string,
  properties: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw invalidRunsInput(`${label} must be an object`);
  }
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch (_) {
    throw invalidRunsInput(`${label} could not be read`);
  }
  if (isArray) throw invalidRunsInput(`${label} must be an object`);

  const snapshot: Record<string, unknown> = {};
  try {
    for (const property of properties) snapshot[property] = Reflect.get(value, property);
  } catch (_) {
    throw invalidRunsInput(`${label} could not be read`);
  }
  return snapshot;
}

function normalizeApiUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidRunsInput("Runs API URL must be a non-empty string");
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch (_) {
    throw invalidRunsInput("Runs API URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalidRunsInput("Runs API URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw invalidRunsInput("Runs API URL must not include credentials");
  }
  if (parsed.search || parsed.hash) {
    throw invalidRunsInput("Runs API URL must not include a query string or fragment");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

function validateAuthToken(value: unknown, label = "Runs auth token"): string {
  if (
    typeof value !== "string" || value.trim().length === 0 || value !== value.trim()
  ) {
    throw invalidRunsInput(`${label} must be a non-empty string`, 401);
  }
  if (value.length > MAX_AUTH_TOKEN_LENGTH) {
    throw invalidRunsInput(`${label} exceeds the supported length`, 401);
  }
  try {
    new Headers({ Authorization: `Bearer ${value}` });
  } catch (_) {
    throw invalidRunsInput(`${label} is invalid`, 401);
  }
  return value;
}

function validateString(
  value: unknown,
  label: string,
  maxLength = MAX_IDENTIFIER_LENGTH,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidRunsInput(`${label} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw invalidRunsInput(`${label} exceeds the supported length`);
  }
  if (
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw invalidRunsInput(`${label} contains invalid control characters`);
  }
  return value;
}

function validateIdentifier(
  value: unknown,
  label: string,
  maxLength = MAX_IDENTIFIER_LENGTH,
): string {
  const identifier = validateString(value, label, maxLength);
  if (identifier !== identifier.trim()) {
    throw invalidRunsInput(`${label} must not contain surrounding whitespace`);
  }
  return identifier;
}

function validateOptionalString(
  value: unknown,
  label: string,
  maxLength = MAX_IDENTIFIER_LENGTH,
): string | undefined {
  return value === undefined ? undefined : validateString(value, label, maxLength);
}

function validateOptionalIdentifier(
  value: unknown,
  label: string,
  maxLength = MAX_IDENTIFIER_LENGTH,
): string | undefined {
  return value === undefined ? undefined : validateIdentifier(value, label, maxLength);
}

function validateNullableString(
  value: unknown,
  label: string,
): string | null | undefined {
  return value === undefined || value === null ? value : validateIdentifier(value, label);
}

function validateOptionalInteger(
  value: unknown,
  label: string,
  minimum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    const qualifier = minimum === 0 ? "non-negative" : "positive";
    throw invalidRunsInput(`${label} must be a ${qualifier} integer`);
  }
  return value as number;
}

function validateTarget(value: unknown, kind: "task" | "workflow" | "eval"): string {
  const target = validateIdentifier(value, `${kind} target`);
  const prefix = `${kind}:`;
  if (!target.startsWith(prefix) || target.length === prefix.length) {
    throw invalidRunsInput(`${kind} target must use ${prefix}<id> format`);
  }
  return target;
}

function validateJsonRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidRunsInput(`${label} must be a JSON object`);
  }
  const result = getJsonValueSchema().safeParse(value);
  if (
    !result.success || typeof result.data !== "object" || result.data === null ||
    Array.isArray(result.data)
  ) {
    throw invalidRunsInput(`${label} must be JSON-serializable`);
  }
  return result.data as Record<string, unknown>;
}

function validateStringArray(
  value: unknown,
  label: string,
  itemLabel: string,
  itemKind: "identifier" | "text" = "identifier",
): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_KNOWLEDGE_ITEMS) {
    throw invalidRunsInput(
      `${label} must contain between 1 and ${MAX_KNOWLEDGE_ITEMS} items`,
    );
  }
  return value.map((item) =>
    itemKind === "identifier"
      ? validateIdentifier(item, itemLabel)
      : validateString(item, itemLabel)
  );
}

function runtimeTargetBody(values: Record<string, unknown>): Record<string, unknown> {
  const kind = values.runtimeTargetKind;
  if (
    kind !== undefined && kind !== "main_branch" && kind !== "environment" &&
    kind !== "preview_branch"
  ) {
    throw invalidRunsInput("runtimeTargetKind is invalid");
  }
  const environmentId = validateNullableString(
    values.runtimeTargetEnvironmentId,
    "runtimeTargetEnvironmentId",
  );
  const branchId = validateNullableString(values.runtimeTargetBranchId, "runtimeTargetBranchId");

  if (kind === "environment" && !environmentId) {
    throw invalidRunsInput(
      "runtimeTargetEnvironmentId is required for an environment runtime target",
    );
  }
  if (kind === "preview_branch" && !branchId) {
    throw invalidRunsInput(
      "runtimeTargetBranchId is required for a preview_branch runtime target",
    );
  }
  if (kind !== "environment" && environmentId) {
    throw invalidRunsInput(
      "runtimeTargetEnvironmentId requires an environment runtime target",
    );
  }
  if (kind !== "preview_branch" && branchId) {
    throw invalidRunsInput(
      "runtimeTargetBranchId requires a preview_branch runtime target",
    );
  }

  return {
    runtime_target_kind: kind,
    runtime_target_environment_id: environmentId,
    runtime_target_branch_id: branchId,
  };
}

function toQueryParams(values: Record<string, string | number | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length > 0 ? `${path}?${query}` : path;
}

function serializeJsonBody(value: Record<string, unknown>): string {
  let body: string;
  try {
    body = JSON.stringify(value);
  } catch (_) {
    throw invalidRunsInput("Runs request body must be JSON-serializable");
  }
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BODY_BYTES) {
    throw invalidRunsInput(
      `Runs request body exceeds the ${MAX_REQUEST_BODY_BYTES}-byte limit`,
      413,
    );
  }
  return body;
}

function snapshotClientConfig(config: unknown): Readonly<ResolvedRunsClientConfig> {
  const values = snapshotProperties(config, "Runs client configuration", [
    "apiUrl",
    "authToken",
    "projectReference",
    "requestIdentityProvider",
    "retry",
    "requestPolicy",
  ]);
  if (
    values.requestIdentityProvider !== undefined &&
    typeof values.requestIdentityProvider !== "function"
  ) {
    throw invalidRunsInput("Runs requestIdentityProvider must be a function");
  }
  const rawRetry = values.retry === undefined
    ? {}
    : snapshotProperties(values.retry, "Runs retry configuration", [
      "maxRetries",
      "initialDelay",
      "maxDelay",
    ]);
  const retry = Object.freeze({
    maxRetries: rawRetry.maxRetries === undefined ? DEFAULT_MAX_RETRIES : rawRetry.maxRetries,
    initialDelay: rawRetry.initialDelay === undefined
      ? DEFAULT_INITIAL_RETRY_DELAY_MS
      : rawRetry.initialDelay,
    maxDelay: rawRetry.maxDelay === undefined ? DEFAULT_MAX_RETRY_DELAY_MS : rawRetry.maxDelay,
  }) as RetryConfig;
  validateRetryConfig(retry);

  return Object.freeze({
    apiUrl: values.apiUrl === undefined ? undefined : normalizeApiUrl(values.apiUrl),
    authToken: values.authToken === undefined ? undefined : validateAuthToken(values.authToken),
    projectReference: validateOptionalIdentifier(
      values.projectReference,
      "Runs project reference",
    ),
    requestIdentityProvider: values
      .requestIdentityProvider as ResolvedRunsClientConfig["requestIdentityProvider"],
    retry,
    requestPolicy: snapshotAPIRequestPolicy(values.requestPolicy),
  });
}

function snapshotRequestIdentity(value: unknown): Readonly<RunsRequestIdentity> {
  const values = snapshotProperties(value, "Runs request identity", [
    "authToken",
    "projectReference",
  ]);
  return Object.freeze({
    authToken: validateAuthToken(values.authToken, "Runs request identity auth token"),
    projectReference: validateIdentifier(
      values.projectReference,
      "Runs request identity project reference",
    ),
  });
}

function joinApiPath(apiUrl: string, path: string): string {
  return `${apiUrl}/${path.replace(/^\/+/, "")}`;
}

/** Public client for canonical durable runs. */
export class VeryfrontRunsClient {
  private readonly config: Readonly<ResolvedRunsClientConfig>;
  private requestToken?: string;
  private requestProjectReference?: string;

  /** Helpers that create the canonical knowledge-ingest task run. */
  readonly knowledge: Readonly<{
    /** Ingest uploaded files selected by upload identifier. */
    ingestByUploadIds: (input: KnowledgeIngestByUploadIdsInput) => Promise<CreateRunResponse>;
    /** Ingest uploaded files selected by exact path. */
    ingestByUploadPaths: (input: KnowledgeIngestByUploadPathsInput) => Promise<CreateRunResponse>;
    /** Ingest uploaded files selected by path prefix. */
    ingestByUploadPrefix: (input: KnowledgeIngestByUploadPrefixInput) => Promise<CreateRunResponse>;
  }>;

  /** Create a client and snapshot its static configuration. */
  constructor(config: VeryfrontRunsClientConfig = {}) {
    this.config = snapshotClientConfig(config);
    this.knowledge = Object.freeze({
      ingestByUploadIds: async (input: KnowledgeIngestByUploadIdsInput) =>
        await this.ingestKnowledgeByUploadIds(input),
      ingestByUploadPaths: async (input: KnowledgeIngestByUploadPathsInput) =>
        await this.ingestKnowledgeByUploadPaths(input),
      ingestByUploadPrefix: async (input: KnowledgeIngestByUploadPrefixInput) =>
        await this.ingestKnowledgeByUploadPrefix(input),
    });
  }

  /**
   * Set a mutable auth token for a legacy single-request client.
   *
   * @deprecated Use requestIdentityProvider when a client can serve concurrent requests.
   */
  setRequestToken(token: string): void {
    this.requestToken = validateAuthToken(token, "Runs request token");
  }

  /**
   * Clear the mutable auth token on a legacy single-request client.
   *
   * @deprecated Use requestIdentityProvider when a client can serve concurrent requests.
   */
  clearRequestToken(): void {
    this.requestToken = undefined;
  }

  /**
   * Set a mutable project reference for a legacy single-request client.
   *
   * @deprecated Use requestIdentityProvider when a client can serve concurrent requests.
   */
  setProjectReference(projectReference: string): void {
    this.requestProjectReference = validateIdentifier(
      projectReference,
      "Runs request project reference",
    );
  }

  /**
   * Clear the mutable project reference on a legacy single-request client.
   *
   * @deprecated Use requestIdentityProvider when a client can serve concurrent requests.
   */
  clearProjectReference(): void {
    this.requestProjectReference = undefined;
  }

  /** Create a canonical task run. */
  async createTaskRun(input: CreateTaskRunInput): Promise<CreateRunResponse> {
    const values = snapshotProperties(input, "Task run input", [
      "projectId",
      "publicId",
      "parentRunId",
      "name",
      "target",
      "batchId",
      "config",
      "timeoutSeconds",
      "backoffLimit",
      "runtimeTargetKind",
      "runtimeTargetEnvironmentId",
      "runtimeTargetBranchId",
    ]);
    const projectId = validateIdentifier(values.projectId, "projectId");
    const publicId = validateOptionalIdentifier(values.publicId, "publicId");
    const parentRunId = validateOptionalIdentifier(values.parentRunId, "parentRunId");
    const name = validateOptionalString(values.name, "name");
    const target = validateTarget(values.target, "task");
    const batchId = validateOptionalIdentifier(values.batchId, "batchId");
    const taskConfig = validateJsonRecord(values.config, "Task run config");
    const timeoutSeconds = validateOptionalInteger(values.timeoutSeconds, "timeoutSeconds", 0);
    const backoffLimit = validateOptionalInteger(values.backoffLimit, "backoffLimit", 0);

    return await this.requestJson("/runs", CreateRunResponseSchema, {
      method: "POST",
      operation: "createTaskRun",
      route: "/runs",
      body: {
        kind: "task",
        owner: { kind: "project", id: projectId },
        public_id: publicId,
        parent_run_id: parentRunId,
        request: {
          name,
          target,
          batch_id: batchId,
          ...runtimeTargetBody(values),
          config: taskConfig,
          timeout_seconds: timeoutSeconds,
          backoff_limit: backoffLimit,
        },
      },
    });
  }

  /** Create a canonical workflow run. */
  async createWorkflowRun(input: CreateWorkflowRunInput): Promise<CreateRunResponse> {
    const values = snapshotProperties(input, "Workflow run input", [
      "projectId",
      "publicId",
      "parentRunId",
      "workflowId",
      "target",
      "input",
      "startMode",
      "runtimeTargetKind",
      "runtimeTargetEnvironmentId",
      "runtimeTargetBranchId",
    ]);
    const projectId = validateIdentifier(values.projectId, "projectId");
    const publicId = validateOptionalIdentifier(values.publicId, "publicId");
    const parentRunId = validateOptionalIdentifier(values.parentRunId, "parentRunId");
    const workflowId = validateIdentifier(values.workflowId, "workflowId");
    const target = validateTarget(values.target, "workflow");
    const workflowInput = validateJsonRecord(values.input, "Workflow run input payload");
    const startMode = validateOptionalIdentifier(values.startMode, "startMode");

    return await this.requestJson("/runs", CreateRunResponseSchema, {
      method: "POST",
      operation: "createWorkflowRun",
      route: "/runs",
      body: {
        kind: "workflow",
        owner: { kind: "project", id: projectId },
        public_id: publicId,
        parent_run_id: parentRunId,
        request: {
          workflow_id: workflowId,
          target,
          ...runtimeTargetBody(values),
          input: workflowInput,
          start_mode: startMode,
        },
      },
    });
  }

  /** Create a canonical eval run. */
  async createEvalRun(input: CreateEvalRunInput): Promise<CreateRunResponse> {
    const values = snapshotProperties(input, "Eval run input", [
      "projectId",
      "publicId",
      "parentRunId",
      "target",
      "input",
      "config",
      "startMode",
      "runtimeTargetKind",
      "runtimeTargetEnvironmentId",
      "runtimeTargetBranchId",
    ]);
    const projectId = validateIdentifier(values.projectId, "projectId");
    const publicId = validateOptionalIdentifier(values.publicId, "publicId");
    const parentRunId = validateOptionalIdentifier(values.parentRunId, "parentRunId");
    const target = validateTarget(values.target, "eval");
    const evalInput = validateJsonRecord(values.input, "Eval run input payload");
    const evalConfig = validateJsonRecord(values.config, "Eval run config");
    const startMode = validateOptionalIdentifier(values.startMode, "startMode");

    return await this.requestJson("/runs", CreateRunResponseSchema, {
      method: "POST",
      operation: "createEvalRun",
      route: "/runs",
      body: {
        kind: "eval",
        owner: { kind: "project", id: projectId },
        public_id: publicId,
        parent_run_id: parentRunId,
        request: {
          target,
          ...runtimeTargetBody(values),
          input: evalInput,
          config: evalConfig,
          start_mode: startMode,
        },
      },
    });
  }

  /** List runs owned by a project. */
  async list(options: ListRunsOptions = {}): Promise<RunList> {
    const values = snapshotProperties(options, "Run list options", [
      "projectReference",
      "cursor",
      "limit",
    ]);
    const explicitProjectReference = validateOptionalIdentifier(
      values.projectReference,
      "Runs project reference",
    );
    const cursor = validateOptionalString(values.cursor, "cursor", MAX_CURSOR_LENGTH);
    const limit = validateOptionalInteger(values.limit, "limit", 1);

    return await this.requestJson(
      (context) => {
        const projectReference = explicitProjectReference ?? context.projectReference;
        if (!projectReference) {
          throw invalidRunsInput(
            "Runs project reference not configured. Pass projectReference explicitly, set VERYFRONT_PROJECT_SLUG, or provide request-scoped Veryfront project context.",
          );
        }
        return withQuery(
          `/projects/${encodeURIComponent(projectReference)}/runs`,
          toQueryParams({ cursor, limit }),
        );
      },
      RunListSchema,
      {
        operation: "listRuns",
        route: "/projects/{project}/runs",
        requiresProject: explicitProjectReference === undefined,
      },
    );
  }

  /** Read one canonical run. */
  async get(runId: string): Promise<Run> {
    const id = validateIdentifier(runId, "run ID");
    return await this.requestJson(`/runs/${encodeURIComponent(id)}`, RunSchema, {
      operation: "getRun",
      route: "/runs/{run_id}",
    });
  }

  /** List canonical events emitted by one run. */
  async events(runId: string, options: ListRunEventsOptions = {}): Promise<RunEventList> {
    const id = validateIdentifier(runId, "run ID");
    const values = snapshotProperties(options, "Run event list options", [
      "afterEventId",
      "limit",
    ]);
    const afterEventId = validateOptionalInteger(values.afterEventId, "afterEventId", 0);
    const limit = validateOptionalInteger(values.limit, "limit", 1);
    return await this.requestJson(
      withQuery(
        `/runs/${encodeURIComponent(id)}/events`,
        toQueryParams({ after_event_id: afterEventId, limit }),
      ),
      RunEventListSchema,
      { operation: "listRunEvents", route: "/runs/{run_id}/events" },
    );
  }

  /** Request cancellation of a non-terminal run. */
  async cancel(runId: string): Promise<CancelRunResponse> {
    const id = validateIdentifier(runId, "run ID");
    return await this.requestJson(
      `/runs/${encodeURIComponent(id)}/cancel`,
      CancelRunResponseSchema,
      { method: "POST", operation: "cancelRun", route: "/runs/{run_id}/cancel" },
    );
  }

  /** Create a knowledge-ingest run for upload identifiers. */
  private ingestKnowledgeByUploadIds(
    input: KnowledgeIngestByUploadIdsInput,
  ): Promise<CreateRunResponse> {
    const values = this.snapshotKnowledgeInput(input, "uploadIds");
    const uploadIds = validateStringArray(values.uploadIds, "uploadIds", "upload ID");
    return this.createKnowledgeIngestRun(values, { upload_ids: uploadIds });
  }

  /** Create a knowledge-ingest run for uploaded paths. */
  private ingestKnowledgeByUploadPaths(
    input: KnowledgeIngestByUploadPathsInput,
  ): Promise<CreateRunResponse> {
    const values = this.snapshotKnowledgeInput(input, "uploadPaths");
    const uploadPaths = validateStringArray(
      values.uploadPaths,
      "uploadPaths",
      "upload path",
      "text",
    );
    return this.createKnowledgeIngestRun(values, { paths: uploadPaths });
  }

  /** Create a knowledge-ingest run for an uploaded path prefix. */
  private ingestKnowledgeByUploadPrefix(
    input: KnowledgeIngestByUploadPrefixInput,
  ): Promise<CreateRunResponse> {
    const values = this.snapshotKnowledgeInput(input, "uploadPrefix");
    const uploadPrefix = validateString(values.uploadPrefix, "uploadPrefix");
    return this.createKnowledgeIngestRun(values, { path_prefix: uploadPrefix });
  }

  /** Snapshot the common knowledge-ingest input fields once. */
  private snapshotKnowledgeInput(
    input: unknown,
    knowledgeProperty: "uploadIds" | "uploadPaths" | "uploadPrefix",
  ): Record<string, unknown> {
    return snapshotProperties(input, "Knowledge ingest input", [
      "projectId",
      "publicId",
      "parentRunId",
      "name",
      "batchId",
      "timeoutSeconds",
      "backoffLimit",
      "runtimeTargetKind",
      "runtimeTargetEnvironmentId",
      "runtimeTargetBranchId",
      knowledgeProperty,
    ]);
  }

  /** Delegate validated knowledge input to the canonical task-run API. */
  private createKnowledgeIngestRun(
    values: Record<string, unknown>,
    config: Record<string, unknown>,
  ): Promise<CreateRunResponse> {
    return this.createTaskRun({
      projectId: values.projectId as string,
      publicId: values.publicId as string | undefined,
      parentRunId: values.parentRunId as string | undefined,
      name: values.name === undefined ? DEFAULT_KNOWLEDGE_INGEST_RUN_NAME : values.name as string,
      target: "task:knowledge-ingest",
      batchId: values.batchId as string | undefined,
      config,
      timeoutSeconds: values.timeoutSeconds as number | undefined,
      backoffLimit: values.backoffLimit as number | undefined,
      runtimeTargetKind: values.runtimeTargetKind as RunRuntimeTargetKind | undefined,
      runtimeTargetEnvironmentId: values.runtimeTargetEnvironmentId as string | null | undefined,
      runtimeTargetBranchId: values.runtimeTargetBranchId as string | null | undefined,
    });
  }

  /** Resolve one immutable auth, routing, and API URL snapshot. */
  private resolveOperationContext(requiresProject: boolean): Readonly<RunsOperationContext> {
    let providedIdentity: Readonly<RunsRequestIdentity> | undefined;
    if (this.config.requestIdentityProvider) {
      try {
        const provided = this.config.requestIdentityProvider();
        if (provided !== undefined) providedIdentity = snapshotRequestIdentity(provided);
      } catch (error) {
        if (error instanceof VeryfrontError && error.slug === "api-client-error") {
          throw error;
        }
        throw invalidRunsInput("Unable to resolve the Runs request identity", 401);
      }
    }

    const configuredAuthToken = providedIdentity?.authToken ?? this.requestToken ??
      this.config.authToken;
    const configuredProjectReference = providedIdentity?.projectReference ??
      this.requestProjectReference ?? this.config.projectReference;
    const needsBootstrap = this.config.apiUrl === undefined || configuredAuthToken === undefined ||
      (requiresProject && configuredProjectReference === undefined);
    const bootstrap = needsBootstrap ? getVeryfrontCloudBootstrap() : undefined;
    const authToken = configuredAuthToken ?? bootstrap?.apiToken;
    if (!authToken) {
      throw invalidRunsInput(
        "Runs auth not configured. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass authToken explicitly.",
        401,
      );
    }

    const projectReference = configuredProjectReference ??
      (requiresProject ? bootstrap?.projectSlug : undefined);
    return Object.freeze({
      apiUrl: this.config.apiUrl ?? normalizeApiUrl(bootstrap?.apiBaseUrl),
      authToken: validateAuthToken(authToken),
      projectReference: projectReference === undefined
        ? undefined
        : validateIdentifier(projectReference, "Runs project reference"),
    });
  }

  /** Execute a bounded request and validate its response schema. */
  private async requestJson<T>(
    path: string | ((context: Readonly<RunsOperationContext>) => string),
    schema: Schema<T>,
    options: RequestJsonOptions,
  ): Promise<T> {
    const context = this.resolveOperationContext(options.requiresProject === true);
    const resolvedPath = typeof path === "function" ? path(context) : path;
    const raw = await requestWithRetry(
      joinApiPath(context.apiUrl, resolvedPath),
      context.authToken,
      this.config.retry,
      {
        ...this.config.requestPolicy,
        method: options.method,
        body: options.body === undefined ? undefined : serializeJsonBody(options.body),
        telemetry: { operation: options.operation, route: options.route },
      },
    );
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
    throw API_CLIENT_ERROR.create({
      detail: "Veryfront API returned an invalid runs response",
      status: 502,
      context: {
        details: { operation: options.operation, issueCount: result.issues.length },
      },
    });
  }
}

/** Create a runs client. */
export function createRunsClient(config?: VeryfrontRunsClientConfig): VeryfrontRunsClient {
  return new VeryfrontRunsClient(config);
}
