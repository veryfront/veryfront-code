import type { Agent } from "../../agent/index.js";
import type { Tool } from "../../tool/index.js";
import type { BaseNodeConfig, RetryConfig, WorkflowContext, WorkflowNode } from "../types.js";
export interface StepOptions extends Omit<BaseNodeConfig, "checkpoint"> {
    agent?: string | Agent;
    tool?: string | Tool;
    input?: string | Record<string, unknown> | ((context: WorkflowContext) => unknown);
    checkpoint?: boolean;
    retry?: RetryConfig;
    timeout?: string | number;
    skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}
export declare function step(id: string, options: StepOptions): WorkflowNode;
export declare function agentStep(id: string, agent: string | Agent, options?: Omit<StepOptions, "agent" | "tool">): WorkflowNode;
export declare function toolStep(id: string, tool: string | Tool, options?: Omit<StepOptions, "agent" | "tool">): WorkflowNode;
//# sourceMappingURL=step.d.ts.map