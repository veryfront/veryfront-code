import type { AgentConfig } from "../types.ts";
import { isToolVisibleTo, toolRegistry } from "#veryfront/tool";
import { getRemoteToolProvenance } from "#veryfront/tool/remote-tool-provenance.ts";
import { AGENT_DELEGATE_TOOL_PREFIX } from "../runtime/agent-delegation-names.ts";
import { DEFAULT_MAX_STEPS } from "../runtime/constants.ts";
import type { RuntimeRemoteToolConfig } from "../runtime/mcp-server-tool-sources.ts";
import { getProviderNativeToolNames } from "../runtime/provider-native-tool-inventory.ts";
import {
  resolveRuntimeToolLoading,
  type RuntimeToolFilterConfig,
} from "../runtime/runtime-tool-config.ts";

const SKILL_LOADER_TOOL_NAMES = ["load_skill", "load_skill_reference"] as const;

// The full skill infrastructure family the factory injects whenever skills stay
// enabled. Kept as a local literal so this security boundary cannot be widened
// by mutating the public `SKILL_TOOL_IDS` compatibility set.
const SKILL_INFRASTRUCTURE_TOOL_NAMES = [
  "load_skill",
  "load_skill_reference",
  "execute_skill_script",
] as const;

// Reflection intrinsics captured at module evaluation, before any project
// module loaded for a local eval can run in this realm and replace them. The
// intersection below invokes only these captured references plus syntax-level
// operations (index loops, property access, object literals and spreads), so
// replacing globals or prototype methods such as `Object.entries`,
// `Object.fromEntries`, `Set.prototype.has`, `Array.prototype.filter`, or the
// iteration protocol cannot preserve or inject a denied tool.
const ObjectKeys = Object.keys;
const createNullPrototypeObject = Object.create;
const reflectApply = Reflect.apply;
const mapForEach = Map.prototype.forEach;

/** Name allowlist as a null-prototype lookup so `Object.prototype` names never read as allowlisted. */
type ToolNameLookup = Record<string, true>;

function toToolNameLookup(names: readonly string[]): ToolNameLookup {
  const lookup = createNullPrototypeObject(null) as ToolNameLookup;
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    if (name === undefined) continue;
    lookup[name] = true;
  }
  return lookup;
}

function filterAllowedNames(
  names: readonly string[],
  allowedTools: ToolNameLookup,
  toolNamePrefix = "",
): string[] {
  const kept: string[] = [];
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    if (name === undefined) continue;
    if (allowedTools[toolNamePrefix + name] === true) {
      kept[kept.length] = name;
    }
  }
  return kept;
}

/**
 * Ceiling a trusted server caller applies to one AG-UI run.
 *
 * The caller owns these values (a control-plane eval run resolves them before
 * dispatch), so they narrow the agent for that run only. A request body never
 * supplies them directly, and they can never widen the agent's configuration.
 */
export interface AgUiRuntimeRestrictions {
  /** Tool names the run may use. An empty list authorizes no tools at all. */
  allowedTools?: string[];
  /** Upper bound on agent loop steps. It never raises a configured bound. */
  maxSteps?: number;
}

/** Whether a restriction set narrows anything. */
export function hasAgUiRuntimeRestrictions(
  restrictions: AgUiRuntimeRestrictions | undefined,
): restrictions is AgUiRuntimeRestrictions {
  return restrictions !== undefined &&
    (restrictions.allowedTools !== undefined || restrictions.maxSteps !== undefined);
}

function restrictConfiguredTools(
  tools: AgentConfig["tools"],
  allowedToolNames: readonly string[],
  allowedTools: ToolNameLookup,
  providerToolNames: ToolNameLookup,
  visibleLocalTools: ToolNameLookup,
): AgentConfig["tools"] {
  if (tools === undefined) return undefined;
  if (tools === true) {
    // `true` authorizes the whole scoped catalog. An explicit allowlist replaces
    // it with registry lookups for exactly the allowlisted names.
    //
    // Provider-native tools stay out of this selector: the runtime resolves
    // every `true` entry against the local and remote tool registries and
    // throws `Unknown tool reference` for a name that only exists as a
    // provider-native definition. Those names travel in `providerTools` alone.
    const selected: Exclude<AgentConfig["tools"], true | undefined> = {};
    for (let index = 0; index < allowedToolNames.length; index++) {
      const toolName = allowedToolNames[index];
      if (toolName === undefined) continue;
      if (providerToolNames[toolName] !== true && visibleLocalTools[toolName] === true) {
        selected[toolName] = true;
      }
    }
    return selected;
  }
  const intersected: Exclude<AgentConfig["tools"], true | undefined> = {};
  const configuredToolNames = ObjectKeys(tools);
  for (let index = 0; index < configuredToolNames.length; index++) {
    const toolName = configuredToolNames[index];
    if (toolName === undefined) continue;
    const configuredTool = tools[toolName];
    const canonicalRemoteName = getRemoteToolProvenance(configuredTool);
    if (
      configuredTool !== undefined &&
      (allowedTools[toolName] === true ||
        (canonicalRemoteName !== undefined && allowedTools[canonicalRemoteName] === true))
    ) {
      intersected[toolName] = configuredTool;
    }
  }
  return intersected;
}

function getVisibleLocalToolNames(agentId: string | undefined): ToolNameLookup {
  const visible = createNullPrototypeObject(null) as ToolNameLookup;
  const addVisible = (tool: ReturnType<typeof toolRegistry.get>, name: string): void => {
    if (!tool || !isToolVisibleTo(tool, { agentId })) return;
    visible[name] = true;
    if (
      agentId !== undefined && tool.ownerAgentId === agentId &&
      typeof tool.shortName === "string" && tool.shortName.length > 0
    ) {
      visible[tool.shortName] = true;
    }
  };
  reflectApply(mapForEach, toolRegistry.getAll(), [addVisible]);
  return visible;
}

function getRetainedRemoteToolNames(tools: AgentConfig["tools"]): string[] {
  if (tools === undefined || tools === true) return [];
  const names: string[] = [];
  const seen = createNullPrototypeObject(null) as ToolNameLookup;
  const toolNames = ObjectKeys(tools);
  for (let index = 0; index < toolNames.length; index++) {
    const toolName = toolNames[index];
    if (toolName === undefined) continue;
    const canonicalName = getRemoteToolProvenance(tools[toolName]);
    if (canonicalName !== undefined && seen[canonicalName] !== true) {
      seen[canonicalName] = true;
      names[names.length] = canonicalName;
    }
  }
  return names;
}

/**
 * Narrow an agent configuration to a restriction ceiling.
 *
 * Every branch only removes capability: tools, provider tools, and delegates
 * are intersected with the allowlist, and the step bound keeps the lower of
 * the requested value and the configured bound (or the runtime default when
 * the agent configures none).
 */
export function applyAgUiRuntimeRestrictions(
  config: AgentConfig,
  restrictions: AgUiRuntimeRestrictions,
): AgentConfig {
  return applyAgUiRuntimeRestrictionsForModel(config, restrictions);
}

/** @internal Apply a ceiling using the effective request model for provider collisions. */
export function applyAgUiRuntimeRestrictionsForModel(
  config: AgentConfig,
  restrictions: AgUiRuntimeRestrictions,
  modelOverride?: string,
  sourceAgentId: string | undefined = config.id,
): AgentConfig {
  const restricted: AgentConfig = { ...config };

  if (restrictions.maxSteps !== undefined) {
    // An agent that configures no bound still runs at the runtime default, so
    // the ceiling intersects with that effective bound too. A restriction can
    // narrow the default but never raise it.
    const configuredMaxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;
    restricted.maxSteps = restrictions.maxSteps < configuredMaxSteps
      ? restrictions.maxSteps
      : configuredMaxSteps;
    // `computeMaxSteps` prefers an enabled edge limit over the top-level
    // bound, so narrow that limit too -- otherwise an edge-enabled agent
    // would run its full edge step budget past the ceiling.
    if (config.edge?.enabled && config.edge.maxSteps !== undefined) {
      restricted.edge = {
        ...config.edge,
        maxSteps: restrictions.maxSteps < config.edge.maxSteps
          ? restrictions.maxSteps
          : config.edge.maxSteps,
      };
    }
  }

  if (restrictions.allowedTools === undefined) {
    return restricted;
  }

  const allowedToolNames = restrictions.allowedTools;
  const allowedTools = toToolNameLookup(allowedToolNames);
  const supportedProviderTools = toToolNameLookup(getProviderNativeToolNames({
    model: modelOverride ?? config.model,
  }));
  const configuredProviderToolNames = config.providerTools === undefined
    ? []
    : filterAllowedNames(config.providerTools, supportedProviderTools);
  const providerToolNames = toToolNameLookup(configuredProviderToolNames);
  const visibleLocalTools = config.tools === true
    ? getVisibleLocalToolNames(sourceAgentId)
    : toToolNameLookup([]);
  restricted.tools = restrictConfiguredTools(
    config.tools,
    allowedToolNames,
    allowedTools,
    providerToolNames,
    visibleLocalTools,
  );
  if (config.tools === true) {
    // Replacing the authored `tools: true` selector with an explicit map would
    // flip `resolveRuntimeToolLoading` from deferred to eager, sending every
    // allowlisted schema on the first provider call instead of exposing
    // `tool_search`. Pin the source configuration's resolved mode so the
    // intersection only narrows which tools exist, never how they load.
    (restricted as RuntimeToolFilterConfig).__vfToolLoadingMode =
      resolveRuntimeToolLoading(config).mode;
  }
  restricted.providerTools = config.providerTools === undefined
    ? undefined
    : filterAllowedNames(config.providerTools, allowedTools);
  restricted.delegates = config.delegates === undefined
    ? undefined
    : filterAllowedNames(config.delegates, allowedTools, AGENT_DELEGATE_TOOL_PREFIX);
  // MCP servers publish their tool names when the run connects to them, so a
  // name allowlist resolved before the run cannot bound that surface. Drop the
  // servers instead of leaving remote tools reachable.
  //
  // The list has to be explicitly empty rather than absent: an absent
  // `mcpServers` makes `getRuntimeRemoteToolSources` treat allowlisted boolean
  // tool references that no local registry resolves as a request for an
  // implicit Veryfront API MCP server, and it lets ambient runtime remote
  // sources be inherited. Injected remote-source fields are cleared for the
  // same reason.
  restricted.mcpServers = [];
  const remoteToolConfig = restricted as AgentConfig & RuntimeRemoteToolConfig;
  remoteToolConfig.__vfRemoteToolSources = [];
  remoteToolConfig.__vfAllowedRemoteTools = getRetainedRemoteToolNames(restricted.tools);
  // Skills reach further instructions and tools through the skill loader, so
  // they stay out unless the loader itself is allowlisted.
  let skillLoaderAllowed = false;
  for (let index = 0; index < SKILL_LOADER_TOOL_NAMES.length; index++) {
    const loaderToolName = SKILL_LOADER_TOOL_NAMES[index];
    if (loaderToolName !== undefined && allowedTools[loaderToolName] === true) {
      skillLoaderAllowed = true;
      break;
    }
  }
  if (!skillLoaderAllowed) {
    restricted.skills = false;
  } else {
    // With skills enabled, the factory injects the whole skill infrastructure
    // family into the rebuilt agent's tool map unless an entry is explicitly
    // `false`. The intersection above only removes names, so stamp an explicit
    // `false` for every family member outside the allowlist -- otherwise a
    // ceiling naming only `load_skill` would also grant `execute_skill_script`.
    const tools = restricted.tools === undefined || restricted.tools === true
      ? {}
      : { ...restricted.tools };
    for (let index = 0; index < SKILL_INFRASTRUCTURE_TOOL_NAMES.length; index++) {
      const toolName = SKILL_INFRASTRUCTURE_TOOL_NAMES[index];
      if (toolName !== undefined && allowedTools[toolName] !== true) {
        tools[toolName] = false;
      }
    }
    restricted.tools = tools;
  }

  return restricted;
}
