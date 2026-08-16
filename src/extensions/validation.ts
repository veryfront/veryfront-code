/**
 * Extension validation and conflict detection.
 *
 * @module extensions/validation
 */

import type { Capability, Extension, ExtensionSource, ResolvedExtension } from "./types.ts";
import {
  assertKnownCapabilitySchema,
  formatCapabilities,
  mapToDenoPermissions,
  snapshotRuntimeCapabilities,
} from "./capabilities.ts";
import {
  containsUnicodeControlOrLineSeparator,
  isWellFormedUnicode,
  MAX_CAPABILITY_TYPE_CHARACTERS,
  MAX_EXTENSION_CONTRACT_NAME_CHARACTERS,
  MAX_EXTENSION_CONTRACTS_PER_LIST,
  MAX_EXTENSION_NAME_CHARACTERS,
  MAX_EXTENSION_PRESET_CHILDREN,
  MAX_EXTENSION_VERSION_CHARACTERS,
  snapshotDenseMetadataArray,
} from "./metadata-policy.ts";
import { describeThrownValue } from "./safe-value.ts";

/**
 * Information about a contract conflict between extensions.
 */
export interface ConflictInfo {
  contract: string;
  providers: Array<{ name: string; source: ExtensionSource }>;
}

/** Immutable contract metadata captured before extension activation. @internal */
export interface ExtensionContractSnapshot {
  readonly declaredProvides: readonly string[];
  readonly requires: readonly string[];
  readonly legacyProvides: readonly Readonly<{
    contract: string;
    implementation: unknown;
  }>[];
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
  snapshots?: ReadonlyMap<ResolvedExtension, ExtensionContractSnapshot>,
): Map<string, ResolvedExtension> {
  const winner = new Map<string, ResolvedExtension>();
  for (const resolved of extensions) {
    for (
      const contract of providedContractNames(
        resolved.extension,
        snapshots?.get(resolved),
      )
    ) {
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

function providedContractNames(
  extension: Extension,
  prepared?: ExtensionContractSnapshot,
): string[] {
  const snapshot = prepared ?? snapshotExtensionContractMetadata(extension);
  return [
    ...new Set([
      ...snapshot.legacyProvides.map(({ contract }) => contract),
      ...snapshot.declaredProvides,
    ]),
  ];
}

function assertCanonicalContractName(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.trim() !== value) {
    throw new TypeError(`${label} must not have surrounding whitespace`);
  }
  if (!isWellFormedUnicode(value)) {
    throw new TypeError(`${label} must contain well-formed Unicode`);
  }
  if (containsUnicodeControlOrLineSeparator(value)) {
    throw new TypeError(
      `${label} must not contain Unicode control characters or line separators`,
    );
  }
  if (value.length > MAX_EXTENSION_CONTRACT_NAME_CHARACTERS) {
    throw new TypeError(
      `${label} must not exceed ${MAX_EXTENSION_CONTRACT_NAME_CHARACTERS} characters`,
    );
  }
}

function snapshotContractNameList(
  value: unknown,
  field: string,
): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  const entries = snapshotDenseMetadataArray(
    value,
    field,
    0,
    MAX_EXTENSION_CONTRACTS_PER_LIST,
  );
  const names: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const name = entries[index];
    assertCanonicalContractName(name, `${field}[${index}]`);
    if (seen.has(name)) {
      throw new TypeError(`${field}[${index}] duplicates "${name}"`);
    }
    seen.add(name);
    names.push(name);
  }
  return Object.freeze(names);
}

function snapshotContractRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("contracts must be an object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw new TypeError("contracts could not be inspected", { cause });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("contracts must be a plain object");
  }
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (key !== "provides" && key !== "requires") {
      throw new TypeError(`contracts contains unexpected field ${String(key)}`);
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (cause) {
      throw new TypeError(`contracts.${key} could not be inspected`, { cause });
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`contracts.${key} must be an enumerable own data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function snapshotLegacyProvides(
  value: unknown,
): ExtensionContractSnapshot["legacyProvides"] {
  if (value === undefined) return Object.freeze([]);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("provides must be an object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw new TypeError("provides could not be inspected", { cause });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("provides must be a plain object");
  }
  if (keys.length > MAX_EXTENSION_CONTRACTS_PER_LIST) {
    throw new TypeError(
      `provides must contain at most ${MAX_EXTENSION_CONTRACTS_PER_LIST} entries`,
    );
  }
  const entries: Array<Readonly<{ contract: string; implementation: unknown }>> = [];
  for (const key of keys) {
    if (typeof key !== "string" || key === "__proto__") {
      throw new TypeError(`provides contains invalid contract key ${String(key)}`);
    }
    assertCanonicalContractName(key, "provides key");
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (cause) {
      throw new TypeError(`provides.${key} could not be inspected`, { cause });
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`provides.${key} must be an enumerable own data property`);
    }
    if (descriptor.value === undefined) {
      throw new TypeError(`provides.${key} must not be undefined`);
    }
    entries.push(Object.freeze({ contract: key, implementation: descriptor.value }));
  }
  return Object.freeze(entries);
}

function readOwnMetadataField(
  extension: Extension | Record<string, unknown>,
  field: "contracts" | "provides",
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(extension, field);
  } catch (cause) {
    throw new TypeError(`${field} could not be inspected`, { cause });
  }
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !("value" in descriptor)) {
    throw new TypeError(`${field} must be an enumerable own data property`);
  }
  return descriptor.value;
}

/** Descriptor-snapshot contract metadata for planning and activation. @internal */
export function snapshotExtensionContractMetadata(
  extension: Extension,
): ExtensionContractSnapshot {
  const contractsValue = readOwnMetadataField(extension, "contracts");
  const legacyValue = readOwnMetadataField(extension, "provides");
  if (contractsValue !== undefined && legacyValue !== undefined) {
    throw new TypeError("contracts and legacy provides must not be declared together");
  }
  const contracts = snapshotContractRecord(contractsValue);
  return Object.freeze({
    declaredProvides: snapshotContractNameList(
      contracts?.provides,
      "contracts.provides",
    ),
    requires: snapshotContractNameList(contracts?.requires, "contracts.requires"),
    legacyProvides: snapshotLegacyProvides(legacyValue),
  });
}

function validateContractList(
  field: string,
  value: unknown,
  issues: string[],
): void {
  if (value === undefined) return;
  let entries: readonly unknown[];
  try {
    entries = snapshotDenseMetadataArray(
      value,
      field,
      0,
      MAX_EXTENSION_CONTRACTS_PER_LIST,
    );
  } catch (error) {
    issues.push(describeThrownValue(error));
    return;
  }
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      assertCanonicalContractName(entry, `${field}[${i}]`);
    } catch (error) {
      issues.push(describeThrownValue(error));
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
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(candidate, field);
  } catch (error) {
    issues.push(`${label} could not be inspected: ${describeThrownValue(error)}`);
    return { ok: false };
  }
  if (!descriptor) return { ok: true, value: undefined };
  if (!descriptor.enumerable || !("value" in descriptor)) {
    issues.push(`${label} must be an enumerable own data property`);
    return { ok: false };
  }
  return { ok: true, value: descriptor.value };
}

function validateCanonicalString(
  field: string,
  value: unknown,
  issues: string[],
  maximumLength: number,
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${field} must be a non-empty string`);
  } else if (value.trim() !== value) {
    issues.push(`${field} must not have surrounding whitespace`);
  } else if (!isWellFormedUnicode(value)) {
    issues.push(`${field} must contain well-formed Unicode`);
  } else if (containsUnicodeControlOrLineSeparator(value)) {
    issues.push(
      `${field} must not contain Unicode control characters or line separators`,
    );
  } else if (value.length > maximumLength) {
    issues.push(`${field} must not exceed ${maximumLength} characters`);
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

  try {
    const prototype = Object.getPrototypeOf(ext);
    if (prototype !== Object.prototype && prototype !== null) {
      issues.push("extension must be a plain object");
      return issues;
    }
  } catch (error) {
    issues.push(`extension could not be inspected: ${describeThrownValue(error)}`);
    return issues;
  }

  const candidate = ext as Record<string, unknown>;
  const name = readField(candidate, "name", issues);
  if (name.ok) {
    validateCanonicalString("name", name.value, issues, MAX_EXTENSION_NAME_CHARACTERS);
  }

  const version = readField(candidate, "version", issues);
  if (version.ok) {
    validateCanonicalString(
      "version",
      version.value,
      issues,
      MAX_EXTENSION_VERSION_CHARACTERS,
    );
  }

  const capabilities = readField(candidate, "capabilities", issues);
  if (!capabilities.ok) {
    return issues;
  }
  const capabilityIssueBaseline = issues.length;
  let capabilitySnapshot: readonly Capability[] = [];
  try {
    capabilitySnapshot = snapshotRuntimeCapabilities(capabilities.value);
  } catch (error) {
    issues.push(describeThrownValue(error));
  }

  for (let i = 0; i < capabilitySnapshot.length; i++) {
    const cap = capabilitySnapshot[i]!;
    const type = readField(
      cap as Record<string, unknown>,
      "type",
      issues,
      `capabilities[${i}].type`,
    );
    if (type.ok) {
      validateCanonicalString(
        `capabilities[${i}].type`,
        type.value,
        issues,
        MAX_CAPABILITY_TYPE_CHARACTERS,
      );
      if (
        typeof type.value === "string" && type.value.trim().length > 0 &&
        type.value.trim() === type.value &&
        type.value.length <= MAX_CAPABILITY_TYPE_CHARACTERS &&
        isWellFormedUnicode(type.value) &&
        !containsUnicodeControlOrLineSeparator(type.value)
      ) {
        try {
          assertKnownCapabilitySchema(
            cap as Capability,
            i,
            type.value,
          );
        } catch (error) {
          issues.push(describeThrownValue(error));
        }
      }
    }
  }
  if (issues.length === capabilityIssueBaseline) {
    try {
      mapToDenoPermissions([...capabilitySnapshot]);
    } catch (error) {
      issues.push(describeThrownValue(error));
    }
  }
  if (issues.length === capabilityIssueBaseline) {
    try {
      formatCapabilities([...capabilitySnapshot]);
    } catch (error) {
      issues.push(describeThrownValue(error));
    }
  }

  let contractsValue: unknown;
  let legacyProvidesValue: unknown;
  try {
    contractsValue = readOwnMetadataField(candidate, "contracts");
  } catch (error) {
    issues.push(describeThrownValue(error));
  }
  try {
    legacyProvidesValue = readOwnMetadataField(candidate, "provides");
  } catch (error) {
    issues.push(describeThrownValue(error));
  }
  if (contractsValue !== undefined && legacyProvidesValue !== undefined) {
    issues.push("contracts and legacy provides must not be declared together");
  }
  try {
    const contractRecord = snapshotContractRecord(contractsValue);
    validateContractList("contracts.provides", contractRecord?.provides, issues);
    validateContractList("contracts.requires", contractRecord?.requires, issues);
  } catch (error) {
    issues.push(describeThrownValue(error));
  }
  try {
    snapshotLegacyProvides(legacyProvidesValue);
  } catch (error) {
    issues.push(describeThrownValue(error));
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

  const extendsField = readField(candidate, "extends", issues);
  if (extendsField.ok && extendsField.value !== undefined) {
    try {
      snapshotDenseMetadataArray(
        extendsField.value,
        "extends",
        0,
        MAX_EXTENSION_PRESET_CHILDREN,
      );
    } catch (error) {
      issues.push(describeThrownValue(error));
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
export function detectConflicts(
  extensions: ResolvedExtension[],
  snapshots?: ReadonlyMap<ResolvedExtension, ExtensionContractSnapshot>,
  extensionNames?: ReadonlyMap<ResolvedExtension, string>,
): ConflictInfo[] {
  const contractProviders = new Map<
    string,
    Array<{ name: string; source: ExtensionSource }>
  >();

  for (const resolved of extensions) {
    for (
      const contract of providedContractNames(
        resolved.extension,
        snapshots?.get(resolved),
      )
    ) {
      let list = contractProviders.get(contract);
      if (!list) {
        list = [];
        contractProviders.set(contract, list);
      }
      list.push({
        name: extensionNames?.get(resolved) ?? resolved.extension.name,
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
