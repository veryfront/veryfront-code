/**
 * Kubernetes Job Executor
 *
 * Executes workflow jobs as Kubernetes Jobs.
 * Each workflow runs in an ephemeral pod with complete isolation.
 */

import { logger as baseLogger } from "#veryfront/utils";
import type { JobConfig, JobExecutor, JobInfo, JobStatus } from "./types.ts";

const logger = baseLogger.component("k8s-job-executor");

/** Default TTL for completed K8s Jobs before automatic cleanup (seconds) */
const DEFAULT_TTL_AFTER_FINISHED_SECONDS = 300;

/**
 * K8s Job Executor configuration
 */
export interface K8sJobExecutorConfig {
  /** Kubernetes namespace for jobs */
  namespace?: string;

  /** Container image for workflow execution */
  image: string;

  /** Image pull policy */
  imagePullPolicy?: "Always" | "IfNotPresent" | "Never";

  /** Service account for jobs */
  serviceAccount?: string;

  /** Resource requests/limits for job pods */
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };

  /** Secrets to mount as environment variables */
  envFromSecrets?: string[];

  /** Time to keep completed jobs for debugging (seconds) */
  ttlAfterFinished?: number;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Kubernetes API client interface
 */
export interface K8sClient {
  /** Create a Job */
  createJob(namespace: string, job: K8sJobSpec): Promise<void>;

  /** Get Job status */
  getJob(namespace: string, name: string): Promise<K8sJobStatusResponse | null>;

  /** List Jobs with label selector */
  listJobs(namespace: string, labelSelector: string): Promise<K8sJobStatusResponse[]>;

  /** Delete a Job */
  deleteJob(namespace: string, name: string): Promise<void>;
}

/**
 * K8s Job spec
 */
export interface K8sJobSpec {
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
  };
  spec: {
    ttlSecondsAfterFinished?: number;
    activeDeadlineSeconds?: number;
    backoffLimit: number;
    template: {
      metadata: {
        labels: Record<string, string>;
      };
      spec: {
        restartPolicy: "Never" | "OnFailure";
        serviceAccountName?: string;
        containers: Array<{
          name: string;
          image: string;
          imagePullPolicy?: string;
          env?: Array<{ name: string; value?: string; valueFrom?: unknown }>;
          envFrom?: Array<{ secretRef?: { name: string } }>;
          resources?: {
            requests?: { cpu?: string; memory?: string };
            limits?: { cpu?: string; memory?: string };
          };
          command?: string[];
          args?: string[];
        }>;
      };
    };
  };
}

/**
 * K8s Job status response
 */
export interface K8sJobStatusResponse {
  metadata: {
    name: string;
    labels: Record<string, string>;
    creationTimestamp: string;
  };
  status: {
    active?: number;
    succeeded?: number;
    failed?: number;
    startTime?: string;
    completionTime?: string;
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
    }>;
  };
}

/**
 * Kubernetes Job Executor
 */
export class K8sJobExecutor implements JobExecutor {
  private config:
    & Required<Omit<K8sJobExecutorConfig, "resources" | "serviceAccount" | "envFromSecrets">>
    & {
      resources?: K8sJobExecutorConfig["resources"];
      serviceAccount?: K8sJobExecutorConfig["serviceAccount"];
      envFromSecrets?: K8sJobExecutorConfig["envFromSecrets"];
    };
  private k8sClient: K8sClient;

  constructor(config: K8sJobExecutorConfig, k8sClient: K8sClient) {
    this.k8sClient = k8sClient;
    this.config = {
      namespace: "default",
      imagePullPolicy: "IfNotPresent",
      ttlAfterFinished: DEFAULT_TTL_AFTER_FINISHED_SECONDS,
      debug: false,
      ...config,
    };
  }

  async createJob(jobConfig: JobConfig): Promise<string> {
    const { jobId, run, managerId, timeout, env, debug } = jobConfig;
    const jobName = this.sanitizeJobName(jobId);
    const tenantSlug = run._tenant?.projectSlug ?? "unknown";

    const job: K8sJobSpec = {
      metadata: {
        name: jobName,
        namespace: this.config.namespace,
        labels: {
          "veryfront.com/component": "workflow-job",
          "veryfront.com/manager": managerId,
          "veryfront.com/job-id": jobId,
          "veryfront.com/run-id": run.id,
          "veryfront.com/workflow-id": run.workflowId,
          "veryfront.com/tenant": tenantSlug,
        },
      },
      spec: {
        ttlSecondsAfterFinished: this.config.ttlAfterFinished,
        activeDeadlineSeconds: Math.floor(timeout / 1000),
        backoffLimit: 0,
        template: {
          metadata: {
            labels: {
              "veryfront.com/component": "workflow-job",
              "veryfront.com/job-id": jobId,
              "veryfront.com/run-id": run.id,
              "veryfront.com/tenant": tenantSlug,
            },
          },
          spec: {
            restartPolicy: "Never",
            serviceAccountName: this.config.serviceAccount,
            containers: [
              {
                name: "workflow",
                image: this.config.image,
                imagePullPolicy: this.config.imagePullPolicy,
                env: [
                  { name: "MODE", value: "job" },
                  { name: "WORKFLOW_RUN_ID", value: run.id },
                  { name: "JOB_ID", value: jobId },
                  ...this.buildTenantEnv(run),
                  ...Object.entries(env).map(([name, value]) => ({ name, value })),
                ],
                envFrom: this.config.envFromSecrets?.map((name) => ({
                  secretRef: { name },
                })),
                resources: this.config.resources,
              },
            ],
          },
        },
      },
    };

    await this.k8sClient.createJob(this.config.namespace, job);

    if (debug || this.config.debug) {
      logger.info(`Created job ${jobName} for run ${run.id}`);
    }

    return jobId;
  }

  async getJobStatus(jobId: string): Promise<JobInfo | null> {
    const jobName = this.sanitizeJobName(jobId);

    try {
      const k8sJob = await this.k8sClient.getJob(this.config.namespace, jobName);
      if (!k8sJob) {
        return null;
      }

      return this.parseJobInfo(k8sJob, jobId);
    } catch {
      return null;
    }
  }

  async listJobs(managerId: string): Promise<JobInfo[]> {
    const labelSelector = `veryfront.com/manager=${managerId}`;
    const k8sJobs = await this.k8sClient.listJobs(this.config.namespace, labelSelector);

    return k8sJobs.map((k8sJob) => {
      const jobId = k8sJob.metadata.labels["veryfront.com/job-id"] ?? k8sJob.metadata.name;
      return this.parseJobInfo(k8sJob, jobId);
    });
  }

  async deleteJob(jobId: string): Promise<void> {
    const jobName = this.sanitizeJobName(jobId);

    try {
      await this.k8sClient.deleteJob(this.config.namespace, jobName);

      if (this.config.debug) {
        logger.info(`Deleted job ${jobName}`);
      }
    } catch (error) {
      logger.warn(`Failed to delete job ${jobName}:`, error);
    }
  }

  /**
   * Convert job ID to valid K8s name
   */
  private sanitizeJobName(jobId: string): string {
    return `wf-${jobId.replace(/_/g, "-").toLowerCase()}`;
  }

  /**
   * Build tenant environment variables
   */
  private buildTenantEnv(
    run: JobConfig["run"],
  ): Array<{ name: string; value: string }> {
    if (!run._tenant) {
      return [];
    }

    const { projectSlug, token, projectId, productionMode, releaseId } = run._tenant;
    return [
      { name: "TENANT_PROJECT_SLUG", value: projectSlug },
      { name: "TENANT_TOKEN", value: token },
      { name: "TENANT_PROJECT_ID", value: projectId ?? "" },
      { name: "TENANT_PRODUCTION_MODE", value: productionMode ? "1" : "0" },
      { name: "TENANT_RELEASE_ID", value: releaseId ?? "" },
    ];
  }

  /**
   * Parse K8s job response to JobInfo
   */
  private parseJobInfo(k8sJob: K8sJobStatusResponse, jobId: string): JobInfo {
    const runId = k8sJob.metadata.labels["veryfront.com/run-id"] ?? "";

    return {
      jobId,
      runId,
      status: this.parseStatus(k8sJob),
      createdAt: new Date(k8sJob.metadata.creationTimestamp),
      startedAt: k8sJob.status.startTime ? new Date(k8sJob.status.startTime) : undefined,
      completedAt: k8sJob.status.completionTime
        ? new Date(k8sJob.status.completionTime)
        : undefined,
      error: this.extractError(k8sJob),
      metadata: {
        k8sName: k8sJob.metadata.name,
        namespace: this.config.namespace,
      },
    };
  }

  /**
   * Parse K8s job status
   */
  private parseStatus(k8sJob: K8sJobStatusResponse): JobStatus {
    if (k8sJob.status.succeeded && k8sJob.status.succeeded > 0) {
      return "succeeded";
    }
    if (k8sJob.status.failed && k8sJob.status.failed > 0) {
      return "failed";
    }
    if (k8sJob.status.active && k8sJob.status.active > 0) {
      return "running";
    }
    return "pending";
  }

  /**
   * Extract error from K8s job
   */
  private extractError(k8sJob: K8sJobStatusResponse): string | undefined {
    const failedCondition = k8sJob.status.conditions?.find(
      (c) => c.type === "Failed" && c.status === "True",
    );

    if (failedCondition) {
      return failedCondition.message ?? failedCondition.reason ?? "Unknown error";
    }

    return undefined;
  }
}
