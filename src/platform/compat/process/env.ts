import { getDenoRuntime, isDeno as IS_DENO } from "../runtime.ts";
import { hostProcessEnv, runtimeProcess } from "./runtime-process.ts";
import {
  createProjectScopedDenoEnvView,
  deleteProjectScopedEnv,
  installProjectScopedProcessEnv,
  projectScopedEnvRecord,
  readProjectScopedEnv,
  writeProjectScopedEnv,
} from "./scoped-process-env.ts";
import type { ProjectEnvSnapshot } from "./project-env-contract.ts";

type EnvOverlayValue = string | null;
type EnvOverlayStore = Map<string, EnvOverlayValue>;

const apply = Reflect.apply;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const denoRuntime = IS_DENO ? getDenoRuntime() : undefined;
const denoEnv = denoRuntime?.env;
const denoEnvGet = denoEnv?.get;
const allowHostEnvTestOverlay = (() => {
  if (denoEnv && denoEnvGet) {
    try {
      return apply(denoEnvGet, denoEnv, ["DENO_TESTING"]) === "1";
    } catch {
      return false;
    }
  }
  return hostProcessEnv?.DENO_TESTING === "1";
})();
const MapConstructor = Map;
const mapDelete = Map.prototype.delete;
const mapEntries = Map.prototype.entries;
const mapGet = Map.prototype.get;
const mapHas = Map.prototype.has;
const mapSet = Map.prototype.set;
const SetConstructor = Set;
const setAdd = Set.prototype.add;
const setClear = Set.prototype.clear;
const setHas = Set.prototype.has;
// Captured before project code runs: `getHostEnv` is on the credential path,
// so a project that replaces `String.prototype.trim` must not observe — or
// influence — how a host value is classified as blank.
const stringTrim = String.prototype.trim;

/**
 * Host-private credentials, deliberately kept out of the process environment.
 *
 * The CLI resolves the developer's stored login token before it starts a
 * server. In local development project route modules are imported into that
 * same process, so anything placed in the environment — `Deno.env`,
 * `process.env`, a spawned child's inherited env, or `getEnv()` — is readable
 * by project-authored code, and a hostile project could exfiltrate the token
 * just by being served. Values registered here are resolved only through
 * {@link getHostEnv}, which the public `veryfront/*` entry points do not
 * export, so framework code can still read them while project code reaching
 * for a supported export cannot.
 *
 * The boundary is the export surface, not a realm: project modules are loaded
 * with a plain dynamic `import()` into this same process, so code that
 * resolves this file directly rather than through a `veryfront/*` entry shares
 * the module instance and can still call {@link getHostSecret}. The import map
 * and the module-boundary lint are what keep that path closed, exactly as for
 * {@link registerTrustedProjectEnvSnapshot}. What this store buys is that the
 * credential is no longer reachable through the ordinary, fully supported
 * readers — `Deno.env`, `process.env`, {@link getEnv}, and a spawned child's
 * inherited environment.
 */
const hostSecrets: Map<string, string> = new MapConstructor();
const envFileValueKeys: Set<string> = new SetConstructor();
const hostApiEnvSnapshot: Map<string, string | undefined> = new MapConstructor();
const HOST_API_ENV_KEYS = ["VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL"] as const;

/** @internal Record that an environment value came from a project env file. */
export function markEnvFileValue(key: string): void {
  apply(setAdd, envFileValueKeys, [key]);
}

/** @internal Clear project env provenance alongside the env loader's test reset. */
export function clearEnvFileValueSources(): void {
  if (!allowHostEnvTestOverlay) return;
  apply(setClear, envFileValueKeys, []);
}

/** @internal Report whether the current process value was copied from a project env file. */
export function hasEnvFileValueSource(key: string): boolean {
  return apply(setHas, envFileValueKeys, [key]);
}

export type EnvOverlayStorage = {
  getStore: () => unknown;
  run?: <T>(store: unknown, fn: () => T) => T;
  enterWith?: (store: unknown) => void;
};

function getEnvOverlayStore(): EnvOverlayStore | null {
  const storage = getEnvOverlayStorage();
  const store = storage?.getStore();
  return store instanceof MapConstructor ? store as EnvOverlayStore : null;
}

function getOverlayEnvValue(
  store: EnvOverlayStore | null,
  key: string,
): { hasValue: boolean; value: string | undefined } {
  if (!store || !apply(mapHas, store, [key])) {
    return { hasValue: false, value: undefined };
  }

  const value = apply(mapGet, store, [key]);
  return { hasValue: true, value: value ?? undefined };
}

/** Read and write process environment variables. */
export function env(): Record<string, string> {
  const projectEnv = getTrustedProjectEnvSnapshot();
  // Same rule as getEnv(): while a project scope is active its snapshot is the
  // whole environment, so the bulk accessor cannot report a wider set of
  // variables than the single-key one. Built from the scoped view rather than
  // the raw snapshot, so a write the raw object has already accepted is not
  // missing here.
  if (projectEnv !== undefined) return projectScopedEnvRecord(projectEnv);

  const deno = IS_DENO ? getDenoRuntime() : undefined;
  const base = deno
    ? deno.env.toObject()
    : hostProcessEnv
    ? { ...hostProcessEnv } as Record<string, string>
    : {};

  const overlay = getEnvOverlayStore();
  if (!overlay) return base;

  for (const [key, value] of apply(mapEntries, overlay, [])) {
    if (value === null) {
      delete base[key];
      continue;
    }
    base[key] = value;
  }

  return base;
}

/**
 * Register a host-private credential under `key`.
 *
 * The value is held in memory only: it never reaches `Deno.env`,
 * `process.env`, a child process environment, or {@link getEnv}, so project
 * code running in the same process cannot read it. {@link getHostEnv} resolves
 * it after the real environment, so an explicitly exported variable still wins.
 *
 * Part of the contract for every registered key: a host variable that is
 * exported but blank (empty or whitespace-only) does not shadow the
 * credential — {@link getHostEnv} treats such a value as unset for that key
 * and returns the registered credential instead. Register a credential only
 * when a blank export must not suppress it; a caller that needs a blank
 * export to win must not use this store.
 */
export function setHostSecret(key: string, value: string): void {
  if (key === "VERYFRONT_API_TOKEN") {
    for (const apiKey of HOST_API_ENV_KEYS) {
      const trustedValue = hasEnvFileValueSource(apiKey) ? undefined : readHostProcessEnv(apiKey);
      apply(mapSet, hostApiEnvSnapshot, [apiKey, trustedValue]);
    }
  }
  apply(mapSet, hostSecrets, [key, value]);
}

/** Read a host-private credential registered by {@link setHostSecret}. */
export function getHostSecret(key: string): string | undefined {
  return apply(mapGet, hostSecrets, [key]);
}

/** Forget a host-private credential registered by {@link setHostSecret}. */
export function deleteHostSecret(key: string): void {
  apply(mapDelete, hostSecrets, [key]);
  if (key === "VERYFRONT_API_TOKEN") {
    for (const apiKey of HOST_API_ENV_KEYS) apply(mapDelete, hostApiEnvSnapshot, [apiKey]);
  }
}

/**
 * Read outside the project snapshot. Test overlays require a captured host DENO_TESTING=1.
 * Tenant project scopes and later global mutations cannot shadow this read.
 *
 * Host-private credentials registered with {@link setHostSecret} resolve here
 * and only here, so framework code reaches them while `getEnv()` — the reader
 * project code can reach — does not.
 *
 * A host value that is defined but blank does not shadow a registered
 * credential. The CLI normalizes `VERYFRONT_API_TOKEN=""` (or whitespace) to
 * "unset" when it decides to register the stored login token, so treating that
 * blank value as authoritative here would strand the credential and leave
 * `dev`, `start`, workflow, and eval consumers with no usable token.
 */
export function getHostEnv(key: string): string | undefined {
  const value = readHostProcessEnv(key);
  if (value !== undefined && apply(stringTrim, value, []) !== "") return value;
  // Only a registered credential displaces the blank host value; without one
  // the host environment is still reported verbatim.
  const secret = getHostSecret(key);
  return secret !== undefined ? secret : value;
}

/** Read host environment while excluding values copied from project env files. */
export function getHostEnvExcludingEnvFile(key: string): string | undefined {
  if (
    getHostSecret("VERYFRONT_API_TOKEN") !== undefined && apply(mapHas, hostApiEnvSnapshot, [key])
  ) {
    return apply(mapGet, hostApiEnvSnapshot, [key]);
  }
  if (hasEnvFileValueSource(key)) return getHostSecret(key);
  return getHostEnv(key);
}

/** The host process environment alone, without host-private credentials. */
function readHostProcessEnv(key: string): string | undefined {
  if (denoRuntime && denoEnv && denoEnvGet) {
    let value: string | undefined;
    try {
      // Probe the real host permission through the accessor captured before
      // project code runs. A denied worker must not reach test overlays, and a
      // project cannot replace Deno.env.get after module initialization.
      value = apply(denoEnvGet, denoEnv, [key]);
    } catch {
      if (allowHostEnvTestOverlay) {
        const overlayResult = getOverlayEnvValue(getEnvOverlayStore(), key);
        if (overlayResult.hasValue) return overlayResult.value;
      }
      return undefined;
    }

    if (allowHostEnvTestOverlay) {
      const overlayResult = getOverlayEnvValue(getEnvOverlayStore(), key);
      if (overlayResult.hasValue) return overlayResult.value;
    }
    return value;
  }

  if (allowHostEnvTestOverlay) {
    const overlayResult = getOverlayEnvValue(getEnvOverlayStore(), key);
    if (overlayResult.hasValue) return overlayResult.value;
  }

  // Read the captured host record rather than `runtimeProcess.env`, so the
  // narrower view installed over `process.env` cannot redirect a host-scoped
  // read back into a project scope.
  if (hostProcessEnv) return hostProcessEnv[key];
  return undefined;
}

let _trustedProjectEnvSnapshot: (() => ProjectEnvSnapshot | undefined) | null = null;
let denoEnvViewInstalled = false;
let denoCommandViewInstalled = false;

function installProjectScopedDenoCommand(
  getSnapshot: () => ProjectEnvSnapshot | undefined,
): void {
  if (denoCommandViewInstalled || !denoRuntime) return;

  const HostCommand = denoRuntime.Command;
  const hostOutput = HostCommand.prototype.output;
  const hostOutputSync = HostCommand.prototype.outputSync;
  const hostSpawn = HostCommand.prototype.spawn;

  class ProjectScopedCommand {
    readonly #command: Deno.Command;

    constructor(command: string | URL, options: Deno.CommandOptions = {}) {
      const snapshot = getSnapshot();
      const scopedOptions = snapshot === undefined ? options : {
        ...options,
        clearEnv: true,
        env: { ...projectScopedEnvRecord(snapshot), ...options.env },
      };
      this.#command = new HostCommand(command, scopedOptions);
    }

    output(): Promise<Deno.CommandOutput> {
      return apply(hostOutput, this.#command, []);
    }

    outputSync(): Deno.CommandOutput {
      return apply(hostOutputSync, this.#command, []);
    }

    spawn(): Deno.ChildProcess {
      return apply(hostSpawn, this.#command, []);
    }
  }

  ObjectDefineProperty(denoRuntime, "Command", {
    value: ProjectScopedCommand,
    writable: false,
    enumerable: true,
    configurable: false,
  });
  denoCommandViewInstalled = true;
}

function installProjectScopedDenoEnv(
  getSnapshot: () => ProjectEnvSnapshot | undefined,
): void {
  if (denoEnvViewInstalled || !denoRuntime || !denoEnv) return;

  const descriptor = ObjectGetOwnPropertyDescriptor(denoRuntime, "env");
  const getOverlay = allowHostEnvTestOverlay ? getEnvOverlayStore : undefined;
  const view = createProjectScopedDenoEnvView(denoEnv, getSnapshot, getOverlay);
  ObjectDefineProperty(denoRuntime, "env", {
    value: view,
    writable: false,
    enumerable: descriptor?.enumerable ?? true,
    configurable: false,
  });
  denoEnvViewInstalled = true;
}

/**
 * Register the server-owned project environment snapshot bridge.
 *
 * Kept out of the public process barrel so project code cannot replace the
 * callback through a supported package export. Re-registering a different
 * function is rejected rather than silently widening an isolation boundary.
 *
 * Registering the bridge also installs the matching view over `process.env`, so
 * the raw environment object and `getEnv()` are scoped by the same act and
 * cannot drift apart.
 */
export function registerTrustedProjectEnvSnapshot(
  getter: () => ProjectEnvSnapshot | undefined,
): void {
  if (_trustedProjectEnvSnapshot && _trustedProjectEnvSnapshot !== getter) {
    throw new Error("Project environment snapshot bridge is already registered");
  }
  installProjectScopedDenoEnv(getter);
  installProjectScopedDenoCommand(getter);
  _trustedProjectEnvSnapshot = getter;
  installProjectScopedProcessEnv(
    getTrustedProjectEnvSnapshot,
    allowHostEnvTestOverlay ? getEnvOverlayStore : undefined,
  );
}

/** Return the active server-owned project env snapshot, if registered. */
export function getTrustedProjectEnvSnapshot(): ProjectEnvSnapshot | undefined {
  return _trustedProjectEnvSnapshot?.();
}

/** Read an environment variable from the active project scope. */
export function getEnv(key: string): string | undefined {
  const projectEnv = getTrustedProjectEnvSnapshot();
  if (projectEnv !== undefined) {
    // The registered snapshot is authoritative even when the requested key is
    // absent. Falling through here would expose host process configuration to
    // a remote project. Never discover this boundary through replaceable
    // globalThis hooks. Reads go through the scoped view so this accessor and
    // the raw object resolve a key by the same rule, writes included.
    return readProjectScopedEnv(projectEnv, key);
  }

  // Host process environment only. Host-private credentials stay out of this
  // reader: local development imports project route modules into this process,
  // and `getEnv()` is the accessor those modules can call.
  return readHostProcessEnv(key);
}

const DEFAULT_ENV_TRUE_VALUES = ["1", "true", "yes"] as const;
const DEFAULT_ENV_FALSE_VALUES = ["0", "false", "no"] as const;

export interface EnvBooleanOptions {
  trueValues?: readonly string[];
  falseValues?: readonly string[];
  trim?: boolean;
  caseSensitive?: boolean;
}

function normalizeEnvToken(
  value: string,
  options: { trim: boolean; caseSensitive: boolean },
): string {
  const normalized = options.trim ? value.trim() : value;
  return options.caseSensitive ? normalized : normalized.toLowerCase();
}

export function getEnvString(key: string): string | undefined;
export function getEnvString(key: string, fallback: string): string;
export function getEnvString(key: string, fallback?: string): string | undefined {
  const value = getEnv(key);
  if (value === undefined) return fallback;
  return value;
}

export function getEnvNumber(key: string): number | undefined;
export function getEnvNumber(key: string, fallback: number): number;
export function getEnvNumber(key: string, fallback?: number): number | undefined {
  const value = getEnvString(key);
  if (value === undefined) return fallback;

  const normalized = value.trim();
  if (!/^[+-]?\d+$/.test(normalized)) return fallback ?? Number.NaN;

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return fallback ?? Number.NaN;
  return parsed;
}

export function getEnvBoolean(
  key: string,
  fallback = false,
  options: EnvBooleanOptions = {},
): boolean {
  const value = getEnvString(key);
  if (value === undefined) return fallback;

  const trim = options.trim ?? true;
  const caseSensitive = options.caseSensitive ?? false;
  const normalized = normalizeEnvToken(value, { trim, caseSensitive });

  const trueValues = options.trueValues ?? DEFAULT_ENV_TRUE_VALUES;
  for (const trueValue of trueValues) {
    if (normalized === normalizeEnvToken(trueValue, { trim, caseSensitive })) return true;
  }

  const falseValues = options.falseValues ?? DEFAULT_ENV_FALSE_VALUES;
  for (const falseValue of falseValues) {
    if (normalized === normalizeEnvToken(falseValue, { trim, caseSensitive })) return false;
  }

  return fallback;
}

/** Sets env. */
export function setEnv(key: string, value: string): void {
  const projectEnv = getTrustedProjectEnvSnapshot();
  if (projectEnv !== undefined) {
    // Same rule as getEnv() and the process.env view: while a project scope is
    // active its snapshot is the whole environment, so a write stays contained
    // to that scope instead of mutating the shared host process environment.
    writeProjectScopedEnv(projectEnv, key, value);
    return;
  }

  const overlay = getEnvOverlayStore();
  if (overlay) {
    overlay.set(key, value);
    return;
  }

  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    deno.env.set(key, value);
    return;
  }
  if (runtimeProcess) {
    runtimeProcess.env[key] = value;
    return;
  }
  throw new Error("setEnv() is not supported in this runtime");
}

/** Delete a process environment variable. */
export function deleteEnv(key: string): void {
  const projectEnv = getTrustedProjectEnvSnapshot();
  if (projectEnv !== undefined) {
    // Contained to the active project scope for the same reason as setEnv().
    deleteProjectScopedEnv(projectEnv, key);
    return;
  }

  const overlay = getEnvOverlayStore();
  if (overlay) {
    overlay.set(key, null);
    return;
  }

  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    deno.env.delete(key);
    return;
  }
  if (runtimeProcess) {
    delete runtimeProcess.env[key];
    return;
  }
  throw new Error("deleteEnv() is not supported in this runtime");
}

/**
 * Get an AsyncLocalStorage-based env overlay storage if installed.
 * This enables per-async-context env isolation (e.g., in tests).
 */
export function getEnvOverlayStorage(): EnvOverlayStorage | null {
  const globalAny = globalThis as Record<string, unknown>;
  const overlay =
    (globalAny["__vfTestDenoEnvOverlay"] as { storage?: EnvOverlayStorage } | undefined) ??
      (globalAny["__vfTestEnvOverlay"] as { storage?: EnvOverlayStorage } | undefined);

  const storage = overlay?.storage;
  if (!storage || typeof storage.getStore !== "function") return null;
  return storage;
}
