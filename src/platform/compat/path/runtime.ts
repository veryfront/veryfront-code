import * as importedNodePath from "node:path";
import { isDeno } from "../runtime.ts";
import type { NodePathModule, PathImplementation } from "./types.ts";

const candidate = importedNodePath as unknown as NodePathModule;

/**
 * Native path implementation when the host provides the Node-compatible API.
 * Browser transforms replace `node:path` with the noop module, leaving this
 * value null so path operations use the portable implementation.
 */
export const nodePath: NodePathModule | null = typeof candidate.join === "function" &&
    typeof candidate.resolve === "function" &&
    typeof candidate.posix?.join === "function" &&
    typeof candidate.win32?.join === "function"
  ? candidate
  : null;

export { isDeno };

export const sep = nodePath?.sep ?? "/";
export const delimiter = nodePath?.delimiter ?? ":";
export const hasNodePath = nodePath !== null;

export function getNativePathImplementation(
  windows: boolean,
): PathImplementation | null {
  if (!nodePath) return null;
  return windows ? nodePath.win32 : nodePath.posix;
}
