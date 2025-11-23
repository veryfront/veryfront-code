import { logger } from "./logger/logger.ts";

export function normalizePath(pathname: string): string {
  pathname = pathname.replace(/\\+/g, "/").replace(/\/\.+\//g, "/");

  if (pathname !== "/" && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  return pathname;
}

export function joinPath(a: string, b: string): string {
  return `${a.replace(/\/$/, "")}/${b.replace(/^\//, "")}`;
}

export function isWithinDirectory(root: string, target: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedTarget = normalizePath(target);
  return normalizedTarget.startsWith(`${normalizedRoot}/`) || normalizedTarget === normalizedRoot;
}

export function getExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) {
    return "";
  }
  return path.slice(lastDot);
}

export function getDirectory(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : normalized.slice(0, lastSlash);
}

export function hasHashedFilename(path: string): boolean {
  return /\.[a-f0-9]{8,}\./.test(path);
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export function toBase64Url(s: string): string {
  const b64 = btoa(s);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64Url(encoded: string): string {
  const b64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const pad = b64.length % 4 === 2 ? "==" : b64.length % 4 === 3 ? "=" : "";
  try {
    return atob(b64 + pad);
  } catch (error) {
    logger.debug(`Failed to decode base64url string "${encoded}":`, error);
    return "";
  }
}
