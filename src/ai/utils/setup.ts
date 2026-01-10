import type { Tool } from "../types/tool.ts";
import type { Agent } from "../types/agent.ts";
import type { Prompt, Resource } from "../types/mcp.ts";
import { discoverAll, type DiscoveryConfig } from "./discovery.ts";
import { toolRegistry } from "./tool.ts";
import { registerAgent } from "../agent/composition.ts";
import { registerPrompt, registerResource } from "../mcp/registry.ts";
import { toAISDKTools } from "../adapters/ai-sdk.ts";
import { cwd } from "../../platform/compat/process.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";
import { cliLogger as logger } from "@veryfront/utils";

const fs = createFileSystem();

export interface SetupAIOptions {
  baseDir?: string;
  manifestPath?: string;
  aiDir?: string;
  tools?: Record<string, Tool>;
  agents?: Record<string, Agent>;
  resources?: Record<string, Resource>;
  prompts?: Record<string, Prompt>;
  verbose?: boolean;
  skipDiscovery?: boolean;
}

export interface SetupAIResult {
  tools: Map<string, Tool>;
  agents: Map<string, Agent>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
  getTool(id: string): Tool | undefined;
  getAgent(id: string): Agent | undefined;
  getTools(): Tool[];
  getAgents(): Agent[];
  toAISDKTools(): ReturnType<typeof toAISDKTools>;
  errors: Array<{ file: string; error: Error }>;
}

export async function setupAI(options: SetupAIOptions = {}): Promise<SetupAIResult> {
  const {
    baseDir = cwd(),
    aiDir = "ai",
    tools: manualTools = {},
    agents: manualAgents = {},
    resources: manualResources = {},
    prompts: manualPrompts = {},
    verbose = false,
    skipDiscovery = false,
    manifestPath,
  } = options;

  // Result containers
  const tools = new Map<string, Tool>();
  const agents = new Map<string, Agent>();
  const resources = new Map<string, Resource>();
  const prompts = new Map<string, Prompt>();
  const errors: Array<{ file: string; error: Error }> = [];

  // Step 1: Load from manifest if provided
  if (manifestPath) {
    try {
      const manifestText = await fs.readTextFile(manifestPath);
      const manifest = JSON.parse(manifestText);
      if (manifest.tools) {
        for (const [id, tool] of Object.entries(manifest.tools)) {
          tools.set(id, tool as Tool);
          toolRegistry.register(id, tool as Tool);
        }
      }
      if (manifest.agents) {
        for (const [id, agent] of Object.entries(manifest.agents)) {
          agents.set(id, agent as Agent);
          registerAgent(id, agent as Agent);
        }
      }
      if (manifest.resources) {
        for (const [id, resource] of Object.entries(manifest.resources)) {
          resources.set(id, resource as Resource);
          registerResource(id, resource as Resource);
        }
      }
      if (manifest.prompts) {
        for (const [id, prompt] of Object.entries(manifest.prompts)) {
          prompts.set(id, prompt as Prompt);
          registerPrompt(id, prompt as Prompt);
        }
      }
      if (verbose) {
        logger.info(`[setupAI] Loaded manifest: ${tools.size} tools, ${agents.size} agents`);
      }
    } catch (error) {
      errors.push({
        file: manifestPath,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  // Step 2: Discover from filesystem (unless skipped)
  if (!skipDiscovery && !manifestPath) {
    const discoveryConfig: DiscoveryConfig = {
      baseDir,
      aiDir,
      verbose,
    };

    try {
      const discovered = await discoverAll(discoveryConfig);

      // Merge discovered items
      for (const [id, tool] of discovered.tools) {
        tools.set(id, tool);
      }
      for (const [id, agent] of discovered.agents) {
        agents.set(id, agent);
      }
      for (const [id, resource] of discovered.resources) {
        resources.set(id, resource);
      }
      for (const [id, prompt] of discovered.prompts) {
        prompts.set(id, prompt);
      }
      errors.push(...discovered.errors);

      if (verbose) {
        logger.info(`[setupAI] Discovered: ${tools.size} tools, ${agents.size} agents`);
      }
    } catch (error) {
      // Discovery failed - might be expected if no ai/ directory
      if (verbose) {
        logger.info(`[setupAI] Discovery skipped: ${error}`);
      }
    }
  }

  // Step 3: Register manual items (override discovered ones)
  for (const [id, tool] of Object.entries(manualTools)) {
    tools.set(id, tool);
    toolRegistry.register(id, tool);
  }
  for (const [id, agent] of Object.entries(manualAgents)) {
    agents.set(id, agent);
    registerAgent(id, agent);
  }
  for (const [id, resource] of Object.entries(manualResources)) {
    resources.set(id, resource);
    registerResource(id, resource);
  }
  for (const [id, prompt] of Object.entries(manualPrompts)) {
    prompts.set(id, prompt);
    registerPrompt(id, prompt);
  }

  // Create the result object with helper methods
  const result: SetupAIResult = {
    tools,
    agents,
    resources,
    prompts,
    errors,

    getTool(id: string) {
      return tools.get(id);
    },

    getAgent(id: string) {
      return agents.get(id);
    },

    getTools() {
      return Array.from(tools.values());
    },

    getAgents() {
      return Array.from(agents.values());
    },

    toAISDKTools() {
      // Convert Map to Record for toAISDKTools
      const toolsRecord: Record<string, Tool> = {};
      for (const [id, tool] of tools) {
        toolsRecord[id] = tool;
      }
      return toAISDKTools(toolsRecord);
    },
  };

  return result;
}
