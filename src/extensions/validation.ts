/**
 * Extension validation and conflict detection.
 *
 * @module extensions/validation
 */

import type { Extension, ExtensionSource, ResolvedExtension } from "./types.ts";

/**
 * Information about a contract conflict between extensions.
 */
export interface ConflictInfo {
  contract: string;
  providers: Array<{ name: string; source: ExtensionSource }>;
}

/**
 * Priority map for extension sources.
 * Lower number = higher priority.
 */
export const SOURCE_PRIORITY: Record<ExtensionSource, number> = {
  config: 0,
  package: 1,
  project: 2,
  "local-file": 3,
};

/**
 * Select the highest-priority provider for each contract across a list of
 * resolved extensions. When multiple extensions provide the same contract,
 * the one whose source has the lowest `SOURCE_PRIORITY` number wins.
 * Ties break on first-seen order (mirrors detectConflicts semantics).
 */
export function selectContractProviders(
  extensions: ResolvedExtension[],
): Map<string, ResolvedExtension> {
  const winner = new Map<string, ResolvedExtension>();
  for (const resolved of extensions) {
    const provides = resolved.extension.provides;
    if (!provides) continue;
    for (const contract of Object.keys(provides)) {
      const current = winner.get(contract);
      if (
        !current ||
        SOURCE_PRIORITY[resolved.source] < SOURCE_PRIORITY[current.source]
      ) {
        winner.set(contract, resolved);
      }
    }
  }
  return winner;
}

/**
 * Validate the shape of an extension object.
 * Returns an array of issue descriptions (empty array = valid).
 *
 * Accepts `unknown` so callers at module-boundary / config-loading paths can
 * validate arbitrary imported values without casting.
 */
export function validateExtension(ext: unknown): string[] {
  const issues: string[] = [];

  if (ext === null || typeof ext !== "object" || Array.isArray(ext)) {
    issues.push("extension must be a non-null object");
    return issues;
  }

  const candidate = ext as Partial<Extension>;

  if (typeof candidate.name !== "string" || candidate.name.length === 0) {
    issues.push("name must be a non-empty string");
  }

  if (typeof candidate.version !== "string" || candidate.version.length === 0) {
    issues.push("version must be a non-empty string");
  }

  if (!Array.isArray(candidate.capabilities)) {
    issues.push("capabilities must be an array");
    return issues;
  }

  for (let i = 0; i < candidate.capabilities.length; i++) {
    const cap = candidate.capabilities[i];
    if (typeof cap !== "object" || cap === null || Array.isArray(cap)) {
      issues.push(`capabilities[${i}] must be an object`);
      continue;
    }
    if (typeof cap.type !== "string" || cap.type.length === 0) {
      issues.push(`capabilities[${i}].type must be a non-empty string`);
    }
  }

  return issues;
}

/**
 * Detect contract conflicts between resolved extensions.
 *
 * A conflict exists when two or more extensions provide the same contract
 * and no single provider has strictly higher source priority than all others.
 */
export function detectConflicts(extensions: ResolvedExtension[]): ConflictInfo[] {
  const contractProviders = new Map<
    string,
    Array<{ name: string; source: ExtensionSource }>
  >();

  for (const resolved of extensions) {
    const provides = resolved.extension.provides;
    if (!provides) continue;

    for (const contract of Object.keys(provides)) {
      let list = contractProviders.get(contract);
      if (!list) {
        list = [];
        contractProviders.set(contract, list);
      }
      list.push({
        name: resolved.extension.name,
        source: resolved.source,
      });
    }
  }

  const conflicts: ConflictInfo[] = [];

  for (const [contract, providers] of contractProviders) {
    if (providers.length < 2) continue;

    // Find the highest priority (lowest number) among providers
    const priorities = providers.map((p) => SOURCE_PRIORITY[p.source]);
    const bestPriority = Math.min(...priorities);
    const winnersCount = priorities.filter((p) => p === bestPriority).length;

    // If exactly one provider has the best priority, no conflict
    if (winnersCount === 1) continue;

    conflicts.push({
      contract,
      providers: providers.map((p) => ({ name: p.name, source: p.source })),
    });
  }

  return conflicts;
}
