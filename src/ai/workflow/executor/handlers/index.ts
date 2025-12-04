/**
 * Node Handlers Module
 *
 * Contains the Strategy pattern implementation for workflow node execution:
 * - INodeHandler: Interface for all node handlers
 * - BaseNodeHandler: Base class with common functionality
 * - NodeHandlerRegistry: Registry for handler lookup
 *
 * Handler implementations:
 * - StepNodeHandler: Basic workflow step execution
 * - ParallelNodeHandler: Concurrent node execution
 * - BranchNodeHandler: Conditional branching
 * - WaitNodeHandler: Human approval / event waiting
 */

// Core interfaces and base class
export {
  BaseNodeHandler,
  type INodeHandler,
  type NodeExecutionResult,
  type NodeHandlerContext,
} from "./node-handler.ts";

// Registry
export { createNodeHandlerRegistry, NodeHandlerRegistry } from "./node-handler-registry.ts";

// Sub-executor interface (for parallel/branch handlers)
export type { DAGSubExecutionResult, IDAGSubExecutor } from "./dag-executor-interface.ts";

// Handler implementations
export {
  createStepNodeHandler,
  type StepNodeCallbacks,
  StepNodeHandler,
} from "./step-node-handler.ts";

export {
  createParallelNodeHandler,
  type ParallelNodeCallbacks,
  ParallelNodeHandler,
} from "./parallel-node-handler.ts";

export {
  type BranchNodeCallbacks,
  BranchNodeHandler,
  createBranchNodeHandler,
} from "./branch-node-handler.ts";

export {
  createWaitNodeHandler,
  type WaitNodeCallbacks,
  WaitNodeHandler,
} from "./wait-node-handler.ts";
