import type { NodePathModule, PathImplementation } from "./types.ts";

const globalProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
const hasNodeApis = !!globalProcess?.versions?.node || "Bun" in globalThis;

export const isDeno = typeof Deno !== "undefined";

function loadNodePath(): NodePathModule | null {
  if (!hasNodeApis) return null;
  try {
    const nodeRequire = (globalThis as {
      require?: (specifier: string) => unknown;
    }).require;
    return nodeRequire ? nodeRequire("node:path") as NodePathModule : null;
  } catch {
    // node:path require may fail in non-Node runtimes.
    return null;
  }
}

export const nodePath = loadNodePath();

export const sep = nodePath?.sep ?? "/";
export const delimiter = nodePath?.delimiter ?? ":";
export const hasNodePath = nodePath !== null;

export function getNativePathImplementation(
  windows: boolean,
): PathImplementation | null {
  if (!nodePath) return null;
  return windows ? nodePath.win32 : nodePath.posix;
}
