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
  } catch (_) {
    /* expected: node:url require may fail in non-Node runtimes */
    return null;
  }
}

export function fromFileUrl(url: string | URL): string {
  const parsedUrl = typeof url === "string" ? new URL(url) : url;
  if (parsedUrl.protocol !== "file:") {
    throw new TypeError("Must be a file URL");
  }

  const fileURLToPath = getFileURLToPath();
  if (fileURLToPath) return fileURLToPath(parsedUrl);

  if (isDeno) {
    const g = globalThis as GlobalWithRequire;
    const hasCwd = Boolean(g.Deno?.cwd);
    const isWindows = g.Deno?.build?.os === "windows";

    if (hasCwd && isWindows) {
      return decodeURIComponent(parsedUrl.pathname)
        .replace(/^\/([A-Za-z]:)/, "$1")
        .replace(/\//g, "\\");
    }

    return decodeURIComponent(parsedUrl.pathname);
  }

  return decodeURIComponent(parsedUrl.pathname);
}

export function toFileUrl(path: string): URL {
  const absolute = hasNodePath ? path : isAbsolute(path) ? path : resolve(path);
  // Preserve filesystem characters that URL parsing would otherwise decode or
  // interpret as fragment/query delimiters.
  const encodedPath = absolute
    .replaceAll("%", "%25")
    .replaceAll("#", "%23")
    .replaceAll("?", "%3F");
  return new URL(`file://${encodedPath}`);
}
