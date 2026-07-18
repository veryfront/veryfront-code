import type { DISCOVERY_GLOBAL_VERYFRONT_MODULES } from "./import-rewriter.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";

export type DiscoveryRuntimeModuleName = (typeof DISCOVERY_GLOBAL_VERYFRONT_MODULES)[number];

export type DiscoveryRuntimeModules = Record<DiscoveryRuntimeModuleName, unknown>;

let runtimeModules: DiscoveryRuntimeModules | undefined;

/** Register modules embedded for compiled-binary discovery. */
export function registerDiscoveryRuntimeModules(modules: DiscoveryRuntimeModules): void {
  runtimeModules = modules;
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
