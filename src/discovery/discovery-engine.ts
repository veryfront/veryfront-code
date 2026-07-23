/**
 * Discovery Engine
 *
 * Core discovery orchestration that coordinates finding and registering
 * tools, agents, resources, prompts, and workflows.
 */

import { detectPlatform } from "#veryfront/platform/core-platform.ts";
import { agentLogger } from "#veryfront/utils";
import { ensureError } from "#veryfront/errors";
import { registerSkill, skillRegistry } from "#veryfront/skill/registry.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { prepareAgentSkillToolsForModuleInitialization } from "#veryfront/agent/factory.ts";
import { promptRegistry } from "#veryfront/prompt/registry.ts";
import { resourceRegistry } from "#veryfront/resource/registry.ts";
import { workflowRegistry } from "#veryfront/workflow/registry.ts";
import {
  runWithRegistryTransaction,
  runWithRegistryTransactionSavepoint,
} from "#veryfront/registry/project-scoped-registry-manager.ts";
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
} from "./handlers/index.ts";
import { discoverRuntimeAgentMarkdownDefinitions } from "./handlers/runtime-agent-markdown-handler.ts";
import { discoveryFileLabel, filenameToId } from "./discovery-utils.ts";
import { recordDiscoveryError, recordDiscoveryErrors } from "./discovery-errors.ts";

const logger = agentLogger.component("discovery");
const MAX_DISCOVERY_ROOTS_PER_CONCEPT = 64;
const MAX_DISCOVERY_ROOT_LENGTH = 1_024;
const MAX_DISCOVERY_EXPORTS_PER_MODULE = 1_000;
const MAX_DISCOVERED_ITEMS_PER_CONCEPT = 10_000;

type DiscoveryCandidate<T> = {
  exportName: string;
  item: T;
};

function isIndexModule(file: string): boolean {
  const normalized = file.replace("file://", "");
  return /(?:^|\/)index\.(?:ts|tsx|js|jsx|mjs)$/.test(normalized);
}

function compareDiscoveryFiles(a: string, b: string): number {
  const aIsIndex = isIndexModule(a);
  const bIsIndex = isIndexModule(b);
  if (aIsIndex !== bIsIndex) return aIsIndex ? 1 : -1;
  return a.localeCompare(b);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function normalizeDiscoveryDir(dir: string): string {
  if (
    typeof dir !== "string" || dir.length === 0 ||
    dir.length > MAX_DISCOVERY_ROOT_LENGTH
  ) {
    throw new TypeError("Discovery directories must be non-empty project-relative paths");
  }

  const normalized = dir.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) ||
    segments.includes("..") || hasControlCharacter(normalized)
  ) {
    throw new TypeError("Discovery directories must be project-relative paths");
  }

  const cleanSegments = segments.filter((segment) => segment !== "" && segment !== ".");
  if (cleanSegments.length === 0) {
    throw new TypeError("Discovery directories must be non-empty project-relative paths");
  }
  return cleanSegments.join("/");
}

function resolveDiscoveryDir(baseDir: string, dir: string): string {
  const normalizedDir = normalizeDiscoveryDir(dir);
  if (baseDir === "") return normalizedDir;
  return `${baseDir.replace(/[\\/]+$/, "")}/${normalizedDir}`;
}

const DISCOVERY_DIRECTORY_SETTINGS = [
  ["toolDirs", ["tools"]],
  ["agentDirs", ["agents"]],
  ["skillDirs", ["skills"]],
  ["resourceDirs", ["resources"]],
  ["promptDirs", ["prompts"]],
  ["workflowDirs", ["workflows"]],
  ["taskDirs", ["tasks"]],
  ["scheduleDirs", ["schedules"]],
  ["webhookDirs", ["webhooks"]],
  ["evalDirs", ["evals"]],
] as const satisfies ReadonlyArray<
  readonly [
    Exclude<
      keyof DiscoveryConfig,
      "baseDir" | "verbose" | "fsAdapter" | "moduleImporter"
    >,
    readonly string[],
  ]
>;

function readDiscoveryConfigProperty(
  config: object,
  property: keyof DiscoveryConfig,
): unknown {
  try {
    return Reflect.get(config, property);
  } catch {
    throw new TypeError("Discovery configuration properties must be readable");
  }
}

function snapshotDiscoveryDirectories(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Discovery directory settings must be arrays");
  }

  let directories: unknown[];
  try {
    const length = Reflect.get(value, "length");
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new TypeError("Discovery directory settings must be arrays");
    }
    if (length > MAX_DISCOVERY_ROOTS_PER_CONCEPT) {
      throw new RangeError("Discovery directory count exceeds the supported limit");
    }
    directories = Array.from(value as readonly unknown[]);
  } catch (error) {
    if (error instanceof RangeError) throw error;
    throw new TypeError("Discovery directory settings must be readable arrays");
  }

  const normalizedDirectories = new Set<string>();
  for (const dir of directories) {
    const normalized = normalizeDiscoveryDir(dir as string);
    if (normalizedDirectories.has(normalized)) {
      throw new TypeError("Discovery directory settings contain duplicate roots");
    }
    normalizedDirectories.add(normalized);
  }
  return Object.freeze([...normalizedDirectories]);
}

function validateAndSnapshotDiscoveryConfig(config: DiscoveryConfig): DiscoveryConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new TypeError("Discovery configuration must be an object");
  }
  const input = config as object;
  const baseDir = readDiscoveryConfigProperty(input, "baseDir");
  if (
    typeof baseDir !== "string" || baseDir.length > 32_768 ||
    hasControlCharacter(baseDir)
  ) {
    throw new TypeError("Discovery baseDir must be a valid path");
  }
  const verbose = readDiscoveryConfigProperty(input, "verbose");
  if (verbose !== undefined && typeof verbose !== "boolean") {
    throw new TypeError("Discovery verbose must be a boolean");
  }
  const moduleImporter = readDiscoveryConfigProperty(input, "moduleImporter");
  if (moduleImporter !== undefined && typeof moduleImporter !== "function") {
    throw new TypeError("Discovery moduleImporter must be a function");
  }

  const snapshot: DiscoveryConfig = {
    baseDir,
    fsAdapter: readDiscoveryConfigProperty(input, "fsAdapter") as DiscoveryConfig["fsAdapter"],
    ...(moduleImporter === undefined
      ? {}
      : { moduleImporter: moduleImporter as DiscoveryConfig["moduleImporter"] }),
    ...(verbose === undefined ? {} : { verbose }),
  };
  for (const [property, defaults] of DISCOVERY_DIRECTORY_SETTINGS) {
    const configured = readDiscoveryConfigProperty(input, property);
    const directories = snapshotDiscoveryDirectories(
      configured === undefined ? defaults : configured,
    );
    for (const directory of directories) resolveDiscoveryDir(baseDir, directory);
    if (configured !== undefined) snapshot[property] = directories as string[];
  }
  return Object.freeze(snapshot);
}

function collectDiscoveryCandidates<T>(
  module: unknown,
  handler: DiscoveryHandler<T>,
): DiscoveryCandidate<T>[] {
  const candidates: DiscoveryCandidate<T>[] = [];
  const seenItems = new Set<unknown>();
  if (module === null || (typeof module !== "object" && typeof module !== "function")) {
    return candidates;
  }
  const record = module as Record<string, unknown>;
  const exportNames = Object.keys(record);
  if (exportNames.length > MAX_DISCOVERY_EXPORTS_PER_MODULE) {
    throw new RangeError("Discovery module export limit exceeded");
  }

  const defaultItem = record.default;
  if (handler.validate(defaultItem)) {
    candidates.push({ exportName: "default", item: defaultItem as T });
    seenItems.add(defaultItem);
  }

  for (const exportName of exportNames) {
    if (exportName === "default") continue;
    const value = record[exportName];
    if (!handler.validate(value)) continue;
    if (seenItems.has(value)) continue;
    candidates.push({ exportName, item: value });
    seenItems.add(value);
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
  if (!useExportNameFallback || candidate.exportName === "default") return derivedId;

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
    logger.info("Discovery directory scanned", {
      type: handler.typeName,
      files: files.length,
    });
  }

  for (const file of files) {
    // agent({ skills: ... }) lazily installs framework-owned skill tools. Make
    // only those known tools available before project code enters the shared-
    // registry restriction. The lease removes them again when the module does
    // not construct a skill-enabled agent.
    const releaseSkillToolLease = handler === (agentHandler as unknown as DiscoveryHandler<T>)
      ? prepareAgentSkillToolsForModuleInitialization()
      : undefined;
    try {
      // Discovery publishes a fresh registry generation. Re-run module
      // initialization so legitimate project-scoped registrations, such as
      // tools embedded in an agent definition, are restored after the clear.
      const moduleImporter = context.moduleImporter ?? importModule;
      const module = await runWithRegistryTransactionSavepoint(
        () => moduleImporter(file, context, { reuseInitializedModule: false }),
        { rollbackOnSuccess: true },
      );
      const candidates = collectDiscoveryCandidates(module, handler);
      if (candidates.length === 0) {
        if (verbose) {
          logger.warn("Discovery module has no matching export", {
            type: handler.typeName,
            file: discoveryFileLabel(file, context.baseDir),
          });
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
          if (!isIndexModule(file)) {
            recordDiscoveryError(result.errors, {
              file: discoveryFileLabel(file, context.baseDir),
              error: ensureError(`Duplicate ${handler.typeName} id; keeping the first definition`),
            });
          }
          if (verbose) {
            logger.warn("Duplicate discovery id ignored", {
              type: handler.typeName,
              file: discoveryFileLabel(file, context.baseDir),
            });
          }
          continue;
        }

        if (resultMap.size >= MAX_DISCOVERED_ITEMS_PER_CONCEPT) {
          throw new RangeError(`Discovery ${handler.typeName} limit exceeded`);
        }

        const registered = await runWithRegistryTransactionSavepoint(
          async () =>
            handler.register(
              id,
              candidate.item,
              file,
              dir,
              candidate.exportName,
            ),
        );
        resultMap.set(id, registered);

        if (verbose) {
          logger.info("Discovery item registered", {
            type: handler.typeName,
            exportKind: candidate.exportName === "default" ? "default" : "named",
          });
        }
      }
    } catch (error) {
      recordDiscoveryError(result.errors, {
        file: discoveryFileLabel(file, context.baseDir),
        error: ensureError(error),
      });

      if (verbose) {
        logger.error("Discovery module failed to load", {
          type: handler.typeName,
          file: discoveryFileLabel(file, context.baseDir),
          errorName: error instanceof Error ? error.name : typeof error,
        });
      }
    } finally {
      releaseSkillToolLease?.();
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
async function discoverAllGeneration(config: DiscoveryConfig): Promise<DiscoveryResult> {
  const baseDir = config.baseDir;

  const context: FileDiscoveryContext = {
    platform: detectPlatform(),
    fsAdapter: config.fsAdapter,
    baseDir,
    moduleImporter: config.moduleImporter,
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

  // Replace the complete project-scoped discovery generation. Shared
  // framework registrations remain intact, while definitions removed from
  // source disappear on a successful rediscovery.
  toolRegistry.clear();
  agentRegistry.clear();
  skillRegistry.clear();
  resourceRegistry.clear();
  promptRegistry.clear();
  workflowRegistry.clear();

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

  // Discover global skills before agents so directory-agent colocated skills
  // can diagnose owned short names that shadow a global id.
  for (const dir of config.skillDirs ?? ["skills"]) {
    const skillResult = await discoverSkills(
      resolveDiscoveryDir(baseDir, dir),
      context,
      config.verbose,
    );
    for (const [id, skill] of skillResult.skills) {
      if (result.skills.has(id)) {
        recordDiscoveryError(result.errors, {
          file: discoveryFileLabel(`${skill.rootPath}/SKILL.md`, baseDir),
          error: ensureError("Duplicate skill id; keeping the first definition"),
        });
        if (config.verbose) logger.warn("Duplicate skill id ignored across discovery roots");
        continue;
      }
      registerSkill(id, skill);
      result.skills.set(id, skill);
    }
    recordDiscoveryErrors(result.errors, skillResult.errors);
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

/** Discover and atomically publish one complete project definition generation. */
export async function discoverAll(config: DiscoveryConfig): Promise<DiscoveryResult> {
  // Validate every configured root before importing or registering anything.
  // A later invalid path must not leave registries partially updated.
  const snapshot = validateAndSnapshotDiscoveryConfig(config);
  return await runWithRegistryTransaction(() => discoverAllGeneration(snapshot));
}
