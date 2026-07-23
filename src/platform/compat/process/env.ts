import { getDenoRuntime, isDeno as IS_DENO } from "../runtime.ts";
import { runtimeProcess } from "./runtime-process.ts";

type EnvOverlayValue = string | null;
type EnvOverlayStore = Map<string, EnvOverlayValue>;

export type EnvOverlayStorage = {
  getStore: () => unknown;
  run?: <T>(store: unknown, fn: () => T) => T;
  enterWith?: (store: unknown) => void;
};

function getEnvOverlayStore(): EnvOverlayStore | null {
  const storage = getEnvOverlayStorage();
  const store = storage?.getStore();
  return store instanceof Map ? store as EnvOverlayStore : null;
}

function getOverlayEnvValue(
  store: EnvOverlayStore | null,
  key: string,
): { hasValue: boolean; value: string | undefined } {
  if (!store?.has(key)) {
    return { hasValue: false, value: undefined };
  }

  const value = store.get(key);
  return { hasValue: true, value: value ?? undefined };
}

/** Read and write process environment variables. */
export function env(): Record<string, string> {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  const base = deno
    ? deno.env.toObject()
    : runtimeProcess
    ? { ...runtimeProcess.env } as Record<string, string>
    : {};

  const overlay = getEnvOverlayStore();
  if (!overlay) return base;

  for (const [key, value] of overlay.entries()) {
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
  const overlayResult = getOverlayEnvValue(getEnvOverlayStore(), key);
  if (overlayResult.hasValue) {
    return overlayResult.value;
  }

  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    try {
      return deno.env.get(key);
    } catch (error) {
      // Under a tightened env permission allowlist (project isolation workers),
      // reading a non-allowlisted variable throws NotCapable. Treat it as absent
      // so optional-variable lookups do not crash the request. Unexpected host
      // environment failures must remain visible to the caller.
      if (getErrorName(error) === "NotCapable") return undefined;
      throw error;
    }
  }
  if (runtimeProcess && Object.hasOwn(runtimeProcess.env, key)) {
    return runtimeProcess.env[key];
  }
  return undefined;
}

// Lazy-loaded references to project-env/storage.ts functions.
// Uses globalThis to avoid circular imports (process compat is low-level, project-env is high-level).
// IMPORTANT: Only cache when the real getter is found. If storage.ts hasn't loaded yet,
// re-check globalThis on every call to avoid permanently caching the fallback.
let _getProjectEnv: ((key: string) => string | undefined) | null = null;
let _isProjectEnvActive: (() => boolean) | null = null;

function getProjectEnvSafe(key: string): string | undefined {
  if (_getProjectEnv === null) {
    const mod = (globalThis as Record<string, unknown>).__vfProjectEnvGetter as
      | ((key: string) => string | undefined)
      | undefined;
    if (mod) {
      _getProjectEnv = mod;
    } else {
      return undefined;
    }
  }
  return _getProjectEnv(key);
}

function isProjectEnvActiveSafe(): boolean {
  if (_isProjectEnvActive === null) {
    const mod = (globalThis as Record<string, unknown>).__vfProjectEnvActiveChecker as
      | (() => boolean)
      | undefined;
    if (mod) {
      _isProjectEnvActive = mod;
    } else {
      return false;
    }
  }
  return _isProjectEnvActive();
}

/** Read an environment variable from the active project scope. */
export function getEnv(key: string): string | undefined {
  // Check per-request project env overlay first (AsyncLocalStorage)
  const projectValue = getProjectEnvSafe(key);
  if (projectValue !== undefined) return projectValue;

  // When a project env overlay is active (remote project request), do NOT
  // fall through to host process env. This prevents remote projects from
  // reading host-level secrets like AWS_SECRET_ACCESS_KEY, DATABASE_URL, etc.
  if (isProjectEnvActiveSafe()) return undefined;

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
  if (normalized.length === 0) return fallback;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function getErrorName(error: unknown): string | undefined {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return undefined;
  }

  try {
    const name = Reflect.get(error, "name");
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
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

const ENV_OVERLAY_STORAGE_KEYS = ["__vfTestDenoEnvOverlay", "__vfTestEnvOverlay"] as const;
const MAX_ENV_OVERLAY_PROTOTYPE_DEPTH = 32;

function readOwnDataValue(target: object, key: PropertyKey): unknown {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function findEnvOverlayDataValue(target: object, key: PropertyKey): unknown {
  const seen = new Set<object>();
  let current: object | null = target;
  while (
    current && !seen.has(current) && seen.size < MAX_ENV_OVERLAY_PROTOTYPE_DEPTH
  ) {
    seen.add(current);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(current, key);
      current = Reflect.getPrototypeOf(current);
    } catch {
      return undefined;
    }
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
  }
  return undefined;
}

function resolveEnvOverlayStorage(container: unknown): EnvOverlayStorage | null {
  if (!container || (typeof container !== "object" && typeof container !== "function")) {
    return null;
  }
  const storage = readOwnDataValue(container, "storage");
  if (!storage || (typeof storage !== "object" && typeof storage !== "function")) return null;
  if (typeof findEnvOverlayDataValue(storage, "getStore") !== "function") return null;
  for (const optionalMethod of ["run", "enterWith"] as const) {
    const method = findEnvOverlayDataValue(storage, optionalMethod);
    if (method !== undefined && typeof method !== "function") return null;
  }
  return storage as EnvOverlayStorage;
}

/**
 * Get an AsyncLocalStorage-based env overlay storage if installed.
 * This enables per-async-context env isolation (e.g., in tests).
 */
export function getEnvOverlayStorage(): EnvOverlayStorage | null {
  for (const key of ENV_OVERLAY_STORAGE_KEYS) {
    const container = readOwnDataValue(globalThis, key);
    const storage = resolveEnvOverlayStorage(container);
    if (storage) return storage;
  }
  return null;
}
