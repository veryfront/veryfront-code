/**
 * Tool Helpers
 *
 * Utilities for tool argument parsing and tool type checking.
 *
 * @module ai/agent/runtime/tool-helpers
 */

import type { RemoteToolSource, Tool, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import { executeTool, isToolVisibleTo, toolRegistry } from "#veryfront/tool";
import { assertLocalToolId, toolToProviderDefinition } from "#veryfront/tool/registry.ts";
import { getRemoteToolProvenance } from "#veryfront/tool/remote-tool-provenance.ts";
import { isSkillInfrastructureToolId } from "#veryfront/skill/types.ts";
import { serverLogger } from "#veryfront/utils";
import { createError, PERMISSION_DENIED, toError } from "#veryfront/errors";
import {
  executeRemoteIntegrationTool,
  isRemoteIntegrationTool,
} from "#veryfront/integrations/remote-tools.ts";
import type { RemoteIntegrationToolDiscoveryResult } from "#veryfront/integrations/remote-tools.ts";
import {
  isIntegrationToolAllowedBySourcePolicy,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

const logger = serverLogger.component("agent");
const intrinsicReflectApply = Reflect.apply;
const intrinsicObjectEntries = Object.entries;
const intrinsicArrayPush = Array.prototype.push;
const intrinsicArrayIncludes = Array.prototype.includes;

function intrinsicIncludes<T>(values: readonly T[], value: T): boolean {
  return intrinsicReflectApply(intrinsicArrayIncludes, values, [value]);
}

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

function getConfiguredRemoteToolName(
  entry: ToolConfigEntry | undefined,
): string | undefined {
  return typeof entry === "object" ? getRemoteToolProvenance(entry) : undefined;
}

function getConfiguredToolAuthorizationName(
  toolName: string,
  entry: ToolConfigEntry | undefined,
): string {
  return getConfiguredRemoteToolName(entry) ?? toolName;
}

function isRemoteToolAllowed(
  toolName: string,
  allowedRemoteToolNames: readonly string[] | undefined,
): boolean {
  return allowedRemoteToolNames === undefined ||
    intrinsicIncludes(allowedRemoteToolNames, toolName);
}

/**
 * Resolve a configured tool name for a caller: the caller's own tool by short
 * name first, then an exact registry id — returning only tools visible to the
 * caller (owner-aware).
 */
function resolveVisibleRegistryTool(
  name: string,
  callerAgentId?: string,
  // deno-lint-ignore no-explicit-any -- generic erasure: registry tools carry any input/output types
): Tool<any, any> | undefined {
  if (callerAgentId !== undefined) {
    for (const tool of toolRegistry.getAll().values()) {
      if (tool.ownerAgentId === callerAgentId && tool.shortName === name) {
        return tool;
      }
    }
  }
  const tool = toolRegistry.get(name);
  return tool && isToolVisibleTo(tool, { agentId: callerAgentId }) ? tool : undefined;
}

function formatAvailableToolNames(names: Iterable<string>): string {
  const sorted = [...new Set(names)].sort(compareStrings);
  return sorted.length > 0 ? sorted.join(", ") : "(none)";
}

function throwUnknownConfiguredToolsError(
  unknownToolNames: string[],
  availableLocalToolNames: Iterable<string>,
  availableRemoteToolNames: Iterable<string>,
): never {
  const unknownList = unknownToolNames.toSorted(compareStrings).join(", ");
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
  onIntegrationToolDiscovery?: (result: RemoteIntegrationToolDiscoveryResult) => void;
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
      !intrinsicIncludes(options.allowedRemoteToolNames, definition.name)
    ) {
      return;
    }
    seenToolNames.add(definition.name);
    intrinsicReflectApply(intrinsicArrayPush, definitions, [definition]);
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
    const { getRemoteIntegrationToolDiscovery } = await import(
      "#veryfront/integrations/remote-tools.ts"
    );
    const discovery = await getRemoteIntegrationToolDiscovery(remoteToolContext);
    options?.onIntegrationToolDiscovery?.(discovery);
    if (discovery.status === "ok") {
      for (const def of discovery.tools) {
        addDefinition(def);
      }
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

    if (allowedRemoteToolNames && !intrinsicIncludes(allowedRemoteToolNames, toolName)) {
      throw PERMISSION_DENIED.create({ detail: `Tool "${toolName}" is not allowed for this run` });
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
  context?: ToolExecutionContext,
  options?: {
    allowIntegrationStyleConcreteTools?: boolean;
  },
): Tool | null {
  if (!toolsConfig) {
    return null;
  }

  // Registry-backed lookups (`tools: true` and `{ name: true }` entries) are
  // owner-aware: another agent's owned tool behaves as if it does not exist.
  // Tool objects embedded directly in the config record were bound by the
  // agent author and pass through as-is.
  if (toolsConfig === true) {
    const registryTool = toolRegistry.get(toolName);
    return registryTool && isToolVisibleTo(registryTool, context) ? registryTool : null;
  }

  const configuredEntry = toolsConfig[toolName];
  if (configuredEntry === true) {
    const registryTool = toolRegistry.get(toolName);
    return registryTool && isToolVisibleTo(registryTool, context) ? registryTool : null;
  }

  if (configuredEntry && typeof configuredEntry === "object") {
    if (
      options?.allowIntegrationStyleConcreteTools !== true &&
      getConfiguredRemoteToolName(configuredEntry) === undefined
    ) {
      assertLocalToolId(toolName);
      assertLocalToolId(configuredEntry.id);
    }
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
  sourceIntegrationPolicy?: SourceIntegrationPolicyManifest,
  options?: {
    strictConfiguredToolsOnly?: boolean;
  },
): Promise<unknown> {
  const configuredEntry = toolsConfig === true ? undefined : toolsConfig?.[toolName];
  const configuredRemoteToolName = getConfiguredRemoteToolName(configuredEntry);
  const authorizationToolName = getConfiguredToolAuthorizationName(toolName, configuredEntry);

  if (
    sourceIntegrationPolicy &&
    !isIntegrationToolAllowedBySourcePolicy(authorizationToolName, sourceIntegrationPolicy)
  ) {
    throw new Error(
      `Tool "${authorizationToolName}" is not allowed by the source integration policy`,
    );
  }

  if (
    configuredRemoteToolName !== undefined &&
    !isRemoteToolAllowed(configuredRemoteToolName, allowedRemoteToolNames)
  ) {
    throw PERMISSION_DENIED.create({
      detail: `Tool "${configuredRemoteToolName}" is not allowed for this run`,
    });
  }

  const configuredTool = resolveConfiguredTool(toolsConfig, toolName, context, {
    allowIntegrationStyleConcreteTools: options?.strictConfiguredToolsOnly,
  });
  if (configuredTool) {
    return await configuredTool.execute(input, context);
  }

  if (options?.strictConfiguredToolsOnly) {
    throw new Error(`Tool "${toolName}" is not available in request-scoped replacement tools`);
  }

  // Try local registry first. Owned tools are only executable by their
  // owning agent (context.agentId is stamped by the runtime); invisible tools
  // fall through and surface as "not found" via executeTool.
  const registryTool = toolRegistry.get(toolName);
  if (registryTool && isToolVisibleTo(registryTool, context)) {
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

  // Route canonical integration tools to the project-scoped API executor.
  if (isRemoteIntegrationTool(toolName)) {
    if (allowedRemoteToolNames && !intrinsicIncludes(allowedRemoteToolNames, toolName)) {
      throw PERMISSION_DENIED.create({ detail: `Tool "${toolName}" is not allowed for this run` });
    }
    return await executeRemoteIntegrationTool(toolName, input, context);
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
  const def = toolToProviderDefinition({ ...tool, id: name });
  logToolDefinition(name, def);
  intrinsicReflectApply(intrinsicArrayPush, tools, [def]);
}

/**
 * Merge forwarded integration tool definitions into the remote defs array.
 * Forwarded definitions are provided by the API when the runtime cannot
 * fetch them directly (e.g., the runtime token lacks user auth).
 * Only appends definitions not already present in the array.
 */
function appendForwardedToolDefinitions(
  remoteDefs: ToolDefinition[],
  forwarded: ToolDefinition[] | undefined,
  allowedNames: string[] | undefined,
): void {
  if (!forwarded?.length) return;
  const existing = new Set(remoteDefs.map((def) => def.name));
  for (const def of forwarded) {
    if (existing.has(def.name)) continue;
    if (allowedNames && !intrinsicIncludes(allowedNames, def.name)) continue;
    intrinsicReflectApply(intrinsicArrayPush, remoteDefs, [def]);
    existing.add(def.name);
  }
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
    forwardedRemoteToolDefinitions?: ToolDefinition[];
    remoteToolSources?: RemoteToolSource[];
    remoteToolContext?: ToolExecutionContext;
    onIntegrationToolDiscovery?: (result: RemoteIntegrationToolDiscoveryResult) => void;
    sourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
    strictConfiguredToolsOnly?: boolean;
    /** Calling agent id for owner-aware tool visibility. */
    callerAgentId?: string;
  },
): Promise<ToolDefinition[]> {
  if (!toolsConfig) return [];
  const sourceIntegrationPolicy = options?.sourceIntegrationPolicy;
  const strictConfiguredToolsOnly = options?.strictConfiguredToolsOnly === true;

  if (toolsConfig === true) {
    const allTools = toolRegistry.getAll();
    logger.debug(`Loading all ${allTools.size} tools from registry`);

    const visibleTools = Array.from(allTools.entries()).filter(([, tool]) =>
      isToolVisibleTo(tool, { agentId: options?.callerAgentId })
    );
    const tools = visibleTools.map(([name, tool]) => {
      const def = toolToProviderDefinition(tool);
      logToolDefinition(name, def);
      return def;
    }).filter((def) => {
      // Exclude skill tools unless explicitly included
      if (isSkillInfrastructureToolId(def.name) && !options?.includeSkillTools) return false;
      return true;
    });

    if (!strictConfiguredToolsOnly) {
      // Append remote integration tools (per-request, project-scoped)
      const remoteDefs = await getRemoteToolDefinitions(options);
      appendForwardedToolDefinitions(
        remoteDefs,
        options?.forwardedRemoteToolDefinitions,
        options?.allowedRemoteToolNames,
      );
      for (const def of remoteDefs) {
        logToolDefinition(def.name, def);
      }
      intrinsicReflectApply(intrinsicArrayPush, tools, remoteDefs);
    }

    return sourceIntegrationPolicy
      ? tools.filter((definition) =>
        isIntegrationToolAllowedBySourcePolicy(definition.name, sourceIntegrationPolicy)
      )
      : tools;
  }

  const tools: ToolDefinition[] = [];
  const remoteDefs = strictConfiguredToolsOnly ? [] : await getRemoteToolDefinitions(options);
  if (!strictConfiguredToolsOnly) {
    appendForwardedToolDefinitions(
      remoteDefs,
      options?.forwardedRemoteToolDefinitions,
      options?.allowedRemoteToolNames,
    );
  }
  const remoteToolNames = new Set(remoteDefs.map((def) => def.name));
  const explicitlyRequestedRemoteToolNames = new Set<string>();
  const unresolvedConfiguredToolNames: string[] = [];
  const configuredAuthorizationToolNames = new Map<string, string>();

  const configuredEntries = intrinsicReflectApply(intrinsicObjectEntries, Object, [
    toolsConfig,
  ]) as Array<[string, (typeof toolsConfig)[string]]>;
  for (let index = 0; index < configuredEntries.length; index++) {
    const configuredEntry = configuredEntries[index];
    if (configuredEntry === undefined) continue;
    const name = configuredEntry[0];
    const entry = configuredEntry[1];
    const configuredRemoteToolName = getConfiguredRemoteToolName(entry);
    const authorizationToolName = getConfiguredToolAuthorizationName(name, entry);
    if (
      sourceIntegrationPolicy &&
      !isIntegrationToolAllowedBySourcePolicy(authorizationToolName, sourceIntegrationPolicy)
    ) {
      continue;
    }

    if (entry === true) {
      if (strictConfiguredToolsOnly) {
        intrinsicReflectApply(intrinsicArrayPush, unresolvedConfiguredToolNames, [name]);
        continue;
      }

      // Own short name first, then exact id; owned tools of other agents are
      // invisible and fall through to the unresolved diagnostic. Definitions
      // are exposed under the tool's full registry id so execution resolves
      // through the same owner-aware gate.
      const tool = resolveVisibleRegistryTool(name, options?.callerAgentId);
      if (tool) {
        addToolDefinition(tools, tool.id, tool);
        continue;
      }

      if (remoteToolNames.has(name)) {
        explicitlyRequestedRemoteToolNames.add(name);
        continue;
      }

      intrinsicReflectApply(intrinsicArrayPush, unresolvedConfiguredToolNames, [name]);
      continue;
    }

    if (entry && typeof entry === "object") {
      if (
        configuredRemoteToolName !== undefined &&
        !isRemoteToolAllowed(configuredRemoteToolName, options?.allowedRemoteToolNames)
      ) {
        continue;
      }
      if (!strictConfiguredToolsOnly && configuredRemoteToolName === undefined) {
        assertLocalToolId(name);
        assertLocalToolId(entry.id);
      }
      configuredAuthorizationToolNames.set(name, authorizationToolName);
      addToolDefinition(tools, name, entry);
    }
  }

  // Explicit-object configs should only expose remote definitions that were
  // explicitly requested, except for the internal runtime path that expands
  // `tools: true` into an explicit local-tool map and passes the remote allowlist.
  const remoteDefsToAppend: ToolDefinition[] = [];
  for (let index = 0; index < remoteDefs.length; index++) {
    const definition = remoteDefs[index];
    if (definition === undefined) continue;
    const allowed = explicitlyRequestedRemoteToolNames.size > 0
      ? explicitlyRequestedRemoteToolNames.has(definition.name)
      : options?.allowedRemoteToolNames !== undefined &&
        intrinsicIncludes(options.allowedRemoteToolNames, definition.name);
    if (allowed) remoteDefsToAppend[remoteDefsToAppend.length] = definition;
  }

  for (let index = 0; index < remoteDefsToAppend.length; index++) {
    const def = remoteDefsToAppend[index];
    if (def === undefined) continue;
    // Skip if already present (e.g., explicitly configured by name)
    if (!tools.some((t) => t.name === def.name)) {
      logToolDefinition(def.name, def);
      intrinsicReflectApply(intrinsicArrayPush, tools, [def]);
    }
  }

  if (unresolvedConfiguredToolNames.length > 0) {
    // Enumerate only tools visible to the caller — never another agent's
    // owned tool ids (error-message leak guard).
    const visibleLocalToolNames = Array.from(toolRegistry.getAll().entries())
      .filter(([, tool]) => isToolVisibleTo(tool, { agentId: options?.callerAgentId }))
      .map(([name]) => name);
    throwUnknownConfiguredToolsError(
      unresolvedConfiguredToolNames,
      visibleLocalToolNames,
      remoteToolNames,
    );
  }

  return sourceIntegrationPolicy
    ? tools.filter((definition) =>
      isIntegrationToolAllowedBySourcePolicy(
        configuredAuthorizationToolNames.get(definition.name) ?? definition.name,
        sourceIntegrationPolicy,
      )
    )
    : tools;
}
