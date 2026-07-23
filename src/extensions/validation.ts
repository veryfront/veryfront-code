/**
 * Extension validation and conflict detection.
 *
 * @module extensions/validation
 */

import type { Extension, ExtensionSource, ResolvedExtension } from "./types.ts";
import { EXTENSION_VALIDATION_ERROR } from "./errors.ts";
import { snapshotResolvedExtensions } from "./extension-snapshot.ts";
import {
  hasControlCharacters,
  identifierIssue,
  MAX_CAPABILITY_TYPE_LENGTH,
  MAX_CONTRACT_NAME_LENGTH,
  MAX_EXTENSION_NAME_LENGTH,
  MAX_EXTENSION_VERSION_LENGTH,
} from "./identifiers.ts";

const MAX_CAPABILITIES = 128;
const MAX_CONTRACTS_PER_LIST = 128;
const MAX_PROVIDED_CONTRACTS = 128;
const MAX_PRESET_CHILDREN = 128;
const MAX_RESOLVED_EXTENSIONS = 4_096;
const MAX_VALIDATION_DEPTH = 64;
const MAX_VALIDATION_NODES = 4_096;

/**
 * Information about a contract conflict between extensions.
 */
export interface ConflictInfo {
  /** Contract with competing providers. */
  contract: string;
  /** Providers tied at the highest applicable source priority. */
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
  assertResolvedExtensionInputs(extensions);
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
  const length = value.length;
  if (length > MAX_CONTRACTS_PER_LIST) {
    issues.push(`${field} must contain at most ${MAX_CONTRACTS_PER_LIST} entries`);
  }
  const seen = new Set<string>();
  for (let i = 0; i < Math.min(length, MAX_CONTRACTS_PER_LIST); i++) {
    const entry = value[i];
    const issue = identifierIssue(entry, MAX_CONTRACT_NAME_LENGTH);
    if (issue) {
      issues.push(`${field}[${i}] ${issue}`);
    } else if (seen.has(entry as string)) {
      issues.push(`${field}[${i}] duplicates an earlier contract`);
    } else {
      seen.add(entry as string);
    }
  }
}

function validateOptionalFunction(
  field: string,
  value: unknown,
  issues: string[],
): void {
  if (value !== undefined && typeof value !== "function") {
    issues.push(`${field} must be a function when provided`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
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
  let issues: string[];
  try {
    issues = validateExtensionShallow(ext);
  } catch {
    return ["extension fields could not be read safely"];
  }
  if (!isRecord(ext)) return issues;

  type ValidationFrame = {
    extension: Record<string, unknown>;
    path: Set<object>;
    prefix: string;
    depth: number;
  };
  const pending: ValidationFrame[] = [];
  try {
    const children = Reflect.get(ext, "extends");
    if (Array.isArray(children)) {
      const childCount = Math.min(children.length, MAX_PRESET_CHILDREN);
      for (let index = childCount - 1; index >= 0; index--) {
        const child = Reflect.get(children, index);
        if (isRecord(child)) {
          pending.push({
            extension: child,
            path: new Set([ext]),
            prefix: `extends[${index}]`,
            depth: 1,
          });
        }
      }
    }
  } catch {
    issues.push("extension fields could not be read safely");
    return issues;
  }

  let nodes = 0;
  while (pending.length > 0) {
    const frame = pending.pop()!;
    if (++nodes > MAX_VALIDATION_NODES) {
      issues.push(`extends must contain at most ${MAX_VALIDATION_NODES} nested extensions`);
      break;
    }
    if (frame.path.has(frame.extension)) {
      issues.push(`${frame.prefix} forms a circular preset chain`);
      continue;
    }
    if (frame.depth > MAX_VALIDATION_DEPTH) {
      issues.push(`${frame.prefix} exceeds the maximum preset depth`);
      continue;
    }

    let childIssues: string[];
    try {
      childIssues = validateExtensionShallow(frame.extension);
    } catch {
      childIssues = ["extension fields could not be read safely"];
    }
    for (const issue of childIssues) {
      issues.push(
        issue.startsWith("extension ") ? `${frame.prefix} ${issue}` : `${frame.prefix}.${issue}`,
      );
    }

    try {
      const children = Reflect.get(frame.extension, "extends");
      if (!Array.isArray(children)) continue;
      const childPath = new Set(frame.path);
      childPath.add(frame.extension);
      const childCount = Math.min(children.length, MAX_PRESET_CHILDREN);
      for (let index = childCount - 1; index >= 0; index--) {
        const child = Reflect.get(children, index);
        if (isRecord(child)) {
          pending.push({
            extension: child,
            path: childPath,
            prefix: `${frame.prefix}.extends[${index}]`,
            depth: frame.depth + 1,
          });
        }
      }
    } catch {
      issues.push(`${frame.prefix}.extension fields could not be read safely`);
    }
  }
  return issues;
}

/** @internal Validate one extension object without traversing preset children. */
export function validateExtensionShallow(ext: unknown): string[] {
  const issues: string[] = [];

  if (!isRecord(ext)) {
    issues.push("extension must be a non-null object");
    return issues;
  }

  try {
    const candidate = ext as Partial<Extension>;

    const nameIssue = identifierIssue(candidate.name, MAX_EXTENSION_NAME_LENGTH);
    if (nameIssue) issues.push(`name ${nameIssue}`);

    const versionIssue = identifierIssue(candidate.version, MAX_EXTENSION_VERSION_LENGTH);
    if (versionIssue) issues.push(`version ${versionIssue}`);

    if (!Array.isArray(candidate.capabilities)) {
      issues.push("capabilities must be an array");
    } else {
      const capabilityCount = candidate.capabilities.length;
      if (capabilityCount > MAX_CAPABILITIES) {
        issues.push(`capabilities must contain at most ${MAX_CAPABILITIES} entries`);
      }
      for (let i = 0; i < Math.min(capabilityCount, MAX_CAPABILITIES); i++) {
        const cap = candidate.capabilities[i];
        if (!isRecord(cap)) {
          issues.push(`capabilities[${i}] must be an object`);
          continue;
        }
        const typeIssue = identifierIssue(cap.type, MAX_CAPABILITY_TYPE_LENGTH);
        if (typeIssue) issues.push(`capabilities[${i}].type ${typeIssue}`);
      }
    }

    if (candidate.contracts !== undefined) {
      if (!isRecord(candidate.contracts)) {
        issues.push("contracts must be an object");
      } else {
        validateContractList(
          "contracts.provides",
          candidate.contracts.provides,
          issues,
        );
        validateContractList(
          "contracts.requires",
          candidate.contracts.requires,
          issues,
        );
      }
    }

    validateOptionalFunction("setup", candidate.setup, issues);
    validateOptionalFunction("teardown", candidate.teardown, issues);

    if (candidate.provides !== undefined) {
      if (!isRecord(candidate.provides)) {
        issues.push("provides must be an object");
      } else {
        const entries = Object.entries(candidate.provides);
        if (entries.length > MAX_PROVIDED_CONTRACTS) {
          issues.push(`provides must contain at most ${MAX_PROVIDED_CONTRACTS} contracts`);
        }
        for (const [contract, implementation] of entries) {
          const contractIssue = identifierIssue(contract, MAX_CONTRACT_NAME_LENGTH);
          if (contractIssue) issues.push(`provides contract name ${contractIssue}`);
          if (implementation === undefined) {
            issues.push(`provides implementation for a contract cannot be undefined`);
          }
        }
      }
    }

    if (candidate.extends !== undefined) {
      if (!Array.isArray(candidate.extends)) {
        issues.push("extends must be an array");
      } else {
        const extensionCount = candidate.extends.length;
        if (extensionCount > MAX_PRESET_CHILDREN) {
          issues.push(`extends must contain at most ${MAX_PRESET_CHILDREN} entries`);
        }
        for (let index = 0; index < Math.min(extensionCount, MAX_PRESET_CHILDREN); index++) {
          if (!isRecord(candidate.extends[index])) {
            issues.push(`extends[${index}] must be an extension object`);
          }
        }
      }
    }
  } catch {
    issues.push("extension fields could not be read safely");
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
  const safeExtensions = snapshotResolvedExtensions(extensions);
  assertResolvedExtensionInputs(safeExtensions);
  const contractProviders = new Map<
    string,
    Array<{ name: string; source: ExtensionSource }>
  >();

  for (const resolved of safeExtensions) {
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
    const winningProviders = providers.filter((provider) =>
      SOURCE_PRIORITY[provider.source] === bestPriority
    );

    // If exactly one provider has the best priority, no conflict
    if (winningProviders.length === 1) continue;

    conflicts.push({
      contract,
      providers: winningProviders.map((provider) => ({
        name: provider.name,
        source: provider.source,
      })),
    });
  }

  return conflicts;
}

function assertResolvedExtensionInputs(value: unknown): asserts value is ResolvedExtension[] {
  let length: number;
  try {
    if (!Array.isArray(value)) throw new TypeError();
    length = value.length;
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Resolved extension list is invalid" });
  }
  if (length > MAX_RESOLVED_EXTENSIONS) {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Resolved extension list is invalid" });
  }
  for (let index = 0; index < length; index++) {
    let entry: unknown;
    let extension: unknown;
    let origin: unknown;
    let source: unknown;
    try {
      entry = Reflect.get(value, index);
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError();
      }
      extension = Reflect.get(entry, "extension");
      origin = Reflect.get(entry, "origin");
      source = Reflect.get(entry, "source");
    } catch {
      throw EXTENSION_VALIDATION_ERROR.create({ message: "Resolved extension is invalid" });
    }
    if (
      typeof source !== "string" || !Object.hasOwn(SOURCE_PRIORITY, source) ||
      typeof origin !== "string" || origin.length === 0 || origin.length > 4_096 ||
      hasControlCharacters(origin) || validateExtension(extension).length > 0
    ) {
      throw EXTENSION_VALIDATION_ERROR.create({ message: "Resolved extension is invalid" });
    }
  }
}
