import type { Checkpoint, NodeState, WorkflowContext, WorkflowNode } from "../types.js";
import type { WorkflowBackend } from "../backends/types.js";
export interface CheckpointManagerConfig {
    backend: WorkflowBackend;
    debug?: boolean;
}
export interface ResumeInfo {
    checkpoint: Checkpoint;
    startFromNode: string;
    context: WorkflowContext;
    nodeStates: Record<string, NodeState>;
}
export declare class CheckpointManager {
    private config;
    constructor(config: CheckpointManagerConfig);
    save(runId: string, checkpoint: Checkpoint): Promise<void>;
    createCheckpoint(runId: string, nodeId: string, context: WorkflowContext, nodeStates: Record<string, NodeState>): Promise<Checkpoint>;
    getLatest(runId: string): Promise<Checkpoint | null>;
    getAll(runId: string): Promise<Checkpoint[]>;
    prepareResume(runId: string, nodes: WorkflowNode[], fromCheckpoint?: string): Promise<ResumeInfo | null>;
    private findNextNode;
    shouldCheckpoint(node: WorkflowNode): boolean;
    cleanup(runId: string, keepCount?: number): Promise<void>;
}
//# sourceMappingURL=checkpoint-manager.d.ts.map