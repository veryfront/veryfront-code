import { getDenoRuntime, isDeno as IS_DENO } from "../runtime.ts";

// Deno has native implementations for the process APIs below. Its Node global
// is lazy in newer compilers and must not be initialized just to import logging
// or environment helpers. Node/Bun still capture the host object at bootstrap.
const nodeProcess = IS_DENO
  ? undefined
  : (globalThis as { process?: typeof import("node:process") }).process;
const apply = Reflect.apply;
const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
const denoProcessGetter = IS_DENO && typeof processDescriptor?.get === "function"
  ? processDescriptor.get
  : undefined;
const denoProcessValue = IS_DENO && processDescriptor && "value" in processDescriptor
  ? processDescriptor.value
  : undefined;
export type RuntimeProcess = typeof import("node:process");

/**
 * Detect a real Node/Bun process object.
 * Browser bundles may inject `window.process = { env: {} }`, which is not enough
 * to safely call process APIs like cwd(), exit(), or on().
 */
export function testHasRuntimeProcess(processLike: unknown): processLike is RuntimeProcess {
  if (!processLike || typeof processLike !== "object") return false;
  const versions = (processLike as { versions?: { node?: string } }).versions;
  return typeof versions?.node === "string" && versions.node.length > 0;
}

export const runtimeProcess: RuntimeProcess | null = testHasRuntimeProcess(nodeProcess)
  ? nodeProcess
  : null;

/** Resolve Node compatibility only for an API without a native Deno equivalent. */
export function getNodeCompatibilityProcess(): RuntimeProcess | null {
  if (!IS_DENO) return runtimeProcess;
  // Capture the host descriptor before project code runs, and invoke only that
  // getter on demand. A later replacement of the global cannot redirect this
  // trusted compatibility lookup.
  const processLike = denoProcessGetter
    ? apply(denoProcessGetter, globalThis, [])
    : denoProcessValue;
  return testHasRuntimeProcess(processLike) ? processLike : null;
}

/**
 * The host environment record, captured before any narrower view is installed
 * over `process.env`.
 *
 * Host-scoped accessors read through this reference so that installing a
 * scoped view over `process.env` cannot redirect them.
 */
export const hostProcessEnv: RuntimeProcess["env"] | null = runtimeProcess?.env ?? null;

export function isWindowsPlatform(): boolean {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) return deno.build.os === "windows";
  const platform = runtimeProcess?.platform ??
    (globalThis as { process?: { platform?: string } }).process?.platform;
  return platform === "win32";
}
