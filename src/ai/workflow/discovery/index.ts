/**
 * Workflow Discovery Module
 *
 * Provides utilities for discovering workflow definitions from user code.
 */

export {
  createWorkflowRegistry,
  discoverWorkflows,
  findWorkflowById,
  type DiscoveredWorkflow,
  type WorkflowDiscoveryOptions,
  type WorkflowDiscoveryResult,
} from "./workflow-discovery.ts";
