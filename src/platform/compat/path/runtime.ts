import type { NodePathModule } from "./types.ts";

const globalProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
const hasNodeApis = !!globalProcess?.versions?.node || "Bun" in globalThis;

export const isDeno = typeof Deno !== "undefined";

export let nodePath: NodePathModule | null = null;

if (hasNodeApis) {
  nodePath = await import("node:path") as NodePathModule;
}

export const sep = nodePath ? nodePath.sep : "/";

export const delimiter = nodePath ? nodePath.delimiter : ":";

export const hasNodePath = nodePath !== null;
