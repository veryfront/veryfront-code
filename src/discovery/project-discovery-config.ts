import type { VeryfrontConfig } from "../config/index.ts";
import { CONFIG_INVALID } from "../errors/index.ts";
import type { FileSystemAdapter } from "../platform/adapters/base.ts";
import {
  MAX_PROJECT_DISCOVERY_DIRECTORIES,
  normalizeProjectRelativeDiscoveryPath,
} from "../utils/discovery-path-policy.ts";
import { MAX_PATH_LENGTH_CHARS } from "../utils/constants/limits.ts";
import type { DiscoveryConfig } from "./types.ts";

function frozenPaths(...paths: string[]): readonly string[] {
  return Object.freeze(paths);
}

/** Canonical convention roots used when a primitive does not override discovery. */
export const DEFAULT_PROJECT_DISCOVERY_DIRS = Object.freeze({
  toolDirs: frozenPaths("tools"),
  agentDirs: frozenPaths("agents"),
  skillDirs: frozenPaths("skills"),
  resourceDirs: frozenPaths("resources"),
  promptDirs: frozenPaths("prompts"),
  workflowDirs: frozenPaths("workflows"),
  taskDirs: frozenPaths("tasks"),
  scheduleDirs: frozenPaths("schedules"),
  webhookDirs: frozenPaths("webhooks"),
  evalDirs: frozenPaths("evals"),
});

type DiscoverySettings = {
  enabled?: boolean;
  paths?: readonly string[];
};

type ProjectDiscoveryConfigInput = {
  projectDir: string;
  cacheNamespace?: string;
  config?: VeryfrontConfig | null;
  fsAdapter?: FileSystemAdapter;
  verbose?: boolean;
};

export type ProjectDiscoveryConfig = Readonly<
  DiscoveryConfig & {
    toolDirs: readonly string[];
    agentDirs: readonly string[];
    skillDirs: readonly string[];
    resourceDirs: readonly string[];
    promptDirs: readonly string[];
    workflowDirs: readonly string[];
    taskDirs: readonly string[];
    scheduleDirs: readonly string[];
    webhookDirs: readonly string[];
    evalDirs: readonly string[];
    verbose: boolean;
  }
>;

const PROJECT_DISCOVERY_DIRECTORY_KEYS = [
  "toolDirs",
  "agentDirs",
  "skillDirs",
  "resourceDirs",
  "promptDirs",
  "workflowDirs",
  "taskDirs",
  "scheduleDirs",
  "webhookDirs",
  "evalDirs",
] as const satisfies readonly (keyof ProjectDiscoveryConfig)[];

function invalidDiscoveryConfig(detail: string, cause?: unknown): never {
  throw CONFIG_INVALID.create({
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function normalizeDiscoveryBaseDir(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    containsControlCharacter(value) ||
    /^file:\/\//i.test(value)
  ) {
    invalidDiscoveryConfig(
      `Discovery baseDir must be a filesystem path of at most ${MAX_PATH_LENGTH_CHARS} characters without control characters`,
    );
  }
  return value;
}

function normalizeDiscoveryCacheNamespace(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    containsControlCharacter(value)
  ) {
    invalidDiscoveryConfig(
      `Discovery cacheNamespace must be a non-empty string of at most ${MAX_PATH_LENGTH_CHARS} characters without control characters`,
    );
  }
  return value;
}

function normalizeDiscoveryPaths(
  value: unknown,
  defaults: readonly string[],
  key: string,
): readonly string[] {
  const source = value === undefined ? defaults : value;
  if (!Array.isArray(source)) {
    invalidDiscoveryConfig(`${key} discovery paths must be an array`);
  }
  if (source.length > MAX_PROJECT_DISCOVERY_DIRECTORIES) {
    invalidDiscoveryConfig(
      `${key} discovery paths may contain at most ${MAX_PROJECT_DISCOVERY_DIRECTORIES} directories`,
    );
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const path of source) {
    let canonical: string;
    try {
      canonical = normalizeProjectRelativeDiscoveryPath(path);
    } catch (error) {
      invalidDiscoveryConfig(`${key} discovery path is invalid`, error);
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    normalized.push(canonical);
  }
  return Object.freeze(normalized);
}

function normalizeVerbose(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    invalidDiscoveryConfig("Discovery verbose must be a boolean");
  }
  return value;
}

/**
 * Snapshot and validate a public discovery configuration before asynchronous
 * filesystem work begins.
 */
export function snapshotDiscoveryConfig(config: DiscoveryConfig): ProjectDiscoveryConfig {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    invalidDiscoveryConfig("Discovery configuration must be an object");
  }

  const cacheNamespace = normalizeDiscoveryCacheNamespace(config.cacheNamespace);

  return Object.freeze({
    baseDir: normalizeDiscoveryBaseDir(config.baseDir),
    ...(cacheNamespace === undefined ? {} : { cacheNamespace }),
    toolDirs: normalizeDiscoveryPaths(
      config.toolDirs,
      DEFAULT_PROJECT_DISCOVERY_DIRS.toolDirs,
      "tool",
    ),
    agentDirs: normalizeDiscoveryPaths(
      config.agentDirs,
      DEFAULT_PROJECT_DISCOVERY_DIRS.agentDirs,
      "agent",
    ),
    skillDirs: normalizeDiscoveryPaths(
      config.skillDirs,
      DEFAULT_PROJECT_DISCOVERY_DIRS.skillDirs,
      "skill",
    ),
    resourceDirs: normalizeDiscoveryPaths(
      config.resourceDirs,
      DEFAULT_PROJECT_DISCOVERY_DIRS.resourceDirs,
      "resource",
    ),
    promptDirs: normalizeDiscoveryPaths(
      config.promptDirs,
      DEFAULT_PROJECT_DISCOVERY_DIRS.promptDirs,
      "prompt",
    ),
    workflowDirs: normalizeDiscoveryPaths(
      config.workflowDirs,
      DEFAULT_PROJECT_DISCOVERY_DIRS.workflowDirs,
      "workflow",
    ),
    taskDirs: normalizeDiscoveryPaths(
      config.taskDirs,
      DEFAULT_PROJECT_DISCOVERY_DIRS.taskDirs,
      "task",
    ),
    scheduleDirs: normalizeDiscoveryPaths(
      config.scheduleDirs,
      DEFAULT_PROJECT_DISCOVERY_DIRS.scheduleDirs,
      "schedule",
    ),
    webhookDirs: normalizeDiscoveryPaths(
      config.webhookDirs,
      DEFAULT_PROJECT_DISCOVERY_DIRS.webhookDirs,
      "webhook",
    ),
    evalDirs: normalizeDiscoveryPaths(
      config.evalDirs,
      DEFAULT_PROJECT_DISCOVERY_DIRS.evalDirs,
      "eval",
    ),
    fsAdapter: config.fsAdapter,
    verbose: normalizeVerbose(config.verbose),
  });
}

/** Return every enabled discovery directory once, preserving config order. */
export function getProjectDiscoveryDirectories(
  config: ProjectDiscoveryConfig,
): string[] {
  const directories = new Set<string>();
  for (const key of PROJECT_DISCOVERY_DIRECTORY_KEYS) {
    for (const directory of config[key]) directories.add(directory);
  }
  return Array.from(directories);
}

function resolveDiscoveryPaths(
  discovery: DiscoverySettings | undefined,
  defaultPaths: readonly string[],
): readonly string[] {
  if (discovery?.enabled === false) return frozenPaths();
  if (discovery?.enabled !== undefined && typeof discovery.enabled !== "boolean") {
    invalidDiscoveryConfig("Discovery enabled must be a boolean");
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

  return snapshotDiscoveryConfig({
    baseDir: resolveProjectDiscoveryBaseDir(input.projectDir, input.config),
    cacheNamespace: input.cacheNamespace,
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
    verbose: input.verbose,
  });
}
