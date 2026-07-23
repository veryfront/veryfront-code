/** Internal immutable snapshots for queued extension lifecycle work. */

import { EXTENSION_VALIDATION_ERROR } from "./errors.ts";
import type {
  Capability,
  Extension,
  ExtensionContractMetadata,
  ResolvedExtension,
} from "./types.ts";

const MAX_SNAPSHOT_ARRAY_ENTRIES = 4_096;
const MAX_SNAPSHOT_OBJECT_FIELDS = 256;
const MAX_SNAPSHOT_EXTENSION_DEPTH = 64;
const MAX_SNAPSHOT_EXTENSION_NODES = 4_096;
const MAX_PROJECT_CONFIG_FIELDS = 1_024;

type ExtensionSnapshotState = {
  readonly snapshots: Map<object, Extension>;
  nodes: number;
};

export function snapshotResolvedExtensions(value: unknown): ResolvedExtension[] {
  try {
    if (!Array.isArray(value)) {
      throw new TypeError();
    }
    const length = Reflect.get(value, "length");
    if (
      typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
      length > MAX_SNAPSHOT_ARRAY_ENTRIES
    ) throw new TypeError();
    const state: ExtensionSnapshotState = {
      nodes: 0,
      snapshots: new Map(),
    };
    const result: ResolvedExtension[] = [];
    for (let index = 0; index < length; index++) {
      const resolved = Reflect.get(value, index);
      if (resolved === null || typeof resolved !== "object" || Array.isArray(resolved)) {
        result.push(resolved as ResolvedExtension);
        continue;
      }
      const extension = Reflect.get(resolved, "extension");
      const source = Reflect.get(resolved, "source");
      const origin = Reflect.get(resolved, "origin");
      result.push(Object.freeze({
        extension: snapshotExtension(extension, state, 0),
        origin,
        source,
      }) as ResolvedExtension);
    }
    return result;
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Resolved extension fields could not be read safely",
    });
  }
}

export function snapshotProjectConfig(value: unknown): Readonly<Record<string, unknown>> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError();
    }
    const keys = Object.keys(value);
    if (keys.length > MAX_PROJECT_CONFIG_FIELDS) throw new TypeError();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      Object.defineProperty(result, key, {
        enumerable: true,
        value: Reflect.get(value, key),
      });
    }
    return Object.freeze(result);
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Project config could not be snapshotted safely",
    });
  }
}

function snapshotExtension(
  value: unknown,
  state: ExtensionSnapshotState,
  depth: number,
): Extension {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value as Extension;
  }
  const existing = state.snapshots.get(value);
  if (existing) return existing;
  if (depth > MAX_SNAPSHOT_EXTENSION_DEPTH || ++state.nodes > MAX_SNAPSHOT_EXTENSION_NODES) {
    throw new TypeError();
  }

  const result = Object.create(null) as Extension;
  state.snapshots.set(value, result);

  const name = Reflect.get(value, "name");
  const version = Reflect.get(value, "version");
  const capabilities = Reflect.get(value, "capabilities");
  const contracts = Reflect.get(value, "contracts");
  const setup = Reflect.get(value, "setup");
  const teardown = Reflect.get(value, "teardown");
  const provides = Reflect.get(value, "provides");
  const extended = Reflect.get(value, "extends");

  defineSnapshotField(result, "name", name);
  defineSnapshotField(result, "version", version);
  defineSnapshotField(result, "capabilities", snapshotCapabilities(capabilities));
  if (contracts !== undefined) {
    defineSnapshotField(result, "contracts", snapshotContracts(contracts));
  }
  if (setup !== undefined) defineSnapshotField(result, "setup", setup);
  if (teardown !== undefined) defineSnapshotField(result, "teardown", teardown);
  if (provides !== undefined) {
    defineSnapshotField(result, "provides", snapshotRecord(provides));
  }
  if (extended !== undefined) {
    const entries = snapshotArray(extended);
    defineSnapshotField(
      result,
      "extends",
      Array.isArray(entries)
        ? Object.freeze(entries.map((entry) => snapshotExtension(entry, state, depth + 1)))
        : entries,
    );
  }
  return Object.freeze(result);
}

function snapshotCapabilities(value: unknown): unknown {
  const entries = snapshotArray(value);
  if (!Array.isArray(entries)) return entries;
  return Object.freeze(entries.map((entry) => snapshotCapability(entry)));
}

function snapshotCapability(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return snapshotRecord(value) as Capability;
}

function snapshotContracts(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const result: ExtensionContractMetadata = {};
  const provides = Reflect.get(value, "provides");
  const requires = Reflect.get(value, "requires");
  if (provides !== undefined) {
    defineSnapshotField(result, "provides", snapshotArray(provides));
  }
  if (requires !== undefined) {
    defineSnapshotField(result, "requires", snapshotArray(requires));
  }
  return Object.freeze(result);
}

function snapshotArray(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const length = Reflect.get(value, "length");
  if (
    typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
    length > MAX_SNAPSHOT_ARRAY_ENTRIES
  ) throw new TypeError();
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    result.push(Reflect.get(value, index));
  }
  return Object.freeze(result);
}

function snapshotRecord(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const keys = Object.keys(value);
  if (keys.length > MAX_SNAPSHOT_OBJECT_FIELDS) throw new TypeError();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    Object.defineProperty(result, key, {
      enumerable: true,
      value: Reflect.get(value, key),
    });
  }
  return Object.freeze(result);
}

function defineSnapshotField(target: object, field: PropertyKey, value: unknown): void {
  Object.defineProperty(target, field, {
    enumerable: true,
    value,
  });
}
