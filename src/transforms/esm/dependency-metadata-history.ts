import type { DependencyMetadataHistory } from "#veryfront/platform/adapters/dependency-metadata-history.ts";
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
const freeze = Object.freeze;

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

function own(value: Record<string, unknown> | readonly unknown[], name: string): unknown {
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
  freeze(dependencies);
  return freeze({ __proto__: null, dependencies, expiresAt }) as MetadataEntry;
}

/** Copy only validated scoped fields before retaining an API history response. */
export function captureDependencyMetadataHistory(
  value: unknown,
  scope: MetadataHistoryScope,
  now: number,
): { value: DependencyMetadataHistory; bytes: number } {
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
  const bytes = utf8ByteLength(stringify(safe));
  if (bytes > DEPENDENCY_SNAPSHOT_MAX_BYTES) throw unavailable();
  freeze(safeEntries);
  return { value: freeze(safe) as DependencyMetadataHistory, bytes };
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
  return selectCapturedHistoricalDependencySnapshot(
    captureDependencyMetadataHistory(value, scope, now).value,
    scope,
    requestedKey,
    configuredVersions,
    now,
  );
}

/** Select from the immutable result of captureDependencyMetadataHistory without recopying it. */
export function selectCapturedHistoricalDependencySnapshot(
  value: DependencyMetadataHistory,
  scope: MetadataHistoryScope,
  requestedKey: string,
  configuredVersions: DependencyPinningSnapshot["configuredVersions"],
  now: number,
): HistoricalDependencySnapshot | undefined {
  const envelope = record(value);
  if (
    own(envelope, "version") !== 1 || own(envelope, "projectId") !== scope.projectId ||
    own(envelope, "branch") !== scope.branch
  ) throw unavailable();
  const safeEntries = own(envelope, "entries");
  if (!isArray(safeEntries) || isProxyWithoutHooks(safeEntries)) throw unavailable();
  let selected: HistoricalDependencySnapshot | undefined;
  let selectedBytes: string | undefined;
  // Index access avoids invoking a mutable Array iterator.
  let index = 0;
  while (index < safeEntries.length) {
    const entry = record(own(safeEntries, `${index++}`));
    const expiresAt = own(entry, "expiresAt");
    if (
      typeof expiresAt !== "number" || !isSafeInteger(expiresAt) || expiresAt <= 0 ||
      expiresAt > now + DEPENDENCY_SNAPSHOT_RETENTION_MS
    ) throw unavailable();
    if (expiresAt <= now) continue;
    const dependencies = own(entry, "dependencies") as Readonly<Record<string, string>>;
    const effective = applyConfiguredDependencyOverrides(dependencies, configuredVersions);
    const key = `on:${hashDependencyPins(effective, configuredVersions)}`;
    if (key !== requestedKey) continue;
    const snapshot = createDependencyPinningSnapshot(key, effective, configuredVersions);
    const bytes = encodeDependencySnapshot("metadata-history", snapshot);
    if (selectedBytes !== undefined && selectedBytes !== bytes) throw unavailable();
    if (!selected || selected.expiresAt < expiresAt) {
      selected = { snapshot, expiresAt };
      selectedBytes = bytes;
    }
  }
  return selected;
}
