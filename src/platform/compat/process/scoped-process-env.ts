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
 * ## Why `process.env` uses one stable view
 *
 * Node and Bun inspect a proxy by reading its target directly when custom
 * inspect hooks are disabled (`console.dir`, `inspect(v, { customInspect:
 * false })`), invoking no traps. Whatever sits on a proxy target is therefore
 * readable from any scope that can reach the proxy, which forces two rules:
 *
 * - Host values must never sit on a proxy target: `process.env` is a global,
 *   so every view is reachable from project scopes through captured
 *   references, and a host-populated target is exactly the inspection leak
 *   this module exists to close.
 *
 * The `process.env` accessor therefore returns one stable proxy whose target
 * contains no environment values. Its traps resolve every operation against
 * the current ambient snapshot, or against the closed-over host record when no
 * project scope is active. A captured reference follows the active scope rather
 * than retaining the project that first read it. The custom inspect hook returns
 * a detached scoped record; inspection modes that bypass hooks see only the
 * target's masking note and cannot recover host or tenant values.
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
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ReflectApply = Reflect.apply;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ReflectDefineProperty = Reflect.defineProperty;
const ReflectDeleteProperty = Reflect.deleteProperty;
const ReflectGet = Reflect.get;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const ReflectHas = Reflect.has;
const ReflectOwnKeys = Reflect.ownKeys;
const ReflectSet = Reflect.set;
const ReflectSetPrototypeOf = Reflect.setPrototypeOf;
const INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");

// Keyed by the snapshot object, which the scope owns for exactly its lifetime.
const writesBySnapshot = new WeakMap<ProjectEnvSnapshot, ScopedWrites>();

/** Minimal contract implemented by the Deno environment capability. */
export interface DenoEnvView {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  has(key: string): boolean;
  toObject(): Record<string, string>;
}

function writesFor(snapshot: ProjectEnvSnapshot): ScopedWrites {
  const existing = writesBySnapshot.get(snapshot);
  if (existing) return existing;
  const created: ScopedWrites = new Map();
  writesBySnapshot.set(snapshot, created);
  return created;
}

/**
 * Record a scoped write (or, with `null`, a delete) against a snapshot.
 *
 * Every mutation path funnels through here so all accessors and the stable
 * process.env view observe the same write log.
 */
function recordScopedWrite(
  snapshot: ProjectEnvSnapshot,
  key: string,
  value: string | null,
): void {
  writesFor(snapshot).set(key, value);
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

/**
 * Record a write against the active snapshot instead of the host environment.
 *
 * Exported so the mutating accessors (`setEnv()`) apply writes through exactly
 * the same rule as the raw `process.env` view: while a project scope is
 * active, its snapshot owns the whole environment and a write must stay
 * contained to that scope rather than reaching the shared host process.
 */
export function writeProjectScopedEnv(
  snapshot: ProjectEnvSnapshot,
  key: string,
  value: string,
): void {
  writesFor(snapshot).set(key, value);
}

/** Record a deletion against the active snapshot (masks the snapshot entry). */
export function deleteProjectScopedEnv(
  snapshot: ProjectEnvSnapshot,
  key: string,
): void {
  writesFor(snapshot).set(key, null);
}

/**
 * Create an ambient-scope-aware view over the Deno environment capability.
 *
 * The host methods are captured before tenant code runs. Project reads and
 * writes use the same snapshot log as process.env, while calls outside a
 * project scope preserve native Deno behavior and permission checks.
 */
export function createProjectScopedDenoEnvView(
  hostEnv: DenoEnvView,
  getSnapshot: ProjectEnvSnapshotGetter,
): DenoEnvView {
  const hostGet = hostEnv.get;
  const hostSet = hostEnv.set;
  const hostDelete = hostEnv.delete;
  const hostHas = hostEnv.has;
  const hostToObject = hostEnv.toObject;

  return {
    get(key) {
      const snapshot = getSnapshot();
      return snapshot === undefined
        ? ReflectApply(hostGet, hostEnv, [key])
        : readScoped(snapshot, key);
    },
    set(key, value) {
      const snapshot = getSnapshot();
      if (snapshot === undefined) {
        ReflectApply(hostSet, hostEnv, [key, value]);
        return;
      }
      writeProjectScopedEnv(snapshot, key, value);
    },
    delete(key) {
      const snapshot = getSnapshot();
      if (snapshot === undefined) {
        ReflectApply(hostDelete, hostEnv, [key]);
        return;
      }
      deleteProjectScopedEnv(snapshot, key);
    },
    has(key) {
      const snapshot = getSnapshot();
      return snapshot === undefined
        ? ReflectApply(hostHas, hostEnv, [key])
        : readScoped(snapshot, key) !== undefined;
    },
    toObject() {
      const snapshot = getSnapshot();
      return snapshot === undefined
        ? ReflectApply(hostToObject, hostEnv, [])
        : projectScopedEnvRecord(snapshot);
    },
  };
}

/** The scoped view as a plain record, for the bulk accessor. */
export function projectScopedEnvRecord(
  snapshot: ProjectEnvSnapshot,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const key of scopedKeys(snapshot)) {
    const value = readScoped(snapshot, key);
    if (value !== undefined) {
      ObjectDefineProperty(record, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
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

/**
 * Handler for the shared host view.
 *
 * Scope-aware per operation: with a snapshot active every string-keyed
 * operation resolves through the scoped rules, so a reference captured outside
 * a scope still presents the project environment inside one; without a
 * snapshot everything passes through to the captured host record.
 */
function createHostViewHandler(
  hostEnv: EnvRecord,
  getSnapshot: ProjectEnvSnapshotGetter,
): ProxyHandler<EnvRecord> {
  /** Resolve the snapshot for a string key, or undefined to defer to the host record. */
  const scopeFor = (prop: string | symbol): ProjectEnvSnapshot | undefined =>
    typeof prop === "string" ? getSnapshot() : undefined;

  return {
    get(target, prop) {
      if (prop === INSPECT_CUSTOM) return ReflectGet(target, prop);
      const snapshot = scopeFor(prop);
      if (!snapshot) return ReflectGet(hostEnv, prop);
      return readScoped(snapshot, prop as string);
    },
    set(_target, prop, value) {
      const snapshot = scopeFor(prop);
      if (!snapshot) return ReflectSet(hostEnv, prop, value);
      recordScopedWrite(snapshot, prop as string, String(value));
      return true;
    },
    deleteProperty(_target, prop) {
      const snapshot = scopeFor(prop);
      if (!snapshot) return ReflectDeleteProperty(hostEnv, prop);
      recordScopedWrite(snapshot, prop as string, null);
      return true;
    },
    has(target, prop) {
      if (prop === INSPECT_CUSTOM) return ReflectHas(target, prop);
      const snapshot = scopeFor(prop);
      if (!snapshot) return ReflectHas(hostEnv, prop);
      return readScoped(snapshot, prop as string) !== undefined;
    },
    ownKeys(_target) {
      const snapshot = getSnapshot();
      if (!snapshot) return ReflectOwnKeys(hostEnv);
      return scopedKeys(snapshot);
    },
    getOwnPropertyDescriptor(target, prop) {
      if (prop === INSPECT_CUSTOM) return ReflectGetOwnPropertyDescriptor(target, prop);
      const snapshot = scopeFor(prop);
      if (!snapshot) return ReflectGetOwnPropertyDescriptor(hostEnv, prop);
      const value = readScoped(snapshot, prop as string);
      if (value === undefined) return undefined;
      return { value, writable: true, enumerable: true, configurable: true };
    },
    defineProperty(_target, prop, descriptor) {
      const snapshot = scopeFor(prop);
      if (!snapshot) return ReflectDefineProperty(hostEnv, prop, descriptor);
      assertEnvDataDescriptor(descriptor);
      recordScopedWrite(snapshot, prop as string, String(descriptor.value));
      return true;
    },
    setPrototypeOf(target, prototype) {
      // A prototype cannot be represented in the per-snapshot write log. Do
      // not let project code mutate process-wide host state through this path.
      if (getSnapshot()) return false;

      const originalHostPrototype = ObjectGetPrototypeOf(hostEnv);
      if (!ReflectSetPrototypeOf(hostEnv, prototype)) return false;
      if (ReflectSetPrototypeOf(target, prototype)) return true;

      // Keep the two records synchronized if the masking target rejects a
      // prototype the backing environment accepted.
      ReflectSetPrototypeOf(hostEnv, originalHostPrototype);
      return false;
    },
    preventExtensions() {
      return false;
    },
  };
}

/** Create the one ambient-scope-aware process.env view installed for this process. */
export function createProjectScopedProcessEnvView(
  hostEnv: EnvRecord,
  getSnapshot: ProjectEnvSnapshotGetter,
): EnvRecord {
  const target = ObjectCreate(ObjectGetPrototypeOf(hostEnv)) as EnvRecord;
  ObjectDefineProperty(target, "<veryfront:masked>", {
    value: "host environment values are not shown through generic proxy-target " +
      "inspection; log process.env directly or read getHostEnv() instead",
    enumerable: true,
    configurable: true,
  });
  ObjectDefineProperty(target, INSPECT_CUSTOM, {
    value: () => {
      const snapshot = getSnapshot();
      return snapshot ? projectScopedEnvRecord(snapshot) : { ...hostEnv };
    },
    configurable: true,
  });
  return new Proxy(target, createHostViewHandler(hostEnv, getSnapshot));
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
  const hostView = createProjectScopedProcessEnvView(hostEnv, getSnapshot);
  try {
    ObjectDefineProperty(processLike, "env", {
      get: () => hostView,
      set: (replacement: unknown) => applyEnvReplacement(hostView, getSnapshot, replacement),
      enumerable: true,
      configurable: false,
    });
  } catch {
    // A runtime that refuses to redefine the property still gets the view; it
    // just keeps the weaker guarantee a plain assignment gives.
    processLike.env = hostView;
  }
}
