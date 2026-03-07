import { hasNodePath, isDeno, nodePath } from "./runtime.ts";

function hasWindowsLikePath(path: string): boolean {
  return path.includes("\\") || /^[A-Za-z]:/.test(path) || path.startsWith("\\\\");
}

function useNodePath(paths: string[]): boolean {
  return !isDeno && hasNodePath && !paths.some(hasWindowsLikePath);
}

/** Normalize backslashes to forward slashes (for Deno on Windows). */
function normSep(p: string): string {
  return p.includes("\\") ? p.replace(/\\/g, "/") : p;
}

export function join(...paths: string[]): string {
  const joined = paths
    .map(normSep)
    .filter((p) => p.length > 0)
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

  return joined || "/";
}

export function dirname(path: string): string {
  if (useNodePath([path])) return nodePath!.dirname(path);

  const p = normSep(path);
  const lastSlash = p.lastIndexOf("/");
  if (lastSlash === -1) return ".";
  if (lastSlash === 0) return "/";
  return p.slice(0, lastSlash);
}

export function basename(path: string, ext?: string): string {
  if (useNodePath([path])) {
    // Only pass ext if defined - Bun is strict about this parameter
    return ext === undefined ? nodePath!.basename(path) : nodePath!.basename(path, ext);
  }

  let normalizedPath = normSep(path);
  while (normalizedPath.length > 1 && normalizedPath.endsWith("/")) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  const lastSlash = normalizedPath.lastIndexOf("/");
  let base = lastSlash === -1 ? normalizedPath : normalizedPath.slice(lastSlash + 1);

  if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length);

  return base;
}

export function extname(path: string): string {
  if (useNodePath([path])) return nodePath!.extname(path);

  const base = basename(path);
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return base.slice(lastDot);
}
