import * as dntShim from "../../../../_dnt.shims.js";
import type { NodePathModule } from "./types.js";

const globalProcess = (dntShim.dntGlobalThis as { process?: { versions?: { node?: string } } }).process;
const hasNodeApis = !!globalProcess?.versions?.node || "Bun" in dntShim.dntGlobalThis;

export const isDeno = typeof dntShim.Deno !== "undefined";

let nodePath: NodePathModule | null = null;

if (hasNodeApis) {
  try {
    const nodeRequire = typeof require !== "undefined" ? require : null;
    if (nodeRequire) nodePath = nodeRequire("node:path") as NodePathModule;
  } catch {
    // ignore
  }
}

export { nodePath };

export const sep = nodePath?.sep ?? "/";
export const delimiter = nodePath?.delimiter ?? ":";
export const hasNodePath = nodePath !== null;
