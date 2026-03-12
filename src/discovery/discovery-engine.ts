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
  promptHandler,
  resourceHandler,
  taskHandler,
  toolHandler,
  workflowHandler,
} from "./handlers/index.ts";
import { join } from "#veryfront/compat/path";

const logger = agentLogger.component("discovery");

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
  const files = await findTypeScriptFiles(dir, context);

  if (verbose) {
    logger.info(`Found ${files.length} ${handler.typeName} files in ${dir}`);
  }

  for (const file of files) {
    try {
      const module = await importModule(file, context);

      // Check default export first, then fall back to named exports
      let item = (module as { default?: T }).default;

      if (!handler.validate(item)) {
        // Search named exports for a valid item (e.g. `export const myAgent = agent(...)`)
        for (const key of Object.keys(module as Record<string, unknown>)) {
          if (key === "default") continue;
          const candidate = (module as Record<string, unknown>)[key] as T;
          if (handler.validate(candidate)) {
            item = candidate;
            break;
          }
        }
      }

      if (!handler.validate(item)) {
        if (verbose) {
          logger.warn(`${file} does not export a valid ${handler.typeName}`);
        }
        continue;
      }

      const id = handler.getId(item, file, dir);
      const registered = handler.register(id, item, file, dir);
      handler.getResultMap(result).set(id, registered);

      if (verbose) {
        logger.info(`Registered ${handler.typeName}: ${id}`);
      }
    } catch (error) {
      result.errors.push({ file, error: ensureError(error) });

      if (verbose) {
        logger.error(`Error loading ${file}:`, error);
      }
    }
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
    tasks: new Map(),
    errors: [],
  };

  // Discover tools
  for (const dir of config.toolDirs ?? ["tools"]) {
    await discoverItems(`${baseDir}/${dir}`, result, context, toolHandler, config.verbose);
  }

  // Discover agents
  for (const dir of config.agentDirs ?? ["agents"]) {
    await discoverItems(`${baseDir}/${dir}`, result, context, agentHandler, config.verbose);
  }

  // Discover resources
  for (const dir of config.resourceDirs ?? ["resources"]) {
    await discoverItems(`${baseDir}/${dir}`, result, context, resourceHandler, config.verbose);
  }

  // Discover prompts
  for (const dir of config.promptDirs ?? ["prompts"]) {
    await discoverItems(`${baseDir}/${dir}`, result, context, promptHandler, config.verbose);
  }

  // Discover workflows
  for (const dir of config.workflowDirs ?? ["workflows"]) {
    await discoverItems(`${baseDir}/${dir}`, result, context, workflowHandler, config.verbose);
  }

  // Discover tasks
  for (const dir of config.taskDirs ?? ["tasks"]) {
    await discoverItems(`${baseDir}/${dir}`, result, context, taskHandler, config.verbose);
  }

  // Clear stale skills before rediscovery so deleted/renamed skills are removed.
  skillRegistry.clear();

  // Discover skills (parallel path — markdown-based, not TypeScript import)
  for (const dir of config.skillDirs ?? ["skills"]) {
    const skillResult = await discoverSkills(
      join(baseDir, dir),
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

  return result;
}
