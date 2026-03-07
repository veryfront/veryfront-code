import { hasNodePath, isDeno } from "./runtime.ts";
import { isAbsolute, resolve } from "./resolution.ts";

type GlobalWithRequire = typeof globalThis & {
  require?: (specifier: string) => { fileURLToPath?: (url: string | URL) => string };
  Deno?: { cwd?: () => string; build?: { os?: string } };
};

let _fileURLToPath: ((url: string | URL) => string) | null = null;

function getFileURLToPath(): ((url: string | URL) => string) | null {
  if (_fileURLToPath) return _fileURLToPath;
  if (!hasNodePath) return null;

  try {
    const nodeUrl = (globalThis as GlobalWithRequire).require?.("node:url");
    const fileURLToPath = nodeUrl?.fileURLToPath;

    if (!fileURLToPath) return null;

    _fileURLToPath = fileURLToPath;
    return _fileURLToPath;
  } catch {
    return null;
  }
}

export function fromFileUrl(url: string | URL): string {
  const fileURLToPath = getFileURLToPath();
  if (fileURLToPath) return fileURLToPath(url);

  const urlString = typeof url === "string" ? url : url.toString();

  if (isDeno) {
    const g = globalThis as GlobalWithRequire;
    const hasCwd = Boolean(g.Deno?.cwd);
    const isWindows = g.Deno?.build?.os === "windows";

    if (hasCwd && isWindows) {
      return decodeURIComponent(urlString.slice(8).replace(/\//g, "\\"));
    }

    return decodeURIComponent(urlString.slice(7));
  }

  if (!urlString.startsWith("file://")) {
    throw new TypeError("Must be a file URL");
  }

  return decodeURIComponent(urlString.slice(7));
}

export function toFileUrl(path: string): URL {
  const absolute = hasNodePath ? path : isAbsolute(path) ? path : resolve(path);
  return new URL(`file://${absolute}`);
}
