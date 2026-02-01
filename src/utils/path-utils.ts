import { logger } from "./logger/logger.ts";

export function normalizePath(pathname: string): string {
  let normalized = pathname.replace(/\\+/g, "/").replace(/\/\.+\//g, "/");

  if (normalized !== "/" && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function joinPath(a: string, b: string): string {
  const left = a.replace(/\/$/, "");
  const right = b.replace(/^\//, "");
  return `${left}/${right}`;
}

export function isWithinDirectory(root: string, target: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedTarget = normalizePath(target);

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

/**
 * Get file extension including the dot (e.g., ".ts", ".tsx").
 * Returns empty string if no extension found.
 */
export function getExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) return "";
  return path.slice(lastDot);
}

/**
 * Get file extension without the dot, lowercased (e.g., "ts", "tsx").
 * Returns empty string if no extension found.
 */
export function getExtensionName(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) return "";
  return path.slice(lastDot + 1).toLowerCase();
}

export function getDirectory(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return normalized.slice(0, lastSlash);
}

export function hasHashedFilename(path: string): boolean {
  return /\.[a-f0-9]{8,}\./.test(path);
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

export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export function toBase64Url(s: string): string {
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function getBase64Padding(length: number): string {
  if (length % 4 === 2) return "==";
  if (length % 4 === 3) return "=";
  return "";
}

export function fromBase64Url(encoded: string): string {
  const b64 = encoded.replaceAll("-", "+").replaceAll("_", "/");

  try {
    return atob(b64 + getBase64Padding(b64.length));
  } catch (error) {
    logger.debug(`Failed to decode base64url string "${encoded}":`, error);
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
 *    (after FSAdapter normalizes absolute paths like /Users/.../veryfront-renderer/src/...)
 */
export function isFrameworkSourcePath(normalizedPath: string): boolean {
  if (normalizedPath.startsWith("_veryfront/")) {
    return true;
  }
  return FRAMEWORK_SOURCE_PATH_RE.test(normalizedPath);
}
