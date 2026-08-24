/**************************
 * Workflow Client
 *
 * High-level API for interacting with workflows
 **************************/

import { logger as baseLogger } from "#veryfront/utils";
import type {
  PendingApproval,
  RunFilter,
  WaitNodeConfig,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";
import { hasRunObservationSupport, type WorkflowBackend } from "../backends/types.ts";
import { deriveWorkflowRunEventObservation, type WorkflowRunEventObservation } from "../events.ts";
import { MemoryBackend } from "../backends/memory.ts";
import {
  WorkflowExecutor,
  type WorkflowExecutorConfig,
  type WorkflowHandle,
} from "../executor/workflow-executor.ts";
import { ApprovalManager, type ApprovalManagerConfig } from "../runtime/approval-manager.ts";
import type { Workflow } from "../dsl/workflow.ts";

const logger = baseLogger.component("workflow-client");

/** Configuration used by workflow client. */
export interface WorkflowClientConfig {
  /** Backend for persistence (default: MemoryBackend) */
  backend?: WorkflowBackend;
  /** Executor configuration */
  executor?: Partial<WorkflowExecutorConfig>;
  /** Approval manager configuration */
  approval?: Partial<ApprovalManagerConfig>;
  /** Enable debug logging */
  debug?: boolean;
}

/** Supported observation stream or an explicit unsupported-backend result. */
export type WorkflowRunEventsResult =
  | ({ supported: true } & WorkflowRunEventObservation)
  | { supported: false; reason: "unsupported" };

/** Implement workflow client. */
export class WorkflowClient {
  private backend: WorkflowBackend;
  private executor: WorkflowExecutor;
  private approvalManager: ApprovalManager;
  private debug: boolean;
  /** Wait-node configs from registered definitions, keyed "<workflowId>::<nodeId>". */
  private waitNodeConfigs = new Map<string, WaitNodeConfig>();

  constructor(config: WorkflowClientConfig = {}) {
    this.debug = config.debug ?? false;
    this.backend = config.backend ?? new MemoryBackend({ debug: this.debug });

    const userOnWaiting = config.executor?.onWaiting;
    const userResponseSchemaResolver = config.approval?.responseSchemaResolver;

    this.executor = new WorkflowExecutor({
      backend: this.backend,
      debug: this.debug,
      ...config.executor,
      onWaiting: async (run, nodeId, activeWaitConfig) => {
        const input = run.nodeStates[nodeId]?.input as
          | { type?: string; message?: string; payload?: unknown }
          | undefined;

        if (!input) {
          logger.debug("No wait config found for node", { nodeId });
          await userOnWaiting?.(run, nodeId);
          return;
        }

        if (input.type !== "approval") {
          await userOnWaiting?.(run, nodeId);
          return;
        }

        // Node state persists only the resolved message and payload. Carry the
        // exact runtime config across the pause boundary so nested nodes that
        // reuse an id and function-generated nodes retain their own policy.
        // The registered definition remains a compatibility fallback for an
        // execution result produced without the runtime config.
        const registered = this.waitNodeConfigs.get(`${run.workflowId}::${nodeId}`);
        const configured = activeWaitConfig ?? registered;
        const waitConfig: WaitNodeConfig = {
          type: "wait" as const,
          waitType: "approval" as const,
          message: input.message,
          payload: input.payload,
          ...(configured?.timeout !== undefined ? { timeout: configured.timeout } : {}),
          ...(configured?.approvers !== undefined ? { approvers: configured.approvers } : {}),
          ...(configured?.responseSchema !== undefined
            ? { responseSchema: configured.responseSchema }
            : {}),
        };

        try {
          await this.approvalManager.createApproval(run, nodeId, waitConfig, run.context);
          logger.debug("Created approval for node", { nodeId });
        } catch (error) {
          logger.error("Failed to create approval", error);
          throw error;
        }

        await userOnWaiting?.(run, nodeId);
      },
    });

    this.approvalManager = new ApprovalManager({
      backend: this.backend,
      executor: this.executor,
      debug: this.debug,
      ...config.approval,
      responseSchemaResolver: async (input) => {
        const userSchema = await userResponseSchemaResolver?.(input);
        if (userSchema) return userSchema;

        return this.waitNodeConfigs.get(`${input.run.workflowId}::${input.approval.nodeId}`)
          ?.responseSchema;
      },
    });
  }

  register(workflow: Workflow | WorkflowDefinition): void {
    const definition = "definition" in workflow ? workflow.definition : workflow;
    this.executor.register(definition);
    this.indexWaitNodeConfigs(definition);
    logger.debug("Registered workflow", { workflowId: definition.id });
  }

  /**
   * Record every wait node's config under "<workflowId>::<nodeId>".
   *
   * `responseSchema` is a live object and cannot be persisted on an approval,
   * so this index lets a later process recover decision validation from the
   * currently registered definition. Node ids are already arm-qualified by
   * the DSL, so they match what an approval is keyed by. A statically declared
   * sub-workflow is walked too: its child node ids are not namespaced at
   * runtime and its approvals are reported on the parent run, so its wait
   * nodes are keyed under the registering workflow's id.
   *
   * A workflow or loop whose `steps` is a function is not walked: the node list
   * depends on runtime input/iteration state, so no schema can be recovered
   * from the definition after a process restart. During execution, the exact
   * runtime config supplies expiry, approvers, and response validation.
   */
  private indexWaitNodeConfigs(definition: WorkflowDefinition): void {
    const keyPrefix = `${definition.id}::`;
    for (const key of this.waitNodeConfigs.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.waitNodeConfigs.delete(key);
      }
    }

    if (!Array.isArray(definition.steps)) return;

    const visit = (nodes: readonly WorkflowNode[]): void => {
      for (const node of nodes) {
        const config = node.config as {
          type?: string;
          nodes?: WorkflowNode[];
          then?: WorkflowNode[];
          else?: WorkflowNode[];
          steps?: WorkflowNode[] | ((...args: never[]) => WorkflowNode[]);
          workflow?: string | WorkflowDefinition;
        };
        if (config.type === "wait") {
          this.waitNodeConfigs.set(`${definition.id}::${node.id}`, node.config as WaitNodeConfig);
        }
        if (Array.isArray(config.nodes)) visit(config.nodes);
        if (Array.isArray(config.then)) visit(config.then);
        if (Array.isArray(config.else)) visit(config.else);
        if (Array.isArray(config.steps)) visit(config.steps);
        if (
          typeof config.workflow === "object" &&
          Array.isArray(config.workflow.steps)
        ) {
          visit(config.workflow.steps);
        }
      }
    };

    visit(definition.steps);
  }

  registerAll(workflows: Array<Workflow | WorkflowDefinition>): void {
    for (const workflow of workflows) this.register(workflow);
  }

  start<TInput, TOutput = unknown>(
    workflowId: string,
    input: TInput,
    options?: { runId?: string },
  ): Promise<WorkflowHandle<TOutput>> {
    return this.executor.start<TInput, TOutput>(workflowId, input, options);
  }

  resume(runId: string, expectedWorkerId?: string): Promise<void> {
    return this.executor.resume(runId, undefined, expectedWorkerId);
  }

  retry(runId: string): Promise<void> {
    return this.executor.retry(runId);
  }

  cancel(runId: string): Promise<void> {
    return this.executor.cancel(runId);
  }

  /** Read a run, including the approvals it is currently waiting on. */
  getRun(runId: string): Promise<WorkflowRun | null> {
    return this.backend.getRun(runId);
  }

  listRuns(filter?: RunFilter): Promise<WorkflowRun[]> {
    return this.backend.listRuns(filter ?? {});
  }

  getRunsByStatus(
    status: WorkflowStatus | WorkflowStatus[],
    limit?: number,
  ): Promise<WorkflowRun[]> {
    return this.backend.listRuns({ status, limit });
  }

  getRunsForWorkflow(workflowId: string, limit?: number): Promise<WorkflowRun[]> {
    return this.backend.listRuns({ workflowId, limit });
  }

  getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    return this.approvalManager.getPendingApprovals(runId);
  }

  async approve(
    runId: string,
    approvalId: string,
    approver: string,
    comment?: string,
    data?: unknown,
  ): Promise<void> {
    return await this.approvalManager.approve(runId, approvalId, approver, comment, data);
  }

  async reject(
    runId: string,
    approvalId: string,
    approver: string,
    comment?: string,
    data?: unknown,
  ): Promise<void> {
    return await this.approvalManager.reject(runId, approvalId, approver, comment, data);
  }

  listAllPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    return this.approvalManager.listAllPending(filter);
  }

  /** Open an ordered event observation, or report unsupported custom backends explicitly. */
  async observeRunEvents(
    runId: string,
    options?: { signal?: AbortSignal },
  ): Promise<WorkflowRunEventsResult | null> {
    if (!hasRunObservationSupport(this.backend)) {
      return { supported: false, reason: "unsupported" };
    }
    const observation = await this.backend.openRunObservation(runId, options);
    if (!observation) return null;
    return { supported: true, ...deriveWorkflowRunEventObservation(observation) };
  }

  getBackend(): WorkflowBackend {
    return this.backend;
  }

  getExecutor(): WorkflowExecutor {
    return this.executor;
  }

  getApprovalManager(): ApprovalManager {
    return this.approvalManager;
  }

  async destroy(): Promise<void> {
    this.approvalManager.stop();
    await this.backend.destroy();
    logger.debug("Destroyed");
  }
}

/** Create workflow client. */
export function createWorkflowClient(config?: WorkflowClientConfig): WorkflowClient {
  return new WorkflowClient(config);
}
