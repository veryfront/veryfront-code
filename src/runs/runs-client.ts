import {
  getVeryfrontCloudBootstrap,
  getVeryfrontCloudHostBootstrap,
} from "#veryfront/platform/cloud/resolver.ts";
import {
  requestWithRetry,
  type RetryConfig,
} from "#veryfront/platform/adapters/veryfront-api-client/retry-handler.ts";
import { API_CLIENT_ERROR } from "#veryfront/platform/adapters/veryfront-api-client/types.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { ResolvedTriggerTarget } from "#veryfront/trigger/target.ts";
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
  RunSchema,
  ScheduleReferenceListSchema,
  type ScheduleRunCreateResponse,
  ScheduleRunCreateResponseSchema,
} from "./schemas.ts";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;
const DEFAULT_KNOWLEDGE_INGEST_RUN_NAME = "Ingest knowledge";
const GENERATED_SCHEDULE_RUN_IDEMPOTENCY_PREFIX = "schedule-run";
const applyIntrinsic = Reflect.apply;
const stringReplace = String.prototype.replace;
const NativeURL = URL;
const urlOriginGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "origin")?.get;

function readUrlOrigin(url: URL): string {
  if (!urlOriginGetter) throw new TypeError("Native URL origin getter is unavailable");
  return applyIntrinsic(urlOriginGetter, url, []) as string;
}

/** Configuration used by the Veryfront runs client. */
export interface VeryfrontRunsClientConfig {
  apiUrl?: string;
  authToken?: string;
  projectReference?: string;
  retry?: Partial<RetryConfig>;
}

/** Options accepted by project-scoped run requests. */
export interface ProjectScopedOptions {
  projectReference?: string;
}

/** Runtime target for a task, workflow, or eval run. */
export type RunRuntimeTargetKind = "main_branch" | "environment" | "preview_branch";

/** Runtime target fields accepted by run creation APIs. */
export interface RunRuntimeTargetOptions {
  runtimeTargetKind?: RunRuntimeTargetKind;
  runtimeTargetEnvironmentId?: string | null;
  runtimeTargetBranchId?: string | null;
}

export interface RunCreateBaseInput {
  projectId: string;
  publicId?: string;
  parentRunId?: string;
}

export interface CreateTaskRunInput extends RunCreateBaseInput, RunRuntimeTargetOptions {
  name?: string;
  target: `task:${string}`;
  batchId?: string;
  config?: Record<string, unknown>;
  timeoutSeconds?: number;
  backoffLimit?: number;
}

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

/** Input for triggering one persisted schedule by its canonical UUID. */
export interface CreateScheduleRunInput extends ProjectScopedOptions {
  scheduleId: string;
  runName?: string;
  idempotencyKey?: string;
}

/** Input for resolving and triggering one pushed source-defined schedule. */
export interface CreateScheduleRunFromSourceInput extends ProjectScopedOptions {
  sourceTriggerId: string;
  runName?: string;
  idempotencyKey?: string;
}

/** Cloud schedule metadata returned with an accepted source-triggered run. */
export interface CreateScheduleRunFromSourceResult {
  scheduleRun: ScheduleRunCreateResponse;
  timeoutSeconds: number;
  target: ResolvedTriggerTarget;
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

export interface ListRunsOptions extends ProjectScopedOptions {
  cursor?: string;
  limit?: number;
}

export interface ListRunEventsOptions {
  afterEventId?: number;
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

function runtimeTargetBody(input: RunRuntimeTargetOptions): Record<string, unknown> {
  return {
    runtime_target_kind: input.runtimeTargetKind,
    runtime_target_environment_id: input.runtimeTargetEnvironmentId,
    runtime_target_branch_id: input.runtimeTargetBranchId,
  };
}

/** Public client for canonical durable runs. */
export class VeryfrontRunsClient {
  private readonly retryConfig: RetryConfig;
  private requestToken?: string;
  private requestProjectReference?: string;

  readonly knowledge: {
    ingestByUploadIds: NamespaceMethod<[KnowledgeIngestByUploadIdsInput], CreateRunResponse>;
    ingestByUploadPaths: NamespaceMethod<[KnowledgeIngestByUploadPathsInput], CreateRunResponse>;
    ingestByUploadPrefix: NamespaceMethod<[KnowledgeIngestByUploadPrefixInput], CreateRunResponse>;
  };

  constructor(private readonly config: VeryfrontRunsClientConfig = {}) {
    this.retryConfig = {
      maxRetries: config.retry?.maxRetries ?? DEFAULT_MAX_RETRIES,
      initialDelay: config.retry?.initialDelay ?? DEFAULT_INITIAL_RETRY_DELAY_MS,
      maxDelay: config.retry?.maxDelay ?? DEFAULT_MAX_RETRY_DELAY_MS,
    };

    this.knowledge = {
      ingestByUploadIds: (input) => this.ingestKnowledgeByUploadIds(input),
      ingestByUploadPaths: (input) => this.ingestKnowledgeByUploadPaths(input),
      ingestByUploadPrefix: (input) => this.ingestKnowledgeByUploadPrefix(input),
    };
  }

  setRequestToken(token: string): void {
    this.requestToken = token;
  }

  clearRequestToken(): void {
    this.requestToken = undefined;
  }

  setProjectReference(projectReference: string): void {
    this.requestProjectReference = projectReference;
  }

  clearProjectReference(): void {
    this.requestProjectReference = undefined;
  }

  createTaskRun(input: CreateTaskRunInput): Promise<CreateRunResponse> {
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

    return this.requestJson("/runs", CreateRunResponseSchema, {
      method: "POST",
      body: {
        kind: "task",
        owner: { kind: "project", id: projectId },
        public_id: publicId,
        parent_run_id: parentRunId,
        request: {
          name,
          target,
          batch_id: batchId,
          ...runtimeTargetBody(runtimeTarget),
          config,
          timeout_seconds: timeoutSeconds,
          backoff_limit: backoffLimit,
        },
      },
    });
  }

  createWorkflowRun(input: CreateWorkflowRunInput): Promise<CreateRunResponse> {
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

    return this.requestJson("/runs", CreateRunResponseSchema, {
      method: "POST",
      body: {
        kind: "workflow",
        owner: { kind: "project", id: projectId },
        public_id: publicId,
        parent_run_id: parentRunId,
        request: {
          workflow_id: workflowId,
          target,
          ...runtimeTargetBody(runtimeTarget),
          input: workflowInput,
          start_mode: startMode,
        },
      },
    });
  }

  createEvalRun(input: CreateEvalRunInput): Promise<CreateRunResponse> {
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

    return this.requestJson("/runs", CreateRunResponseSchema, {
      method: "POST",
      body: {
        kind: "eval",
        owner: { kind: "project", id: projectId },
        public_id: publicId,
        parent_run_id: parentRunId,
        request: {
          target,
          ...runtimeTargetBody(runtimeTarget),
          input: evalInput,
          config,
          start_mode: startMode,
        },
      },
    });
  }

  createScheduleRun(input: CreateScheduleRunInput): Promise<ScheduleRunCreateResponse> {
    const { scheduleId, projectReference, runName, idempotencyKey } = input;
    const project = this.resolveProjectReference(projectReference);
    const resolvedIdempotencyKey = idempotencyKey ??
      `${GENERATED_SCHEDULE_RUN_IDEMPOTENCY_PREFIX}:${crypto.randomUUID()}`;
    return this.requestJson(
      `/projects/${encodeURIComponent(project)}/schedules/${encodeURIComponent(scheduleId)}/runs`,
      ScheduleRunCreateResponseSchema,
      {
        method: "POST",
        body: {
          run_name: runName,
          idempotency_key: resolvedIdempotencyKey,
        },
      },
    );
  }

  async createScheduleRunFromSource(
    input: CreateScheduleRunFromSourceInput,
  ): Promise<CreateScheduleRunFromSourceResult> {
    const projectReference = this.resolveProjectReference(input.projectReference);
    const listed = await this.requestJson(
      withQuery(
        `/projects/${encodeURIComponent(projectReference)}/schedules`,
        toQueryParams({
          status: "active",
          source_trigger_id: input.sourceTriggerId,
        }),
      ),
      ScheduleReferenceListSchema,
    );
    const schedule = listed.schedules.find((candidate) =>
      candidate.status === "active" &&
      candidate.definition_source === "source" &&
      candidate.source_trigger_id === input.sourceTriggerId
    );
    if (!schedule) {
      throw API_CLIENT_ERROR.create({
        detail:
          `Active source schedule "${input.sourceTriggerId}" not found in project "${projectReference}". Push the source schedule before running it remotely.`,
        status: 404,
      });
    }

    const scheduleRun = await this.createScheduleRun({
      scheduleId: schedule.id,
      projectReference,
      runName: input.runName ?? schedule.name,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      scheduleRun,
      timeoutSeconds: schedule.timeout_seconds,
      target: schedule.target,
    };
  }

  async list(options: ListRunsOptions = {}): Promise<RunList> {
    const { projectReference, cursor, limit } = options;
    return await this.requestJson(
      withQuery(
        `/projects/${encodeURIComponent(this.resolveProjectReference(projectReference))}/runs`,
        toQueryParams({ cursor, limit }),
      ),
      RunListSchema,
    );
  }

  get(runId: string): Promise<Run> {
    return this.requestJson(`/runs/${encodeURIComponent(runId)}`, RunSchema);
  }

  events(runId: string, options: ListRunEventsOptions = {}): Promise<RunEventList> {
    const { afterEventId, limit } = options;
    return this.requestJson(
      withQuery(
        `/runs/${encodeURIComponent(runId)}/events`,
        toQueryParams({ after_event_id: afterEventId, limit }),
      ),
      RunEventListSchema,
    );
  }

  cancel(runId: string): Promise<CancelRunResponse> {
    return this.requestJson(`/runs/${encodeURIComponent(runId)}/cancel`, CancelRunResponseSchema, {
      method: "POST",
    });
  }

  private ingestKnowledgeByUploadIds(
    input: KnowledgeIngestByUploadIdsInput,
  ): Promise<CreateRunResponse> {
    const { uploadIds, ...options } = input;
    return this.createTaskRun({
      ...options,
      name: options.name ?? DEFAULT_KNOWLEDGE_INGEST_RUN_NAME,
      target: "task:knowledge-ingest",
      config: { upload_ids: uploadIds },
    });
  }

  private ingestKnowledgeByUploadPaths(
    input: KnowledgeIngestByUploadPathsInput,
  ): Promise<CreateRunResponse> {
    const { uploadPaths, ...options } = input;
    return this.createTaskRun({
      ...options,
      name: options.name ?? DEFAULT_KNOWLEDGE_INGEST_RUN_NAME,
      target: "task:knowledge-ingest",
      config: { paths: uploadPaths },
    });
  }

  private ingestKnowledgeByUploadPrefix(
    input: KnowledgeIngestByUploadPrefixInput,
  ): Promise<CreateRunResponse> {
    const { uploadPrefix, ...options } = input;
    return this.createTaskRun({
      ...options,
      name: options.name ?? DEFAULT_KNOWLEDGE_INGEST_RUN_NAME,
      target: "task:knowledge-ingest",
      config: { path_prefix: uploadPrefix },
    });
  }

  private resolveConnection(): { apiUrl: string; authToken: string } {
    if (this.config.apiUrl && !this.config.authToken) {
      throw API_CLIENT_ERROR.create({
        detail:
          "Runs apiUrl requires an explicit authToken. A caller-selected endpoint cannot use request- or host-owned credentials.",
        status: 401,
      });
    }
    if (this.config.apiUrl && this.config.authToken) {
      return { apiUrl: this.config.apiUrl, authToken: this.config.authToken };
    }

    const host = getVeryfrontCloudHostBootstrap();
    if (this.config.authToken) {
      return { apiUrl: host.apiBaseUrl, authToken: this.config.authToken };
    }
    if (this.requestToken) {
      return { apiUrl: host.apiBaseUrl, authToken: this.requestToken };
    }

    const bootstrap = getVeryfrontCloudBootstrap();
    if (bootstrap.apiToken) {
      return { apiUrl: bootstrap.apiBaseUrl, authToken: bootstrap.apiToken };
    }
    throw API_CLIENT_ERROR.create({
      detail:
        "Runs auth not configured. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass authToken explicitly.",
      status: 401,
    });
  }

  private resolveProjectReference(projectReference?: string): string {
    const resolved = projectReference ?? this.requestProjectReference ??
      this.config.projectReference ??
      getVeryfrontCloudBootstrap().projectSlug;
    if (resolved) {
      return resolved;
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
    const { apiUrl, authToken } = this.resolveConnection();
    const normalizedApiUrl = applyIntrinsic(stringReplace, apiUrl, [/\/+$/, ""]) as string;
    const apiOrigin = readUrlOrigin(new NativeURL(normalizedApiUrl));
    const raw = await requestWithRetry(
      `${normalizedApiUrl}${path}`,
      authToken,
      this.retryConfig,
      {
        method: options.method,
        body: options.body == null ? undefined : JSON.stringify(options.body),
      },
      {
        authorizeUrl: (target) => {
          if (readUrlOrigin(target) !== apiOrigin) {
            throw new Error("Runs request blocked: destination origin is not authorized");
          }
        },
      },
    );
    return schema.parse(raw);
  }
}

/** Create a runs client. */
export function createRunsClient(config?: VeryfrontRunsClientConfig): VeryfrontRunsClient {
  return new VeryfrontRunsClient(config);
}
