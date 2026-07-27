/**
 * Source-owned integration restrictions.
 *
 * This policy is deliberately monotonic: it can only remove integrations or
 * tools from the capabilities already granted by the agent source, catalog,
 * and control-plane policy. It never enables an integration, selects a
 * credential scope, or grants access on its own.
 */

import {
  MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH,
  MAX_SOURCE_INTEGRATION_POLICY_INTEGRATIONS,
  MAX_SOURCE_INTEGRATION_POLICY_SEGMENT_LENGTH,
  MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS,
} from "./limits.ts";
import type { IntegrationName } from "./schema.ts";

export interface SourceIntegrationRestriction {
  /**
   * Exact connector-local tool IDs. Omit to allow every catalog tool for the
   * listed integration; use an empty array to allow none.
   */
  allowedTools?: readonly string[];
}

export interface SourceIntegrationPolicyConfig {
  /** Integrations that remain eligible after source-policy narrowing. */
  readonly allow: Readonly<Partial<Record<IntegrationName, SourceIntegrationRestriction>>>;
}

export type SourceIntegrationPolicyManifest =
  | {
    readonly schemaVersion: 1;
    readonly mode: "unrestricted";
  }
  | {
    readonly schemaVersion: 1;
    readonly mode: "allowlist";
    readonly integrations: Readonly<
      Record<
        string,
        Readonly<{
          /** `null` means every tool for this integration remains eligible. */
          readonly allowedToolIds: readonly string[] | null;
        }>
      >
    >;
  };

interface DataRecordSnapshot {
  readonly keys: string[];
  readonly values: Record<string, unknown>;
}

type SourceIntegrationRestrictionManifest = Readonly<{
  allowedToolIds: readonly string[] | null;
}>;

type SourceIntegrationRestrictionRecord = Record<
  string,
  SourceIntegrationRestrictionManifest
>;

/*
 * Project code can run in the same worker realm before a later request is
 * admitted. Capture every mutable primordial used by this security boundary
 * while the module is initialized so one project cannot sabotage the next.
 */
const IntrinsicArray = Array;
const IntrinsicRangeError = RangeError;
const IntrinsicSet = Set;
const IntrinsicString = String;
const IntrinsicTypeError = TypeError;
const IntrinsicWeakSet = WeakSet;
const ArrayIsArray = Array.isArray;
const ArrayPrototype = Array.prototype;
const ArrayPrototypeIncludes = Array.prototype.includes;
const ArrayPrototypeSort = Array.prototype.sort;
const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectPrototype = Object.prototype;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectHasOwn = Object.hasOwn;
const ReflectApply = Reflect.apply;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const ReflectGetPrototypeOf = Reflect.getPrototypeOf;
const ReflectOwnKeys = Reflect.ownKeys;
const RegExpPrototypeTest = RegExp.prototype.test;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeHas = Set.prototype.has;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeLastIndexOf = String.prototype.lastIndexOf;
const StringPrototypeSlice = String.prototype.slice;
const WeakSetPrototypeAdd = WeakSet.prototype.add;
const WeakSetPrototypeHas = WeakSet.prototype.has;
const SNAPSHOT_LIMIT_EXCEEDED = Symbol("snapshot-limit-exceeded");
const canonicalSourceIntegrationPolicies = new IntrinsicWeakSet<object>();

function freezeObject<T extends object>(value: T): Readonly<T> {
  return ReflectApply(ObjectFreeze, undefined, [value]) as Readonly<T>;
}

function createNullRecord<T>(): Record<string, T> {
  return ReflectApply(ObjectCreate, undefined, [null]) as Record<string, T>;
}

function defineOwnDataProperty<T>(
  target: Record<string, T>,
  key: string,
  value: T,
): void {
  const descriptor = createNullRecord<unknown>();
  descriptor.configurable = true;
  descriptor.enumerable = true;
  descriptor.value = value;
  descriptor.writable = true;
  ReflectApply(ObjectDefineProperty, undefined, [
    target,
    key,
    descriptor,
  ]);
}

function hasOwn(value: object, key: string): boolean {
  return ReflectApply(ObjectHasOwn, undefined, [value, key]) as boolean;
}

function pushValue<T>(values: T[], value: T): void {
  const descriptor = createNullRecord<unknown>();
  descriptor.configurable = true;
  descriptor.enumerable = true;
  descriptor.value = value;
  descriptor.writable = true;
  ReflectApply(ObjectDefineProperty, undefined, [
    values,
    IntrinsicString(values.length),
    descriptor,
  ]);
}

function sortStrings(values: string[]): string[] {
  return ReflectApply(ArrayPrototypeSort, values, [compareCanonicalStrings]) as string[];
}

function setHas(set: Set<string>, value: string): boolean {
  return ReflectApply(SetPrototypeHas, set, [value]) as boolean;
}

function setAdd(set: Set<string>, value: string): void {
  ReflectApply(SetPrototypeAdd, set, [value]);
}

function weakSetHas(set: WeakSet<object>, value: object): boolean {
  return ReflectApply(WeakSetPrototypeHas, set, [value]) as boolean;
}

function weakSetAdd(set: WeakSet<object>, value: object): void {
  ReflectApply(WeakSetPrototypeAdd, set, [value]);
}

function stringIncludes(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeIncludes, value, [search]) as boolean;
}

function stringIndexOf(value: string, search: string): number {
  return ReflectApply(StringPrototypeIndexOf, value, [search]) as number;
}

function stringLastIndexOf(value: string, search: string): number {
  return ReflectApply(StringPrototypeLastIndexOf, value, [search]) as number;
}

function stringSlice(value: string, start: number): string {
  return ReflectApply(StringPrototypeSlice, value, [start]) as string;
}

function stringSliceRange(value: string, start: number, end: number): string {
  return ReflectApply(StringPrototypeSlice, value, [start, end]) as string;
}

/**
 * Snapshot a small plain data record without dereferencing accessors. Reflective
 * inspection can invoke proxy traps, but trap failures remain contained and
 * malformed input never escapes this boundary.
 */
function snapshotDataRecord(
  value: unknown,
  maxKeys: number,
): DataRecordSnapshot | typeof SNAPSHOT_LIMIT_EXCEEDED | null {
  try {
    if (typeof value !== "object" || value === null || ArrayIsArray(value)) return null;
    const prototype = ReflectApply(ReflectGetPrototypeOf, undefined, [value]);
    if (prototype !== ObjectPrototype && prototype !== null) return null;

    const ownKeys = ReflectApply(ReflectOwnKeys, undefined, [value]) as PropertyKey[];
    if (ownKeys.length > maxKeys) return SNAPSHOT_LIMIT_EXCEEDED;

    const keys: string[] = new IntrinsicArray();
    const values = createNullRecord<unknown>();
    for (let index = 0; index < ownKeys.length; index++) {
      const key = ownKeys[index];
      if (typeof key !== "string") return null;
      const descriptor = ReflectApply(ReflectGetOwnPropertyDescriptor, undefined, [
        value,
        key,
      ]) as PropertyDescriptor | undefined;
      if (
        !descriptor ||
        !hasOwn(descriptor, "value") ||
        !hasOwn(descriptor, "enumerable") ||
        descriptor.enumerable !== true
      ) {
        return null;
      }
      defineOwnDataProperty(values, key, descriptor.value);
      pushValue(keys, key);
    }
    return { keys, values };
  } catch {
    return null;
  }
}

/**
 * Snapshot a dense ordinary array without invoking accessors or iterators.
 */
function snapshotDataArray(
  value: unknown,
  maxLength: number,
): unknown[] | typeof SNAPSHOT_LIMIT_EXCEEDED | null {
  try {
    if (!ArrayIsArray(value)) return null;
    const prototype = ReflectApply(ReflectGetPrototypeOf, undefined, [value]);
    if (prototype !== ArrayPrototype) return null;

    const lengthDescriptor = ReflectApply(ReflectGetOwnPropertyDescriptor, undefined, [
      value,
      "length",
    ]) as PropertyDescriptor | undefined;
    const length = lengthDescriptor && hasOwn(lengthDescriptor, "value")
      ? lengthDescriptor.value
      : undefined;
    if (
      typeof length !== "number" ||
      !NumberIsSafeInteger(length) ||
      length < 0 ||
      !lengthDescriptor ||
      !hasOwn(lengthDescriptor, "enumerable") ||
      lengthDescriptor?.enumerable !== false
    ) {
      return null;
    }
    if (length > maxLength) return SNAPSHOT_LIMIT_EXCEEDED;

    const ownKeys = ReflectApply(ReflectOwnKeys, undefined, [value]) as PropertyKey[];
    if (ownKeys.length !== length + 1) return null;

    const values: unknown[] = new IntrinsicArray();
    for (let index = 0; index < length; index++) {
      const key = IntrinsicString(index);
      const descriptor = ReflectApply(ReflectGetOwnPropertyDescriptor, undefined, [
        value,
        key,
      ]) as PropertyDescriptor | undefined;
      if (
        !descriptor ||
        !hasOwn(descriptor, "value") ||
        !hasOwn(descriptor, "enumerable") ||
        descriptor.enumerable !== true
      ) {
        return null;
      }
      pushValue(values, descriptor.value);
    }
    return values;
  } catch {
    return null;
  }
}

function hasExactKeys(
  snapshot: DataRecordSnapshot,
  expectedKeys: readonly string[],
): boolean {
  if (snapshot.keys.length !== expectedKeys.length) return false;
  for (let index = 0; index < expectedKeys.length; index++) {
    const key = expectedKeys[index];
    if (typeof key !== "string" || !hasOwn(snapshot.values, key)) return false;
  }
  return true;
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createRestrictionRecord(): SourceIntegrationRestrictionRecord {
  return createNullRecord<SourceIntegrationRestrictionManifest>();
}

function createFrozenRestriction(
  allowedToolIds: readonly string[] | null,
): SourceIntegrationRestrictionManifest {
  const restriction = createNullRecord<readonly string[] | null>();
  defineOwnDataProperty(restriction, "allowedToolIds", allowedToolIds);
  return freezeObject(restriction) as SourceIntegrationRestrictionManifest;
}

function createAllowlistManifest(
  integrations: SourceIntegrationRestrictionRecord,
): SourceIntegrationPolicyManifest {
  const manifest = createNullRecord<unknown>();
  defineOwnDataProperty(manifest, "schemaVersion", 1);
  defineOwnDataProperty(manifest, "mode", "allowlist");
  defineOwnDataProperty(manifest, "integrations", freezeObject(integrations));
  const frozenManifest = freezeObject(manifest) as SourceIntegrationPolicyManifest;
  weakSetAdd(canonicalSourceIntegrationPolicies, frozenManifest);
  return frozenManifest;
}

const unrestrictedSourceIntegrationPolicy = createNullRecord<unknown>();
defineOwnDataProperty(unrestrictedSourceIntegrationPolicy, "schemaVersion", 1);
defineOwnDataProperty(unrestrictedSourceIntegrationPolicy, "mode", "unrestricted");
const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = freezeObject(
  unrestrictedSourceIntegrationPolicy,
) as SourceIntegrationPolicyManifest;
weakSetAdd(
  canonicalSourceIntegrationPolicies,
  UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
);

const EMPTY_SOURCE_INTEGRATION_RESTRICTIONS = freezeObject(createRestrictionRecord());

const DENY_ALL_SOURCE_INTEGRATION_POLICY = createAllowlistManifest(
  EMPTY_SOURCE_INTEGRATION_RESTRICTIONS,
);

function denyAllSourceIntegrationPolicy(): SourceIntegrationPolicyManifest {
  return DENY_ALL_SOURCE_INTEGRATION_POLICY;
}

const CANONICAL_INTEGRATION_TOOL_SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;

function isCanonicalIntegrationToolSegment(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= MAX_SOURCE_INTEGRATION_POLICY_SEGMENT_LENGTH &&
    ReflectApply(RegExpPrototypeTest, CANONICAL_INTEGRATION_TOOL_SEGMENT, [value]) === true;
}

function tryParseSourceIntegrationPolicyManifest(
  value: unknown,
): SourceIntegrationPolicyManifest | null {
  const manifest = snapshotDataRecord(value, 3);
  if (
    !manifest ||
    manifest === SNAPSHOT_LIMIT_EXCEEDED ||
    manifest.values.schemaVersion !== 1
  ) {
    return null;
  }

  if (manifest.values.mode === "unrestricted") {
    return hasExactKeys(manifest, ["schemaVersion", "mode"])
      ? UNRESTRICTED_SOURCE_INTEGRATION_POLICY
      : null;
  }
  if (
    manifest.values.mode !== "allowlist" ||
    !hasExactKeys(manifest, ["schemaVersion", "mode", "integrations"])
  ) {
    return null;
  }

  const integrationSnapshot = snapshotDataRecord(
    manifest.values.integrations,
    MAX_SOURCE_INTEGRATION_POLICY_INTEGRATIONS,
  );
  if (!integrationSnapshot || integrationSnapshot === SNAPSHOT_LIMIT_EXCEEDED) return null;

  const integrationNames = sortStrings(integrationSnapshot.keys);
  const integrations = createRestrictionRecord();
  let totalToolIds = 0;
  for (let index = 0; index < integrationNames.length; index++) {
    const integration = integrationNames[index];
    if (typeof integration !== "string") return null;
    const restrictionSnapshot = snapshotDataRecord(
      integrationSnapshot.values[integration],
      1,
    );
    if (
      !isCanonicalIntegrationToolSegment(integration) ||
      !restrictionSnapshot ||
      restrictionSnapshot === SNAPSHOT_LIMIT_EXCEEDED ||
      !hasExactKeys(restrictionSnapshot, ["allowedToolIds"])
    ) {
      return null;
    }

    const rawToolIds = restrictionSnapshot.values.allowedToolIds;
    if (rawToolIds === null) {
      defineOwnDataProperty(
        integrations,
        integration,
        createFrozenRestriction(null),
      );
      continue;
    }

    const snapshottedToolIds = snapshotDataArray(
      rawToolIds,
      MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS,
    );
    if (!snapshottedToolIds || snapshottedToolIds === SNAPSHOT_LIMIT_EXCEEDED) return null;

    const seenToolIds = new IntrinsicSet<string>();
    const toolIds: string[] = new IntrinsicArray();
    for (let toolIndex = 0; toolIndex < snapshottedToolIds.length; toolIndex++) {
      const toolId = snapshottedToolIds[toolIndex];
      if (
        !isCanonicalIntegrationToolSegment(toolId) ||
        integration.length + 2 + toolId.length > MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH ||
        setHas(seenToolIds, toolId) ||
        ++totalToolIds > MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS
      ) {
        return null;
      }
      setAdd(seenToolIds, toolId);
      pushValue(toolIds, toolId);
    }
    sortStrings(toolIds);
    defineOwnDataProperty(
      integrations,
      integration,
      createFrozenRestriction(freezeObject(toolIds)),
    );
  }

  return createAllowlistManifest(integrations);
}

/** Return whether a process-boundary value is an exact versioned policy manifest. */
export function isSourceIntegrationPolicyManifest(
  value: unknown,
): value is SourceIntegrationPolicyManifest {
  return tryParseSourceIntegrationPolicyManifest(value) !== null;
}

/** Strictly parse and canonicalize a process-boundary policy manifest. */
export function parseSourceIntegrationPolicyManifest(
  value: unknown,
): SourceIntegrationPolicyManifest {
  const parsed = tryParseSourceIntegrationPolicyManifest(value);
  if (!parsed) {
    throw new IntrinsicTypeError("Invalid source integration policy manifest");
  }
  return parsed;
}

/** Resolve an internal manifest; malformed state narrows to deny-all. */
export function resolveSourceIntegrationPolicyManifest(
  value: unknown,
): SourceIntegrationPolicyManifest | undefined {
  if (value === undefined) return undefined;
  return tryParseSourceIntegrationPolicyManifest(value) ?? denyAllSourceIntegrationPolicy();
}

function resolveAuthorizationPolicy(
  value: unknown,
): SourceIntegrationPolicyManifest {
  if (
    typeof value === "object" &&
    value !== null &&
    weakSetHas(canonicalSourceIntegrationPolicies, value)
  ) {
    return value as SourceIntegrationPolicyManifest;
  }
  return tryParseSourceIntegrationPolicyManifest(value) ?? denyAllSourceIntegrationPolicy();
}

function uniqueSorted(values: readonly unknown[]): string[] {
  const unique = new IntrinsicSet<string>();
  const result: string[] = new IntrinsicArray();
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (typeof value !== "string") {
      throw new IntrinsicTypeError("Source integration policy tool IDs must be strings");
    }
    if (!setHas(unique, value)) {
      setAdd(unique, value);
      pushValue(result, value);
    }
  }
  return sortStrings(result);
}

/** Build a deterministic manifest from validated `veryfront.config.ts` input. */
export function normalizeSourceIntegrationPolicy(
  config: SourceIntegrationPolicyConfig | undefined,
): SourceIntegrationPolicyManifest {
  if (config === undefined) return UNRESTRICTED_SOURCE_INTEGRATION_POLICY;

  const configSnapshot = snapshotDataRecord(config, 1);
  if (
    !configSnapshot ||
    configSnapshot === SNAPSHOT_LIMIT_EXCEEDED ||
    !hasExactKeys(configSnapshot, ["allow"])
  ) {
    throw new IntrinsicTypeError("Invalid source integration policy config");
  }
  const allowSnapshot = snapshotDataRecord(
    configSnapshot.values.allow,
    MAX_SOURCE_INTEGRATION_POLICY_INTEGRATIONS,
  );
  if (allowSnapshot === SNAPSHOT_LIMIT_EXCEEDED) {
    throw new IntrinsicRangeError("Source integration policy has too many integrations");
  }
  if (!allowSnapshot) {
    throw new IntrinsicTypeError("Invalid source integration policy allowlist");
  }

  const integrationNames = sortStrings(allowSnapshot.keys);
  const integrations = createRestrictionRecord();
  let totalToolIds = 0;
  for (let index = 0; index < integrationNames.length; index++) {
    const integration = integrationNames[index];
    if (typeof integration !== "string") {
      throw new IntrinsicTypeError("Invalid source integration policy integration name");
    }
    const rawRestriction = allowSnapshot.values[integration];
    if (rawRestriction === undefined) continue;

    const restrictionSnapshot = snapshotDataRecord(rawRestriction, 1);
    if (
      !restrictionSnapshot ||
      restrictionSnapshot === SNAPSHOT_LIMIT_EXCEEDED ||
      (
        restrictionSnapshot.keys.length === 1 &&
        !hasOwn(restrictionSnapshot.values, "allowedTools")
      )
    ) {
      throw new IntrinsicTypeError("Invalid source integration policy restriction");
    }

    const rawAllowedTools = restrictionSnapshot.values.allowedTools;
    if (rawAllowedTools === undefined) {
      defineOwnDataProperty(
        integrations,
        integration,
        createFrozenRestriction(null),
      );
      continue;
    }

    const allowedTools = snapshotDataArray(
      rawAllowedTools,
      MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS,
    );
    if (allowedTools === SNAPSHOT_LIMIT_EXCEEDED) {
      throw new IntrinsicRangeError("Source integration policy has too many tool IDs");
    }
    if (!allowedTools) {
      throw new IntrinsicTypeError("Invalid source integration policy tool ID list");
    }
    if ((totalToolIds += allowedTools.length) > MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS) {
      throw new IntrinsicRangeError("Source integration policy has too many tool IDs");
    }
    defineOwnDataProperty(
      integrations,
      integration,
      createFrozenRestriction(uniqueSorted(allowedTools)),
    );
  }

  return parseSourceIntegrationPolicyManifest({
    schemaVersion: 1,
    mode: "allowlist",
    integrations,
  });
}

function intersectAllowedToolIds(
  left: readonly string[] | null,
  right: readonly string[] | null,
): readonly string[] | null {
  if (left === null) return right;
  if (right === null) return left;

  const rightIds = new IntrinsicSet<string>();
  for (let index = 0; index < right.length; index++) {
    const toolId = right[index];
    if (typeof toolId !== "string") {
      throw new IntrinsicTypeError("Canonical source integration policy contains a sparse array");
    }
    setAdd(rightIds, toolId);
  }

  const intersection: string[] = new IntrinsicArray();
  for (let index = 0; index < left.length; index++) {
    const toolId = left[index];
    if (typeof toolId !== "string") {
      throw new IntrinsicTypeError("Canonical source integration policy contains a sparse array");
    }
    if (setHas(rightIds, toolId)) pushValue(intersection, toolId);
  }
  return intersection;
}

/** Combine independent restrictions without allowing either one to widen access. */
export function intersectSourceIntegrationPolicies(
  left: SourceIntegrationPolicyManifest,
  right: SourceIntegrationPolicyManifest,
): SourceIntegrationPolicyManifest {
  const canonicalLeft = parseSourceIntegrationPolicyManifest(left);
  const canonicalRight = parseSourceIntegrationPolicyManifest(right);
  if (canonicalLeft.mode === "unrestricted") return canonicalRight;
  if (canonicalRight.mode === "unrestricted") return canonicalLeft;

  const leftSnapshot = snapshotDataRecord(
    canonicalLeft.integrations,
    MAX_SOURCE_INTEGRATION_POLICY_INTEGRATIONS,
  );
  if (!leftSnapshot || leftSnapshot === SNAPSHOT_LIMIT_EXCEEDED) {
    throw new IntrinsicTypeError("Canonical source integration policy invariant failed");
  }
  const integrationNames = sortStrings(leftSnapshot.keys);
  const integrations = createRestrictionRecord();
  for (let index = 0; index < integrationNames.length; index++) {
    const integration = integrationNames[index];
    if (typeof integration !== "string") {
      throw new IntrinsicTypeError("Canonical source integration policy contains a sparse record");
    }
    if (!hasOwn(canonicalRight.integrations, integration)) continue;

    const leftRestriction = canonicalLeft.integrations[integration];
    const rightRestriction = canonicalRight.integrations[integration];
    if (!leftRestriction || !rightRestriction) {
      throw new IntrinsicTypeError("Canonical source integration policy invariant failed");
    }
    defineOwnDataProperty(
      integrations,
      integration,
      createFrozenRestriction(
        intersectAllowedToolIds(
          leftRestriction.allowedToolIds,
          rightRestriction.allowedToolIds,
        ),
      ),
    );
  }

  return parseSourceIntegrationPolicyManifest({
    schemaVersion: 1,
    mode: "allowlist",
    integrations,
  });
}

export interface IntegrationToolIdentity {
  integration: string;
  toolId: string;
}

/**
 * Parse the canonical API tool name (`integration__tool_id`). Aliases and
 * alternate separators are intentionally not accepted at this policy layer.
 */
export function parseIntegrationToolIdentity(toolName: string): IntegrationToolIdentity | null {
  if (
    typeof toolName !== "string" ||
    toolName.length > MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH
  ) {
    return null;
  }
  const separator = stringIndexOf(toolName, "__");
  if (
    separator <= 0 ||
    separator !== stringLastIndexOf(toolName, "__") ||
    separator + 2 >= toolName.length
  ) {
    return null;
  }

  const integration = stringSliceRange(toolName, 0, separator);
  const toolId = stringSlice(toolName, separator + 2);
  if (
    !isCanonicalIntegrationToolSegment(integration) ||
    !isCanonicalIntegrationToolSegment(toolId)
  ) {
    return null;
  }
  return { integration, toolId };
}

/** Return whether a canonical integration tool survives the source restriction. */
export function isIntegrationToolAllowedBySourcePolicy(
  toolName: string,
  policy: SourceIntegrationPolicyManifest,
): boolean {
  if (typeof toolName !== "string") return false;
  const canonicalPolicy = resolveAuthorizationPolicy(policy);
  return isIntegrationToolAllowedByCanonicalPolicy(toolName, canonicalPolicy);
}

function isIntegrationToolAllowedByCanonicalPolicy(
  toolName: string,
  policy: SourceIntegrationPolicyManifest,
): boolean {
  if (policy.mode === "unrestricted") return true;

  const identity = parseIntegrationToolIdentity(toolName);
  if (!identity) return !stringIncludes(toolName, "__");

  if (!hasOwn(policy.integrations, identity.integration)) return false;
  const restriction = policy.integrations[identity.integration];
  if (!restriction) return false;
  return restriction.allowedToolIds === null ||
    ReflectApply(ArrayPrototypeIncludes, restriction.allowedToolIds, [
        identity.toolId,
      ]) === true;
}

/** Filter canonical tool names while leaving non-integration tools untouched. */
export function applySourceIntegrationPolicy(
  toolNames: readonly string[],
  policy: SourceIntegrationPolicyManifest,
): string[] {
  const canonicalPolicy = resolveAuthorizationPolicy(policy);
  const allowedToolNames: string[] = new IntrinsicArray();
  for (let index = 0; index < toolNames.length; index++) {
    const toolName = toolNames[index];
    if (
      typeof toolName === "string" &&
      isIntegrationToolAllowedByCanonicalPolicy(toolName, canonicalPolicy)
    ) {
      pushValue(allowedToolNames, toolName);
    }
  }
  return allowedToolNames;
}
