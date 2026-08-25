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
 * ## Why `process.env` resolves to two kinds of view
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
 * - Scoped values must sit on a target owned by their own snapshot, so that
 *   trap-bypassing inspection inside a scope still reports the project's
 *   environment instead of an empty object.
 *
 * The `process.env` accessor therefore resolves per access: inside a scope it
 * returns that snapshot's view, a proxy over a materialized record holding
 * exactly the scoped entries; outside one it returns the shared host view,
 * whose traps pass through to the host record but whose target stays free of
 * host values. Both views dispatch reads and writes through the same scoped
 * rules, so a reference captured in one context stays correct in another.
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
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ReflectDefineProperty = Reflect.defineProperty;
const ReflectDeleteProperty = Reflect.deleteProperty;
const ReflectGet = Reflect.get;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const ReflectHas = Reflect.has;
const ReflectOwnKeys = Reflect.ownKeys;
const ReflectSet = Reflect.set;
const INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");

// Keyed by the snapshot object, which the scope owns for exactly its lifetime.
const writesBySnapshot = new WeakMap<ProjectEnvSnapshot, ScopedWrites>();

/** Per-snapshot view over a materialized record of the scoped entries. */
type ScopedView = { view: EnvRecord; record: EnvRecord };

const viewsBySnapshot = new WeakMap<ProjectEnvSnapshot, ScopedView>();

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
 * Every mutation path funnels through here so the snapshot's materialized
 * record never drifts from the write log: trap-bypassing inspection reads that
 * record directly, without a trap this module could use to sync it lazily.
 */
function recordScopedWrite(
  snapshot: ProjectEnvSnapshot,
  key: string,
  value: string | null,
): void {
  writesFor(snapshot).set(key, value);
  const scoped = viewsBySnapshot.get(snapshot);
  if (!scoped) return;
  if (value === null) delete scoped.record[key];
  else scoped.record[key] = value;
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
    preventExtensions() {
      return false;
    },
  };
}

/**
 * Handler for a snapshot's own view.
 *
 * Bound to its snapshot rather than the ambient scope: a scoped reference that
 * escapes its scope keeps answering with that snapshot's entries instead of
 * degrading to the host record, so an escaped reference can never widen into
 * host access. String-keyed operations resolve through the shared scoped rules
 * (write log over snapshot); symbol-keyed ones fall through to the record so
 * nothing a project attaches ever touches the host object.
 */
function createScopedViewHandler(
  snapshot: ProjectEnvSnapshot,
  record: EnvRecord,
): ProxyHandler<EnvRecord> {
  return {
    get(_target, prop) {
      if (typeof prop !== "string") return ReflectGet(record, prop);
      return readScoped(snapshot, prop);
    },
    set(_target, prop, value) {
      if (typeof prop !== "string") return ReflectSet(record, prop, value);
      recordScopedWrite(snapshot, prop, String(value));
      return true;
    },
    deleteProperty(_target, prop) {
      if (typeof prop !== "string") return ReflectDeleteProperty(record, prop);
      recordScopedWrite(snapshot, prop, null);
      return true;
    },
    has(_target, prop) {
      if (typeof prop !== "string") return ReflectHas(record, prop);
      return readScoped(snapshot, prop) !== undefined;
    },
    ownKeys(_target) {
      return scopedKeys(snapshot);
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== "string") return ReflectGetOwnPropertyDescriptor(record, prop);
      const value = readScoped(snapshot, prop);
      if (value === undefined) return undefined;
      return { value, writable: true, enumerable: true, configurable: true };
    },
    defineProperty(_target, prop, descriptor) {
      if (typeof prop !== "string") return ReflectDefineProperty(record, prop, descriptor);
      assertEnvDataDescriptor(descriptor);
      recordScopedWrite(snapshot, prop, String(descriptor.value));
      return true;
    },
    preventExtensions() {
      return false;
    },
  };
}

/**
 * The view for an active snapshot, created on first access and kept for the
 * snapshot's lifetime so `process.env` stays identity-stable within a scope.
 *
 * The proxy target is a materialized record of the scoped entries, kept in
 * sync by `recordScopedWrite`, so inspection that reads the target directly
 * (Node and Bun with custom inspect hooks disabled) reports the same
 * environment the traps serve.
 */
function scopedViewFor(
  snapshot: ProjectEnvSnapshot,
  hostPrototype: object | null,
): EnvRecord {
  const existing = viewsBySnapshot.get(snapshot);
  if (existing) return existing.view;
  const record = ObjectCreate(hostPrototype) as EnvRecord;
  for (const key of scopedKeys(snapshot)) {
    const value = readScoped(snapshot, key);
    if (value !== undefined) record[key] = value;
  }
  const view = new Proxy(record, createScopedViewHandler(snapshot, record));
  viewsBySnapshot.set(snapshot, { view, record });
  return view;
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
  const hostPrototype = ObjectGetPrototypeOf(hostEnv) as object | null;
  // Keep host secrets in the closed-over backing record, not in the proxy
  // target: runtime inspection utilities read a proxy target without invoking
  // its traps, and this global's target is reachable from every project scope.
  // The masking note is the only own entry, so trap-bypassing inspection at
  // host scope explains itself instead of reporting an empty environment; it is
  // invisible to every trapped operation (enumeration, reads, JSON, spread).
  const target = ObjectCreate(hostPrototype) as EnvRecord;
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
  const hostView = new Proxy(target, createHostViewHandler(hostEnv, getSnapshot));
  const currentView = (): EnvRecord => {
    const snapshot = getSnapshot();
    return snapshot ? scopedViewFor(snapshot, hostPrototype) : hostView;
  };
  try {
    ObjectDefineProperty(processLike, "env", {
      get: currentView,
      set: (replacement: unknown) => applyEnvReplacement(currentView(), getSnapshot, replacement),
      enumerable: true,
      configurable: false,
    });
  } catch {
    // A runtime that refuses to redefine the property still gets the view; it
    // just keeps the weaker guarantee a plain assignment gives.
    processLike.env = hostView;
  }
}
