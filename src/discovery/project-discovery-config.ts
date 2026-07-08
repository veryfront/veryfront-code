import type { VeryfrontConfig } from "../config/index.ts";
import type { FileSystemAdapter } from "../platform/adapters/base.ts";
import type { DiscoveryConfig } from "./types.ts";

export const DEFAULT_PROJECT_DISCOVERY_DIRS = {
  toolDirs: ["tools"],
  agentDirs: ["agents"],
  skillDirs: ["skills"],
  resourceDirs: ["resources"],
  promptDirs: ["prompts"],
  workflowDirs: ["workflows"],
  taskDirs: ["tasks"],
  scheduleDirs: ["schedules"],
  webhookDirs: ["webhooks"],
  evalDirs: ["evals"],
};

type DiscoverySettings = {
  enabled?: boolean;
  paths?: string[];
};

type ProjectDiscoveryConfigInput = {
  projectDir: string;
  config?: VeryfrontConfig | null;
  fsAdapter?: FileSystemAdapter;
  verbose?: boolean;
};

export type ProjectDiscoveryConfig = DiscoveryConfig & {
  toolDirs: string[];
  agentDirs: string[];
  skillDirs: string[];
  resourceDirs: string[];
  promptDirs: string[];
  workflowDirs: string[];
  taskDirs: string[];
  scheduleDirs: string[];
  webhookDirs: string[];
  evalDirs: string[];
};

function isDiscoveryEnabled(discovery: DiscoverySettings | undefined): boolean {
  return discovery?.enabled ?? true;
}

function resolveDiscoveryPaths(
  discovery: DiscoverySettings | undefined,
  defaultPaths: string[],
): string[] {
  if (!isDiscoveryEnabled(discovery)) {
    return [];
  }
  return discovery?.paths ?? defaultPaths;
}

function resolveProjectDiscoveryBaseDir(
  projectDir: string,
  config?: VeryfrontConfig | null,
): string {
  const fsType = config?.fs?.type ?? "local";
  return fsType === "github" || fsType === "veryfront-api" ? "" : projectDir;
}

export function createProjectDiscoveryConfig(
  input: ProjectDiscoveryConfigInput,
): ProjectDiscoveryConfig {
  const aiConfig = input.config?.ai;

  return {
    baseDir: resolveProjectDiscoveryBaseDir(input.projectDir, input.config),
    toolDirs: resolveDiscoveryPaths(
      aiConfig?.tools?.discovery,
      DEFAULT_PROJECT_DISCOVERY_DIRS.toolDirs,
    ),
    agentDirs: resolveDiscoveryPaths(
      aiConfig?.agents?.discovery,
      DEFAULT_PROJECT_DISCOVERY_DIRS.agentDirs,
    ),
    skillDirs: resolveDiscoveryPaths(
      aiConfig?.skills?.discovery,
      DEFAULT_PROJECT_DISCOVERY_DIRS.skillDirs,
    ),
    resourceDirs: resolveDiscoveryPaths(
      aiConfig?.resources?.discovery,
      DEFAULT_PROJECT_DISCOVERY_DIRS.resourceDirs,
    ),
    promptDirs: resolveDiscoveryPaths(
      aiConfig?.prompts?.discovery,
      DEFAULT_PROJECT_DISCOVERY_DIRS.promptDirs,
    ),
    workflowDirs: resolveDiscoveryPaths(
      aiConfig?.workflows?.discovery,
      DEFAULT_PROJECT_DISCOVERY_DIRS.workflowDirs,
    ),
    taskDirs: resolveDiscoveryPaths(
      aiConfig?.tasks?.discovery,
      DEFAULT_PROJECT_DISCOVERY_DIRS.taskDirs,
    ),
    scheduleDirs: resolveDiscoveryPaths(
      aiConfig?.schedules?.discovery,
      DEFAULT_PROJECT_DISCOVERY_DIRS.scheduleDirs,
    ),
    webhookDirs: resolveDiscoveryPaths(
      aiConfig?.webhooks?.discovery,
      DEFAULT_PROJECT_DISCOVERY_DIRS.webhookDirs,
    ),
    evalDirs: resolveDiscoveryPaths(
      aiConfig?.evals?.discovery,
      DEFAULT_PROJECT_DISCOVERY_DIRS.evalDirs,
    ),
    fsAdapter: input.fsAdapter,
    verbose: input.verbose ?? false,
  };
}
