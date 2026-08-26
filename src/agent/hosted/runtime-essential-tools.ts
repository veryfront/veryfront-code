/** Public API contract for hosted runtime allowed tool names. */
export type HostedRuntimeAllowedToolNames = readonly string[] | ReadonlySet<string> | null;

/** Input payload for resolving hosted runtime allowed tools. */
export type ResolveHostedRuntimeAllowedToolNamesInput = {
  allowedToolNames?: HostedRuntimeAllowedToolNames;
  localToolNames: Iterable<string>;
  availableSkillIds?: readonly string[];
  /**
   * Provenance marker: the selector was built from the agent's own trusted
   * config (no request-level `allowedTools` override), which carries the
   * legacy runtime-essential inclusion semantics. Config-derived selectors
   * keep universal skill infrastructure when empty and keep skill delegation
   * (`invoke_agent`) for empty and non-empty configured sets alike.
   * Request- or delegation-derived selectors must leave this unset so they
   * never gain essential tools the caller did not request.
   */
  configDerivedSelector?: boolean;
};

// Script execution is intentionally not runtime-essential under allowlists:
// loading skill instructions is framework infrastructure, while running a
// project-provided script remains a direct execution capability.
const SKILL_RUNTIME_TOOL_NAMES = ["load_skill", "load_skill_reference"] as const;
const SKILL_DELEGATION_TOOL_NAMES = ["invoke_agent"] as const;
const SKILL_SCRIPT_TOOL_NAMES = ["execute_skill_script"] as const;
const EMPTY_SKILL_MANIFEST_TOOL_NAMES = [
  ...SKILL_RUNTIME_TOOL_NAMES,
  ...SKILL_SCRIPT_TOOL_NAMES,
] as const;

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
  const localToolNames = new Set(input.localToolNames);
  const hasKnownSkillManifest = input.availableSkillIds !== undefined;
  const hasAuthorizedSkills = (input.availableSkillIds?.length ?? 0) > 0;

  if (!allowedToolNames) {
    if (!hasKnownSkillManifest || hasAuthorizedSkills) {
      return null;
    }

    const resolvedToolNames = new Set(localToolNames);
    for (const toolName of EMPTY_SKILL_MANIFEST_TOOL_NAMES) {
      resolvedToolNames.delete(toolName);
    }
    return resolvedToolNames;
  }

  if (allowedToolNames.size === 0 && !input.configDerivedSelector) {
    return allowedToolNames;
  }

  const resolvedToolNames = new Set(allowedToolNames);

  if (hasKnownSkillManifest && !hasAuthorizedSkills) {
    for (const toolName of EMPTY_SKILL_MANIFEST_TOOL_NAMES) {
      resolvedToolNames.delete(toolName);
    }
  }

  // Preserve request-scoped skill loading tools when the host supplies them.
  // Hosted cloud supplies load_skill; other adapters may also supply the
  // reference tool. Explicit request-level empty allowlists return above and
  // remain deny-all.
  if (
    (resolvedToolNames.size > 0 || input.configDerivedSelector) &&
    (!hasKnownSkillManifest || hasAuthorizedSkills)
  ) {
    for (const toolName of SKILL_RUNTIME_TOOL_NAMES) {
      if (localToolNames.has(toolName)) {
        resolvedToolNames.add(toolName);
      }
    }
  }

  // Delegation is keyed on selector provenance, not on emptiness: a legacy
  // skill-enabled agent keeps invoke_agent whether its trusted config omits
  // tools or declares a non-empty set, while a request- or delegation-derived
  // allowlist never has delegation appended to it.
  if (input.configDerivedSelector && hasAuthorizedSkills) {
    for (const toolName of SKILL_DELEGATION_TOOL_NAMES) {
      if (localToolNames.has(toolName)) {
        resolvedToolNames.add(toolName);
      }
    }
  }

  return resolvedToolNames;
}
