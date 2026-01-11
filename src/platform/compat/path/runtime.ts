import type { NodePathModule } from "./types.ts";

const globalProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
const hasNodeApis = !!globalProcess?.versions?.node || "Bun" in globalThis;

export const isDeno = typeof Deno !== "undefined";

// Try to load node:path synchronously (works in Node.js CJS and Bun)
let _nodePath: NodePathModule | null = null;

if (hasNodeApis) {
  try {
    // In Node.js CJS or Bun, require is available globally
    const nodeRequire = typeof require !== "undefined" ? require : null;
    if (nodeRequire) {
      _nodePath = nodeRequire("node:path") as NodePathModule;
    }
  } catch {
    // Fallback to pure JS implementations
  }
}

// Re-export for consumers
export const nodePath: NodePathModule | null = _nodePath;

// Platform-specific path separator
export const sep = _nodePath?.sep ?? "/";

// Platform-specific path delimiter (: on Unix, ; on Windows)
export const delimiter = _nodePath?.delimiter ?? ":";

// Whether node:path was successfully loaded
export const hasNodePath = _nodePath !== null;
