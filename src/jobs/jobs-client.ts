/**
 * Jobs client SDK for project-scoped background execution.
 *
 * Provides a stable public client for one-off jobs, cron jobs, job batches,
 * and job target discovery on the Veryfront Jobs API.
 */

import { getVeryfrontCloudBootstrap } from "#veryfront/platform/cloud/resolver.ts";
import {
  requestWithRetry,
  type RetryConfig,
} from "#veryfront/platform/adapters/veryfront-api-client/retry-handler.ts";
import { API_CLIENT_ERROR } from "#veryfront/platform/adapters/veryfront-api-client/types.ts";
import { z } from "zod";
import {
  type CronJob,
  CronJobSchema,
  type CronJobStatus,
  type Job,
  type JobBatch,
  JobBatchSchema,
  type JobEventsResponse,
  JobEventsResponseSchema,
  type JobLogsResponse,
  JobLogsResponseSchema,
  JobSchema,
  type JobStatus,
  type JobTargetDefinition,
  JobTargetDefinitionSchema,
  type JobTargetDefinitionsResponse,
  JobTargetDefinitionsResponseSchema,
  type PaginatedCronJobsResponse,
  PaginatedCronJobsResponseSchema,
  type PaginatedJobsResponse,
  PaginatedJobsResponseSchema,
} from "./schemas.ts";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;

export interface VeryfrontJobsClientConfig {
  apiUrl?: string;
  authToken?: string;
  projectReference?: string;
  retry?: Partial<RetryConfig>;
}

export interface ProjectScopedOptions {
  projectReference?: string;
}

export interface ListJobsOptions extends ProjectScopedOptions {
  cursor?: string;
  limit?: number;
  status?: JobStatus;
  cronJobId?: string;
  environmentId?: string;
  batchId?: string;
}

export interface ListJobEventsOptions extends ProjectScopedOptions {
  cursor?: string;
  limit?: number;
  direction?: "forward" | "backward";
}

export interface CreateJobInput extends ProjectScopedOptions {
  name: string;
  target: string;
  environmentId?: string;
  batchId?: string;
  config?: Record<string, unknown>;
  timeoutSeconds?: number;
  backoffLimit?: number;
}

export interface ListBatchJobsOptions extends ProjectScopedOptions {
  cursor?: string;
  limit?: number;
  status?: JobStatus;
}

export interface CreateCronJobInput extends ProjectScopedOptions {
  name: string;
  target: string;
  environmentId?: string;
  schedule: string;
  timezone?: string;
  config?: Record<string, unknown>;
  timeoutSeconds?: number;
  backoffLimit?: number;
  concurrencyPolicy?: "Allow" | "Forbid" | "Replace";
}

export interface ListCronJobsOptions extends ProjectScopedOptions {
  cursor?: string;
  limit?: number;
  status?: CronJobStatus;
  environmentId?: string;
}

export interface UpdateCronJobInput extends ProjectScopedOptions {
  name?: string;
  schedule?: string;
  timezone?: string;
  config?: Record<string, unknown>;
  timeoutSeconds?: number;
  backoffLimit?: number;
  concurrencyPolicy?: "Allow" | "Forbid" | "Replace";
  status?: "active" | "paused";
}

type NamespaceMethod<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>;

function toQueryParams(
  values: Record<string, string | number | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value == null) {
      continue;
    }
    params.set(key, String(value));
  }

  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length > 0 ? `${path}?${query}` : path;
}

export class VeryfrontJobsClient {
  private readonly retryConfig: RetryConfig;
  private requestToken?: string;
  private requestProjectReference?: string;

  readonly cron: {
    create: NamespaceMethod<[CreateCronJobInput], CronJob>;
    list: NamespaceMethod<[ListCronJobsOptions?], PaginatedCronJobsResponse>;
    get: NamespaceMethod<[cronJobId: string, options?: ProjectScopedOptions], CronJob>;
    update: NamespaceMethod<[cronJobId: string, input: UpdateCronJobInput], CronJob>;
    delete: NamespaceMethod<[cronJobId: string, options?: ProjectScopedOptions], CronJob>;
    trigger: NamespaceMethod<[cronJobId: string, options?: ProjectScopedOptions], Job>;
  };

  readonly batches: {
    get: NamespaceMethod<[batchId: string, options?: ProjectScopedOptions], JobBatch>;
    listJobs: NamespaceMethod<
      [batchId: string, options?: ListBatchJobsOptions],
      PaginatedJobsResponse
    >;
  };

  readonly targets: {
    list: NamespaceMethod<[options?: ProjectScopedOptions], JobTargetDefinitionsResponse>;
    get: NamespaceMethod<[target: string, options?: ProjectScopedOptions], JobTargetDefinition>;
  };

  constructor(private readonly config: VeryfrontJobsClientConfig = {}) {
    this.retryConfig = {
      maxRetries: config.retry?.maxRetries ?? DEFAULT_MAX_RETRIES,
      initialDelay: config.retry?.initialDelay ?? DEFAULT_INITIAL_RETRY_DELAY_MS,
      maxDelay: config.retry?.maxDelay ?? DEFAULT_MAX_RETRY_DELAY_MS,
    };

    this.cron = {
      create: (input) => this.createCronJob(input),
      list: (options) => this.listCronJobs(options),
      get: (cronJobId, options) => this.getCronJob(cronJobId, options),
      update: (cronJobId, input) => this.updateCronJob(cronJobId, input),
      delete: (cronJobId, options) => this.deleteCronJob(cronJobId, options),
      trigger: (cronJobId, options) => this.triggerCronJob(cronJobId, options),
    };

    this.batches = {
      get: (batchId, options) => this.getBatch(batchId, options),
      listJobs: (batchId, options) => this.listBatchJobs(batchId, options),
    };

    this.targets = {
      list: (options) => this.listTargets(options),
      get: (target, options) => this.getTarget(target, options),
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

  getProjectReference(): string | undefined {
    return this.requestProjectReference ?? this.config.projectReference;
  }

  clearProjectReference(): void {
    this.requestProjectReference = undefined;
  }

  create(input: CreateJobInput): Promise<Job> {
    const { projectReference, environmentId, batchId, timeoutSeconds, backoffLimit, ...rest } =
      input;

    return this.requestProjectJson(
      projectReference,
      "/jobs",
      JobSchema,
      {
        method: "POST",
        body: {
          ...rest,
          environment_id: environmentId,
          batch_id: batchId,
          timeout_seconds: timeoutSeconds,
          backoff_limit: backoffLimit,
        },
      },
    );
  }

  list(options: ListJobsOptions = {}): Promise<PaginatedJobsResponse> {
    const { projectReference, cursor, limit, status, cronJobId, environmentId, batchId } = options;

    return this.requestProjectJson(
      projectReference,
      withQuery(
        "/jobs",
        toQueryParams({
          cursor,
          limit,
          status,
          cron_job_id: cronJobId,
          environment_id: environmentId,
          batch_id: batchId,
        }),
      ),
      PaginatedJobsResponseSchema,
    );
  }

  get(jobId: string, options: ProjectScopedOptions = {}): Promise<Job> {
    return this.requestProjectJson(
      options.projectReference,
      `/jobs/${encodeURIComponent(jobId)}`,
      JobSchema,
    );
  }

  /**
   * Canonical user-visible operational output for a job.
   * Prefer this over raw logs for status, progress, and per-file activity.
   */
  events(jobId: string, options: ListJobEventsOptions = {}): Promise<JobEventsResponse> {
    const { projectReference, cursor, limit, direction } = options;

    return this.requestProjectJson(
      projectReference,
      withQuery(
        `/jobs/${encodeURIComponent(jobId)}/events`,
        toQueryParams({ cursor, limit, direction }),
      ),
      JobEventsResponseSchema,
    );
  }

  /**
   * Raw debugging output for a job.
   * This is secondary to `events()` for operational UX.
   */
  logs(jobId: string, options: ProjectScopedOptions = {}): Promise<JobLogsResponse> {
    return this.requestProjectJson(
      options.projectReference,
      `/jobs/${encodeURIComponent(jobId)}/logs`,
      JobLogsResponseSchema,
    );
  }

  cancel(jobId: string, options: ProjectScopedOptions = {}): Promise<Job> {
    return this.requestProjectJson(
      options.projectReference,
      `/jobs/${encodeURIComponent(jobId)}/cancel`,
      JobSchema,
      { method: "POST" },
    );
  }

  private createCronJob(input: CreateCronJobInput): Promise<CronJob> {
    const {
      projectReference,
      environmentId,
      timeoutSeconds,
      backoffLimit,
      concurrencyPolicy,
      ...rest
    } = input;

    return this.requestProjectJson(
      projectReference,
      "/cron-jobs",
      CronJobSchema,
      {
        method: "POST",
        body: {
          ...rest,
          environment_id: environmentId,
          timeout_seconds: timeoutSeconds,
          backoff_limit: backoffLimit,
          concurrency_policy: concurrencyPolicy,
        },
      },
    );
  }

  private listCronJobs(options: ListCronJobsOptions = {}): Promise<PaginatedCronJobsResponse> {
    const { projectReference, cursor, limit, status, environmentId } = options;

    return this.requestProjectJson(
      projectReference,
      withQuery(
        "/cron-jobs",
        toQueryParams({
          cursor,
          limit,
          status,
          environment_id: environmentId,
        }),
      ),
      PaginatedCronJobsResponseSchema,
    );
  }

  private getCronJob(cronJobId: string, options: ProjectScopedOptions = {}): Promise<CronJob> {
    return this.requestProjectJson(
      options.projectReference,
      `/cron-jobs/${encodeURIComponent(cronJobId)}`,
      CronJobSchema,
    );
  }

  private updateCronJob(cronJobId: string, input: UpdateCronJobInput): Promise<CronJob> {
    const {
      projectReference,
      timeoutSeconds,
      backoffLimit,
      concurrencyPolicy,
      ...rest
    } = input;

    return this.requestProjectJson(
      projectReference,
      `/cron-jobs/${encodeURIComponent(cronJobId)}`,
      CronJobSchema,
      {
        method: "PATCH",
        body: {
          ...rest,
          timeout_seconds: timeoutSeconds,
          backoff_limit: backoffLimit,
          concurrency_policy: concurrencyPolicy,
        },
      },
    );
  }

  private deleteCronJob(cronJobId: string, options: ProjectScopedOptions = {}): Promise<CronJob> {
    return this.requestProjectJson(
      options.projectReference,
      `/cron-jobs/${encodeURIComponent(cronJobId)}`,
      CronJobSchema,
      { method: "DELETE" },
    );
  }

  private triggerCronJob(cronJobId: string, options: ProjectScopedOptions = {}): Promise<Job> {
    return this.requestProjectJson(
      options.projectReference,
      `/cron-jobs/${encodeURIComponent(cronJobId)}/trigger`,
      JobSchema,
      { method: "POST" },
    );
  }

  private getBatch(batchId: string, options: ProjectScopedOptions = {}): Promise<JobBatch> {
    return this.requestProjectJson(
      options.projectReference,
      `/job-batches/${encodeURIComponent(batchId)}`,
      JobBatchSchema,
    );
  }

  private listBatchJobs(
    batchId: string,
    options: ListBatchJobsOptions = {},
  ): Promise<PaginatedJobsResponse> {
    const { projectReference, cursor, limit, status } = options;

    return this.requestProjectJson(
      projectReference,
      withQuery(
        `/job-batches/${encodeURIComponent(batchId)}/jobs`,
        toQueryParams({
          cursor,
          limit,
          status,
        }),
      ),
      PaginatedJobsResponseSchema,
    );
  }

  private listTargets(
    options: ProjectScopedOptions = {},
  ): Promise<JobTargetDefinitionsResponse> {
    return this.requestProjectJson(
      options.projectReference,
      "/job-targets",
      JobTargetDefinitionsResponseSchema,
    );
  }

  private getTarget(
    target: string,
    options: ProjectScopedOptions = {},
  ): Promise<JobTargetDefinition> {
    return this.requestProjectJson(
      options.projectReference,
      `/job-targets/${encodeURIComponent(target)}`,
      JobTargetDefinitionSchema,
    );
  }

  private resolveApiUrl(): string {
    return this.config.apiUrl ?? getVeryfrontCloudBootstrap().apiBaseUrl;
  }

  private resolveAuthToken(): string {
    const token = this.requestToken ?? this.config.authToken ??
      getVeryfrontCloudBootstrap().apiToken;
    if (token) {
      return token;
    }

    throw API_CLIENT_ERROR.create({
      detail:
        "Jobs auth not configured. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass authToken explicitly.",
      status: 401,
    });
  }

  private resolveProjectReference(projectReference?: string): string {
    const resolved = projectReference ??
      this.requestProjectReference ??
      this.config.projectReference ??
      getVeryfrontCloudBootstrap().projectSlug;

    if (resolved) {
      return resolved;
    }

    throw API_CLIENT_ERROR.create({
      detail:
        "Jobs project reference not configured. Pass projectReference explicitly, set VERYFRONT_PROJECT_SLUG, or provide request-scoped Veryfront project context.",
      status: 400,
    });
  }

  private async requestProjectJson<TSchema extends z.ZodTypeAny>(
    projectReference: string | undefined,
    path: string,
    schema: TSchema,
    options: {
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      body?: Record<string, unknown>;
    } = {},
  ): Promise<z.infer<TSchema>> {
    const resolvedProjectReference = this.resolveProjectReference(projectReference);
    const raw = await requestWithRetry(
      `${this.resolveApiUrl()}/projects/${encodeURIComponent(resolvedProjectReference)}${path}`,
      this.resolveAuthToken(),
      this.retryConfig,
      {
        method: options.method,
        body: options.body == null ? undefined : JSON.stringify(options.body),
      },
    );

    return schema.parse(raw);
  }
}

export function createJobsClient(config?: VeryfrontJobsClientConfig): VeryfrontJobsClient {
  return new VeryfrontJobsClient(config);
}
