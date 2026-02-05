/**
 * Discovery Engine
 *
 * Core discovery orchestration that coordinates finding and registering
 * tools, agents, resources, prompts, and workflows.
 */

import { detectPlatform } from "../../platform/core-platform.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
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
  promptHandler,
  resourceHandler,
  toolHandler,
  workflowHandler,
} from "./handlers/index.ts";

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
    agentLogger.info(`[Discovery] Found ${files.length} ${handler.typeName} files in ${dir}`);
  }

  for (const file of files) {
    try {
      const module = await importModule(file, context);
      const item = (module as { default?: T }).default;

      if (!handler.validate(item)) {
        if (verbose) {
          agentLogger.warn(`[Discovery] ${file} does not export a valid ${handler.typeName}`);
        }
        continue;
      }

      const id = handler.getId(item, file, dir);
      const registered = handler.register(id, item, file, dir);
      handler.getResultMap(result).set(id, registered);

      if (verbose) {
        agentLogger.info(`[Discovery] Registered ${handler.typeName}: ${id}`);
      }
    } catch (error) {
      result.errors.push({ file, error: ensureError(error) });

      if (verbose) {
        agentLogger.error(`[Discovery] Error loading ${file}:`, error);
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
    resources: new Map(),
    prompts: new Map(),
    workflows: new Map(),
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

  return result;
}
