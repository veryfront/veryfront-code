import type { NodeStatus, WorkflowNode } from "../../types.js";
export declare function deriveNodeStatus(completed: boolean, waiting: boolean): NodeStatus;
export declare function shouldCheckpoint(node: WorkflowNode): boolean;
export declare function sleep(ms: number): Promise<void>;
//# sourceMappingURL=utils.d.ts.map