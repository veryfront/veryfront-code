/**
 * Tool Helpers
 *
 * Utilities for tool argument parsing and tool type checking.
 *
 * @module ai/agent/runtime/tool-helpers
 */

import type { Tool, ToolDefinition } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool";
import { toolToProviderDefinition } from "#veryfront/tool/registry.ts";
import { SKILL_TOOL_IDS } from "#veryfront/skill/types.ts";
import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("agent");

/**
 * Result of parsing tool arguments.
 */
export interface ParsedToolArgs {
  args: Record<string, unknown>;
  error?: string;
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
      const trimmed = rawArgs.trim();
      if (trimmed === "" || trimmed === "{}") {
        return { args: {} };
      }
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
export function getAvailableTools(
  toolsConfig: true | Record<string, ToolConfigEntry> | undefined,
  options?: { includeSkillTools?: boolean },
): ToolDefinition[] {
  if (!toolsConfig) return [];

  if (toolsConfig === true) {
    const allTools = toolRegistry.getAll();
    logger.debug(`Loading all ${allTools.size} tools from registry`);

    return Array.from(allTools, ([name, tool]) => {
      const def = toolToProviderDefinition(tool);
      logToolDefinition(name, def);
      return def;
    }).filter((def) => {
      // Exclude skill tools unless explicitly included
      if (SKILL_TOOL_IDS.has(def.name) && !options?.includeSkillTools) return false;
      return true;
    });
  }

  const tools: ToolDefinition[] = [];

  for (const [name, entry] of Object.entries(toolsConfig)) {
    if (entry === true) {
      const tool = toolRegistry.get(name);
      if (tool) addToolDefinition(tools, name, tool);
      continue;
    }

    if (entry && typeof entry === "object") {
      addToolDefinition(tools, name, entry);
    }
  }

  return tools;
}
