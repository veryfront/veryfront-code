/**
 * Discovery Engine
 *
 * Core discovery orchestration that coordinates finding and registering
 * tools, agents, resources, prompts, and workflows.
 */

import { detectPlatform } from "#veryfront/platform/core-platform.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
import { registerSkill, skillRegistry } from "#veryfront/skill/registry.ts";
import type {
  DiscoveryConfig,
  DiscoveryHandler,
  DiscoveryResult,
  FileDiscoveryContext,
} from "./types.ts";
import { importModule } from "./transpiler.ts";
import { findTypeScriptFiles } from "./file-discovery.ts";
import {
  agentHandler,
  discoverSkills,
  evalHandler,
  promptHandler,
  resourceHandler,
  scheduleHandler,
  taskHandler,
  toolHandler,
  webhookHandler,
  workflowHandler,
  workHandler,
} from "./handlers/index.ts";
import { discoverRuntimeAgentMarkdownDefinitions } from "./handlers/runtime-agent-markdown-handler.ts";
import { filenameToId } from "./discovery-utils.ts";

const logger = agentLogger.component("discovery");

type DiscoveryCandidate<T> = {
  exportName: string;
  item: T;
};

function isIndexModule(file: string): boolean {
  const normalized = file.replace("file://", "");
  return /(?:^|\/)index\.(?:ts|tsx|js|jsx)$/.test(normalized);
}

function compareDiscoveryFiles(a: string, b: string): number {
  const aIsIndex = isIndexModule(a);
  const bIsIndex = isIndexModule(b);
  if (aIsIndex !== bIsIndex) return aIsIndex ? 1 : -1;
  return a.localeCompare(b);
}

function resolveDiscoveryDir(baseDir: string, dir: string): string {
  if (baseDir === "") return dir;
  return `${baseDir}/${dir}`;
}

function collectDiscoveryCandidates<T>(
  module: unknown,
  handler: DiscoveryHandler<T>,
): DiscoveryCandidate<T>[] {
  const defaultItem = (module as { default?: T }).default;
  if (handler.validate(defaultItem)) {
    return [{ exportName: "default", item: defaultItem }];
  }

  const candidates: DiscoveryCandidate<T>[] = [];
  for (const [exportName, value] of Object.entries(module as Record<string, unknown>)) {
    if (exportName === "default") continue;
    if (!handler.validate(value)) continue;
    candidates.push({ exportName, item: value });
  }

  return candidates;
}

function getCandidateId<T>(
  candidate: DiscoveryCandidate<T>,
  file: string,
  dir: string,
  handler: DiscoveryHandler<T>,
  useExportNameFallback: boolean,
): string {
  const derivedId = handler.getId(candidate.item, file, dir);
  if (!useExportNameFallback) return derivedId;

  const fileId = filenameToId(file);
  if (derivedId !== fileId) return derivedId;
  return candidate.exportName;
}

/**
 * Discover items of a specific type in a directory
 */
async function discoverItems<T>(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  handler: DiscoveryHandler<T>,
  verbose?: boolean,
): Promise<void> {
  const files = (await findTypeScriptFiles(dir, context)).sort(compareDiscoveryFiles);
  const resultMap = handler.getResultMap(result);

  if (verbose) {
    logger.info(`Found ${files.length} ${handler.typeName} files in ${dir}`);
  }

  for (const file of files) {
    try {
      const module = await importModule(file, context);
      const candidates = collectDiscoveryCandidates(module, handler);
      if (candidates.length === 0) {
        if (verbose) {
          logger.warn(`${file} does not export a valid ${handler.typeName}`);
        }
        continue;
      }

      const useExportNameFallback = candidates.length > 1 || isIndexModule(file);
      for (const candidate of candidates) {
        const id = getCandidateId(
          candidate,
          file,
          dir,
          handler,
          useExportNameFallback,
        );

        if (resultMap.has(id)) {
          if (verbose) {
            logger.warn(`Duplicate ${handler.typeName} "${id}" in ${file}; keeping first`);
          }
          continue;
        }

        const registered = handler.register(id, candidate.item, file, dir);
        resultMap.set(id, registered);

        if (verbose) {
          const exportSuffix = candidate.exportName === "default"
            ? ""
            : ` (export: ${candidate.exportName})`;
          logger.info(`Registered ${handler.typeName}: ${id}${exportSuffix}`);
        }
      }
    } catch (error) {
      result.errors.push({ file, error: ensureError(error) });

      if (verbose) {
        logger.error(`Error loading ${file}:`, error);
      }
    }
  }
}

async function discoverConfiguredItems<T>(
  dirs: string[] | undefined,
  defaultDirs: string[],
  baseDir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  handler: DiscoveryHandler<T>,
  verbose?: boolean,
): Promise<void> {
  for (const dir of dirs ?? defaultDirs) {
    await discoverItems(
      resolveDiscoveryDir(baseDir, dir),
      result,
      context,
      handler,
      verbose,
    );
  }
}

/**
 * Discover all items in configured directories
 */
export async function discoverAll(config: DiscoveryConfig): Promise<DiscoveryResult> {
  const baseDir = config.baseDir;

  const context: FileDiscoveryContext = {
    platform: detectPlatform(),
    fsAdapter: config.fsAdapter,
    baseDir,
  };

  const result: DiscoveryResult = {
    tools: new Map(),
    agents: new Map(),
    skills: new Map(),
    resources: new Map(),
    prompts: new Map(),
    workflows: new Map(),
    works: new Map(),
    tasks: new Map(),
    schedules: new Map(),
    webhooks: new Map(),
    evals: new Map(),
    errors: [],
  };

  // Discover tools
  await discoverConfiguredItems(
    config.toolDirs,
    ["tools"],
    baseDir,
    result,
    context,
    toolHandler,
    config.verbose,
  );

  // Clear stale skills before any skill registration so deleted/renamed
  // skills are removed. Global skills are discovered BEFORE agents so that
  // directory-agent colocated skills (registered during agent discovery)
  // survive the clear and owned-short-name shadow diagnostics can see the
  // global ids they shadow.
  skillRegistry.clear();

  // Discover skills (parallel path — markdown-based, not TypeScript import)
  for (const dir of config.skillDirs ?? ["skills"]) {
    const skillResult = await discoverSkills(
      resolveDiscoveryDir(baseDir, dir),
      context,
      config.verbose,
    );
    for (const [id, skill] of skillResult.skills) {
      if (result.skills.has(id)) {
        logger.warn(`Duplicate skill "${id}" across discovery roots; keeping first registration`);
        continue;
      }
      registerSkill(id, skill);
      result.skills.set(id, skill);
    }
    result.errors.push(
      ...skillResult.errors.map((e) => ({ file: e.file, error: e.error })),
    );
  }

  // Discover agents
  for (const dir of config.agentDirs ?? ["agents"]) {
    const agentDir = resolveDiscoveryDir(baseDir, dir);
    await discoverItems(agentDir, result, context, agentHandler, config.verbose);
    await discoverRuntimeAgentMarkdownDefinitions(agentDir, result, context);
  }

  // Discover resources
  await discoverConfiguredItems(
    config.resourceDirs,
    ["resources"],
    baseDir,
    result,
    context,
    resourceHandler,
    config.verbose,
  );

  // Discover prompts
  await discoverConfiguredItems(
    config.promptDirs,
    ["prompts"],
    baseDir,
    result,
    context,
    promptHandler,
    config.verbose,
  );

  // Discover workflows
  await discoverConfiguredItems(
    config.workflowDirs,
    ["workflows"],
    baseDir,
    result,
    context,
    workflowHandler,
    config.verbose,
  );

  // Discover Work definitions
  await discoverConfiguredItems(
    config.workDirs,
    ["work"],
    baseDir,
    result,
    context,
    workHandler,
    config.verbose,
  );

  // Discover tasks
  await discoverConfiguredItems(
    config.taskDirs,
    ["tasks"],
    baseDir,
    result,
    context,
    taskHandler,
    config.verbose,
  );

  // Discover schedules
  await discoverConfiguredItems(
    config.scheduleDirs,
    ["schedules"],
    baseDir,
    result,
    context,
    scheduleHandler,
    config.verbose,
  );

  // Discover webhooks
  await discoverConfiguredItems(
    config.webhookDirs,
    ["webhooks"],
    baseDir,
    result,
    context,
    webhookHandler,
    config.verbose,
  );

  // Discover eval definitions
  await discoverConfiguredItems(
    config.evalDirs,
    ["evals"],
    baseDir,
    result,
    context,
    evalHandler,
    config.verbose,
  );

  return result;
}
