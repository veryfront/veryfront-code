import { getVeryfrontCloudBootstrap } from "#veryfront/platform/cloud/resolver.ts";
import {
  requestWithRetry,
  type RetryConfig,
} from "#veryfront/platform/adapters/veryfront-api-client/retry-handler.ts";
import { API_CLIENT_ERROR } from "#veryfront/platform/adapters/veryfront-api-client/types.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { normalizeVeryfrontApiRetryConfig } from "#veryfront/utils/config-resource-limits.ts";
import {
  normalizeRunsApiBaseUrl,
  optionalCanonicalString,
  optionalJsonObject,
  optionalOpaqueIdentifier,
  optionalSafeInteger,
  requireAuthToken,
  requireCanonicalString,
  requireCanonicalStringArray,
  requireObject,
  requireOpaqueIdentifier,
  requireOpaqueIdentifierArray,
  requireRunTarget,
  runtimeTargetBody,
  serializeRunsRequestBody,
  withoutUndefined,
} from "./request-validation.ts";
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
  type RunRuntimeTargetKind as CanonicalRunRuntimeTargetKind,
  RunSchema,
} from "./schemas.ts";

const DEFAULT_KNOWLEDGE_INGEST_RUN_NAME = "Ingest knowledge";

/** Configuration used by the Veryfront runs client. */
export interface VeryfrontRunsClientConfig {
  /**
   * Absolute HTTP(S) API base URL. Credentials, query strings, and fragments
   * are rejected; a trailing slash is normalized.
   */
  apiUrl?: string;
  /** Bearer credential used when request-scoped Veryfront auth is unavailable. */
  authToken?: string;
  /** Default project slug or opaque project ID used by list(). */
  projectReference?: string;
  /** Retry policy, with 0 through 9 retries after the initial request. */
  retry?: Partial<RetryConfig>;
}

/** Immutable credentials and project routing for an isolated runs client. */
export interface VeryfrontRunsRequestContext {
  authToken?: string;
  projectReference?: string;
}

/** Options accepted by project-scoped run requests. */
export interface ProjectScopedOptions {
  /** Project slug or opaque project ID overriding the client default. */
  projectReference?: string;
}

/** Runtime target for a task, workflow, or eval run. */
export type { RunRuntimeTargetKind } from "./schemas.ts";

/** Runtime target fields accepted by run creation APIs. */
export interface RunRuntimeTargetOptions {
  /** Runtime target category governing which target identifier is required. */
  runtimeTargetKind?: CanonicalRunRuntimeTargetKind;
  /** Required only when runtimeTargetKind is "environment". */
  runtimeTargetEnvironmentId?: string | null;
  /** Required only when runtimeTargetKind is "preview_branch". */
  runtimeTargetBranchId?: string | null;
}

/** Identity fields shared by task, workflow, and eval run creation. */
export interface RunCreateBaseInput {
  /** Owning project ID. */
  projectId: string;
  /** Optional caller-controlled public identifier. */
  publicId?: string;
  /** Optional parent durable-run identifier. */
  parentRunId?: string;
}

/** Input payload for creating a task run. */
export interface CreateTaskRunInput extends RunCreateBaseInput, RunRuntimeTargetOptions {
  name?: string;
  target: `task:${string}`;
  batchId?: string;
  config?: Record<string, unknown>;
  timeoutSeconds?: number;
  backoffLimit?: number;
}

/** Input payload for creating a workflow run. */
export interface CreateWorkflowRunInput extends RunCreateBaseInput, RunRuntimeTargetOptions {
  workflowId: string;
  target: `workflow:${string}`;
  input?: Record<string, unknown>;
  startMode?: string;
}

/** Input payload for creating an eval run. */
export interface CreateEvalRunInput extends RunCreateBaseInput, RunRuntimeTargetOptions {
  target: `eval:${string}`;
  input?: Record<string, unknown>;
  config?: Record<string, unknown>;
  startMode?: string;
}

/** Input payload for knowledge ingest by upload IDs. */
export interface KnowledgeIngestByUploadIdsInput
  extends Omit<CreateTaskRunInput, "target" | "config"> {
  uploadIds: string[];
}

/** Input payload for knowledge ingest by upload paths. */
export interface KnowledgeIngestByUploadPathsInput
  extends Omit<CreateTaskRunInput, "target" | "config"> {
  uploadPaths: string[];
}

/** Input payload for knowledge ingest by upload prefix. */
export interface KnowledgeIngestByUploadPrefixInput
  extends Omit<CreateTaskRunInput, "target" | "config"> {
  uploadPrefix: string;
}

/** Pagination and routing options for listing project runs. */
export interface ListRunsOptions extends ProjectScopedOptions {
  /** Opaque pagination cursor returned by the API. */
  cursor?: string;
  /** Positive safe-integer page size. */
  limit?: number;
}

/** Pagination options for reading a run's canonical event stream. */
export interface ListRunEventsOptions {
  /** Return events after this non-negative event ID. */
  afterEventId?: number;
  /** Positive safe-integer page size. */
  limit?: number;
}

type NamespaceMethod<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>;

function toQueryParams(values: Record<string, string | number | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value != null) {
      params.set(key, String(value));
    }
  }
  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length > 0 ? `${path}?${query}` : path;
}

/** Public client for canonical durable runs. */
export class VeryfrontRunsClient {
  private readonly retryConfig: RetryConfig;
  private readonly apiUrl?: string;
  private readonly authToken?: string;
  private readonly projectReference?: string;
  private requestToken?: string;
  private requestProjectReference?: string;

  readonly knowledge: {
    ingestByUploadIds: NamespaceMethod<[KnowledgeIngestByUploadIdsInput], CreateRunResponse>;
    ingestByUploadPaths: NamespaceMethod<[KnowledgeIngestByUploadPathsInput], CreateRunResponse>;
    ingestByUploadPrefix: NamespaceMethod<[KnowledgeIngestByUploadPrefixInput], CreateRunResponse>;
  };

  constructor(config: VeryfrontRunsClientConfig = {}) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new TypeError("Runs client config must be an object");
    }
    this.retryConfig = normalizeVeryfrontApiRetryConfig(config.retry);
    this.apiUrl = config.apiUrl === undefined ? undefined : normalizeRunsApiBaseUrl(config.apiUrl);
    this.authToken = config.authToken === undefined
      ? undefined
      : requireAuthToken(config.authToken);
    this.projectReference = config.projectReference === undefined
      ? undefined
      : requireOpaqueIdentifier(config.projectReference, "projectReference");

    this.knowledge = {
      ingestByUploadIds: (input) => this.ingestKnowledgeByUploadIds(input),
      ingestByUploadPaths: (input) => this.ingestKnowledgeByUploadPaths(input),
      ingestByUploadPrefix: (input) => this.ingestKnowledgeByUploadPrefix(input),
    };
  }

  /**
   * Create a new client with isolated request credentials and project routing.
   * Prefer this over mutating a client shared by concurrent requests.
   */
  withRequestContext(context: VeryfrontRunsRequestContext): VeryfrontRunsClient {
    requireObject(context, "Runs request context");
    const authToken = context.authToken === undefined
      ? this.authToken
      : requireAuthToken(context.authToken, "request authToken");
    const projectReference = context.projectReference === undefined
      ? this.projectReference
      : requireOpaqueIdentifier(context.projectReference, "request projectReference");
    return new VeryfrontRunsClient({
      apiUrl: this.apiUrl,
      authToken,
      projectReference,
      retry: this.retryConfig,
    });
  }

  /** @deprecated Prefer withRequestContext() for concurrent request isolation. */
  setRequestToken(token: string): void {
    this.requestToken = requireAuthToken(token, "request token");
  }

  /** @deprecated Prefer withRequestContext() for concurrent request isolation. */
  clearRequestToken(): void {
    this.requestToken = undefined;
  }

  /** @deprecated Prefer withRequestContext() for concurrent request isolation. */
  setProjectReference(projectReference: string): void {
    this.requestProjectReference = requireOpaqueIdentifier(
      projectReference,
      "request projectReference",
    );
  }

  /** @deprecated Prefer withRequestContext() for concurrent request isolation. */
  clearProjectReference(): void {
    this.requestProjectReference = undefined;
  }

  createTaskRun(input: CreateTaskRunInput): Promise<CreateRunResponse> {
    requireObject(input, "Task run input");
    const {
      projectId,
      publicId,
      parentRunId,
      name,
      target,
      batchId,
      config,
      timeoutSeconds,
      backoffLimit,
      ...runtimeTarget
    } = input;
    const normalizedProjectId = requireOpaqueIdentifier(projectId, "projectId");
    const normalizedPublicId = optionalOpaqueIdentifier(publicId, "publicId");
    const normalizedParentRunId = optionalOpaqueIdentifier(parentRunId, "parentRunId");
    const normalizedName = optionalCanonicalString(name, "name");
    const normalizedTarget = requireRunTarget(target, "task:");
    const normalizedBatchId = optionalOpaqueIdentifier(batchId, "batchId");
    const normalizedTimeoutSeconds = optionalSafeInteger(
      timeoutSeconds,
      "timeoutSeconds",
      1,
    );
    const normalizedBackoffLimit = optionalSafeInteger(backoffLimit, "backoffLimit", 0);
    const normalizedConfig = optionalJsonObject(config, "config");

    return this.requestJson("/runs", CreateRunResponseSchema, {
      method: "POST",
      body: withoutUndefined({
        kind: "task",
        owner: { kind: "project", id: normalizedProjectId },
        public_id: normalizedPublicId,
        parent_run_id: normalizedParentRunId,
        request: withoutUndefined({
          name: normalizedName,
          target: normalizedTarget,
          batch_id: normalizedBatchId,
          ...runtimeTargetBody(runtimeTarget),
          config: normalizedConfig,
          timeout_seconds: normalizedTimeoutSeconds,
          backoff_limit: normalizedBackoffLimit,
        }),
      }),
    });
  }

  createWorkflowRun(input: CreateWorkflowRunInput): Promise<CreateRunResponse> {
    requireObject(input, "Workflow run input");
    const {
      projectId,
      publicId,
      parentRunId,
      workflowId,
      target,
      input: workflowInput,
      startMode,
      ...runtimeTarget
    } = input;
    const normalizedProjectId = requireOpaqueIdentifier(projectId, "projectId");
    const normalizedPublicId = optionalOpaqueIdentifier(publicId, "publicId");
    const normalizedParentRunId = optionalOpaqueIdentifier(parentRunId, "parentRunId");
    const normalizedWorkflowId = requireOpaqueIdentifier(workflowId, "workflowId");
    const normalizedTarget = requireRunTarget(target, "workflow:");
    const normalizedStartMode = optionalCanonicalString(startMode, "startMode");
    const normalizedWorkflowInput = optionalJsonObject(workflowInput, "input");

    return this.requestJson("/runs", CreateRunResponseSchema, {
      method: "POST",
      body: withoutUndefined({
        kind: "workflow",
        owner: { kind: "project", id: normalizedProjectId },
        public_id: normalizedPublicId,
        parent_run_id: normalizedParentRunId,
        request: withoutUndefined({
          workflow_id: normalizedWorkflowId,
          target: normalizedTarget,
          ...runtimeTargetBody(runtimeTarget),
          input: normalizedWorkflowInput,
          start_mode: normalizedStartMode,
        }),
      }),
    });
  }

  createEvalRun(input: CreateEvalRunInput): Promise<CreateRunResponse> {
    requireObject(input, "Eval run input");
    const {
      projectId,
      publicId,
      parentRunId,
      target,
      input: evalInput,
      config,
      startMode,
      ...runtimeTarget
    } = input;
    const normalizedProjectId = requireOpaqueIdentifier(projectId, "projectId");
    const normalizedPublicId = optionalOpaqueIdentifier(publicId, "publicId");
    const normalizedParentRunId = optionalOpaqueIdentifier(parentRunId, "parentRunId");
    const normalizedTarget = requireRunTarget(target, "eval:");
    const normalizedStartMode = optionalCanonicalString(startMode, "startMode");
    const normalizedEvalInput = optionalJsonObject(evalInput, "input");
    const normalizedConfig = optionalJsonObject(config, "config");

    return this.requestJson("/runs", CreateRunResponseSchema, {
      method: "POST",
      body: withoutUndefined({
        kind: "eval",
        owner: { kind: "project", id: normalizedProjectId },
        public_id: normalizedPublicId,
        parent_run_id: normalizedParentRunId,
        request: withoutUndefined({
          target: normalizedTarget,
          ...runtimeTargetBody(runtimeTarget),
          input: normalizedEvalInput,
          config: normalizedConfig,
          start_mode: normalizedStartMode,
        }),
      }),
    });
  }

  async list(options: ListRunsOptions = {}): Promise<RunList> {
    requireObject(options, "List runs options");
    const { projectReference, cursor, limit } = options;
    const normalizedCursor = optionalOpaqueIdentifier(cursor, "cursor");
    const normalizedLimit = optionalSafeInteger(limit, "limit", 1);
    return await this.requestJson(
      withQuery(
        `/projects/${encodeURIComponent(this.resolveProjectReference(projectReference))}/runs`,
        toQueryParams({ cursor: normalizedCursor, limit: normalizedLimit }),
      ),
      RunListSchema,
    );
  }

  get(runId: string): Promise<Run> {
    const normalizedRunId = requireOpaqueIdentifier(runId, "runId");
    return this.requestJson(`/runs/${encodeURIComponent(normalizedRunId)}`, RunSchema);
  }

  events(runId: string, options: ListRunEventsOptions = {}): Promise<RunEventList> {
    requireObject(options, "List run events options");
    const { afterEventId, limit } = options;
    const normalizedRunId = requireOpaqueIdentifier(runId, "runId");
    const normalizedAfterEventId = optionalSafeInteger(afterEventId, "afterEventId", 0);
    const normalizedLimit = optionalSafeInteger(limit, "limit", 1);
    return this.requestJson(
      withQuery(
        `/runs/${encodeURIComponent(normalizedRunId)}/events`,
        toQueryParams({ after_event_id: normalizedAfterEventId, limit: normalizedLimit }),
      ),
      RunEventListSchema,
    );
  }

  cancel(runId: string): Promise<CancelRunResponse> {
    const normalizedRunId = requireOpaqueIdentifier(runId, "runId");
    return this.requestJson(
      `/runs/${encodeURIComponent(normalizedRunId)}/cancel`,
      CancelRunResponseSchema,
      {
        method: "POST",
      },
    );
  }

  private ingestKnowledgeByUploadIds(
    input: KnowledgeIngestByUploadIdsInput,
  ): Promise<CreateRunResponse> {
    requireObject(input, "Knowledge ingest input");
    const { uploadIds, ...options } = input;
    const normalizedUploadIds = requireOpaqueIdentifierArray(uploadIds, "uploadIds");
    return this.createTaskRun({
      ...options,
      name: options.name ?? DEFAULT_KNOWLEDGE_INGEST_RUN_NAME,
      target: "task:knowledge-ingest",
      config: { upload_ids: normalizedUploadIds },
    });
  }

  private ingestKnowledgeByUploadPaths(
    input: KnowledgeIngestByUploadPathsInput,
  ): Promise<CreateRunResponse> {
    requireObject(input, "Knowledge ingest input");
    const { uploadPaths, ...options } = input;
    const normalizedUploadPaths = requireCanonicalStringArray(uploadPaths, "uploadPaths");
    return this.createTaskRun({
      ...options,
      name: options.name ?? DEFAULT_KNOWLEDGE_INGEST_RUN_NAME,
      target: "task:knowledge-ingest",
      config: { paths: normalizedUploadPaths },
    });
  }

  private ingestKnowledgeByUploadPrefix(
    input: KnowledgeIngestByUploadPrefixInput,
  ): Promise<CreateRunResponse> {
    requireObject(input, "Knowledge ingest input");
    const { uploadPrefix, ...options } = input;
    const normalizedUploadPrefix = requireCanonicalString(uploadPrefix, "uploadPrefix");
    return this.createTaskRun({
      ...options,
      name: options.name ?? DEFAULT_KNOWLEDGE_INGEST_RUN_NAME,
      target: "task:knowledge-ingest",
      config: { path_prefix: normalizedUploadPrefix },
    });
  }

  private resolveApiUrl(): string {
    return this.apiUrl ??
      normalizeRunsApiBaseUrl(getVeryfrontCloudBootstrap().apiBaseUrl);
  }

  private resolveAuthToken(): string {
    const token = this.requestToken ?? this.authToken ??
      getVeryfrontCloudBootstrap().apiToken;
    if (token) {
      return requireAuthToken(token, "Runs auth token");
    }
    throw API_CLIENT_ERROR.create({
      detail:
        "Runs auth not configured. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass authToken explicitly.",
      status: 401,
    });
  }

  private resolveProjectReference(projectReference?: string): string {
    const resolved = projectReference ?? this.requestProjectReference ??
      this.projectReference ??
      getVeryfrontCloudBootstrap().projectSlug;
    if (resolved) {
      return requireOpaqueIdentifier(resolved, "projectReference");
    }
    throw API_CLIENT_ERROR.create({
      detail:
        "Runs project reference not configured. Pass projectReference explicitly, set VERYFRONT_PROJECT_SLUG, or provide request-scoped Veryfront project context.",
      status: 400,
    });
  }

  private async requestJson<T>(
    path: string,
    schema: Schema<T>,
    options: {
      method?: "GET" | "POST";
      body?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    const raw = await requestWithRetry(
      `${this.resolveApiUrl()}${path}`,
      this.resolveAuthToken(),
      this.retryConfig,
      {
        method: options.method,
        body: options.body == null ? undefined : serializeRunsRequestBody(options.body),
      },
    );
    return schema.parse(raw);
  }
}

/** Create a runs client. */
export function createRunsClient(config?: VeryfrontRunsClientConfig): VeryfrontRunsClient {
  return new VeryfrontRunsClient(config);
}
