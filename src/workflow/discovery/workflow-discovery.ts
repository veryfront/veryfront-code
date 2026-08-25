/**
 * Workflow Discovery
 *
 * Discovers workflow definitions from user's project files.
 * Uses the same patterns as API route discovery.
 *
 * Scans:
 * - workflows/*.ts - workflow definition files
 * - workflows/**\/*.ts - nested workflow files
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

import { join } from "#veryfront/compat/path";
import { logger as baseLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import { collectFiles } from "#veryfront/utils/file-discovery.ts";
import { importDiscoveryModule } from "#veryfront/discovery/module-import.ts";
import type { WorkflowDefinition } from "../types.ts";
import { captureWorkflowDefinition } from "../executor/workflow-definition-snapshot.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { normalizeProjectRelativeDiscoveryPath } from "#veryfront/utils/discovery-path-policy.ts";

const logger = baseLogger.component("workflow-discovery");
const arrayIsArray = Array.isArray;
const arrayJoin = Array.prototype.join;
const arrayPush = Array.prototype.push;
const arraySlice = Array.prototype.slice;
const arraySort = Array.prototype.sort;
const MapConstructor = Map;
const mapHas = Map.prototype.has;
const mapSet = Map.prototype.set;
const objectEntries = Object.entries;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectApply = Reflect.apply;

function append<T>(values: T[], value: T): void {
  reflectApply(arrayPush, values, [value]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortValues<T>(values: T[], compare: (left: T, right: T) => number): T[] {
  return reflectApply(arraySort, values, [compare]) as T[];
}

function toErrorMessage(error: unknown): string {
  return snapshotThrowableDiagnostic(error);
}

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

  /** Base directory for workflows (default: "workflows") */
  workflowsDir?: string;

  /** Enable debug logging */
  debug?: boolean;

  /** Explicit host-owned capability for a trusted local or dedicated runtime. */
  allowHostProjectCodeExecution?: boolean;
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

function isWorkflowDefinitionCandidate(value: unknown): value is WorkflowDefinition {
  if (
    typeof value !== "object" || value === null || arrayIsArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    return false;
  }
  try {
    return objectGetOwnPropertyDescriptor(value, "id") !== undefined &&
      objectGetOwnPropertyDescriptor(value, "steps") !== undefined;
  } catch {
    return false;
  }
}

/**
 * Extract workflow definition from a module export
 */
function extractWorkflowDefinition(value: unknown): WorkflowDefinition | null {
  if (
    typeof value !== "object" || value === null || arrayIsArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    return null;
  }

  let candidate: unknown = value;
  const definitionDescriptor = objectGetOwnPropertyDescriptor(value, "definition");
  if (definitionDescriptor !== undefined) {
    if (!("value" in definitionDescriptor)) {
      throw new TypeError("Workflow wrapper definition must be a data property");
    }
    candidate = definitionDescriptor.value;
  }

  if (!isWorkflowDefinitionCandidate(candidate)) return null;
  return captureWorkflowDefinition(candidate, { allowEmptySteps: true });
}

function finalizeWorkflowDiscoveryResult(
  workflows: DiscoveredWorkflow[],
  errors: WorkflowDiscoveryResult["errors"],
): WorkflowDiscoveryResult {
  const sorted = sortValues(
    reflectApply(arraySlice, workflows, []) as DiscoveredWorkflow[],
    (left, right) =>
      compareText(left.id, right.id) ||
      compareText(left.filePath, right.filePath) ||
      compareText(left.exportName, right.exportName),
  );
  const unique: DiscoveredWorkflow[] = [];

  for (let index = 0; index < sorted.length;) {
    let end = index + 1;
    while (end < sorted.length && sorted[end]!.id === sorted[index]!.id) end++;
    if (end === index + 1) {
      append(unique, sorted[index]!);
      index = end;
      continue;
    }

    const declarations: string[] = [];
    for (let declarationIndex = index; declarationIndex < end; declarationIndex++) {
      const workflow = sorted[declarationIndex]!;
      append(declarations, `${workflow.filePath} (export ${workflow.exportName})`);
    }
    const message = `Duplicate workflow id "${sorted[index]!.id}" was declared by: ${
      reflectApply(arrayJoin, declarations, [", "])
    }`;
    for (let declarationIndex = index; declarationIndex < end; declarationIndex++) {
      append(errors, {
        filePath: sorted[declarationIndex]!.filePath,
        error: message,
      });
    }
    index = end;
  }

  sortValues(
    errors,
    (left, right) =>
      compareText(left.filePath, right.filePath) || compareText(left.error, right.error),
  );
  return { workflows: unique, errors };
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
    workflowsDir: configuredWorkflowsDir = "workflows",
    debug = false,
    allowHostProjectCodeExecution,
  } = options;

  const workflows: DiscoveredWorkflow[] = [];
  const errors: Array<{ filePath: string; error: string }> = [];

  let baseDir = configuredWorkflowsDir;

  try {
    const workflowsDir = normalizeProjectRelativeDiscoveryPath(configuredWorkflowsDir);
    const fsType = config?.fs?.type ?? "local";
    const useRelativePaths = fsType === "github" || fsType === "veryfront-api";
    baseDir = useRelativePaths ? workflowsDir : join(projectDir, workflowsDir);

    if (debug) {
      logger.info(`Scanning ${baseDir} for workflows`);
    }

    // Check if workflows directory exists
    const dirExists = await adapter.fs.exists(baseDir);
    if (!dirExists) {
      if (debug) {
        logger.info(`No workflows directory found at ${baseDir}`);
      }
      return finalizeWorkflowDiscoveryResult(workflows, errors);
    }

    // Discover workflow files
    const files = await collectFiles({
      baseDir,
      extensions: [".ts", ".tsx", ".js", ".jsx"],
      recursive: true,
      ignorePatterns: ["node_modules", ".git", "__tests__", "*.test.*", "*.spec.*"],
      adapter,
    });
    sortValues(files, (left, right) => compareText(left.path, right.path));

    if (debug) {
      logger.info(`Found ${files.length} potential workflow files`);
    }

    // Load and extract workflows from each file
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex]!;
      try {
        const module = await importDiscoveryModule(file.path, {
          adapter,
          projectDir,
          allowHostProjectCodeExecution,
        });

        // Extract workflows from module exports
        const exports = objectEntries(module);
        sortValues(exports, (left, right) => compareText(left[0], right[0]));
        for (let exportIndex = 0; exportIndex < exports.length; exportIndex++) {
          const [exportName, value] = exports[exportIndex]!;
          try {
            const definition = extractWorkflowDefinition(value);
            if (!definition) continue;
            append(workflows, {
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
          } catch (error) {
            append(errors, { filePath: file.path, error: toErrorMessage(error) });
          }
        }
      } catch (error) {
        const errorMsg = toErrorMessage(error);
        append(errors, { filePath: file.path, error: errorMsg });

        if (debug) {
          logger.warn(`Failed to load ${file.path}: ${errorMsg}`);
        }
      }
    }
  } catch (error) {
    const errorMsg = toErrorMessage(error);
    logger.error(`Discovery failed: ${errorMsg}`);
    append(errors, { filePath: baseDir, error: errorMsg });
  }

  const result = finalizeWorkflowDiscoveryResult(workflows, errors);
  if (debug) logger.info(`Discovered ${result.workflows.length} workflows`);
  return result;
}

/**
 * Find a specific workflow by ID
 */
export async function findWorkflowById(
  workflowId: string,
  options: WorkflowDiscoveryOptions,
): Promise<DiscoveredWorkflow | null> {
  const { workflows } = await discoverWorkflows(options);
  for (let index = 0; index < workflows.length; index++) {
    if (workflows[index]!.id === workflowId) return workflows[index]!;
  }
  return null;
}

/**
 * Create a workflow registry from discovered workflows
 */
export function createWorkflowRegistry(
  workflows: DiscoveredWorkflow[],
): Map<string, DiscoveredWorkflow> {
  const registry = new MapConstructor<string, DiscoveredWorkflow>();
  for (let index = 0; index < workflows.length; index++) {
    const workflow = workflows[index]!;
    const id = workflow.id;
    if (typeof id !== "string" || id.length === 0) {
      throw INVALID_ARGUMENT.create({
        detail: "Discovered workflow id must be a non-empty string",
      });
    }
    if (reflectApply(mapHas, registry, [id])) {
      throw INVALID_ARGUMENT.create({
        detail: `Duplicate workflow id "${id}" cannot be added to the registry`,
      });
    }
    reflectApply(mapSet, registry, [id, workflow]);
  }
  return registry;
}
