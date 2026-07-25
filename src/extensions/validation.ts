/**
 * Extension validation and conflict detection.
 *
 * @module extensions/validation
 */

import type { Extension, ExtensionSource, ResolvedExtension } from "./types.ts";
import { describeThrownValue } from "./safe-value.ts";

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
export const SOURCE_PRIORITY: Readonly<Record<ExtensionSource, number>> = Object.freeze({
  config: 0,
  package: 1,
  project: 2,
  "local-file": 3,
  builtin: 4,
});

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
    for (const contract of providedContractNames(resolved.extension)) {
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

function providedContractNames(extension: Extension): string[] {
  return [
    ...new Set([
      ...Object.keys(extension.provides ?? {}),
      ...(extension.contracts?.provides ?? []),
    ]),
  ];
}

function validateContractList(
  field: string,
  value: unknown,
  issues: string[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return;
  }
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (typeof entry !== "string" || entry.trim().length === 0) {
      issues.push(`${field}[${i}] must be a non-empty string`);
      continue;
    }
    if (entry.trim() !== entry) {
      issues.push(`${field}[${i}] must not have surrounding whitespace`);
      continue;
    }
    if (seen.has(entry)) {
      issues.push(`${field}[${i}] duplicates "${entry}"`);
    } else {
      seen.add(entry);
    }
  }
}

interface FieldRead {
  ok: boolean;
  value?: unknown;
}

function readField(
  candidate: Record<string, unknown>,
  field: string,
  issues: string[],
  label = field,
): FieldRead {
  try {
    return { ok: true, value: candidate[field] };
  } catch (error) {
    issues.push(`${label} could not be read: ${describeThrownValue(error)}`);
    return { ok: false };
  }
}

function validateCanonicalString(
  field: string,
  value: unknown,
  issues: string[],
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${field} must be a non-empty string`);
  } else if (value.trim() !== value) {
    issues.push(`${field} must not have surrounding whitespace`);
  }
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

  const candidate = ext as Record<string, unknown>;
  const name = readField(candidate, "name", issues);
  if (name.ok) validateCanonicalString("name", name.value, issues);

  const version = readField(candidate, "version", issues);
  if (version.ok) validateCanonicalString("version", version.value, issues);

  const capabilities = readField(candidate, "capabilities", issues);
  if (!capabilities.ok) {
    return issues;
  }
  if (!Array.isArray(capabilities.value)) {
    issues.push("capabilities must be an array");
    return issues;
  }

  for (let i = 0; i < capabilities.value.length; i++) {
    const cap = capabilities.value[i];
    if (typeof cap !== "object" || cap === null || Array.isArray(cap)) {
      issues.push(`capabilities[${i}] must be an object`);
      continue;
    }
    const type = readField(
      cap as Record<string, unknown>,
      "type",
      issues,
      `capabilities[${i}].type`,
    );
    if (type.ok) {
      validateCanonicalString(`capabilities[${i}].type`, type.value, issues);
    }
  }

  const contracts = readField(candidate, "contracts", issues);
  if (contracts.ok && contracts.value !== undefined) {
    if (
      typeof contracts.value !== "object" ||
      contracts.value === null ||
      Array.isArray(contracts.value)
    ) {
      issues.push("contracts must be an object");
    } else {
      const contractRecord = contracts.value as Record<string, unknown>;
      const provides = readField(
        contractRecord,
        "provides",
        issues,
        "contracts.provides",
      );
      if (provides.ok) {
        validateContractList("contracts.provides", provides.value, issues);
      }
      const requires = readField(
        contractRecord,
        "requires",
        issues,
        "contracts.requires",
      );
      if (requires.ok) {
        validateContractList("contracts.requires", requires.value, issues);
      }
    }
  }

  const setup = readField(candidate, "setup", issues);
  if (setup.ok && setup.value !== undefined && typeof setup.value !== "function") {
    issues.push("setup must be a function");
  }

  const teardown = readField(candidate, "teardown", issues);
  if (
    teardown.ok &&
    teardown.value !== undefined &&
    typeof teardown.value !== "function"
  ) {
    issues.push("teardown must be a function");
  }

  const provides = readField(candidate, "provides", issues);
  if (
    provides.ok &&
    provides.value !== undefined &&
    (typeof provides.value !== "object" ||
      provides.value === null ||
      Array.isArray(provides.value))
  ) {
    issues.push("provides must be an object");
  } else if (provides.ok && provides.value !== undefined) {
    const providedContracts = provides.value as object;
    try {
      for (const contract of Object.keys(providedContracts)) {
        if (contract.trim().length === 0) {
          issues.push("provides key must be a non-empty string");
        } else if (contract.trim() !== contract) {
          issues.push("provides key must not have surrounding whitespace");
        }
      }
    } catch (error) {
      issues.push(`provides keys could not be read: ${describeThrownValue(error)}`);
    }
  }

  const extendsField = readField(candidate, "extends", issues);
  if (
    extendsField.ok &&
    extendsField.value !== undefined &&
    !Array.isArray(extendsField.value)
  ) {
    issues.push("extends must be an array");
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
    for (const contract of providedContractNames(resolved.extension)) {
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
