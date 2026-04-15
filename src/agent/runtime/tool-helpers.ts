/**
 * Tool Helpers
 *
 * Utilities for tool argument parsing and tool type checking.
 *
 * @module ai/agent/runtime/tool-helpers
 */

import type { RemoteToolSource, Tool, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import { executeTool, toolRegistry } from "#veryfront/tool";
import { toolToProviderDefinition } from "#veryfront/tool/registry.ts";
import { SKILL_TOOL_IDS } from "#veryfront/skill/types.ts";
import { serverLogger } from "#veryfront/utils";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  executeRemoteIntegrationTool,
  isRemoteIntegrationTool,
} from "#veryfront/integrations/remote-tools.ts";

const logger = serverLogger.component("agent");

/**
 * Result of parsing tool arguments.
 */
export interface ParsedToolArgs {
  args: Record<string, unknown>;
  error?: string;
}

function stripLeadingEmptyObjectPlaceholder(rawArgs: string): string {
  let normalized = rawArgs.trim();

  while (normalized.startsWith("{}")) {
    const remainder = normalized.slice(2).trimStart();
    if (remainder.startsWith("{")) {
      normalized = remainder;
      continue;
    }

    if (remainder.startsWith('"')) {
      normalized = `{${remainder}`;
      continue;
    }

    break;
  }

  return normalized;
}

/**
 * Parse tool arguments from raw string or object.
 * Returns parsed args and optional error message.
 */
export function parseToolArgs(
  rawArgs: string | Record<string, unknown>,
): ParsedToolArgs {
  try {
    // Handle empty string or whitespace-only string as empty object
    if (typeof rawArgs === "string") {
      const trimmed = stripLeadingEmptyObjectPlaceholder(rawArgs);
      if (trimmed === "" || trimmed === "{}") {
        return { args: {} };
      }

      rawArgs = trimmed;
    }

    const parsed = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { args: {}, error: "Tool call arguments must be a JSON object" };
    }

    return { args: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      args: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if a tool is dynamic (for SSE event formatting).
 */
export function isDynamicTool(name: string): boolean {
  return toolRegistry.get(name)?.type === "dynamic";
}

/**
 * Tool configuration entry from agent config.
 * Can be a boolean (true to enable from registry) or a Tool instance.
 */
// deno-lint-ignore no-explicit-any -- generic erasure: accepts Tool with any input/output types
export type ToolConfigEntry = Tool<any, any> | boolean;

function formatAvailableToolNames(names: Iterable<string>): string {
  const sorted = [...new Set(names)].sort();
  return sorted.length > 0 ? sorted.join(", ") : "(none)";
}

function throwUnknownConfiguredToolsError(
  unknownToolNames: string[],
  availableLocalToolNames: Iterable<string>,
  availableRemoteToolNames: Iterable<string>,
): never {
  const unknownList = unknownToolNames.sort().join(", ");
  const availableNames = formatAvailableToolNames([
    ...availableLocalToolNames,
    ...availableRemoteToolNames,
  ]);

  throw toError(
    createError({
      type: "agent",
      message:
        `Unknown tool reference${unknownToolNames.length === 1 ? "" : "s"}: ${unknownList}. ` +
        `Tool names must exactly match tool({ id: "..." }). Available tools: ${availableNames}`,
    }),
  );
}

async function getRemoteToolDefinitions(options?: {
  includeIntegrationTools?: boolean;
  allowedRemoteToolNames?: string[];
  remoteToolSources?: RemoteToolSource[];
  remoteToolContext?: ToolExecutionContext;
}): Promise<ToolDefinition[]> {
  const remoteToolContext = options?.remoteToolContext;
  const definitions: ToolDefinition[] = [];
  const seenToolNames = new Set<string>();

  const addDefinition = (definition: ToolDefinition): void => {
    if (seenToolNames.has(definition.name)) {
      return;
    }
    if (
      options?.allowedRemoteToolNames &&
      !options.allowedRemoteToolNames.includes(definition.name)
    ) {
      return;
    }
    seenToolNames.add(definition.name);
    definitions.push(definition);
  };

  for (const source of options?.remoteToolSources ?? []) {
    try {
      const sourceDefs = await source.listTools(remoteToolContext);
      for (const def of sourceDefs) {
        addDefinition(def);
      }
    } catch (error) {
      logger.warn("Failed to fetch remote tool definitions from source", {
        sourceId: source.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (options?.includeIntegrationTools === false) {
    return definitions;
  }

  try {
    const { getRemoteIntegrationToolDefinitions } = await import(
      "#veryfront/integrations/remote-tools.ts"
    );
    for (const def of await getRemoteIntegrationToolDefinitions()) {
      addDefinition(def);
    }
  } catch {
    return definitions;
  }

  return definitions;
}

async function sourceHasTool(
  source: RemoteToolSource,
  toolName: string,
  context?: ToolExecutionContext,
): Promise<boolean> {
  return (await source.listTools(context)).some((definition) => definition.name === toolName);
}

async function executeRemoteToolFromSources(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
  allowedRemoteToolNames: string[] | undefined,
  remoteToolSources: RemoteToolSource[] | undefined,
): Promise<{ handled: boolean; result?: unknown }> {
  for (const source of remoteToolSources ?? []) {
    if (!(await sourceHasTool(source, toolName, context))) {
      continue;
    }

    if (allowedRemoteToolNames && !allowedRemoteToolNames.includes(toolName)) {
      throw new Error(`Tool "${toolName}" is not allowed for this run`);
    }

    return {
      handled: true,
      result: await source.executeTool(toolName, input, context),
    };
  }

  return { handled: false };
}

export function resolveConfiguredTool(
  toolsConfig: true | Record<string, ToolConfigEntry> | undefined,
  toolName: string,
): Tool | null {
  if (!toolsConfig) {
    return null;
  }

  if (toolsConfig === true) {
    return toolRegistry.get(toolName) ?? null;
  }

  const configuredEntry = toolsConfig[toolName];
  if (configuredEntry === true) {
    return toolRegistry.get(toolName) ?? null;
  }

  if (configuredEntry && typeof configuredEntry === "object") {
    return configuredEntry;
  }

  return null;
}

export async function executeConfiguredTool(
  toolName: string,
  input: Record<string, unknown>,
  toolsConfig: true | Record<string, ToolConfigEntry> | undefined,
  context?: ToolExecutionContext,
  allowedRemoteToolNames?: string[],
  remoteToolSources?: RemoteToolSource[],
): Promise<unknown> {
  const configuredTool = resolveConfiguredTool(toolsConfig, toolName);
  if (configuredTool) {
    return await configuredTool.execute(input, context);
  }

  // Try local registry first
  const registryTool = toolRegistry.get(toolName);
  if (registryTool) {
    return await registryTool.execute(input, context);
  }

  const remoteSourceResult = await executeRemoteToolFromSources(
    toolName,
    input,
    context,
    allowedRemoteToolNames,
    remoteToolSources,
  );
  if (remoteSourceResult.handled) {
    return remoteSourceResult.result;
  }

  // Fall back to remote execution for integration tools (e.g., github:list-repos)
  if (isRemoteIntegrationTool(toolName)) {
    if (allowedRemoteToolNames && !allowedRemoteToolNames.includes(toolName)) {
      throw new Error(`Tool "${toolName}" is not allowed for this run`);
    }
    return await executeRemoteIntegrationTool(
      toolName,
      input,
      context?.endUserId as string | undefined,
    );
  }

  return await executeTool(toolName, input, context);
}

function logToolDefinition(name: string, def: ToolDefinition): void {
  logger.debug(
    `[AGENT] Tool definition for "${name}":`,
    JSON.stringify(def, null, 2),
  );
}

function addToolDefinition(
  tools: ToolDefinition[],
  name: string,
  // deno-lint-ignore no-explicit-any -- generic erasure: accepts Tool with any input/output types
  tool: Tool<any, any>,
): void {
  const def = toolToProviderDefinition(tool);
  logToolDefinition(name, def);
  tools.push(def);
}

/**
 * Get available tools based on agent configuration.
 * When tools === true, loads all tools from registry.
 * Otherwise loads specific tools from config.
 *
 * @param toolsConfig - Agent tools configuration
 * @param options.includeSkillTools - When true, include skill tools for `tools: true` agents
 */
export async function getAvailableTools(
  toolsConfig: true | Record<string, ToolConfigEntry> | undefined,
  options?: {
    includeSkillTools?: boolean;
    includeIntegrationTools?: boolean;
    allowedRemoteToolNames?: string[];
    remoteToolSources?: RemoteToolSource[];
    remoteToolContext?: ToolExecutionContext;
  },
): Promise<ToolDefinition[]> {
  if (!toolsConfig) return [];

  if (toolsConfig === true) {
    const allTools = toolRegistry.getAll();
    logger.debug(`Loading all ${allTools.size} tools from registry`);

    const tools = Array.from(allTools, ([name, tool]) => {
      const def = toolToProviderDefinition(tool);
      logToolDefinition(name, def);
      return def;
    }).filter((def) => {
      // Exclude skill tools unless explicitly included
      if (SKILL_TOOL_IDS.has(def.name) && !options?.includeSkillTools) return false;
      return true;
    });

    // Append remote integration tools (per-request, project-scoped)
    const remoteDefs = await getRemoteToolDefinitions(options);
    for (const def of remoteDefs) {
      logToolDefinition(def.name, def);
    }
    tools.push(...remoteDefs);

    return tools;
  }

  const tools: ToolDefinition[] = [];
  const remoteDefs = await getRemoteToolDefinitions(options);
  const remoteToolNames = new Set(remoteDefs.map((def) => def.name));
  const explicitlyRequestedRemoteToolNames = new Set<string>();
  const unresolvedConfiguredToolNames: string[] = [];

  for (const [name, entry] of Object.entries(toolsConfig)) {
    if (entry === true) {
      const tool = toolRegistry.get(name);
      if (tool) {
        addToolDefinition(tools, name, tool);
        continue;
      }

      if (remoteToolNames.has(name)) {
        explicitlyRequestedRemoteToolNames.add(name);
        continue;
      }

      unresolvedConfiguredToolNames.push(name);
      continue;
    }

    if (entry && typeof entry === "object") {
      addToolDefinition(tools, name, entry);
    }
  }

  // Explicit-object configs should only expose remote definitions that were
  // explicitly requested, except for the internal runtime path that expands
  // `tools: true` into an explicit local-tool map and passes the remote allowlist.
  const remoteDefsToAppend = explicitlyRequestedRemoteToolNames.size > 0
    ? remoteDefs.filter((def) => explicitlyRequestedRemoteToolNames.has(def.name))
    : remoteDefs.filter((def) => options?.allowedRemoteToolNames?.includes(def.name));

  for (const def of remoteDefsToAppend) {
    // Skip if already present (e.g., explicitly configured by name)
    if (!tools.some((t) => t.name === def.name)) {
      logToolDefinition(def.name, def);
      tools.push(def);
    }
  }

  if (unresolvedConfiguredToolNames.length > 0) {
    throwUnknownConfiguredToolsError(
      unresolvedConfiguredToolNames,
      toolRegistry.getAll().keys(),
      remoteToolNames,
    );
  }

  return tools;
}
