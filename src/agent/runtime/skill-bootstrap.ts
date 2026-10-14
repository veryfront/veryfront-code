import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { readToolResultOwnDataProperty } from "#veryfront/tool/result.ts";
import { skillRegistry } from "#veryfront/skill/registry.ts";

/** Maximum serialized size of the startup skill root kept in model context. */
export const RUNTIME_SKILL_BOOTSTRAP_MAX_BYTES = 16_384;

/**
 * Resolve the configured startup selector to the canonical ID the framework
 * loader reports, using the same owner-scoped lookup the loader applies (an
 * agent-owned short name such as "cite" names "researcher--cite"). Selectors
 * that do not resolve stay unchanged so the loader's own rejection stands.
 */
export function resolveRuntimeSkillBootstrapId(skillId: string, agentId: string): string {
  return skillRegistry.resolveVisibleSkill(skillId, { agentId })?.id ?? skillId;
}

/**
 * Validate a startup skill result produced by the authorized framework loader.
 * The root is kept intact rather than truncated, because truncating
 * instructions can change their meaning. Detailed references stay deferred.
 */
export function validateRuntimeSkillBootstrapResult(result: unknown, skillId: string): void {
  const instructions = readToolResultOwnDataProperty(result, "instructions");
  if (
    readToolResultOwnDataProperty(result, "skillId") !== skillId || typeof instructions !== "string"
  ) {
    throw new Error("Startup skill could not be loaded through the authorized skill loader");
  }
  if (
    !snapshotBoundedJsonValue(
      result,
      RUNTIME_SKILL_BOOTSTRAP_MAX_BYTES,
      RUNTIME_SKILL_BOOTSTRAP_MAX_BYTES,
    ).success
  ) {
    throw new Error("Startup skill exceeds the 16 KiB context budget");
  }
}
