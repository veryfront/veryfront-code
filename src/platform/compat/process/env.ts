import { getDenoRuntime, isDeno as IS_DENO } from "../runtime.ts";
import { hostProcessEnv, runtimeProcess } from "./runtime-process.ts";
import {
  installProjectScopedProcessEnv,
  projectScopedEnvRecord,
  readProjectScopedEnv,
} from "./scoped-process-env.ts";
import type { ProjectEnvSnapshot } from "./project-env-contract.ts";

type EnvOverlayValue = string | null;
type EnvOverlayStore = Map<string, EnvOverlayValue>;

const apply = Reflect.apply;
const denoRuntime = IS_DENO ? getDenoRuntime() : undefined;
const denoEnv = denoRuntime?.env;
const denoEnvGet = denoEnv?.get;
const allowDeniedDenoEnvTestOverlay = (() => {
  if (!denoEnv || !denoEnvGet) return false;
  try {
    return apply(denoEnvGet, denoEnv, ["DENO_TESTING"]) === "1";
  } catch {
    return false;
  }
})();
const MapConstructor = Map;
const mapEntries = Map.prototype.entries;
const mapGet = Map.prototype.get;
const mapHas = Map.prototype.has;

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
 * Read a host-level environment variable without consulting any project env overlay.
 * Use this for framework-owned runtime configuration that should not be shadowed by tenant env.
 */
export function getHostEnv(key: string): string | undefined {
  if (denoRuntime && denoEnv && denoEnvGet) {
    let value: string | undefined;
    try {
      // Probe the real host permission through the accessor captured before
      // project code runs. A denied worker must not reach test overlays, and a
      // project cannot replace Deno.env.get after module initialization.
      value = apply(denoEnvGet, denoEnv, [key]);
    } catch {
      if (allowDeniedDenoEnvTestOverlay) {
        const overlayResult = getOverlayEnvValue(getEnvOverlayStore(), key);
        if (overlayResult.hasValue) return overlayResult.value;
      }
      return undefined;
    }

    const overlayResult = getOverlayEnvValue(getEnvOverlayStore(), key);
    return overlayResult.hasValue ? overlayResult.value : value;
  }

  const overlayResult = getOverlayEnvValue(getEnvOverlayStore(), key);
  if (overlayResult.hasValue) {
    return overlayResult.value;
  }

  // Read the captured host record rather than `runtimeProcess.env`, so the
  // narrower view installed over `process.env` cannot redirect a host-scoped
  // read back into a project scope.
  if (hostProcessEnv) return hostProcessEnv[key];
  return undefined;
}

let _trustedProjectEnvSnapshot: (() => ProjectEnvSnapshot | undefined) | null = null;

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
  _trustedProjectEnvSnapshot = getter;
  installProjectScopedProcessEnv(getTrustedProjectEnvSnapshot);
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

  return getHostEnv(key);
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
