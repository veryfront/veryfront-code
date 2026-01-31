import type { NodePathModule } from "./types.ts";

const globalProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
const hasNodeApis = !!globalProcess?.versions?.node || "Bun" in globalThis;

export const isDeno = typeof Deno !== "undefined";

let nodePath: NodePathModule | null = null;

if (hasNodeApis) {
  try {
    const nodeRequire = typeof require !== "undefined" ? require : null;
    if (nodeRequire) {
      nodePath = nodeRequire("node:path") as NodePathModule;
    }
  } catch {
    // ignore
  }
}

export { nodePath };

export const sep = nodePath?.sep ?? "/";
export const delimiter = nodePath?.delimiter ?? ":";
export const hasNodePath = nodePath !== null;
