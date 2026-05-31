/**
 * Kubernetes-backed run executor
 *
 * Executes workflow runs as Kubernetes Job resources.
 * Each workflow runs in an ephemeral pod with complete isolation.
 */

import { logger as baseLogger } from "#veryfront/utils";
import type {
  RunExecutionConfig,
  RunExecutionInfo,
  RunExecutionStatus,
  RunExecutor,
} from "./types.ts";

const logger = baseLogger.component("k8s-run-executor");

/** Default TTL for completed K8s Job resources before automatic cleanup (seconds) */
const DEFAULT_TTL_AFTER_FINISHED_SECONDS = 300;

/**
 * Kubernetes-backed run executor configuration
 */
export interface K8sRunExecutorConfig {
  /** Kubernetes namespace for run executions */
  namespace?: string;

  /** Container image for workflow execution */
  image: string;

  /** Image pull policy */
  imagePullPolicy?: "Always" | "IfNotPresent" | "Never";

  /** Service account for run executions */
  serviceAccount?: string;

  /** Resource requests/limits for run execution pods */
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };

  /** Secrets to mount as environment variables */
  envFromSecrets?: string[];

  /** Time to keep completed run executions for debugging (seconds) */
  ttlAfterFinished?: number;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Kubernetes API client interface
 */
export interface K8sClient {
  /** Create a run execution Kubernetes resource */
  createRunExecution(namespace: string, resource: K8sRunExecutionSpec): Promise<void>;

  /** Get Kubernetes resource status */
  getRunExecutionResource(
    namespace: string,
    name: string,
  ): Promise<K8sRunExecutionStatusResponse | null>;

  /** List run execution Kubernetes resources with label selector */
  listRunExecutions(
    namespace: string,
    labelSelector: string,
  ): Promise<K8sRunExecutionStatusResponse[]>;

  /** Delete a run execution Kubernetes resource */
  deleteRunExecution(namespace: string, name: string): Promise<void>;
}

/**
 * K8s run execution Kubernetes resource spec
 */
export interface K8sRunExecutionSpec {
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
 * K8s run execution status response
 */
export interface K8sRunExecutionStatusResponse {
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
 * Kubernetes-backed run executor
 */
export class K8sRunExecutor implements RunExecutor {
  private config:
    & Required<Omit<K8sRunExecutorConfig, "resources" | "serviceAccount" | "envFromSecrets">>
    & {
      resources?: K8sRunExecutorConfig["resources"];
      serviceAccount?: K8sRunExecutorConfig["serviceAccount"];
      envFromSecrets?: K8sRunExecutorConfig["envFromSecrets"];
    };
  private k8sClient: K8sClient;

  constructor(config: K8sRunExecutorConfig, k8sClient: K8sClient) {
    this.k8sClient = k8sClient;
    this.config = {
      namespace: "default",
      imagePullPolicy: "IfNotPresent",
      ttlAfterFinished: DEFAULT_TTL_AFTER_FINISHED_SECONDS,
      debug: false,
      ...config,
    };
  }

  async createRunExecution(executionConfig: RunExecutionConfig): Promise<string> {
    const { executionId, run, managerId, timeout, env, debug } = executionConfig;
    const resourceName = this.sanitizeResourceName(executionId);
    const tenantSlug = run._tenant?.projectSlug ?? "unknown";

    const resource: K8sRunExecutionSpec = {
      metadata: {
        name: resourceName,
        namespace: this.config.namespace,
        labels: {
          "veryfront.com/component": "workflow-run-execution",
          "veryfront.com/manager": managerId,
          "veryfront.com/execution-id": executionId,
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
              "veryfront.com/component": "workflow-run-execution",
              "veryfront.com/execution-id": executionId,
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
                  { name: "MODE", value: "run" },
                  { name: "WORKFLOW_RUN_ID", value: run.id },
                  { name: "RUN_EXECUTION_ID", value: executionId },
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

    await this.k8sClient.createRunExecution(this.config.namespace, resource);

    if (debug || this.config.debug) {
      logger.info(`Created run execution ${resourceName} for run ${run.id}`);
    }

    return executionId;
  }

  async getRunExecutionStatus(executionId: string): Promise<RunExecutionInfo | null> {
    const resourceName = this.sanitizeResourceName(executionId);

    try {
      const k8sResource = await this.k8sClient.getRunExecutionResource(
        this.config.namespace,
        resourceName,
      );
      if (!k8sResource) {
        return null;
      }

      return this.parseRunExecutionInfo(k8sResource, executionId);
    } catch (error) {
      logger.debug("Failed to get K8s run execution status", { error });
      return null;
    }
  }

  async listRunExecutions(managerId: string): Promise<RunExecutionInfo[]> {
    const labelSelector = `veryfront.com/manager=${managerId}`;
    const k8sResources = await this.k8sClient.listRunExecutions(
      this.config.namespace,
      labelSelector,
    );

    return k8sResources.map((k8sResource) => {
      const executionId = k8sResource.metadata.labels["veryfront.com/execution-id"] ??
        k8sResource.metadata.name;
      return this.parseRunExecutionInfo(k8sResource, executionId);
    });
  }

  async deleteRunExecution(executionId: string): Promise<void> {
    const resourceName = this.sanitizeResourceName(executionId);

    try {
      await this.k8sClient.deleteRunExecution(this.config.namespace, resourceName);

      if (this.config.debug) {
        logger.info(`Deleted run execution ${resourceName}`);
      }
    } catch (error) {
      logger.warn(`Failed to delete run execution ${resourceName}:`, error);
    }
  }

  /**
   * Convert execution ID to a valid K8s resource name
   */
  private sanitizeResourceName(executionId: string): string {
    return `wf-${executionId.replace(/_/g, "-").toLowerCase()}`;
  }

  /**
   * Build tenant environment variables
   */
  private buildTenantEnv(
    run: RunExecutionConfig["run"],
  ): Array<{ name: string; value: string }> {
    if (!run._tenant) {
      return [];
    }

    const { projectSlug, token, projectId, productionMode, releaseId, branch, environmentName } =
      run._tenant;
    const env = [
      { name: "TENANT_PROJECT_SLUG", value: projectSlug },
      { name: "TENANT_TOKEN", value: token },
      { name: "TENANT_PROJECT_ID", value: projectId ?? "" },
      { name: "TENANT_PRODUCTION_MODE", value: productionMode ? "1" : "0" },
      { name: "TENANT_RELEASE_ID", value: releaseId ?? "" },
    ];

    if (branch) {
      env.push(
        { name: "TENANT_BRANCH_ID", value: branch },
        { name: "VERYFRONT_BRANCH_REF", value: branch },
      );
    }

    if (environmentName) {
      env.push(
        { name: "TENANT_ENVIRONMENT_NAME", value: environmentName },
        { name: "VERYFRONT_ENVIRONMENT_NAME", value: environmentName },
      );
    }

    return env;
  }

  /**
   * Parse K8s run execution response to RunExecutionInfo
   */
  private parseRunExecutionInfo(
    k8sResource: K8sRunExecutionStatusResponse,
    executionId: string,
  ): RunExecutionInfo {
    const runId = k8sResource.metadata.labels["veryfront.com/run-id"] ?? "";

    return {
      executionId,
      runId,
      status: this.parseStatus(k8sResource),
      createdAt: new Date(k8sResource.metadata.creationTimestamp),
      startedAt: k8sResource.status.startTime ? new Date(k8sResource.status.startTime) : undefined,
      completedAt: k8sResource.status.completionTime
        ? new Date(k8sResource.status.completionTime)
        : undefined,
      error: this.extractError(k8sResource),
      metadata: {
        k8sName: k8sResource.metadata.name,
        namespace: this.config.namespace,
      },
    };
  }

  /**
   * Parse K8s run execution status
   */
  private parseStatus(k8sResource: K8sRunExecutionStatusResponse): RunExecutionStatus {
    if (k8sResource.status.succeeded && k8sResource.status.succeeded > 0) {
      return "succeeded";
    }
    if (k8sResource.status.failed && k8sResource.status.failed > 0) {
      return "failed";
    }
    if (k8sResource.status.active && k8sResource.status.active > 0) {
      return "running";
    }
    return "pending";
  }

  /**
   * Extract error from K8s run execution
   */
  private extractError(k8sResource: K8sRunExecutionStatusResponse): string | undefined {
    const failedCondition = k8sResource.status.conditions?.find(
      (c) => c.type === "Failed" && c.status === "True",
    );

    if (failedCondition) {
      return failedCondition.message ?? failedCondition.reason ?? "Unknown error";
    }

    return undefined;
  }
}
