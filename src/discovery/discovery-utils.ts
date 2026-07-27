/**
 * Discovery Utilities
 *
 * Helper functions for ID generation and path manipulation.
 */

import { fromFileUrl } from "#veryfront/compat/path";

/**
 * Convert a file path to a camelCase ID
 */
export function filenameToId(filePath: string): string {
  const filename = normalizeDiscoveryPath(filePath)
    .split("/")
    .pop()
    ?.replace(/\.(ts|tsx|js|jsx)$/, "") ?? "";
  return discoveryPathSegmentToId(filename);
}

function discoveryPathSegmentToId(segment: string): string {
  return segment
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

/** Return a safe discovery path relative to its configured root. */
export function getRelativeDiscoveryPath(filePath: string, baseDir: string): string {
  const cleanPath = normalizeDiscoveryPath(filePath);
  const normalizedBaseDir = normalizeDiscoveryPath(baseDir).replace(/\/+$/, "");
  const relativePath = cleanPath.startsWith(`${normalizedBaseDir}/`)
    ? cleanPath.slice(normalizedBaseDir.length + 1)
    : undefined;

  if (relativePath === undefined) {
    throw new Error(
      `Discovery file "${filePath}" is outside discovery directory "${baseDir}"`,
    );
  }

  assertSafeRelativeDiscoveryPath(relativePath, filePath);
  return relativePath;
}

/**
 * Convert a discovery file path to a stable ID relative to its configured root.
 *
 * Nested path segments are retained to prevent same-basename files from
 * colliding. Directory index modules use their directory as the ID, while a
 * root index module remains `index`.
 */
export function filePathToId(filePath: string, baseDir: string): string {
  const segments = getRelativeDiscoveryPath(filePath, baseDir)
    .replace(/\.(ts|tsx|js|jsx)$/, "")
    .split("/");

  if (segments.length > 1 && segments.at(-1) === "index") {
    segments.pop();
  }

  return segments.map(discoveryPathSegmentToId).join("/");
}

/**
 * Convert a file path to a URL-style pattern for resources
 */
export function filePathToPattern(filePath: string, baseDir: string): string {
  const cleanPath = normalizeDiscoveryPath(filePath);
  const normalizedBaseDir = normalizeDiscoveryPath(baseDir).replace(/\/+$/, "");
  const relativePath = cleanPath === normalizedBaseDir
    ? ""
    : cleanPath.startsWith(`${normalizedBaseDir}/`)
    ? cleanPath.slice(normalizedBaseDir.length + 1)
    : undefined;

  if (relativePath === undefined) {
    throw new Error(
      `Discovery file "${filePath}" is outside resource directory "${baseDir}"`,
    );
  }

  assertSafeRelativeDiscoveryPath(relativePath, filePath);

  const pattern = relativePath
    .replace(/\.(ts|tsx|js|jsx)$/, "")
    .replace(/\[(\w+)\]/g, ":$1");

  const encodedPattern = pattern
    .split("/")
    .map((segment) => segment.startsWith(":") ? segment : encodeURIComponent(segment))
    .join("/");
  return `/${encodedPattern}`;
}

function assertSafeRelativeDiscoveryPath(relativePath: string, sourcePath: string): void {
  const unsafeSegment = relativePath
    .split("/")
    .find((segment) => segment === "." || segment === ".." || segment.includes("\0"));
  if (unsafeSegment !== undefined) {
    throw new Error(
      `Discovery path contains an unsafe path segment: "${sourcePath}"`,
    );
  }
}

/**
 * Normalize native paths, standard file URLs, and adapter virtual file URLs
 * to the slash-separated form used by discovery boundary checks.
 *
 * @internal
 */
export function normalizeDiscoveryPath(value: string): string {
  let normalized = value;
  if (value.startsWith("file:///")) {
    try {
      normalized = fromFileUrl(value);
    } catch {
      throw new Error("Discovery file URL is invalid");
    }
  } else if (value.startsWith("file://")) {
    // Hosted adapters historically use `file://relative/path.ts` as a virtual
    // file specifier. It is not a standards-compliant file URL (the first
    // segment would be interpreted as a host), so decode only this explicit
    // adapter form. Raw filesystem paths are never decoded: a directory named
    // `%20` must remain distinct from one containing a space.
    try {
      normalized = decodeURIComponent(value.slice("file://".length));
    } catch {
      throw new Error("Discovery virtual file URL is invalid");
    }
  }
  normalized = normalized.replaceAll("\\", "/");
  // A Windows file URL is written as file:///C:/..., while a native Windows
  // path starts C:/.... Normalize both to the latter for safe prefix checks.
  return normalized.replace(/^\/([A-Za-z]:\/)/, "$1");
}
