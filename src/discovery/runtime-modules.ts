import type { DISCOVERY_GLOBAL_VERYFRONT_MODULES } from "./import-rewriter.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";

export type DiscoveryRuntimeModuleName = (typeof DISCOVERY_GLOBAL_VERYFRONT_MODULES)[number];

export type DiscoveryRuntimeModules = Record<DiscoveryRuntimeModuleName, unknown>;

let runtimeModules: DiscoveryRuntimeModules | undefined;
const RUNTIME_MODULES_GLOBAL = "__VERYFRONT_MODULES__";

/** Register modules embedded for compiled-binary discovery. */
export function registerDiscoveryRuntimeModules(modules: DiscoveryRuntimeModules): void {
  if (runtimeModules) {
    throw INITIALIZATION_ERROR.create({
      detail: "Compiled discovery runtime modules were already initialized",
    });
  }
  runtimeModules = Object.freeze({ ...modules });
}

/** Return modules embedded for compiled-binary discovery. */
export function getDiscoveryRuntimeModules(): DiscoveryRuntimeModules {
  if (!runtimeModules) {
    throw INITIALIZATION_ERROR.create({
      detail: "Compiled discovery runtime modules were not initialized",
    });
  }
  return runtimeModules;
}

/** Install the compiled discovery registry without exposing a mutable global slot. */
export function installDiscoveryRuntimeModulesGlobal(): void {
  const modules = getDiscoveryRuntimeModules();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, RUNTIME_MODULES_GLOBAL);
  if (descriptor) {
    if (
      descriptor.value === modules && descriptor.writable === false &&
      descriptor.configurable === false
    ) {
      return;
    }
    throw INITIALIZATION_ERROR.create({
      detail: "Compiled discovery runtime module global is already defined",
    });
  }

  Object.defineProperty(globalThis, RUNTIME_MODULES_GLOBAL, {
    value: modules,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}
