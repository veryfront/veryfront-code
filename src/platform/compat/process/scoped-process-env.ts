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
      if ("value" in descriptor) {
        writesFor(snapshot).set(prop as string, String(descriptor.value));
      }
      return true;
    },
  };
}

let installed = false;

/**
 * Install the project-scoped view over `process.env`.
 *
 * Idempotent: the first installation owns the view for the process lifetime, so
 * the record captured as the host view is always the pre-installation one.
 * Outside a project scope every operation passes straight through to it.
 */
export function installProjectScopedProcessEnv(
  getSnapshot: ProjectEnvSnapshotGetter,
): void {
  if (installed) return;

  const processLike = (globalThis as { process?: { env?: EnvRecord } }).process;
  const hostEnv = processLike?.env;
  if (!processLike || !hostEnv) return;

  installed = true;
  processLike.env = new Proxy(hostEnv, createHandler(getSnapshot));
}
