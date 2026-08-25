import { getDenoRuntime, isDeno as IS_DENO } from "../runtime.ts";

const nodeProcess = (globalThis as { process?: typeof import("node:process") }).process;
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
