import { DEPENDENCY_SNAPSHOT_STORE_UNAVAILABLE } from "#veryfront/errors/error-registry/server.ts";
import {
  canIdentifyProxyWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import {
  applyConfiguredDependencyOverrides,
  createDependencyPinningSnapshot,
  DEPENDENCY_SNAPSHOT_MAX_BYTES,
  DEPENDENCY_SNAPSHOT_RETENTION_MS,
  type DependencyPinningSnapshot,
  encodeDependencySnapshot,
  hashDependencyPins,
} from "./dependency-snapshot.ts";

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectKeys = Object.keys;
const hasOwn = Object.hasOwn;
const getPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const createObject = Object.create;
const setPrototypeOf = Object.setPrototypeOf;
const isArray = Array.isArray;
const isSafeInteger = Number.isSafeInteger;
const stringify = JSON.stringify;

export interface MetadataHistoryScope {
  readonly projectId: string;
  readonly branch: string | null;
}

export interface HistoricalDependencySnapshot {
  readonly snapshot: DependencyPinningSnapshot;
  readonly expiresAt: number;
}

function unavailable(): Error {
  return DEPENDENCY_SNAPSHOT_STORE_UNAVAILABLE.create();
}

function record(value: unknown): Record<string, unknown> {
  if (
    value === null || typeof value !== "object" || !canIdentifyProxyWithoutHooks ||
    isProxyWithoutHooks(value) || isArray(value)
  ) throw unavailable();
  const prototype = getPrototypeOf(value);
  if (prototype !== null && prototype !== objectPrototype) throw unavailable();
  return value as Record<string, unknown>;
}

function own(value: object, name: string): unknown {
  const descriptor = getOwnPropertyDescriptor(value, name);
  if (!descriptor || !hasOwn(descriptor, "value")) throw unavailable();
  return descriptor.value;
}

type MetadataEntry = { dependencies: Record<string, string>; expiresAt: number };

function readHistoryEntry(value: unknown, now: number): MetadataEntry {
  const entry = record(value);
  const expiresAt = own(entry, "expiresAt");
  if (
    typeof expiresAt !== "number" || !isSafeInteger(expiresAt) || expiresAt <= 0 ||
    expiresAt > now + DEPENDENCY_SNAPSHOT_RETENTION_MS
  ) throw unavailable();
  const raw = record(own(entry, "dependencies"));
  const dependencies: Record<string, string> = createObject(null);
  const names = objectKeys(raw);
  let keyIndex = 0;
  while (keyIndex < names.length) {
    const name = names[keyIndex++]!;
    const declaration = own(raw, name);
    if (
      name.length > DEPENDENCY_SNAPSHOT_MAX_BYTES || typeof declaration !== "string" ||
      declaration.length > DEPENDENCY_SNAPSHOT_MAX_BYTES
    ) throw unavailable();
    dependencies[name] = declaration;
  }
  return { __proto__: null, dependencies, expiresAt } as MetadataEntry;
}

function readHistoryEntries(
  value: unknown,
  scope: MetadataHistoryScope,
  now: number,
): MetadataEntry[] {
  const history = record(value);
  if (
    own(history, "version") !== 1 || own(history, "projectId") !== scope.projectId ||
    own(history, "branch") !== scope.branch
  ) throw unavailable();
  const entries = own(history, "entries");
  if (!isArray(entries) || isProxyWithoutHooks(entries) || entries.length > 16) throw unavailable();

  const safeEntries: MetadataEntry[] = [];
  setPrototypeOf(safeEntries, null);
  for (let index = 0; index < entries.length; index++) {
    safeEntries[index] = readHistoryEntry(own(entries, `${index}`), now);
  }
  const safe = {
    __proto__: null,
    version: 1,
    projectId: scope.projectId,
    branch: scope.branch,
    entries: safeEntries,
  };
  if (utf8ByteLength(stringify(safe)) > DEPENDENCY_SNAPSHOT_MAX_BYTES) throw unavailable();

  return safeEntries;
}

/**
 * API history contains prior raw metadata, not renderer configuration or a
 * grant to publish snapshots. Only an exact reconstruction for this source
 * may recover a historical request, and its original expiry is retained.
 */
export function selectHistoricalDependencySnapshot(
  value: unknown,
  scope: MetadataHistoryScope,
  requestedKey: string,
  configuredVersions: DependencyPinningSnapshot["configuredVersions"],
  now: number,
): HistoricalDependencySnapshot | undefined {
  const safeEntries = readHistoryEntries(value, scope, now);

  let selected: HistoricalDependencySnapshot | undefined;
  let selectedBytes: string | undefined;
  // Index access avoids invoking a mutable Array iterator.
  let index = 0;
  while (index < safeEntries.length) {
    const entry = safeEntries[index++]!;
    if (entry.expiresAt <= now) continue;
    const effective = applyConfiguredDependencyOverrides(entry.dependencies, configuredVersions);
    const key = `on:${hashDependencyPins(effective, configuredVersions)}`;
    if (key !== requestedKey) continue;
    const snapshot = createDependencyPinningSnapshot(key, effective, configuredVersions);
    const bytes = encodeDependencySnapshot("metadata-history", snapshot);
    if (selectedBytes !== undefined && selectedBytes !== bytes) throw unavailable();
    if (!selected || selected.expiresAt < entry.expiresAt) {
      selected = { snapshot, expiresAt: entry.expiresAt };
      selectedBytes = bytes;
    }
  }
  return selected;
}
