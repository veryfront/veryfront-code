import { getDenoRuntime, isDeno as IS_DENO } from "../runtime.ts";

export type RuntimeProcess = typeof import("node:process");

function getGlobalProcess(): unknown {
  try {
    return Reflect.get(globalThis, "process");
  } catch {
    return undefined;
  }
}

/**
 * Detect a real Node/Bun process object.
 * Browser bundles may inject `window.process = { env: {} }`, which is not enough
 * to safely call process APIs like cwd(), exit(), or on().
 */
export function testHasRuntimeProcess(processLike: unknown): processLike is RuntimeProcess {
  if (!processLike || typeof processLike !== "object") return false;

  try {
    const candidate = processLike as Record<string, unknown>;
    const versions = candidate.versions as Record<string, unknown> | undefined;
    const env = candidate.env;
    const stdin = candidate.stdin as Record<string, unknown> | undefined;
    const stdout = candidate.stdout as Record<string, unknown> | undefined;
    return (
      typeof versions?.node === "string" &&
      versions.node.length > 0 &&
      typeof env === "object" &&
      env !== null &&
      !Array.isArray(env) &&
      Array.isArray(candidate.argv) &&
      candidate.argv.every((argument) => typeof argument === "string") &&
      typeof candidate.platform === "string" &&
      candidate.platform.length > 0 &&
      typeof candidate.version === "string" &&
      candidate.version.length > 0 &&
      Number.isSafeInteger(candidate.pid) &&
      (candidate.pid as number) > 0 &&
      typeof candidate.execPath === "string" &&
      candidate.execPath.length > 0 &&
      typeof candidate.cwd === "function" &&
      typeof candidate.chdir === "function" &&
      typeof candidate.exit === "function" &&
      typeof candidate.on === "function" &&
      typeof candidate.off === "function" &&
      typeof candidate.memoryUsage === "function" &&
      typeof candidate.uptime === "function" &&
      typeof stdin === "object" &&
      stdin !== null &&
      typeof stdout === "object" &&
      stdout !== null &&
      typeof stdout.write === "function"
    );
  } catch {
    return false;
  }
}

const nodeProcess = getGlobalProcess();
export const runtimeProcess: RuntimeProcess | null = testHasRuntimeProcess(nodeProcess)
  ? nodeProcess
  : null;

export function isWindowsPlatform(): boolean {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) return deno.build.os === "windows";
  return runtimeProcess?.platform === "win32";
}
