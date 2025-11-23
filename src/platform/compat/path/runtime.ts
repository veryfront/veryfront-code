import type { NodePathModule } from "./types.ts";

export const isDeno = typeof Deno !== "undefined";

export let nodePath: NodePathModule | null = null;

if (!isDeno) {
  nodePath = await import("node:path") as NodePathModule;
}

export const sep = isDeno ? "/" : nodePath!.sep;

export const delimiter = isDeno ? ":" : nodePath!.delimiter;
