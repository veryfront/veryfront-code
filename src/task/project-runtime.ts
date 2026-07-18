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

export interface ProjectTaskRuntimeOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig | null;
  fsAdapter?: FileSystemAdapter;
  cacheKey?: string;
  debug?: boolean;
  throwOnErrors?: boolean;
}

function formatRuntimeDiscoveryError(error: DiscoveryResult["errors"][number]): string {
  return `${error.file}: ${error.error.message}`;
}

export function formatProjectRuntimeDiscoveryErrors(
  errors: DiscoveryResult["errors"],
): string[] {
  return errors.map(formatRuntimeDiscoveryError);
}

export async function discoverProjectTaskRuntime(
  options: ProjectTaskRuntimeOptions,
): Promise<ProjectAgentRuntimeDiscovery> {
  const discovery = await discoverProjectAgentRuntime({
    projectDir: options.projectDir,
    adapter: options.adapter,
    config: options.config,
    fsAdapter: options.fsAdapter,
    cacheKey: options.cacheKey,
    verbose: options.debug,
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

export function findProjectRuntimeTask(
  discovery: DiscoveryResult,
  taskId: string,
): RunnableTask | null {
  const definition = discovery.tasks.get(taskId);
  if (!definition) return null;

  return {
    id: taskId,
    name: definition.name || taskId,
    definition,
  };
}

export function listProjectRuntimeTasks(discovery: DiscoveryResult): RunnableTask[] {
  return [...discovery.tasks].map(([id, definition]) => ({
    id,
    name: definition.name || id,
    definition,
  }));
}
