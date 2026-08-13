/**
 * Project-scoped view of the raw process environment object.
 *
 * A project environment snapshot is the complete environment a project sees.
 * `getEnv()` already serves that snapshot and nothing else while it is active,
 * but `process.env` is an ordinary object reachable without going through any
 * accessor, so the two surfaces disagreed about what the project environment
 * contains. Installing this view makes them agree.
 *
 * Host-scoped configuration keeps its own accessor (`getHostEnv()`), which
 * reads the captured host record and is unaffected by the installed view.
 *
 * Writes made while a snapshot is active are recorded per snapshot, so a
 * project scope observes its own mutations and nothing outside it does.
 *
 * @module platform/compat/process/scoped-process-env
 */

import type { ProjectEnvSnapshot } from "./project-env-contract.ts";

type EnvRecord = Record<string, string | undefined>;

/** Returns the active project environment snapshot, or undefined outside one. */
export type ProjectEnvSnapshotGetter = () => ProjectEnvSnapshot | undefined;

/** Deleted keys are recorded as `null` so they mask the snapshot entry. */
type ScopedWrites = Map<string, string | null>;

const ObjectKeys = Object.keys;
const ObjectDefineProperty = Object.defineProperty;
const ReflectDefineProperty = Reflect.defineProperty;
const ReflectDeleteProperty = Reflect.deleteProperty;
const ReflectGet = Reflect.get;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const ReflectHas = Reflect.has;
const ReflectOwnKeys = Reflect.ownKeys;
const ReflectSet = Reflect.set;

// Keyed by the snapshot object, which the scope owns for exactly its lifetime.
const writesBySnapshot = new WeakMap<ProjectEnvSnapshot, ScopedWrites>();

function writesFor(snapshot: ProjectEnvSnapshot): ScopedWrites {
  const existing = writesBySnapshot.get(snapshot);
  if (existing) return existing;
  const created: ScopedWrites = new Map();
  writesBySnapshot.set(snapshot, created);
  return created;
}

/**
 * Read a key as the scoped view presents it: snapshot entry, then any write
 * recorded against that snapshot.
 *
 * Exported so the accessors (`getEnv()`, `env()`) resolve keys through exactly
 * the same rule as the raw object, instead of reading the immutable snapshot
 * and missing writes the object has already accepted.
 */
export function readProjectScopedEnv(
  snapshot: ProjectEnvSnapshot,
  key: string,
): string | undefined {
  return readScoped(snapshot, key);
}

/** The scoped view as a plain record, for the bulk accessor. */
export function projectScopedEnvRecord(
  snapshot: ProjectEnvSnapshot,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const key of scopedKeys(snapshot)) {
    const value = readScoped(snapshot, key);
    if (value !== undefined) record[key] = value;
  }
  return record;
}

function readScoped(snapshot: ProjectEnvSnapshot, key: string): string | undefined {
  const writes = writesBySnapshot.get(snapshot);
  if (writes?.has(key)) {
    const written = writes.get(key);
    return written === null ? undefined : written;
  }
  const value = snapshot[key];
  return typeof value === "string" ? value : undefined;
}

function scopedKeys(snapshot: ProjectEnvSnapshot): string[] {
  const keys = new Set<string>(ObjectKeys(snapshot));
  const writes = writesBySnapshot.get(snapshot);
  if (writes) {
    for (const [key, value] of writes) {
      if (value === null) keys.delete(key);
      else keys.add(key);
    }
  }
  return [...keys];
}

/**
 * Reject descriptors the raw environment object never accepts.
 *
 * Both Node and Deno back `process.env` with an object that only takes a
 * configurable, writable, enumerable data descriptor and throws a `TypeError`
 * for anything else. Recording the value instead would let the view report a
 * property shape the host object would have refused, which is the kind of
 * disagreement between the two surfaces this module exists to remove.
 */
function assertEnvDataDescriptor(
  descriptor: PropertyDescriptor,
): asserts descriptor is PropertyDescriptor & { value: unknown } {
  if ("get" in descriptor || "set" in descriptor) {
    throw new TypeError(
      "'process.env' does not accept an accessor(getter/setter) descriptor",
    );
  }
  if (
    !("value" in descriptor) || descriptor.writable !== true ||
    descriptor.enumerable !== true || descriptor.configurable !== true
  ) {
    throw new TypeError(
      "'process.env' only accepts a configurable, writable, and enumerable data descriptor",
    );
  }
}

function createHandler(
  getSnapshot: ProjectEnvSnapshotGetter,
): ProxyHandler<EnvRecord> {
  /** Resolve the snapshot for a string key, or undefined to defer to the host record. */
  const scopeFor = (prop: string | symbol): ProjectEnvSnapshot | undefined =>
    typeof prop === "string" ? getSnapshot() : undefined;

  return {
    get(target, prop) {
      const snapshot = scopeFor(prop);
      if (!snapshot) return ReflectGet(target, prop);
      return readScoped(snapshot, prop as string);
    },
    set(target, prop, value) {
      const snapshot = scopeFor(prop);
      if (!snapshot) return ReflectSet(target, prop, value);
      writesFor(snapshot).set(prop as string, String(value));
      return true;
    },
    deleteProperty(target, prop) {
      const snapshot = scopeFor(prop);
      if (!snapshot) return ReflectDeleteProperty(target, prop);
      writesFor(snapshot).set(prop as string, null);
      return true;
    },
    has(target, prop) {
      const snapshot = scopeFor(prop);
      if (!snapshot) return ReflectHas(target, prop);
      return readScoped(snapshot, prop as string) !== undefined;
    },
    ownKeys(target) {
      const snapshot = getSnapshot();
      if (!snapshot) return ReflectOwnKeys(target);
      return scopedKeys(snapshot);
    },
    getOwnPropertyDescriptor(target, prop) {
      const snapshot = scopeFor(prop);
      if (!snapshot) return ReflectGetOwnPropertyDescriptor(target, prop);
      const value = readScoped(snapshot, prop as string);
      if (value === undefined) return undefined;
      return { value, writable: true, enumerable: true, configurable: true };
    },
    defineProperty(target, prop, descriptor) {
      const snapshot = scopeFor(prop);
      if (!snapshot) return ReflectDefineProperty(target, prop, descriptor);
      assertEnvDataDescriptor(descriptor);
      writesFor(snapshot).set(prop as string, String(descriptor.value));
      return true;
    },
  };
}

/**
 * Apply `process.env = record` without giving up the installed view.
 *
 * A plain assignment would swap the object identity and drop the view for the
 * whole process, so the property is an accessor and assignment is applied
 * through the view instead:
 *
 * - Inside a project scope the result is contained to that scope, so the
 *   replacement is applied exactly: keys the assigned record omits are masked.
 * - Outside one, the record is the host's and is shared with child processes,
 *   so entries are merged and nothing is removed. `process.env = {...}` at host
 *   level therefore adds and overwrites but never clears.
 */
function applyEnvReplacement(
  view: EnvRecord,
  getSnapshot: ProjectEnvSnapshotGetter,
  replacement: unknown,
): void {
  // `process.env = process.env` is an identity assignment; clearing first would
  // turn it into a wipe.
  if (replacement === view) return;
  if (getSnapshot() !== undefined) {
    for (const key of ObjectKeys(view)) delete view[key];
  }
  if (replacement === null || typeof replacement !== "object") return;
  for (const key of ObjectKeys(replacement as EnvRecord)) {
    const value = (replacement as EnvRecord)[key];
    if (value === undefined) continue;
    view[key] = value;
  }
}

let installed = false;

/**
 * Install the project-scoped view over `process.env`.
 *
 * Idempotent: the first installation owns the view for the process lifetime, so
 * the record captured as the host view is always the pre-installation one.
 * Outside a project scope every operation passes straight through to it.
 *
 * The view is installed as a non-configurable accessor, so code running later
 * cannot detach it by assigning to or redefining `process.env` — an assignment
 * is applied through the view (see `applyEnvReplacement`) rather than replacing
 * it. Without that, one assignment would drop the view for every scope in the
 * process, not only the one that made it.
 */
export function installProjectScopedProcessEnv(
  getSnapshot: ProjectEnvSnapshotGetter,
): void {
  if (installed) return;

  const processLike = (globalThis as { process?: { env?: EnvRecord } }).process;
  const hostEnv = processLike?.env;
  if (!processLike || !hostEnv) return;

  installed = true;
  const view = new Proxy(hostEnv, createHandler(getSnapshot));
  try {
    ObjectDefineProperty(processLike, "env", {
      get: () => view,
      set: (replacement: unknown) => applyEnvReplacement(view, getSnapshot, replacement),
      enumerable: true,
      configurable: false,
    });
  } catch {
    // A runtime that refuses to redefine the property still gets the view; it
    // just keeps the weaker guarantee a plain assignment gives.
    processLike.env = view;
  }
}
