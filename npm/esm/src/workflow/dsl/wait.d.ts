import type { BaseNodeConfig, RetryConfig, WorkflowContext, WorkflowNode } from "../types.js";
export interface WaitForApprovalOptions extends Omit<BaseNodeConfig, "checkpoint"> {
    message?: string;
    payload?: unknown | ((context: WorkflowContext) => unknown);
    timeout?: string | number;
    approvers?: string[];
    retry?: RetryConfig;
    skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}
/** Create a wait-for-approval node. Pauses until human approves/rejects. */
export declare function waitForApproval(id: string, options?: WaitForApprovalOptions): WorkflowNode;
export interface WaitForEventOptions extends Omit<BaseNodeConfig, "checkpoint"> {
    eventName: string;
    timeout?: string | number;
    retry?: RetryConfig;
    skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}
/** Create a wait-for-event node. Pauses until external event is received. */
export declare function waitForEvent(id: string, options: WaitForEventOptions): WorkflowNode;
/** Create a simple delay/sleep node. */
export declare function delay(id: string, duration: string | number): WorkflowNode;
//# sourceMappingURL=wait.d.ts.map