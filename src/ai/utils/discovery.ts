/**
 * Auto-discovery system for AI components
 *
 * Scans ai/ directories and automatically registers:
 * - Tools (ai/tools/)
 * - Agents (ai/agents/)
 * - Resources (ai/resources/)
 * - Prompts (ai/prompts/)
 */

import { detectPlatform } from "../runtime/platform.ts";
import type { Platform } from "../runtime/platform.ts";
import { registerPrompt, registerResource, registerTool } from "../mcp/registry.ts";
import type { Tool } from "../types/tool.ts";
import type { Prompt, Resource } from "../types/mcp.ts";
import type { Agent } from "../types/agent.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { getConfig } from "../../core/config/loader.ts";
import { createMockAdapter } from "../../platform/adapters/mock.ts";
import type { FileSystemAdapter } from "../../platform/adapters/base.ts";

interface FileDiscoveryContext {
  platform: Platform;
  /** Optional filesystem adapter for cross-platform support */
  fsAdapter?: FileSystemAdapter;
  /** Cached node dependencies (lazy loaded) */
  nodeDeps?: {
    fs: typeof import("node:fs");
    path: typeof import("node:path");
  };
}

export interface DiscoveryConfig {
  /** Base directory (usually project root) */
  baseDir: string;

  /** AI directory (relative to baseDir) */
  aiDir?: string;

  /** Tool directories */
  toolDirs?: string[];

  /** Agent directories */
  agentDirs?: string[];

  /** Resource directories */
  resourceDirs?: string[];

  /** Prompt directories */
  promptDirs?: string[];

  /** Enable verbose logging */
  verbose?: boolean;

  /** Optional filesystem adapter for cross-platform support (Cloudflare Workers, etc.) */
  fsAdapter?: FileSystemAdapter;
}

export interface DiscoveryResult {
  tools: Map<string, Tool>;
  agents: Map<string, Agent>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
  errors: Array<{ file: string; error: Error }>;
}

/**
 * Discover and register all AI components
 */
export async function discoverAll(
  config: DiscoveryConfig,
): Promise<DiscoveryResult> {
  let aiDir = config.aiDir;
  const baseDir = config.baseDir;

  if (!aiDir) {
    try {
      const adapter = createMockAdapter();
      const projectConfig = await getConfig(baseDir, adapter);
      aiDir = projectConfig.directories?.ai || "ai";
    } catch {
      aiDir = "ai";
    }
  }

  const context: FileDiscoveryContext = {
    platform: detectPlatform(),
    fsAdapter: config.fsAdapter,
  };

  const result: DiscoveryResult = {
    tools: new Map(),
    agents: new Map(),
    resources: new Map(),
    prompts: new Map(),
    errors: [],
  };

  const toolDirs = config.toolDirs || [`${aiDir}/tools`];
  for (const dir of toolDirs) {
    await discoverTools(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  const agentDirs = config.agentDirs || [`${aiDir}/agents`];
  for (const dir of agentDirs) {
    await discoverAgents(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  const resourceDirs = config.resourceDirs || [`${aiDir}/resources`];
  for (const dir of resourceDirs) {
    await discoverResources(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  const promptDirs = config.promptDirs || [`${aiDir}/prompts`];
  for (const dir of promptDirs) {
    await discoverPrompts(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  return result;
}

/**
 * Discover tools in a directory
 */
async function discoverTools(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  const files = await findTypeScriptFiles(dir, context);

  if (verbose) {
    agentLogger.info(`[Discovery] Found ${files.length} tool files in ${dir}`);
  }

  for (const file of files) {
    try {
      const module = await import(file);
      const tool = module.default as Tool;

      if (!tool || typeof tool.execute !== "function") {
        if (verbose) {
          agentLogger.warn(`[Discovery] ${file} does not export a valid tool`);
        }
        continue;
      }

      const id = filenameToId(file);
      const toolWithId = { ...tool, id };
      registerTool(id, toolWithId);
      result.tools.set(id, toolWithId);

      if (verbose) {
        agentLogger.info(`[Discovery] Registered tool: ${id}`);
      }
    } catch (error) {
      result.errors.push({
        file,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      if (verbose) {
        agentLogger.error(`[Discovery] Error loading ${file}:`, error);
      }
    }
  }
}

/**
 * Discover agents in a directory
 */
async function discoverAgents(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  const files = await findTypeScriptFiles(dir, context);

  if (verbose) {
    agentLogger.info(`[Discovery] Found ${files.length} agent files in ${dir}`);
  }

  for (const file of files) {
    try {
      const module = await import(file);
      const agent = module.default as Agent;

      if (!agent || typeof agent.generate !== "function") {
        if (verbose) {
          agentLogger.warn(`[Discovery] ${file} does not export a valid agent`);
        }
        continue;
      }

      const id = agent.id || filenameToId(file);

      result.agents.set(id, agent);

      if (verbose) {
        agentLogger.info(`[Discovery] Registered agent: ${id}`);
      }
    } catch (error) {
      result.errors.push({
        file,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      if (verbose) {
        agentLogger.error(`[Discovery] Error loading ${file}:`, error);
      }
    }
  }
}

/**
 * Discover resources in a directory
 */
async function discoverResources(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  const files = await findTypeScriptFiles(dir, context);

  if (verbose) {
    agentLogger.info(`[Discovery] Found ${files.length} resource files in ${dir}`);
  }

  for (const file of files) {
    try {
      const module = await import(file);
      const resource = module.default as Resource;

      if (!resource || typeof resource.load !== "function") {
        if (verbose) {
          agentLogger.warn(`[Discovery] ${file} does not export a valid resource`);
        }
        continue;
      }

      const id = filenameToId(file);
      const pattern = filePathToPattern(file, dir);
      const resourceWithMeta = { ...resource, id, pattern };
      registerResource(id, resourceWithMeta);
      result.resources.set(id, resourceWithMeta);

      if (verbose) {
        agentLogger.info(`[Discovery] Registered resource: ${id} (${pattern})`);
      }
    } catch (error) {
      result.errors.push({
        file,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      if (verbose) {
        agentLogger.error(`[Discovery] Error loading ${file}:`, error);
      }
    }
  }
}

/**
 * Discover prompts in a directory
 */
async function discoverPrompts(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<void> {
  const files = await findTypeScriptFiles(dir, context);

  if (verbose) {
    agentLogger.info(`[Discovery] Found ${files.length} prompt files in ${dir}`);
  }

  for (const file of files) {
    try {
      const module = await import(file);
      const promptInstance = module.default as Prompt;

      if (!promptInstance || typeof promptInstance.getContent !== "function") {
        if (verbose) {
          agentLogger.warn(`[Discovery] ${file} does not export a valid prompt`);
        }
        continue;
      }

      const id = filenameToId(file);
      const promptWithId = { ...promptInstance, id };
      registerPrompt(id, promptWithId);
      result.prompts.set(id, promptWithId);

      if (verbose) {
        agentLogger.info(`[Discovery] Registered prompt: ${id}`);
      }
    } catch (error) {
      result.errors.push({
        file,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      if (verbose) {
        agentLogger.error(`[Discovery] Error loading ${file}:`, error);
      }
    }
  }
}

/**
 * Find all TypeScript files in a directory (recursively)
 */
async function findTypeScriptFiles(
  dir: string,
  context: FileDiscoveryContext,
): Promise<string[]> {
  const files: string[] = [];

  try {
    if (context.fsAdapter) {
      const exists = await context.fsAdapter.exists(dir);
      if (!exists) {
        return files;
      }

      for await (const entry of context.fsAdapter.readDir(dir)) {
        const filePath = `${dir}/${entry.name}`;

        if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          files.push(`file://${filePath}`);
        } else if (entry.isDirectory) {
          const subFiles = await findTypeScriptFiles(filePath, context);
          files.push(...subFiles);
        }
      }
    } else {
      const { fs, path } = await getNodeDeps(context);

      if (!fs || !path) {
        return files;
      }

      if (!fs.existsSync(dir)) {
        return files;
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const filePath = path.join(dir, entry.name);

        if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          files.push(`file://${path.resolve(filePath)}`);
        } else if (entry.isDirectory()) {
          const subFiles = await findTypeScriptFiles(filePath, context);
          files.push(...subFiles);
        }
      }
    }
  } catch {
    // Directory doesn't exist or is not accessible
    return files;
  }

  return files;
}

async function getNodeDeps(context: FileDiscoveryContext) {
  if (context.nodeDeps) {
    return context.nodeDeps;
  }

  if (context.fsAdapter) {
    context.nodeDeps = {
      fs: {} as unknown as typeof import("node:fs"),
      path: {} as unknown as typeof import("node:path"),
    };
    return context.nodeDeps;
  }

  const [fsModule, pathModule] = await Promise.all([
    import("node:fs"),
    import("node:path"),
  ]);

  context.nodeDeps = {
    fs: fsModule,
    path: pathModule,
  };

  return context.nodeDeps;
}

/**
 * Convert filename to camelCase ID
 */
function filenameToId(filePath: string): string {
  const filename = filePath.split("/").pop()?.replace(/\.(ts|tsx|js|jsx)$/, "") || "";

  return filename
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

/**
 * Convert file path to resource pattern
 */
function filePathToPattern(filePath: string, baseDir: string): string {
  const cleanPath = filePath.replace("file://", "");

  let pattern = cleanPath
    .replace(baseDir, "")
    .replace(/\.(ts|tsx|js|jsx)$/, "");

  pattern = pattern.replace(/\[(\w+)\]/g, ":$1");
  pattern = pattern.replace(/^\/+/, "");
  pattern = "/" + pattern;

  return pattern;
}
