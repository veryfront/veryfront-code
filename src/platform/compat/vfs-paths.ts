/**
 * Framework-root resolution for source trees and compiled Deno VFS paths.
 *
 * Compiled binaries expose included files below a `deno-compile-*` directory.
 * Development and package builds retain a `src` path segment. These helpers
 * return the root before that marker using portable forward slashes.
 */

function restoreRoot(normalizedPath: string, parts: string[], end: number): string {
  const prefix = parts.slice(0, end).join("/");
  if (prefix === "" && normalizedPath.startsWith("/")) return "/";
  if (/^[A-Za-z]:$/.test(prefix)) return `${prefix}/`;
  return prefix;
}

/** Resolve the framework root from a portable or platform-native file path. */
export function getFrameworkRoot(filePath: string): string {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0")) return "";

  const normalizedPath = filePath.replaceAll("\\", "/");
  const parts = normalizedPath.split("/");
  const compiledRootIndex = parts.findIndex((part) => /^deno-compile-[^/]+$/.test(part));
  if (compiledRootIndex >= 0) {
    return restoreRoot(normalizedPath, parts, compiledRootIndex + 1);
  }

  const sourceIndex = parts.lastIndexOf("src");
  if (sourceIndex >= 0) return restoreRoot(normalizedPath, parts, sourceIndex);
  return "";
}

function pathFromFileUrl(importMetaUrl: string): string {
  const url = new URL(importMetaUrl);
  if (url.protocol !== "file:") {
    throw new TypeError("Framework module location must be a file URL");
  }
  if (/%(?:2f|5c)/i.test(url.pathname)) {
    throw new TypeError("Framework module file URL contains an encoded path separator");
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new TypeError("Framework module file URL is invalid");
  }
  if (pathname.includes("\0")) {
    throw new TypeError("Framework module file URL is invalid");
  }

  if (url.hostname && url.hostname !== "localhost") {
    return `//${url.hostname}${pathname}`;
  }
  if (/^\/[A-Za-z]:\//.test(pathname)) return pathname.slice(1);
  return pathname;
}

/** Resolve the framework root from an `import.meta.url` file URL. */
export function getFrameworkRootFromMeta(importMetaUrl: string): string {
  const root = getFrameworkRoot(pathFromFileUrl(importMetaUrl));
  if (!root) throw new Error("Framework root could not be resolved from the module location");
  return root;
}

/** Compatibility alias retained for existing tests and internal consumers. */
export function testGetFrameworkRoot(filePath: string): string {
  return getFrameworkRoot(filePath);
}
