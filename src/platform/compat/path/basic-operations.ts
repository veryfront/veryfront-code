import { canonicalizeSeparators, normalizeCanonicalPath, parsePathRoot } from "./internals.ts";

/** Join path segments. */
export function join(...paths: string[]): string {
  const joined = paths.map(canonicalizeSeparators).filter(Boolean).join("/");
  return normalizeCanonicalPath(joined);
}

/** Return the parent directory path. */
export function dirname(path: string): string {
  let normalized = canonicalizeSeparators(path);
  const root = parsePathRoot(normalized);

  while (normalized.length > root.root.length && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  if (normalized === root.root) return root.root || ".";

  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return root.root || ".";
  if (lastSlash < root.root.length) return root.root || ".";
  return normalized.slice(0, lastSlash) || "/";
}

/** Return the last path segment. */
export function basename(path: string, ext?: string): string {
  let normalizedPath = canonicalizeSeparators(path);
  const root = parsePathRoot(normalizedPath);
  while (normalizedPath.length > root.root.length && normalizedPath.endsWith("/")) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  if (normalizedPath === root.root) return "";
  const lastSlash = normalizedPath.lastIndexOf("/");
  let base = lastSlash === -1
    ? normalizedPath.slice(root.root.length)
    : normalizedPath.slice(lastSlash + 1);

  if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length);

  return base;
}

/** Return the file extension for a path. */
export function extname(path: string): string {
  const base = basename(path);
  if (base === "." || base === "..") return "";
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return base.slice(lastDot);
}
