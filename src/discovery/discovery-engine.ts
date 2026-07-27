/**
 * Discovery Engine
 *
 * Core discovery orchestration that coordinates finding and registering
 * tools, agents, resources, prompts, and workflows.
 */

import { detectPlatform } from "#veryfront/platform/core-platform.ts";
import { agentLogger } from "#veryfront/utils";
import { ensureError } from "#veryfront/errors";
import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { join } from "#veryfront/compat/path";
import { agentRegistry } from "#veryfront/agent/composition/composition.ts";
import { promptRegistry } from "#veryfront/prompt/registry.ts";
import { resourceRegistry } from "#veryfront/resource/registry.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { workflowRegistry } from "#veryfront/workflow/registry.ts";
import { runWithRegistryTransaction } from "#veryfront/registry/project-scoped-registry-manager.ts";
import type {
  DiscoveryConfig,
  DiscoveryHandler,
  DiscoveryResult,
  FileDiscoveryContext,
} from "./types.ts";
import { importModule } from "./transpiler.ts";
import { findTypeScriptFiles, MAX_PROJECT_DISCOVERY_ENTRIES } from "./file-discovery.ts";
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
} from "./handlers/index.ts";
import {
  createRuntimeAgentMarkdownDiscoveryState,
  discoverRuntimeAgentMarkdownDefinitions,
} from "./handlers/runtime-agent-markdown-handler.ts";
import { filenameToId, filePathToId } from "./discovery-utils.ts";
import {
  type ProjectDiscoveryConfig,
  snapshotDiscoveryConfig,
} from "./project-discovery-config.ts";

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
  return a < b ? -1 : a > b ? 1 : 0;
}

function resolveDiscoveryDir(baseDir: string, dir: string): string {
  if (baseDir === "") return dir;
  return join(baseDir, dir);
}

function collectDiscoveryCandidates<TInput, TRegistered>(
  module: unknown,
  handler: DiscoveryHandler<TInput, TRegistered>,
): DiscoveryCandidate<TInput>[] {
  const defaultItem = (module as { default?: TInput }).default;
  if (handler.validate(defaultItem)) {
    return [{ exportName: "default", item: defaultItem }];
  }

  const candidates: DiscoveryCandidate<TInput>[] = [];
  const seen = new Set<unknown>();
  for (
    const [exportName, value] of Object.entries(module as Record<string, unknown>).sort(
      ([left], [right]) => left < right ? -1 : left > right ? 1 : 0,
    )
  ) {
    if (exportName === "default") continue;
    if (!handler.validate(value) || seen.has(value)) continue;
    seen.add(value);
    candidates.push({ exportName, item: value });
  }

  return candidates;
}

function getCandidateId<TInput, TRegistered>(
  candidate: DiscoveryCandidate<TInput>,
  file: string,
  dir: string,
  handler: DiscoveryHandler<TInput, TRegistered>,
  useExportNameFallback: boolean,
): string {
  const derivedId = handler.getId(candidate.item, file, dir);
  if (candidate.exportName === "default") return derivedId;
  if (!useExportNameFallback) return derivedId;

  const fileId = filenameToId(file);
  const relativeFileId = filePathToId(file, dir);
  if (derivedId !== fileId && derivedId !== relativeFileId) return derivedId;
  return candidate.exportName;
}

/**
 * Discover items of a specific type in a directory
 */
async function discoverItems<TInput, TRegistered>(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  handler: DiscoveryHandler<TInput, TRegistered>,
  seenFiles: Set<string>,
  verbose?: boolean,
): Promise<void> {
  const files = (await findTypeScriptFiles(dir, context)).sort(compareDiscoveryFiles);
  const resultMap = handler.getResultMap(result);

  if (verbose) {
    logger.info(`Found ${files.length} ${handler.typeName} files in ${dir}`);
  }

  for (const file of files) {
    if (handler.shouldDiscover && !handler.shouldDiscover(file, dir)) {
      continue;
    }
    if (seenFiles.has(file)) continue;
    seenFiles.add(file);

    try {
      const module = await importModule(file, context);
      const candidates = collectDiscoveryCandidates(module, handler);
      if (candidates.length === 0) {
        result.errors.push({
          file,
          error: new Error(`${file} does not export a valid ${handler.typeName}`),
          code: "invalid_export",
          sourceKind: handler.typeName,
        });
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
          // Named exports from an index module are treated as a conventional
          // barrel. Concrete files are ordered first, so the barrel can expose
          // them without turning one source definition into a duplicate error.
          // A default index export remains a real definition and conflicts.
          if (isIndexModule(file) && candidate.exportName !== "default") {
            continue;
          }
          result.errors.push({
            file,
            error: new Error(
              `Duplicate ${handler.typeName} "${id}" in ${file}; keeping first`,
            ),
            code: "duplicate_id",
            sourceKind: handler.typeName,
            sourceId: id,
            exportName: candidate.exportName,
          });
          if (verbose) {
            logger.warn(`Duplicate ${handler.typeName} "${id}" in ${file}; keeping first`);
          }
          continue;
        }

        const registered = handler.register(
          id,
          candidate.item,
          file,
          dir,
          candidate.exportName,
        );
        resultMap.set(id, registered);

        if (verbose) {
          const exportSuffix = candidate.exportName === "default"
            ? ""
            : ` (export: ${candidate.exportName})`;
          logger.info(`Registered ${handler.typeName}: ${id}${exportSuffix}`);
        }
      }
    } catch (error) {
      result.errors.push({
        file,
        error: ensureError(error),
        code: "load_error",
        sourceKind: handler.typeName,
      });

      if (verbose) {
        logger.error(`Error loading ${file}:`, error);
      }
    }
  }
}

async function discoverConfiguredItems<TInput, TRegistered>(
  dirs: readonly string[],
  baseDir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  handler: DiscoveryHandler<TInput, TRegistered>,
  verbose?: boolean,
): Promise<void> {
  const seenFiles = new Set<string>();
  for (const dir of dirs) {
    await discoverItems(
      resolveDiscoveryDir(baseDir, dir),
      result,
      context,
      handler,
      seenFiles,
      verbose,
    );
  }
}

async function discoverSnapshot(snapshot: ProjectDiscoveryConfig): Promise<DiscoveryResult> {
  const baseDir = snapshot.baseDir;

  const context: FileDiscoveryContext = {
    platform: detectPlatform(),
    fsAdapter: snapshot.fsAdapter,
    baseDir,
    entryBudget: {
      scannedEntries: 0,
      maxEntries: MAX_PROJECT_DISCOVERY_ENTRIES,
    },
  };

  const result: DiscoveryResult = {
    tools: new Map(),
    agents: new Map(),
    skills: new Map(),
    resources: new Map(),
    prompts: new Map(),
    workflows: new Map(),
    tasks: new Map(),
    schedules: new Map(),
    webhooks: new Map(),
    evals: new Map(),
    errors: [],
  };

  // Every generation replaces one complete project scope. These mutations are
  // staged by discoverAll's registry transaction, so concurrent readers retain
  // the previous generation until all discovery work finishes.
  agentRegistry.clear();
  toolRegistry.clear();
  skillRegistryInternal.clear();
  promptRegistry.clear();
  resourceRegistry.clear();
  workflowRegistry.clear();

  // Discover tools
  await discoverConfiguredItems(
    snapshot.toolDirs,
    baseDir,
    result,
    context,
    toolHandler,
    snapshot.verbose,
  );

  // Discover global skills before agents so directory-agent colocated skills
  // survive and owned-short-name shadow diagnostics can see global ids.
  for (const dir of snapshot.skillDirs) {
    const skillResult = await discoverSkills(
      resolveDiscoveryDir(baseDir, dir),
      context,
      snapshot.verbose,
    );
    for (const [id, skill] of skillResult.skills) {
      if (result.skills.has(id)) {
        result.errors.push({
          file: skill.rootPath,
          error: new Error(
            `Duplicate skill "${id}" across discovery roots; keeping first registration`,
          ),
          code: "duplicate_id",
          sourceKind: "skill",
          sourceId: id,
        });
        if (snapshot.verbose) {
          logger.warn(`Duplicate skill "${id}" across discovery roots; keeping first registration`);
        }
        continue;
      }
      skillRegistryInternal.register(id, skill);
      const registeredSkill = skillRegistryInternal.get(id);
      if (registeredSkill === undefined) {
        throw new Error(`Skill "${id}" was not available after registration`);
      }
      result.skills.set(id, skill);
    }
    result.errors.push(...skillResult.errors);
  }

  // Discover agents
  const agentFiles = new Set<string>();
  const markdownAgentState = createRuntimeAgentMarkdownDiscoveryState();
  for (const dir of snapshot.agentDirs) {
    const agentDir = resolveDiscoveryDir(baseDir, dir);
    await discoverItems(
      agentDir,
      result,
      context,
      agentHandler,
      agentFiles,
      snapshot.verbose,
    );
    await discoverRuntimeAgentMarkdownDefinitions(
      agentDir,
      result,
      context,
      markdownAgentState,
    );
  }

  // Discover resources
  await discoverConfiguredItems(
    snapshot.resourceDirs,
    baseDir,
    result,
    context,
    resourceHandler,
    snapshot.verbose,
  );

  // Discover prompts
  await discoverConfiguredItems(
    snapshot.promptDirs,
    baseDir,
    result,
    context,
    promptHandler,
    snapshot.verbose,
  );

  // Discover workflows
  await discoverConfiguredItems(
    snapshot.workflowDirs,
    baseDir,
    result,
    context,
    workflowHandler,
    snapshot.verbose,
  );

  // Discover tasks
  await discoverConfiguredItems(
    snapshot.taskDirs,
    baseDir,
    result,
    context,
    taskHandler,
    snapshot.verbose,
  );

  // Discover schedules
  await discoverConfiguredItems(
    snapshot.scheduleDirs,
    baseDir,
    result,
    context,
    scheduleHandler,
    snapshot.verbose,
  );

  // Discover webhooks
  await discoverConfiguredItems(
    snapshot.webhookDirs,
    baseDir,
    result,
    context,
    webhookHandler,
    snapshot.verbose,
  );

  // Discover eval definitions
  await discoverConfiguredItems(
    snapshot.evalDirs,
    baseDir,
    result,
    context,
    evalHandler,
    snapshot.verbose,
  );

  return result;
}

/**
 * Discover and atomically publish one complete project primitive generation.
 *
 * Per-file errors remain in the returned result and the valid subset is
 * published for backwards compatibility. Strict lifecycle callers should use
 * replaceDiscoveredProjectPrimitives(), which wraps this transaction and rolls
 * back the entire generation when result.errors is non-empty.
 */
export async function discoverAll(config: DiscoveryConfig): Promise<DiscoveryResult> {
  const snapshot = snapshotDiscoveryConfig(config);
  return await runWithRegistryTransaction(() => discoverSnapshot(snapshot));
}
