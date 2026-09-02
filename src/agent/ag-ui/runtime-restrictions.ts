import type { AgentConfig } from "../types.ts";
import { AGENT_DELEGATE_TOOL_PREFIX } from "../runtime/agent-delegation-names.ts";

const SKILL_LOADER_TOOL_NAMES = ["load_skill", "load_skill_reference"] as const;

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
  allowedTools: ReadonlySet<string>,
): AgentConfig["tools"] {
  if (tools === undefined) return undefined;
  if (tools === true) {
    // `true` authorizes the whole scoped catalog. An explicit allowlist replaces
    // it with registry lookups for exactly the allowlisted names.
    return Object.fromEntries([...allowedTools].map((toolName) => [toolName, true]));
  }
  return Object.fromEntries(
    Object.entries(tools).filter(([toolName]) => allowedTools.has(toolName)),
  );
}

/**
 * Narrow an agent configuration to a restriction ceiling.
 *
 * Every branch only removes capability: tools, provider tools, and delegates
 * are intersected with the allowlist, and the step bound keeps the lower of the
 * configured and requested values.
 */
export function applyAgUiRuntimeRestrictions(
  config: AgentConfig,
  restrictions: AgUiRuntimeRestrictions,
): AgentConfig {
  const restricted: AgentConfig = { ...config };

  if (restrictions.maxSteps !== undefined) {
    restricted.maxSteps = config.maxSteps === undefined
      ? restrictions.maxSteps
      : Math.min(config.maxSteps, restrictions.maxSteps);
  }

  if (restrictions.allowedTools === undefined) {
    return restricted;
  }

  const allowedTools = new Set(restrictions.allowedTools);
  restricted.tools = restrictConfiguredTools(config.tools, allowedTools);
  restricted.providerTools = config.providerTools?.filter((toolName) => allowedTools.has(toolName));
  restricted.delegates = config.delegates?.filter((delegateId) =>
    allowedTools.has(`${AGENT_DELEGATE_TOOL_PREFIX}${delegateId}`)
  );
  // MCP servers publish their tool names when the run connects to them, so a
  // name allowlist resolved before the run cannot bound that surface. Drop the
  // servers instead of leaving remote tools reachable.
  restricted.mcpServers = undefined;
  // Skills reach further instructions and tools through the skill loader, so
  // they stay out unless the loader itself is allowlisted.
  if (!SKILL_LOADER_TOOL_NAMES.some((toolName) => allowedTools.has(toolName))) {
    restricted.skills = false;
  }

  return restricted;
}
