import { isAbsolute, normalize } from "#veryfront/compat/path/resolution.ts";
import { base64urlEncode } from "./base64url.ts";
import { logger } from "./logger/logger.ts";

function stripTrailingSlash(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}

export function normalizePath(pathname: string): string {
  if (!pathname) return pathname;
  return stripTrailingSlash(normalize(pathname.replace(/\\+/g, "/")));
}

export function joinPath(a: string, b: string): string {
  const left = a.replace(/\/$/, "");
  const right = b.replace(/^\//, "");
  return `${left}/${right}`;
}

export function isWithinDirectory(root: string, target: string): boolean {
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

export { isAbsolute as isAbsolutePath };

export function toBase64Url(input: string): string {
  return base64urlEncode(input);
}

function getRequiredBase64Padding(length: number): string | undefined {
  const remainder = length % 4;
  if (remainder === 0) return "";
  if (remainder === 2) return "==";
  if (remainder === 3) return "=";
  return undefined;
}

export function fromBase64Url(encoded: string): string {
  const b64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padding = getRequiredBase64Padding(b64.length);

  if (padding === undefined) {
    logger.debug(`Failed to decode base64url string "${encoded}": invalid length`);
    return "";
  }

  try {
    return atob(b64 + padding);
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
 *    (after FSAdapter normalizes absolute paths like /Users/.../veryfront-server/src/...)
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
