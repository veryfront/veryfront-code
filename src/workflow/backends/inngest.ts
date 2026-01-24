import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  RunFilter,
  WorkflowJob,
  WorkflowRun,
} from "../types.ts";
import type { BackendConfig, WorkflowBackend } from "./types.ts";
import { agentLogger as logger } from "#veryfront/utils";

export interface InngestAdapterConfig extends BackendConfig {
  eventKey?: string;
  signingKey?: string;
  baseUrl?: string;
  debug?: boolean;
}

export class InngestAdapter implements WorkflowBackend {
  private config: InngestAdapterConfig;

  constructor(config: InngestAdapterConfig = {}) {
    this.config = { debug: false, ...config };

    logger.warn(
      "[InngestAdapter] This is a stub implementation. Full Inngest integration requires additional setup. See: https://www.inngest.com/docs",
    );
  }

  createRun(_run: WorkflowRun): Promise<void> {
    throw new Error("InngestAdapter.createRun not implemented");
  }

  getRun(_runId: string): Promise<WorkflowRun | null> {
    throw new Error("InngestAdapter.getRun not implemented");
  }

  updateRun(_runId: string, _patch: Partial<WorkflowRun>): Promise<void> {
    throw new Error("InngestAdapter.updateRun not implemented");
  }

  listRuns(_filter: RunFilter): Promise<WorkflowRun[]> {
    throw new Error("InngestAdapter.listRuns not implemented");
  }

  saveCheckpoint(_runId: string, _checkpoint: Checkpoint): Promise<void> {
    throw new Error("InngestAdapter.saveCheckpoint not implemented");
  }

  getLatestCheckpoint(_runId: string): Promise<Checkpoint | null> {
    throw new Error("InngestAdapter.getLatestCheckpoint not implemented");
  }

  savePendingApproval(_runId: string, _approval: PendingApproval): Promise<void> {
    throw new Error("InngestAdapter.savePendingApproval not implemented");
  }

  getPendingApprovals(_runId: string): Promise<PendingApproval[]> {
    throw new Error("InngestAdapter.getPendingApprovals not implemented");
  }

  updateApproval(
    _runId: string,
    _approvalId: string,
    _decision: ApprovalDecision,
  ): Promise<void> {
    throw new Error("InngestAdapter.updateApproval not implemented");
  }

  enqueue(_job: WorkflowJob): Promise<void> {
    throw new Error("InngestAdapter.enqueue not implemented");
  }

  dequeue(): Promise<WorkflowJob | null> {
    throw new Error("InngestAdapter.dequeue not implemented");
  }

  acknowledge(_runId: string): Promise<void> {
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    return Promise.resolve();
  }
}
