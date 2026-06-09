/**
 * Per-request environment variable overlay using AsyncLocalStorage.
 *
 * Allows each request to have its own set of environment variables
 * without leaking between concurrent requests.
 *
 * @module server/project-env/storage
 */

import { AsyncLocalStorage } from "node:async_hooks";

const projectEnvStorage = new AsyncLocalStorage<Record<string, string>>();
const PROCESS_ENV_PROXY_FLAG = "__vfProjectEnvProcessProxyInstalled";
const PROCESS_ENV_PROXY_REF = "__vfProjectEnvProcessProxy";
const PROCESS_ENV_HOST_GETTER = "__vfHostProcessEnvGetter";

type ProcessLike = {
  env?: Record<string | symbol, string | undefined>;
};

function getGlobalProcess(): ProcessLike | undefined {
  const candidate = (globalThis as { process?: unknown }).process;
  return candidate && typeof candidate === "object" ? candidate as ProcessLike : undefined;
}

function getActiveStore(): Record<string, string> | undefined {
  return projectEnvStorage.getStore();
}

function installProcessEnvProxy(): void {
  const globals = globalThis as Record<string, unknown>;

  const processLike = getGlobalProcess();
  if (!processLike?.env) return;
  if (globals[PROCESS_ENV_PROXY_FLAG] && globals[PROCESS_ENV_PROXY_REF] === processLike.env) return;

  const hostEnv = processLike.env;
  globals[PROCESS_ENV_HOST_GETTER] = (key: string): string | undefined => hostEnv[key];

  const proxy = new Proxy(hostEnv, {
    get(target, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver);
      }

      const store = getActiveStore();
      if (store !== undefined) {
        return Object.prototype.hasOwnProperty.call(store, property) ? store[property] : undefined;
      }

      return target[property];
    },
    set(target, property, value, receiver) {
      if (typeof property !== "string") {
        return Reflect.set(target, property, value, receiver);
      }

      const normalized = String(value);
      const store = getActiveStore();
      if (store !== undefined) {
        store[property] = normalized;
        return true;
      }

      target[property] = normalized;
      return true;
    },
    deleteProperty(target, property) {
      if (typeof property !== "string") {
        return Reflect.deleteProperty(target, property);
      }

      const store = getActiveStore();
      if (store !== undefined) {
        delete store[property];
        return true;
      }

      return Reflect.deleteProperty(target, property);
    },
    has(target, property) {
      if (typeof property !== "string") {
        return Reflect.has(target, property);
      }

      const store = getActiveStore();
      if (store !== undefined) {
        return Object.prototype.hasOwnProperty.call(store, property);
      }

      return property in target;
    },
    ownKeys(target) {
      const store = getActiveStore();
      return store !== undefined ? Reflect.ownKeys(store) : Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, property) {
      if (typeof property !== "string") {
        return Reflect.getOwnPropertyDescriptor(target, property);
      }

      const store = getActiveStore();
      if (store !== undefined) {
        if (!Object.prototype.hasOwnProperty.call(store, property)) {
          return undefined;
        }

        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: store[property],
        };
      }

      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });

  Object.defineProperty(processLike, "env", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: proxy,
  });
  globals[PROCESS_ENV_PROXY_FLAG] = true;
  globals[PROCESS_ENV_PROXY_REF] = proxy;
}

/**
 * Run a function with project-specific environment variables.
 * Within the callback, `getProjectEnv()` will return values from `vars`.
 */
export function runWithProjectEnv<T>(vars: Record<string, string>, fn: () => T): T {
  installProcessEnvProxy();
  return projectEnvStorage.run(vars, fn);
}

/**
 * Get a project-scoped environment variable from the current request context.
 * Returns undefined if no project env overlay is active or key is not present.
 */
export function getProjectEnv(key: string): string | undefined {
  return projectEnvStorage.getStore()?.[key];
}

/**
 * Check whether a project env overlay is currently active.
 * When true, getEnv() should NOT fall through to host process env
 * to prevent remote projects from reading host-level secrets.
 */
export function isProjectEnvActive(): boolean {
  return projectEnvStorage.getStore() !== undefined;
}

/**
 * Get a snapshot of the current project env overlay.
 * Returns undefined if no overlay is active.
 * Used to forward env vars to isolated workers in proxy mode.
 */
export function getProjectEnvSnapshot(): Record<string, string> | undefined {
  return projectEnvStorage.getStore();
}

// Register on globalThis so lower-layer code can access without upward imports.
// process.ts is low-level (platform/compat), project-env is high-level (server/).
(globalThis as Record<string, unknown>).__vfProjectEnvGetter = getProjectEnv;
(globalThis as Record<string, unknown>).__vfProjectEnvActiveChecker = isProjectEnvActive;
(globalThis as Record<string, unknown>).__vfProjectEnvSnapshotGetter = getProjectEnvSnapshot;
installProcessEnvProxy();
