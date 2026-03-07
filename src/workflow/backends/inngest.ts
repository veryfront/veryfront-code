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
import { NOT_SUPPORTED } from "#veryfront/errors";

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
    throw NOT_SUPPORTED.create({ detail: "InngestAdapter.createRun not implemented" });
  }

  getRun(_runId: string): Promise<WorkflowRun | null> {
    throw NOT_SUPPORTED.create({ detail: "InngestAdapter.getRun not implemented" });
  }

  updateRun(_runId: string, _patch: Partial<WorkflowRun>): Promise<void> {
    throw NOT_SUPPORTED.create({ detail: "InngestAdapter.updateRun not implemented" });
  }

  listRuns(_filter: RunFilter): Promise<WorkflowRun[]> {
    throw NOT_SUPPORTED.create({ detail: "InngestAdapter.listRuns not implemented" });
  }

  saveCheckpoint(_runId: string, _checkpoint: Checkpoint): Promise<void> {
    throw NOT_SUPPORTED.create({ detail: "InngestAdapter.saveCheckpoint not implemented" });
  }

  getLatestCheckpoint(_runId: string): Promise<Checkpoint | null> {
    throw NOT_SUPPORTED.create({ detail: "InngestAdapter.getLatestCheckpoint not implemented" });
  }

  savePendingApproval(_runId: string, _approval: PendingApproval): Promise<void> {
    throw NOT_SUPPORTED.create({ detail: "InngestAdapter.savePendingApproval not implemented" });
  }

  getPendingApprovals(_runId: string): Promise<PendingApproval[]> {
    throw NOT_SUPPORTED.create({ detail: "InngestAdapter.getPendingApprovals not implemented" });
  }

  updateApproval(
    _runId: string,
    _approvalId: string,
    _decision: ApprovalDecision,
  ): Promise<void> {
    throw NOT_SUPPORTED.create({ detail: "InngestAdapter.updateApproval not implemented" });
  }

  enqueue(_job: WorkflowJob): Promise<void> {
    throw NOT_SUPPORTED.create({ detail: "InngestAdapter.enqueue not implemented" });
  }

  dequeue(): Promise<WorkflowJob | null> {
    throw NOT_SUPPORTED.create({ detail: "InngestAdapter.dequeue not implemented" });
  }

  acknowledge(_runId: string): Promise<void> {
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    return Promise.resolve();
  }
}
