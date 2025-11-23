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

interface FileDiscoveryContext {
  platform: Platform;
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

  // If aiDir is not provided, try to load from veryfront.config.ts
  if (!aiDir) {
    try {
      const adapter = createMockAdapter();
      // Attempt to load config from baseDir
      const projectConfig = await getConfig(baseDir, adapter);
      aiDir = projectConfig.directories?.ai || "ai";
    } catch {
      // Fallback to default
      aiDir = "ai";
    }
  }

  const context: FileDiscoveryContext = {
    platform: detectPlatform(),
  };

  const result: DiscoveryResult = {
    tools: new Map(),
    agents: new Map(),
    resources: new Map(),
    prompts: new Map(),
    errors: [],
  };

  // Discover tools
  const toolDirs = config.toolDirs || [`${aiDir}/tools`];
  for (const dir of toolDirs) {
    await discoverTools(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  // Discover agents
  const agentDirs = config.agentDirs || [`${aiDir}/agents`];
  for (const dir of agentDirs) {
    await discoverAgents(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  // Discover resources
  const resourceDirs = config.resourceDirs || [`${aiDir}/resources`];
  for (const dir of resourceDirs) {
    await discoverResources(`${baseDir}/${dir}`, result, context, config.verbose);
  }

  // Discover prompts
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

      // Generate ID from filename
      const id = filenameToId(file);

      // Create new tool with corrected ID
      const toolWithId = { ...tool, id };

      // Register tool
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

      // Generate ID from filename if not provided
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

      // Generate ID and pattern from file path
      const id = filenameToId(file);
      const pattern = filePathToPattern(file, dir);

      // Create resource with corrected ID and pattern
      const resourceWithMeta = { ...resource, id, pattern };

      // Register resource
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

      // Generate ID from filename
      const id = filenameToId(file);

      // Create prompt with corrected ID
      const promptWithId = { ...promptInstance, id };

      // Register prompt
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
    if (context.platform === "deno") {
      // Use Deno's file system API
      for await (const entry of Deno.readDir(dir)) {
        const filePath = `${dir}/${entry.name}`;

        if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          // Convert to file:// URL for import
          files.push(`file://${filePath}`);
        } else if (entry.isDirectory) {
          // Recursively scan subdirectories
          const subFiles = await findTypeScriptFiles(filePath, context);
          files.push(...subFiles);
        }
      }
    } else {
      const { fs, path } = await getNodeDeps(context);

      if (!fs.existsSync(dir)) {
        return files;
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const filePath = path.join(dir, entry.name);

        if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          // Convert to file:// URL for import
          files.push(`file://${path.resolve(filePath)}`);
        } else if (entry.isDirectory()) {
          // Recursively scan subdirectories
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
 * Examples:
 *   search-web.ts -> searchWeb
 *   send_email.ts -> sendEmail
 *   getUserData.ts -> getUserData
 */
function filenameToId(filePath: string): string {
  // Get filename without extension
  const filename = filePath.split("/").pop()?.replace(/\.(ts|tsx|js|jsx)$/, "") || "";

  // Convert kebab-case and snake_case to camelCase
  return filename
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

/**
 * Convert file path to resource pattern
 * Examples:
 *   ai/resources/users/[userId]/profile.ts -> /users/:userId/profile
 *   ai/resources/products/[productId].ts -> /products/:productId
 */
function filePathToPattern(filePath: string, baseDir: string): string {
  // Remove file:// protocol if present
  const cleanPath = filePath.replace("file://", "");

  // Remove base directory and .ts extension
  let pattern = cleanPath
    .replace(baseDir, "")
    .replace(/\.(ts|tsx|js|jsx)$/, "");

  // Convert [param] to :param (Next.js -> Express style)
  pattern = pattern.replace(/\[(\w+)\]/g, ":$1");

  // Remove leading slash if exists, then add it back
  pattern = pattern.replace(/^\/+/, "");
  pattern = "/" + pattern;

  return pattern;
}
