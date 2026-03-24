/**
 * Workflow Discovery
 *
 * Discovers workflow definitions from user's project files.
 * Uses the same patterns as API route discovery.
 *
 * Scans:
 * - app/workflows/*.ts - workflow definition files
 * - app/workflows/**\/*.ts - nested workflow files
 *
 * Workflow files should export a workflow definition:
 * ```typescript
 * import { workflow, step } from "veryfront/workflow";
 *
 * export const myWorkflow = workflow({
 *   id: "my-workflow",
 *   steps: [step("process", { agent: "processor" })],
 * });
 *
 * // Or as default export
 * export default workflow({ ... });
 * ```
 */

import { join } from "@std/path";
import { logger as baseLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import { collectFiles } from "#veryfront/utils/file-discovery.ts";
import { importDiscoveryModule } from "#veryfront/discovery/module-import.ts";
import type { WorkflowDefinition } from "../types.ts";

const logger = baseLogger.component("workflow-discovery");

/**
 * Discovered workflow info
 */
export interface DiscoveredWorkflow {
  /** Workflow ID from the definition */
  id: string;

  /** File path where the workflow is defined */
  filePath: string;

  /** Export name (e.g., "myWorkflow" or "default") */
  exportName: string;

  /** The workflow definition */
  definition: WorkflowDefinition;
}

/**
 * Options for workflow discovery
 */
export interface WorkflowDiscoveryOptions {
  /** Project directory */
  projectDir: string;

  /** Runtime adapter for filesystem operations */
  adapter: RuntimeAdapter;

  /** Veryfront config (for import maps, etc.) */
  config?: VeryfrontConfig;

  /** Base directory for workflows (default: "app/workflows") */
  workflowsDir?: string;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result of workflow discovery
 */
export interface WorkflowDiscoveryResult {
  /** All discovered workflows */
  workflows: DiscoveredWorkflow[];

  /** Errors encountered during discovery */
  errors: Array<{ filePath: string; error: string }>;
}

/**
 * Check if a value looks like a workflow definition
 */
function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === "string" && typeof obj.steps !== "undefined";
}

/**
 * Check if a value is a workflow wrapper (from workflow() DSL)
 */
function isWorkflowWrapper(value: unknown): value is { definition: WorkflowDefinition } {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return isWorkflowDefinition(obj.definition);
}

/**
 * Extract workflow definition from a module export
 */
function extractWorkflowDefinition(value: unknown): WorkflowDefinition | null {
  // Direct WorkflowDefinition
  if (isWorkflowDefinition(value)) {
    return value;
  }

  // Workflow wrapper (from workflow() DSL)
  if (isWorkflowWrapper(value)) {
    return value.definition;
  }

  return null;
}

/**
 * Discover all workflows in a project
 */
export async function discoverWorkflows(
  options: WorkflowDiscoveryOptions,
): Promise<WorkflowDiscoveryResult> {
  const {
    projectDir,
    adapter,
    config,
    workflowsDir = "app/workflows",
    debug = false,
  } = options;

  const workflows: DiscoveredWorkflow[] = [];
  const errors: Array<{ filePath: string; error: string }> = [];

  // For remote adapters, use relative paths
  const fsType = config?.fs?.type ?? "local";
  const useRelativePaths = fsType === "github" || fsType === "veryfront-api";
  const baseDir = useRelativePaths ? workflowsDir : join(projectDir, workflowsDir);

  if (debug) {
    logger.info(`Scanning ${baseDir} for workflows`);
  }

  try {
    // Check if workflows directory exists
    const dirExists = await adapter.fs.exists(baseDir);
    if (!dirExists) {
      if (debug) {
        logger.info(`No workflows directory found at ${baseDir}`);
      }
      return { workflows, errors };
    }

    // Discover workflow files
    const files = await collectFiles({
      baseDir,
      extensions: [".ts", ".tsx", ".js", ".jsx"],
      recursive: true,
      ignorePatterns: ["node_modules", ".git", "__tests__", "*.test.*", "*.spec.*"],
      adapter,
    });

    if (debug) {
      logger.info(`Found ${files.length} potential workflow files`);
    }

    // Load and extract workflows from each file
    for (const file of files) {
      try {
        const module = await importDiscoveryModule(file.path, {
          adapter,
          projectDir,
        });

        // Extract workflows from module exports
        for (const [exportName, value] of Object.entries(module)) {
          const definition = extractWorkflowDefinition(value);
          if (definition) {
            workflows.push({
              id: definition.id,
              filePath: file.path,
              exportName,
              definition,
            });

            if (debug) {
              logger.info(
                `[WorkflowDiscovery] Found workflow "${definition.id}" in ${file.path} (export: ${exportName})`,
              );
            }
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ filePath: file.path, error: errorMsg });

        if (debug) {
          logger.warn(`Failed to load ${file.path}: ${errorMsg}`);
        }
      }
    }

    if (debug) {
      logger.info(`Discovered ${workflows.length} workflows`);
    }

    return { workflows, errors };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Discovery failed: ${errorMsg}`);
    errors.push({ filePath: baseDir, error: errorMsg });
    return { workflows, errors };
  }
}

/**
 * Find a specific workflow by ID
 */
export async function findWorkflowById(
  workflowId: string,
  options: WorkflowDiscoveryOptions,
): Promise<DiscoveredWorkflow | null> {
  const { workflows } = await discoverWorkflows(options);
  return workflows.find((w) => w.id === workflowId) ?? null;
}

/**
 * Create a workflow registry from discovered workflows
 */
export function createWorkflowRegistry(
  workflows: DiscoveredWorkflow[],
): Map<string, DiscoveredWorkflow> {
  const registry = new Map<string, DiscoveredWorkflow>();
  for (const workflow of workflows) {
    registry.set(workflow.id, workflow);
  }
  return registry;
}
