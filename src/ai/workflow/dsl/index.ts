/**
 * Workflow DSL Exports
 *
 * Public API for building workflows
 */

// Main workflow builder
export { workflow, sequence, dag, dependsOn } from "./workflow.ts";
export type { WorkflowOptions, Workflow } from "./workflow.ts";

// Step builder
export { step, agentStep, toolStep } from "./step.ts";
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
export { branch, when, unless } from "./branch.ts";
export type { BranchOptions } from "./branch.ts";

// Wait/approval nodes
export { waitForApproval, waitForEvent, delay } from "./wait.ts";
export type { WaitForApprovalOptions, WaitForEventOptions } from "./wait.ts";
