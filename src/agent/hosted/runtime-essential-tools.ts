/** Public API contract for hosted runtime allowed tool names. */
export type HostedRuntimeAllowedToolNames = readonly string[] | ReadonlySet<string> | null;

/** Input payload for resolving hosted runtime allowed tools. */
export type ResolveHostedRuntimeAllowedToolNamesInput = {
  allowedToolNames?: HostedRuntimeAllowedToolNames;
  localToolNames: Iterable<string>;
  availableSkillIds?: readonly string[];
  /** Let the existing skill-enabled essential-tool policy handle an empty configured selector. */
  includeRuntimeEssentialToolsWhenEmpty?: boolean;
};

const SKILL_RUNTIME_TOOL_NAMES = ["load_skill", "load_skill_reference"] as const;
const SKILL_DELEGATION_TOOL_NAMES = ["invoke_agent"] as const;

/**
 * Tool discovery tools are unconditionally essential: they must never be
 * truncated by the provider cap, regardless of skill availability.
 */
const TOOL_DISCOVERY_TOOL_NAMES = ["search_tools", "load_tools"] as const;

/** Normalize hosted runtime allowed tools. */
export function normalizeHostedRuntimeAllowedToolNames(
  toolNames: HostedRuntimeAllowedToolNames | undefined,
): ReadonlySet<string> | null {
  if (!toolNames) {
    return null;
  }

  return new Set(toolNames);
}

/** Resolve allowed tools after applying runtime-essential hosted tool policy. */
export function resolveHostedRuntimeAllowedToolNames(
  input: ResolveHostedRuntimeAllowedToolNamesInput,
): ReadonlySet<string> | null {
  const allowedToolNames = normalizeHostedRuntimeAllowedToolNames(input.allowedToolNames);
  if (
    !allowedToolNames ||
    (allowedToolNames.size === 0 && !input.includeRuntimeEssentialToolsWhenEmpty)
  ) {
    return allowedToolNames;
  }

  const localToolNames = new Set(input.localToolNames);
  const resolvedToolNames = new Set(allowedToolNames);

  // Tool discovery is unconditionally essential: force-add whenever the tools
  // are registered as local tools, regardless of skill availability.
  for (const toolName of TOOL_DISCOVERY_TOOL_NAMES) {
    if (localToolNames.has(toolName)) {
      resolvedToolNames.add(toolName);
    }
  }

  if (!input.availableSkillIds?.length) {
    return resolvedToolNames;
  }

  for (const toolName of SKILL_RUNTIME_TOOL_NAMES) {
    if (localToolNames.has(toolName)) {
      resolvedToolNames.add(toolName);
    }
  }

  for (const toolName of SKILL_DELEGATION_TOOL_NAMES) {
    if (localToolNames.has(toolName)) {
      resolvedToolNames.add(toolName);
    }
  }

  return resolvedToolNames;
}
