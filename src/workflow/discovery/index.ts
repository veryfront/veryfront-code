/**
 * Workflow Discovery Module
 *
 * Provides utilities for discovering workflow definitions from user code.
 */

export {
  createWorkflowRegistry,
  type DiscoveredWorkflow,
  discoverWorkflows,
  findWorkflowById,
  type WorkflowDiscoveryOptions,
  type WorkflowDiscoveryResult,
} from "./workflow-discovery.ts";
