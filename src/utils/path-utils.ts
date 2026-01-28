import { logger } from "./logger/logger.ts";

export function normalizePath(pathname: string): string {
  let normalized = pathname.replace(/\\+/g, "/").replace(/\/\.+\//g, "/");

  if (normalized !== "/" && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function joinPath(a: string, b: string): string {
  return `${a.replace(/\/$/, "")}/${b.replace(/^\//, "")}`;
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
  switch (length % 4) {
    case 2:
      return "==";
    case 3:
      return "=";
    default:
      return "";
  }
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
