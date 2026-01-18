/**
 * Workflow DSL Exports
 *
 * Public API for building workflows
 */

// Main workflow builder
export { dag, dependsOn, sequence, workflow } from "./workflow.ts";
export type { Workflow, WorkflowOptions } from "./workflow.ts";

// Step builder
export { agentStep, step, toolStep } from "./step.ts";
export type { StepOptions } from "./step.ts";

// Parallel execution
export { parallel } from "./parallel.ts";
export type { ParallelOptions } from "./parallel.ts";

// Map/Fan-out execution
export { map } from "./map.ts";
export type { MapOptions } from "./map.ts";

// Sub-workflow execution
export { subWorkflow } from "./sub-workflow.ts";
export type { SubWorkflowOptions } from "./sub-workflow.ts";

// Conditional branching
export { branch, unless, when } from "./branch.ts";
export type { BranchOptions } from "./branch.ts";

// Wait/approval nodes
export { delay, waitForApproval, waitForEvent } from "./wait.ts";
export type { WaitForApprovalOptions, WaitForEventOptions } from "./wait.ts";

// Loop/iteration nodes
export { doWhile, loop, times } from "./loop.ts";
export type { LoopContext, LoopNodeConfig, LoopOptions } from "./loop.ts";
