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
import { INVALID_ARGUMENT } from "#veryfront/errors/index.ts";
import { getProjectSchema } from "#veryfront/platform/adapters/veryfront-api-client/schemas/index.ts";
import type { ResolvedTriggerTarget } from "#veryfront/trigger/target.ts";
import {
  createRunsSdk,
  type RunsCallOptions,
  type RunsOutput,
  type RunsSdk,
} from "./target/client.ts";
import {
  type CancelRunResponse,
  type CreateRunResponse,
  type Run,
  type RunEventList,
  type RunList,
  RunListSchema,
  RunSchema,
  ScheduleReferenceListSchema,
  type ScheduleRunCreateResponse,
} from "./schemas.ts";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;
const DEFAULT_KNOWLEDGE_INGEST_RUN_NAME = "Ingest knowledge";
const GENERATED_SCHEDULE_RUN_IDEMPOTENCY_PREFIX = "schedule-run";
// Captured before project code runs. `requestJson` normalizes the API base a
// host-owned credential is attached to, so a served project that replaces
// `String.prototype.replace`, `URL`, or the `origin` getter must not be able to
// rewrite that destination and receive the Bearer token.
const applyIntrinsic = Reflect.apply;
const stringReplace = String.prototype.replace;
const NativeURL = URL;
const urlOriginGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "origin")?.get;

/** Read `origin` through the captured getter so a replaced accessor cannot lie. */
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
  /** Stable retry key; generated once per call when omitted. */
  idempotencyKey?: string;
  toolCallId?: string;
  nodeId?: string;
  parentRunId?: string;
}

export interface CreateTaskRunInput extends RunCreateBaseInput, RunRuntimeTargetOptions {
  name?: string;
  target: `task:${string}`;
  batchId?: string;
  /** Business input: any JSON value. The task reads it as `ctx.input`. */
  input?: unknown;
  /** Execution settings. The task reads them as `ctx.config`. */
  config?: Record<string, unknown>;
  timeoutSeconds?: number;
  backoffLimit?: number;
}

export interface CreateWorkflowRunInput extends RunCreateBaseInput, RunRuntimeTargetOptions {
  workflowId: string;
  target: `workflow:${string}`;
  /** Workflow input: any JSON value. */
  input?: unknown;
  startMode?: string;
}

/** Input payload for creating an eval run. */
export interface CreateEvalRunInput extends RunCreateBaseInput, RunRuntimeTargetOptions {
  target: `eval:${string}`;
  /** Eval run input: any JSON value. */
  input?: unknown;
  config?: Record<string, unknown>;
  /** @deprecated Retained for source compatibility; task-based eval runs ignore this option. */
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
  extends Omit<CreateTaskRunInput, "target" | "input" | "config"> {
  uploadIds: string[];
}

/** Input payload for knowledge ingest by upload paths. */
export interface KnowledgeIngestByUploadPathsInput
  extends Omit<CreateTaskRunInput, "target" | "input" | "config"> {
  uploadPaths: string[];
}

/** Input payload for knowledge ingest by upload prefix. */
export interface KnowledgeIngestByUploadPrefixInput
  extends Omit<CreateTaskRunInput, "target" | "input" | "config"> {
  uploadPrefix: string;
}

export interface ListRunsOptions extends ProjectScopedOptions {
  cursor?: string;
  limit?: number;
}

export interface ListRunEventsOptions {
  /** The previous page_info.next cursor. */
  cursor?: string;
  /** Deprecated ascending cursor. Use cursor; do not supply both. */
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

function runtimeTargetBody(input: RunRuntimeTargetOptions) {
  const type = input.runtimeTargetKind;
  if (!type) return undefined;
  if (type === "main_branch") return { type } as const;
  const id = type === "environment"
    ? input.runtimeTargetEnvironmentId
    : input.runtimeTargetBranchId;
  if (!id) throw new Error(`Run runtime ${type} requires its UUID.`);
  return { type, id };
}

/** Local adapter for existing framework callers; every wire request uses the canonical contract. */
function compatibilityRun(run: RunsOutput<"getRun">): Run {
  return RunSchema.parse({
    run_id: run.id,
    kind: run.target.type,
    status: run.status,
    owner: {
      kind: run.conversation_id ? "conversation" : "project",
      id: run.conversation_id ?? run.project_id,
    },
    parent_run_id: run.parent_run_id ?? null,
    root_run_id: run.root_run_id ?? run.id,
    waiting_reason: run.control?.waiting?.reason ?? null,
    waiting_on: run.control?.waiting?.reason === "child_run"
      ? run.control.waiting.dependencies.map((dependency) => ({
        kind: "run",
        run_id: dependency.run_id,
        correlation: { kind: dependency.correlation.type, id: dependency.correlation.id },
      }))
      : null,
    metadata: run.metadata ?? null,
    target: run.target.id === null ? null : `${run.target.type}:${run.target.id}`,
    workflow_id: run.target.type === "workflow" ? run.target.id : null,
    schedule_id: run.trigger?.type === "schedule" ? run.trigger.id : null,
    batch_id: run.batch_id ?? null,
    runtime_target_kind: run.execution?.runtime?.type === "registered"
      ? null
      : run.execution?.runtime?.type ?? null,
    runtime_target_environment_id: run.execution?.runtime?.type === "environment"
      ? run.execution.runtime.id
      : null,
    runtime_target_branch_id: run.execution?.runtime?.type === "preview_branch"
      ? run.execution.runtime.id
      : null,
    input: run.input,
    config: run.config ?? null,
    input_schema_sha256: run.schemas?.input?.sha256 ?? null,
    output_schema_sha256: run.schemas?.output?.sha256 ?? null,
    output: run.output,
    error: run.error
      ? { code: run.error.code, message: run.error.message, detail: run.error.details }
      : null,
    logs: run.execution?.logs ?? null,
    artifacts: run.artifacts ?? [],
    duration_ms: run.execution?.duration_ms ?? null,
    exit_code: run.execution?.exit_code ?? null,
    start_mode: run.execution?.start_mode ?? null,
    timeout_seconds: run.execution?.timeout_seconds ?? null,
    backoff_limit: run.execution?.retry_limit ?? null,
    trigger_kind: !run.trigger
      ? null
      : run.trigger.type === "api_key" || run.trigger.type === "service_account"
      ? "api"
      : run.trigger.type === "schedule" || run.trigger.type === "webhook"
      ? run.trigger.type
      : "manual",
    trigger_id: run.trigger?.id ?? null,
    created_by: null,
    updated_at: run.updated_at,
    created_at: run.created_at,
    started_at: run.started_at ?? null,
    completed_at: run.finished_at ?? null,
  });
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

  private sdk(): RunsSdk {
    const { apiUrl, authToken } = this.#resolveConnection();
    const baseUrl = applyIntrinsic(stringReplace, apiUrl, [/\/+$/, ""]) as string;
    const origin = readUrlOrigin(new NativeURL(baseUrl));
    return createRunsSdk({
      transport: {
        request: (path, init) =>
          requestWithRetry(`${baseUrl}${path}`, authToken, this.retryConfig, init, {
            authorizeUrl: (url) => {
              if (readUrlOrigin(url) !== origin) {
                throw new Error("Runs request blocked: destination origin is not authorized");
              }
            },
          }),
      },
    });
  }

  private async createDefinitionRun(
    input: RunCreateBaseInput,
    body: import("./target/client.ts").RunsInput<"createRun">["body"],
  ): Promise<CreateRunResponse> {
    if (input.publicId) {
      throw new Error(
        "Caller-selected public run aliases are retired; use the returned canonical UUID.",
      );
    }
    const run = await this.sdk().createRun({
      body,
      headers: { "Idempotency-Key": input.idempotencyKey ?? crypto.randomUUID() },
    });
    return { accepted: true, run: "id" in run ? compatibilityRun(run) : run };
  }

  createTaskRun(input: CreateTaskRunInput): Promise<CreateRunResponse> {
    return this.createDefinitionRun(input, {
      project_id: input.projectId,
      target: { type: "task", id: input.target.slice("task:".length) },
      title: input.name,
      parent_run_id: input.parentRunId,
      tool_call_id: input.toolCallId,
      node_id: input.nodeId,
      batch_id: input.batchId,
      input: input.input,
      config: input.config,
      execution: {
        runtime: runtimeTargetBody(input),
        timeout_seconds: input.timeoutSeconds,
        retry_limit: input.backoffLimit,
      },
    });
  }

  createWorkflowRun(input: CreateWorkflowRunInput): Promise<CreateRunResponse> {
    if (input.startMode) {
      throw new Error("Workflow startMode is not supported by canonical run creation.");
    }
    return this.createDefinitionRun(input, {
      project_id: input.projectId,
      target: { type: "workflow", id: input.target.slice("workflow:".length) },
      parent_run_id: input.parentRunId,
      tool_call_id: input.toolCallId,
      node_id: input.nodeId,
      input: input.input,
      execution: { runtime: runtimeTargetBody(input) },
    });
  }

  createEvalRun(input: CreateEvalRunInput): Promise<CreateRunResponse> {
    return this.createDefinitionRun(input, {
      project_id: input.projectId,
      target: { type: "task", id: "eval" },
      parent_run_id: input.parentRunId,
      tool_call_id: input.toolCallId,
      node_id: input.nodeId,
      input: input.input,
      config: { ...input.config, eval_id: input.target },
      execution: { runtime: runtimeTargetBody(input) },
    });
  }

  async createScheduleRun(input: CreateScheduleRunInput): Promise<ScheduleRunCreateResponse> {
    const reference = this.resolveProjectReference(input.projectReference);
    const project = await this.requestJson(
      `/projects/${encodeURIComponent(reference)}`,
      getProjectSchema(),
    );
    const run = await this.sdk().createRun({
      body: {
        project_id: project.id,
        source: { type: "schedule", id: input.scheduleId },
        title: input.runName,
      },
      headers: {
        "Idempotency-Key": input.idempotencyKey ??
          `${GENERATED_SCHEDULE_RUN_IDEMPOTENCY_PREFIX}:${crypto.randomUUID()}`,
      },
    });
    const runId = "id" in run ? run.id : run.run_id;
    return { run_id: runId, run_execution_id: runId, schedule_id: input.scheduleId };
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
    const page = await this.sdk().listProjectRuns({
      path: { project_reference: this.resolveProjectReference(options.projectReference) },
      query: { cursor: options.cursor, limit: options.limit },
    });
    return RunListSchema.parse({
      ...page,
      page_info: {
        self: options.cursor ?? null,
        first: null,
        prev: null,
        next: page.page_info.next,
      },
      data: page.data.map(compatibilityRun),
    });
  }

  /** Read a canonical UUID; adapts the grouped resource for existing framework callers. */
  async get(runId: string): Promise<Run> {
    return compatibilityRun(await this.getRun(runId));
  }

  /** Read the grouped resource by canonical UUID, retaining headers through onHeaders. */
  getRun(runId: string, options?: RunsCallOptions): Promise<RunsOutput<"getRun">> {
    return this.sdk().getRun({ path: { run_id: runId } }, options);
  }

  async events(
    runId: string,
    options: ListRunEventsOptions = {},
  ): Promise<RunsOutput<"listRunEvents"> & { page_info: RunEventList["page_info"] }> {
    if (options.cursor !== undefined && options.afterEventId !== undefined) {
      throw INVALID_ARGUMENT.create({ detail: "Use cursor or afterEventId, not both." });
    }
    const page = await this.sdk().listRunEvents({
      path: { run_id: runId },
      query: { cursor: options.cursor, after_event_id: options.afterEventId, limit: options.limit },
    });
    return {
      ...page,
      page_info: {
        self: options.cursor ?? null,
        first: null,
        prev: null,
        next: page.page_info.next,
      },
    };
  }

  async cancel(
    runId: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CancelRunResponse> {
    const run = await this.sdk().cancelRun({
      path: { run_id: runId },
      headers: { "Idempotency-Key": idempotencyKey },
    });
    return {
      cancelled: run.status === "cancelled" || run.control?.cancellation?.requested_at != null,
      run: compatibilityRun(run),
    };
  }

  private ingestKnowledgeByUploadIds(
    input: KnowledgeIngestByUploadIdsInput,
  ): Promise<CreateRunResponse> {
    const { uploadIds, ...options } = input;
    return this.createTaskRun({
      ...options,
      // Knowledge ingest carries no business input; drop a stray one a wider object passed in.
      input: undefined,
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
      // Knowledge ingest carries no business input; drop a stray one a wider object passed in.
      input: undefined,
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
      // Knowledge ingest carries no business input; drop a stray one a wider object passed in.
      input: undefined,
      name: options.name ?? DEFAULT_KNOWLEDGE_INGEST_RUN_NAME,
      target: "task:knowledge-ingest",
      config: { path_prefix: uploadPrefix },
    });
  }

  #resolveConnection(): { apiUrl: string; authToken: string } {
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
    const { apiUrl, authToken } = this.#resolveConnection();
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
