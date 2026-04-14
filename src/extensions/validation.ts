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
  providers: Array<{ name: string; source: string }>;
}

/**
 * Priority map for extension sources.
 * Lower number = higher priority.
 */
const SOURCE_PRIORITY: Record<ExtensionSource, number> = {
  config: 0,
  package: 1,
  project: 2,
  "local-file": 3,
};

/**
 * Validate the shape of an extension object.
 * Returns an array of issue descriptions (empty array = valid).
 */
export function validateExtension(ext: Extension): string[] {
  const issues: string[] = [];

  if (typeof ext.name !== "string" || ext.name.length === 0) {
    issues.push("name must be a non-empty string");
  }

  if (typeof ext.version !== "string" || ext.version.length === 0) {
    issues.push("version must be a non-empty string");
  }

  if (!Array.isArray(ext.capabilities)) {
    issues.push("capabilities must be an array");
    return issues;
  }

  for (let i = 0; i < ext.capabilities.length; i++) {
    const cap = ext.capabilities[i];
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
      if (!contractProviders.has(contract)) {
        contractProviders.set(contract, []);
      }
      contractProviders.get(contract)!.push({
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
