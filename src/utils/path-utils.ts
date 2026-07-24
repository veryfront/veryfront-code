import { isAbsolute, normalize } from "#veryfront/compat/path/resolution.ts";
import { base64urlDecodeBytes, base64urlEncode } from "./base64url.ts";
import { logger } from "./logger/logger.ts";

function stripTrailingSlash(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}

/** Normalizes path. */
export function normalizePath(pathname: string): string {
  if (!pathname) return pathname;
  return stripTrailingSlash(normalize(pathname.replace(/\\+/g, "/")));
}

export function joinPath(a: string, b: string): string {
  const left = a.replace(/\/$/, "");
  const right = b.replace(/^\//, "");
  return `${left}/${right}`;
}

/**
 * Checks lexical containment after path normalization.
 *
 * This does not resolve symlinks. Callers authorizing access to an existing
 * filesystem object must compare adapter-provided real paths as well.
 */
export function isWithinDirectory(root: string, target: string): boolean {
  if (!root) return false;

  const normalizedRoot = stripTrailingSlash(normalizePath(root));
  const normalizedTarget = stripTrailingSlash(normalizePath(target));

  if (normalizedRoot === "/") return normalizedTarget.startsWith("/");
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

/**
 * Get file extension including the dot (e.g., ".ts", ".tsx").
 * Returns empty string if no extension found.
 */
export function getExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  const lastSeparator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (lastDot <= lastSeparator || lastDot === path.length - 1) return "";
  return path.slice(lastDot);
}

/**
 * Get file extension without the dot, lowercased (e.g., "ts", "tsx").
 * Returns empty string if no extension found.
 */
export function getExtensionName(path: string): string {
  const lastDot = path.lastIndexOf(".");
  const lastSeparator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (lastDot <= lastSeparator || lastDot === path.length - 1) return "";
  return path.slice(lastDot + 1).toLowerCase();
}

export function getDirectory(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return normalized.slice(0, lastSlash);
}

export function hasHashedFilename(path: string): boolean {
  const lastSeparator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return /\.[a-f0-9]{8,}\./.test(path.slice(lastSeparator + 1));
}

const EXTENSION_TO_LOADER: Record<string, "tsx" | "jsx" | "ts" | "js"> = {
  ".tsx": "tsx",
  ".jsx": "jsx",
  ".ts": "ts",
};

/**
 * Get esbuild loader type from file extension
 */
export function getEsbuildLoader(filePath: string): "tsx" | "jsx" | "ts" | "js" {
  const ext = getExtension(filePath).toLowerCase();
  return EXTENSION_TO_LOADER[ext] ?? "js";
}

export { isAbsolute as isAbsolutePath };

export function toBase64Url(input: string): string {
  return base64urlEncode(input);
}

export function fromBase64Url(encoded: string): string {
  const bytes = base64urlDecodeBytes(encoded);
  if (!bytes) return "";

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    logger.debug("Failed to decode base64url string as UTF-8", { error });
    return "";
  }
}

/**
 * Framework source directories that should never be fetched from the API.
 * These are framework-internal modules that must be resolved from local filesystem.
 */
const FRAMEWORK_SOURCE_DIRS = [
  "react",
  "platform",
  "client",
  "lib",
  "html",
  "utils",
  "transforms",
  "modules",
  "server",
  "config",
  "errors",
  "observability",
  "rendering",
  "security",
  "data",
  "cache",
  "build",
  "repositories",
  "cli",
] as const;

const FRAMEWORK_SOURCE_PATH_RE = new RegExp(
  `^src/(${FRAMEWORK_SOURCE_DIRS.join("|")})/`,
);

/**
 * Check if a normalized path is a framework path that should not be fetched from API.
 *
 * Framework paths can appear in two forms:
 * 1. "_veryfront/..." - original framework module path prefix
 * 2. "src/react/...", "src/platform/...", etc. - framework source paths
 *    (after FSAdapter normalizes absolute paths like /opt/veryfront/src/...)
 */
export function isFrameworkSourcePath(normalizedPath: string): boolean {
  // Check for _veryfront/ prefix (with or without embedded: prefix)
  if (
    normalizedPath.startsWith("_veryfront/") || normalizedPath.startsWith("embedded:_veryfront/")
  ) {
    return true;
  }
  return FRAMEWORK_SOURCE_PATH_RE.test(normalizedPath);
}
