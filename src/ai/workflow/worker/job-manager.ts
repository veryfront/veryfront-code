/**
 * Workflow Job Manager
 *
 * Manages ephemeral K8s Jobs for workflow execution.
 * Provides tenant isolation by running each workflow in a separate container.
 *
 * Key properties:
 * - Each workflow runs in a fresh container (no shared state)
 * - Containers are destroyed after workflow completion
 * - Job Manager only orchestrates, never executes user code
 * - Supports crash recovery via stalled job detection
 */

import { logger } from "@veryfront/utils";
import { hasWorkerSupport, type WorkflowBackend } from "../backends/types.ts";
import type { WorkflowRun } from "../types.ts";
import { generateId } from "../types.ts";

/**
 * Configuration for the Workflow Job Manager
 */
export interface WorkflowJobManagerConfig {
  /** Backend for workflow persistence */
  backend: WorkflowBackend;

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

  /** Environment variables to inject into job pods */
  env?: Record<string, string>;

  /** Secrets to mount as environment variables */
  envFromSecrets?: string[];

  /** Poll interval for checking pending workflows (ms) */
  pollInterval?: number;

  /** Maximum concurrent jobs */
  maxConcurrentJobs?: number;

  /** Job timeout (ms) - kills job if it exceeds this */
  jobTimeout?: number;

  /** Time after which a run is considered stalled (ms) - for crash recovery */
  stalledThreshold?: number;

  /** Time to keep completed jobs for debugging (s) */
  ttlAfterFinished?: number;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Job status
 */
export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "unknown";

/**
 * Job info
 */
export interface JobInfo {
  name: string;
  runId: string;
  tenantSlug: string;
  status: JobStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Manager status
 */
export type ManagerStatus = "idle" | "running" | "stopping" | "stopped";

/**
 * Manager statistics
 */
export interface ManagerStats {
  status: ManagerStatus;
  managerId: string;
  startedAt?: Date;
  pollCount: number;
  jobsCreated: number;
  jobsCompleted: number;
  jobsFailed: number;
  activeJobs: number;
  lastPollAt?: Date;
  lastErrorAt?: Date;
  lastError?: string;
}

/**
 * Kubernetes API client interface (minimal subset we need)
 */
export interface K8sClient {
  /** Create a Job */
  createJob(namespace: string, job: K8sJob): Promise<void>;

  /** Get Job status */
  getJob(namespace: string, name: string): Promise<K8sJobStatus | null>;

  /** List Jobs with label selector */
  listJobs(namespace: string, labelSelector: string): Promise<K8sJobStatus[]>;

  /** Delete a Job */
  deleteJob(namespace: string, name: string): Promise<void>;
}

/**
 * K8s Job spec (simplified)
 */
export interface K8sJob {
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
 * K8s Job status (simplified)
 */
export interface K8sJobStatus {
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
 * Workflow Job Manager
 *
 * Orchestrates workflow execution via ephemeral K8s Jobs.
 * Each workflow runs in complete isolation - no shared state between tenants.
 *
 * @example
 * ```typescript
 * const manager = new WorkflowJobManager({
 *   backend: redisBackend,
 *   k8sClient: new KubernetesClient(),
 *   image: "veryfront-renderer:latest",
 *   namespace: "veryfront-jobs",
 * });
 *
 * manager.start();
 *
 * // Later, to stop gracefully:
 * await manager.stop();
 * ```
 */
export class WorkflowJobManager {
  private config: Required<
    Omit<WorkflowJobManagerConfig, "resources" | "env" | "envFromSecrets" | "serviceAccount">
  > & {
    resources?: WorkflowJobManagerConfig["resources"];
    env?: WorkflowJobManagerConfig["env"];
    envFromSecrets?: WorkflowJobManagerConfig["envFromSecrets"];
    serviceAccount?: WorkflowJobManagerConfig["serviceAccount"];
  };
  private k8sClient: K8sClient;
  private status: ManagerStatus = "idle";
  private pollTimeout?: ReturnType<typeof setTimeout>;
  private activeJobs = new Map<string, JobInfo>();
  private stats: ManagerStats;
  private managerId: string;

  constructor(config: WorkflowJobManagerConfig, k8sClient: K8sClient) {
    this.k8sClient = k8sClient;
    this.managerId = generateId("mgr");

    this.config = {
      namespace: "default",
      imagePullPolicy: "IfNotPresent",
      pollInterval: 5000,
      maxConcurrentJobs: 10,
      jobTimeout: 30 * 60 * 1000, // 30 minutes
      stalledThreshold: 60000, // 60 seconds
      ttlAfterFinished: 300, // 5 minutes
      debug: false,
      ...config,
    };

    this.stats = {
      status: "idle",
      managerId: this.managerId,
      pollCount: 0,
      jobsCreated: 0,
      jobsCompleted: 0,
      jobsFailed: 0,
      activeJobs: 0,
    };
  }

  /**
   * Start the job manager
   */
  start(): void {
    if (this.status === "running") {
      throw new Error("Job manager is already running");
    }

    this.status = "running";
    this.stats.status = "running";
    this.stats.startedAt = new Date();

    if (this.config.debug) {
      logger.info(`[WorkflowJobManager] Started manager ${this.managerId}`);
    }

    // Start polling loop
    this.scheduleNextPoll();
  }

  /**
   * Stop the job manager gracefully
   */
  stop(): void {
    if (this.status !== "running") {
      return;
    }

    this.status = "stopping";
    this.stats.status = "stopping";

    if (this.config.debug) {
      logger.info(`[WorkflowJobManager] Stopping manager ${this.managerId}...`);
    }

    // Clear scheduled poll
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = undefined;
    }

    // Note: We don't wait for active jobs - they continue running
    // The manager just stops creating new jobs

    this.status = "stopped";
    this.stats.status = "stopped";

    if (this.config.debug) {
      logger.info(`[WorkflowJobManager] Manager ${this.managerId} stopped`);
    }
  }

  /**
   * Get manager statistics
   */
  getStats(): ManagerStats {
    return { ...this.stats, activeJobs: this.activeJobs.size };
  }

  /**
   * Get active jobs
   */
  getActiveJobs(): JobInfo[] {
    return Array.from(this.activeJobs.values());
  }

  /**
   * Schedule the next poll
   */
  private scheduleNextPoll(): void {
    if (this.status !== "running") {
      return;
    }

    this.pollTimeout = setTimeout(async () => {
      await this.poll();
      this.scheduleNextPoll();
    }, this.config.pollInterval);
  }

  /**
   * Poll for pending workflows and manage jobs
   */
  private async poll(): Promise<void> {
    if (this.status !== "running") {
      return;
    }

    this.stats.pollCount++;
    this.stats.lastPollAt = new Date();

    try {
      // 1. Check status of active jobs
      await this.syncJobStatuses();

      // 2. Find workflows that need execution
      const availableSlots = this.config.maxConcurrentJobs - this.activeJobs.size;
      if (availableSlots <= 0) {
        return;
      }

      // Get pending workflows from queue
      const pendingRuns = await this.config.backend.listRuns({
        status: "pending",
        limit: availableSlots,
      });

      // Also check for stalled workflows (crashed jobs)
      let stalledRuns: WorkflowRun[] = [];
      if (hasWorkerSupport(this.config.backend)) {
        stalledRuns = await this.config.backend.findStalledRuns(this.config.stalledThreshold);

        if (stalledRuns.length > 0 && this.config.debug) {
          logger.info(
            `[WorkflowJobManager] Found ${stalledRuns.length} stalled runs to recover`,
          );
        }
      }

      // Combine pending and stalled runs
      const runsToProcess = [...pendingRuns, ...stalledRuns].slice(0, availableSlots);

      for (const run of runsToProcess) {
        // Skip if already has an active job
        if (this.activeJobs.has(run.id)) {
          continue;
        }

        // For stalled runs, try to claim first
        if (run.status === "running" && hasWorkerSupport(this.config.backend)) {
          const claimed = await this.config.backend.claimStalledRun(
            run.id,
            `mgr:${this.managerId}`,
            this.config.stalledThreshold,
          );
          if (!claimed) {
            // Another manager claimed it
            continue;
          }
        }

        await this.createJobForWorkflow(run);
      }
    } catch (error) {
      this.stats.lastErrorAt = new Date();
      this.stats.lastError = error instanceof Error ? error.message : String(error);
      logger.error(`[WorkflowJobManager] Poll error:`, error);
    }
  }

  /**
   * Sync job statuses with K8s
   */
  private async syncJobStatuses(): Promise<void> {
    const labelSelector = `veryfront.com/manager=${this.managerId}`;

    try {
      const k8sJobs = await this.k8sClient.listJobs(this.config.namespace, labelSelector);

      for (const k8sJob of k8sJobs) {
        const runId = k8sJob.metadata.labels["veryfront.com/run-id"];
        const jobInfo = this.activeJobs.get(runId);

        if (!jobInfo) {
          continue;
        }

        const newStatus = this.parseJobStatus(k8sJob);

        if (newStatus !== jobInfo.status) {
          jobInfo.status = newStatus;

          if (k8sJob.status.startTime) {
            jobInfo.startedAt = new Date(k8sJob.status.startTime);
          }

          if (newStatus === "succeeded") {
            jobInfo.completedAt = new Date();
            this.stats.jobsCompleted++;
            this.activeJobs.delete(runId);

            if (this.config.debug) {
              logger.info(`[WorkflowJobManager] Job completed: ${jobInfo.name}`);
            }
          } else if (newStatus === "failed") {
            jobInfo.completedAt = new Date();
            jobInfo.error = this.extractErrorFromJob(k8sJob);
            this.stats.jobsFailed++;
            this.activeJobs.delete(runId);

            logger.error(`[WorkflowJobManager] Job failed: ${jobInfo.name}`, jobInfo.error);
          }
        }
      }
    } catch (error) {
      logger.error(`[WorkflowJobManager] Failed to sync job statuses:`, error);
    }
  }

  /**
   * Create a K8s Job for a workflow run
   */
  private async createJobForWorkflow(run: WorkflowRun): Promise<void> {
    const tenantSlug = run._tenant?.projectSlug ?? "unknown";
    const jobName = `wf-${run.id.replace(/_/g, "-").toLowerCase()}`;

    const job: K8sJob = {
      metadata: {
        name: jobName,
        namespace: this.config.namespace,
        labels: {
          "veryfront.com/component": "workflow-job",
          "veryfront.com/manager": this.managerId,
          "veryfront.com/run-id": run.id,
          "veryfront.com/workflow-id": run.workflowId,
          "veryfront.com/tenant": tenantSlug,
        },
      },
      spec: {
        ttlSecondsAfterFinished: this.config.ttlAfterFinished,
        activeDeadlineSeconds: Math.floor(this.config.jobTimeout / 1000),
        backoffLimit: 0, // No retries - we handle retries at workflow level
        template: {
          metadata: {
            labels: {
              "veryfront.com/component": "workflow-job",
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
                  // Inject tenant context
                  ...(run._tenant
                    ? [
                        { name: "TENANT_PROJECT_SLUG", value: run._tenant.projectSlug },
                        { name: "TENANT_TOKEN", value: run._tenant.token },
                        { name: "TENANT_PROJECT_ID", value: run._tenant.projectId ?? "" },
                        {
                          name: "TENANT_PRODUCTION_MODE",
                          value: run._tenant.productionMode ? "1" : "0",
                        },
                        { name: "TENANT_RELEASE_ID", value: run._tenant.releaseId ?? "" },
                      ]
                    : []),
                  // Custom env vars
                  ...Object.entries(this.config.env ?? {}).map(([name, value]) => ({
                    name,
                    value,
                  })),
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

    try {
      await this.k8sClient.createJob(this.config.namespace, job);

      const jobInfo: JobInfo = {
        name: jobName,
        runId: run.id,
        tenantSlug,
        status: "pending",
        createdAt: new Date(),
      };

      this.activeJobs.set(run.id, jobInfo);
      this.stats.jobsCreated++;

      // Mark workflow as running
      await this.config.backend.updateRun(run.id, {
        status: "running",
        startedAt: new Date(),
        workerId: `job:${jobName}`,
      });

      if (this.config.debug) {
        logger.info(`[WorkflowJobManager] Created job ${jobName} for workflow ${run.id}`);
      }
    } catch (error) {
      logger.error(`[WorkflowJobManager] Failed to create job for ${run.id}:`, error);

      // Mark workflow as failed
      await this.config.backend.updateRun(run.id, {
        status: "failed",
        error: {
          message: `Failed to create execution job: ${error instanceof Error ? error.message : String(error)}`,
          code: "JOB_CREATION_FAILED",
        },
        completedAt: new Date(),
      });
    }
  }

  /**
   * Parse job status from K8s status
   */
  private parseJobStatus(k8sJob: K8sJobStatus): JobStatus {
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
   * Extract error message from failed job
   */
  private extractErrorFromJob(k8sJob: K8sJobStatus): string {
    const failedCondition = k8sJob.status.conditions?.find(
      (c) => c.type === "Failed" && c.status === "True",
    );

    if (failedCondition) {
      return failedCondition.message ?? failedCondition.reason ?? "Unknown error";
    }

    return "Job failed without error message";
  }
}

/**
 * Create a workflow job manager
 */
export function createWorkflowJobManager(
  config: WorkflowJobManagerConfig,
  k8sClient: K8sClient,
): WorkflowJobManager {
  return new WorkflowJobManager(config, k8sClient);
}
