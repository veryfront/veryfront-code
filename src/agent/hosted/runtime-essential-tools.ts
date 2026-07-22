/** Public API contract for hosted runtime allowed tool names. */
export type HostedRuntimeAllowedToolNames = readonly string[] | ReadonlySet<string> | null;

/** Input payload for resolving hosted runtime allowed tools. */
export type ResolveHostedRuntimeAllowedToolNamesInput = {
  allowedToolNames?: HostedRuntimeAllowedToolNames;
  localToolNames: Iterable<string>;
  availableSkillIds?: readonly string[];
  /** Preserve universal skill infrastructure for an empty configured selector. */
  includeRuntimeEssentialToolsWhenEmpty?: boolean;
};

// Script execution is intentionally not runtime-essential under allowlists:
// loading skill instructions is framework infrastructure, while running a
// project-provided script remains a direct execution capability.
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

  // Tool discovery is essential only when the agent already has at least one
  // tool in its resolved set. Under deny-all (empty allowedToolNames), discovery
  // tools are intentionally excluded: activating new tools is a broader
  // capability than running pre-configured skills (load_skill), so the two are
  // treated asymmetrically when allowedToolNames is empty.
  if (resolvedToolNames.size > 0) {
    for (const toolName of TOOL_DISCOVERY_TOOL_NAMES) {
      if (localToolNames.has(toolName)) {
        resolvedToolNames.add(toolName);
      }
    }
  }

  // Preserve request-scoped skill loading tools when the host supplies them.
  // Hosted cloud supplies load_skill; other adapters may also supply the
  // reference tool. Explicit request-level empty allowlists return above and
  // remain deny-all.
  if (resolvedToolNames.size > 0 || input.includeRuntimeEssentialToolsWhenEmpty) {
    for (const toolName of SKILL_RUNTIME_TOOL_NAMES) {
      if (localToolNames.has(toolName)) {
        resolvedToolNames.add(toolName);
      }
    }
  }

  if (!input.availableSkillIds?.length) {
    return resolvedToolNames;
  }

  for (const toolName of SKILL_DELEGATION_TOOL_NAMES) {
    if (localToolNames.has(toolName)) {
      resolvedToolNames.add(toolName);
    }
  }

  return resolvedToolNames;
}
