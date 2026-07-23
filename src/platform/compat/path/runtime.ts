import type { NodePathModule } from "./types.ts";

const globalProcess = (globalThis as {
  process?: {
    getBuiltinModule?: (specifier: string) => unknown;
    platform?: string;
    versions?: { node?: string };
  };
}).process;
const hasNodeApis = !!globalProcess?.versions?.node || "Bun" in globalThis;

export const isDeno = typeof Deno !== "undefined";

let nodePath: NodePathModule | null = null;

if (hasNodeApis) {
  try {
    const nodeRequire = (globalThis as {
      require?: (specifier: string) => unknown;
    }).require;
    const builtinPath = globalProcess?.getBuiltinModule?.("node:path");
    if (builtinPath) {
      nodePath = builtinPath as NodePathModule;
    } else if (nodeRequire) {
      nodePath = nodeRequire("node:path") as NodePathModule;
    }
  } catch (_) {
    /* expected: node:path require may fail in non-Node runtimes */
  }
}

export { nodePath };

const runtimeOs = (globalThis as { Deno?: { build?: { os?: string } } }).Deno?.build?.os ??
  globalProcess?.platform;
const isWindows = runtimeOs === "windows" || runtimeOs === "win32";

export const sep = nodePath?.sep ?? (isWindows ? "\\" : "/");
export const delimiter = nodePath?.delimiter ?? (isWindows ? ";" : ":");
export const hasNodePath = nodePath !== null;
