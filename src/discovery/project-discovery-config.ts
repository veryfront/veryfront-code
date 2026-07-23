import type { VeryfrontConfig } from "../config/index.ts";
import type { FileSystemAdapter } from "../platform/adapters/base.ts";
import type { DiscoveryConfig } from "./types.ts";

/** Immutable default project-relative roots for every discovery concept. */
export const DEFAULT_PROJECT_DISCOVERY_DIRS: Readonly<
  Record<
    | "toolDirs"
    | "agentDirs"
    | "skillDirs"
    | "resourceDirs"
    | "promptDirs"
    | "workflowDirs"
    | "taskDirs"
    | "scheduleDirs"
    | "webhookDirs"
    | "evalDirs",
    readonly string[]
  >
> = Object.freeze({
  toolDirs: Object.freeze(["tools"]),
  agentDirs: Object.freeze(["agents"]),
  skillDirs: Object.freeze(["skills"]),
  resourceDirs: Object.freeze(["resources"]),
  promptDirs: Object.freeze(["prompts"]),
  workflowDirs: Object.freeze(["workflows"]),
  taskDirs: Object.freeze(["tasks"]),
  scheduleDirs: Object.freeze(["schedules"]),
  webhookDirs: Object.freeze(["webhooks"]),
  evalDirs: Object.freeze(["evals"]),
});

type DiscoverySettings = {
  enabled?: boolean;
  paths?: string[];
};

/** Inputs used to derive discovery roots from a project configuration. */
export type ProjectDiscoveryConfigInput = {
  /** Local project root or virtual project identifier. */
  projectDir: string;
  /** Validated Veryfront project configuration. */
  config?: VeryfrontConfig | null;
  /** Optional project filesystem adapter. */
  fsAdapter?: FileSystemAdapter;
  /** Whether discovery emits sanitized diagnostic logs. */
  verbose?: boolean;
};

/** Fully resolved discovery configuration for one project. */
export type ProjectDiscoveryConfig = DiscoveryConfig & {
  /** Tool discovery roots. */
  toolDirs: string[];
  /** Agent discovery roots. */
  agentDirs: string[];
  /** Skill discovery roots. */
  skillDirs: string[];
  /** Resource discovery roots. */
  resourceDirs: string[];
  /** Prompt discovery roots. */
  promptDirs: string[];
  /** Workflow discovery roots. */
  workflowDirs: string[];
  /** Task discovery roots. */
  taskDirs: string[];
  /** Schedule discovery roots. */
  scheduleDirs: string[];
  /** Webhook discovery roots. */
  webhookDirs: string[];
  /** Eval discovery roots. */
  evalDirs: string[];
};

function isDiscoveryEnabled(discovery: DiscoverySettings | undefined): boolean {
  return discovery?.enabled ?? true;
}

function resolveDiscoveryPaths(
  discovery: DiscoverySettings | undefined,
  defaultPaths: readonly string[],
): string[] {
  if (!isDiscoveryEnabled(discovery)) {
    return [];
  }
  return [...(discovery?.paths ?? defaultPaths)];
}

function resolveProjectDiscoveryBaseDir(
  projectDir: string,
  config?: VeryfrontConfig | null,
): string {
  const fsType = config?.fs?.type ?? "local";
  return fsType === "github" || fsType === "veryfront-api" ? "" : projectDir;
}

/** Resolve immutable defaults and configured project-relative discovery roots. */
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
