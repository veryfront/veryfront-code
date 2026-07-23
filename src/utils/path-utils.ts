import { extname } from "#veryfront/compat/path/basic-operations.ts";
import { isAbsolute, normalize } from "#veryfront/compat/path/resolution.ts";
import { base64urlEncode } from "./base64url.ts";
import { logger } from "./logger/logger.ts";

function stripTrailingSlash(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}

/** Normalizes path. */
export function normalizePath(pathname: string): string {
  if (!pathname) return pathname;
  return stripTrailingSlash(normalize(pathname.replace(/\\/g, "/")));
}

export function joinPath(a: string, b: string): string {
  const left = a.replace(/\/$/, "");
  const right = b.replace(/^\//, "");
  return `${left}/${right}`;
}

export function isWithinDirectory(root: string, target: string): boolean {
  let normalizedRoot = stripTrailingSlash(normalizePath(root));
  let normalizedTarget = stripTrailingSlash(normalizePath(target));

  if (normalizedRoot === "") return false;

  const rootIsWindowsLike = /^[A-Za-z]:\//.test(normalizedRoot) ||
    normalizedRoot.startsWith("//");
  const targetIsWindowsLike = /^[A-Za-z]:\//.test(normalizedTarget) ||
    normalizedTarget.startsWith("//");
  if (rootIsWindowsLike && targetIsWindowsLike) {
    normalizedRoot = normalizedRoot.toLowerCase();
    normalizedTarget = normalizedTarget.toLowerCase();
  }

  if (normalizedRoot === "/") return normalizedTarget.startsWith("/");
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

/**
 * Get file extension including the dot (e.g., ".ts", ".tsx").
 * Returns empty string if no extension found.
 */
export function getExtension(path: string): string {
  const extension = extname(path);
  return extension === "." ? "" : extension;
}

/**
 * Get file extension without the dot, lowercased (e.g., "ts", "tsx").
 * Returns empty string if no extension found.
 */
export function getExtensionName(path: string): string {
  return getExtension(path).slice(1).toLowerCase();
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
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) {
    logger.debug("Failed to decode base64url string", {
      encodedLength: encoded.length,
      reason: "invalid-characters",
    });
    return "";
  }

  const b64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padding = getRequiredBase64Padding(b64.length);

  if (padding === undefined) {
    logger.debug("Failed to decode base64url string", {
      encodedLength: encoded.length,
      reason: "invalid-length",
    });
    return "";
  }

  try {
    const binary = atob(b64 + padding);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // Preserve compatibility with paths emitted by older releases, which
      // encoded JavaScript strings as Latin-1 instead of UTF-8.
      return binary;
    }
  } catch (error) {
    logger.debug("Failed to decode base64url string", {
      encodedLength: encoded.length,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return "";
  }
}

/**
 * Check if a normalized path is a framework path that should not be fetched from API.
 *
 * Framework paths use the explicit `_veryfront/` namespace. A relative
 * `src/<name>/...` path is always ambiguous because user projects can use the
 * same directory names as framework modules, so it must remain a project path.
 */
export function isFrameworkSourcePath(normalizedPath: string): boolean {
  return normalizedPath.startsWith("_veryfront/") ||
    normalizedPath.startsWith("embedded:_veryfront/");
}
