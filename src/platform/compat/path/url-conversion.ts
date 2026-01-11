import { hasNodePath, isDeno } from "./runtime.ts";
import { isAbsolute, resolve } from "./resolution.ts";

// Cache fileURLToPath for synchronous access
let _fileURLToPath: ((url: string | URL) => string) | null = null;

function getFileURLToPath(): ((url: string | URL) => string) | null {
  if (_fileURLToPath !== null) return _fileURLToPath;
  if (hasNodePath) {
    try {
      // Use synchronous require for Node.js/Bun
      // deno-lint-ignore no-explicit-any
      const nodeUrl = (globalThis as any).require?.("node:url");
      if (nodeUrl?.fileURLToPath) {
        _fileURLToPath = nodeUrl.fileURLToPath;
        return _fileURLToPath;
      }
    } catch {
      // Fallback to manual conversion
    }
  }
  return null;
}

/**
 * Convert a file URL to a path (synchronous)
 */
export function fromFileUrl(url: string | URL): string {
  // Try Node.js fileURLToPath first
  const fileURLToPath = getFileURLToPath();
  if (fileURLToPath) {
    return fileURLToPath(url);
  }

  // Deno/fallback: manual conversion
  if (isDeno) {
    // deno-lint-ignore no-explicit-any
    return (Deno as any).cwd
      ? (globalThis as any).Deno?.build?.os === "windows"
        ? decodeURIComponent(
          (typeof url === "string" ? url : url.toString()).slice(8).replace(/\//g, "\\"),
        )
        : decodeURIComponent((typeof url === "string" ? url : url.toString()).slice(7))
      : decodeURIComponent((typeof url === "string" ? url : url.toString()).slice(7));
  }

  // Generic fallback
  const urlString = typeof url === "string" ? url : url.toString();
  if (!urlString.startsWith("file://")) {
    throw new TypeError("Must be a file URL");
  }
  return decodeURIComponent(urlString.slice(7));
}

export function toFileUrl(path: string): URL {
  if (hasNodePath) {
    return new URL(`file://${path}`);
  }

  const absolute = isAbsolute(path) ? path : resolve(path);
  return new URL(`file://${absolute}`);
}
