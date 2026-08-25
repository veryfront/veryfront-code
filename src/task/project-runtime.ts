import {
  discoverProjectAgentRuntime,
  type ProjectAgentRuntimeDiscovery,
} from "#veryfront/agent/project/agent-runtime.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import type { DiscoveryResult } from "#veryfront/discovery";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RunnableTask } from "./runner.ts";

/** Project runtime discovery result used by task lookup and execution helpers. */
export type ProjectTaskRuntimeDiscovery = ProjectAgentRuntimeDiscovery;

/** Options for discovering tasks through the unified project runtime. */
export interface ProjectTaskRuntimeOptions {
  /** Project root used to resolve local discovery paths and configuration. */
  projectDir: string;
  /** Runtime adapter that owns filesystem and environment access. */
  adapter: RuntimeAdapter;
  /** Preloaded project configuration, or `null` to load it from the project. */
  config?: VeryfrontConfig | null;
  /** Optional filesystem override for virtual or hosted project sources. */
  fsAdapter?: FileSystemAdapter;
  /** Source-specific configuration cache key. */
  cacheKey?: string;
  /** Emit verbose discovery diagnostics. */
  debug?: boolean;
  /** Reject the discovery when any colocated project primitive fails to load. */
  throwOnErrors?: boolean;
  /** Explicit host-owned capability for a trusted local or dedicated runtime. */
  allowHostProjectCodeExecution?: boolean;
}

function formatRuntimeDiscoveryError(error: DiscoveryResult["errors"][number]): string {
  return `${error.file}: ${error.error.message}`;
}

/** Format project-runtime discovery failures for CLI and operator diagnostics. */
export function formatProjectRuntimeDiscoveryErrors(
  errors: DiscoveryResult["errors"],
): string[] {
  return errors.map(formatRuntimeDiscoveryError);
}

/** Discover project tasks and the colocated runtime primitives they may use. */
export async function discoverProjectTaskRuntime(
  options: ProjectTaskRuntimeOptions,
): Promise<ProjectTaskRuntimeDiscovery> {
  const discovery = await discoverProjectAgentRuntime({
    projectDir: options.projectDir,
    adapter: options.adapter,
    config: options.config,
    fsAdapter: options.fsAdapter,
    cacheKey: options.cacheKey,
    verbose: options.debug,
    allowHostProjectCodeExecution: options.allowHostProjectCodeExecution,
  });

  if (options.throwOnErrors && discovery.errors.length > 0) {
    const lines = formatProjectRuntimeDiscoveryErrors(discovery.errors);
    throw INITIALIZATION_ERROR.create({
      detail: [
        `Runtime discovery failed with ${discovery.errors.length} errors:`,
        ...lines.map((line) => `- ${line}`),
      ].join("\n"),
    });
  }

  return discovery;
}

function resolveTaskName(definition: RunnableTask["definition"], taskId: string): string {
  return typeof definition.name === "string" && definition.name.trim().length > 0
    ? definition.name
    : taskId;
}

function compareTaskIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Find one task by its stable project-runtime ID. */
export function findProjectRuntimeTask(
  discovery: DiscoveryResult,
  taskId: string,
): RunnableTask | null {
  const definition = discovery.tasks.get(taskId);
  if (!definition) return null;

  return {
    id: taskId,
    name: resolveTaskName(definition, taskId),
    definition,
  };
}

/** List project-runtime tasks in deterministic ID order. */
export function listProjectRuntimeTasks(discovery: DiscoveryResult): RunnableTask[] {
  return [...discovery.tasks]
    .sort(([left], [right]) => compareTaskIds(left, right))
    .map(([id, definition]) => ({
      id,
      name: resolveTaskName(definition, id),
      definition,
    }));
}
