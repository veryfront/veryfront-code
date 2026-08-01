import { posix } from "./posix.ts";
import { resolve } from "./resolution.ts";
import { runtimeUsesWindowsPaths } from "./portable.ts";

function decodeFilePath(pathname: string, windows: boolean): string {
  if (/%2f/i.test(pathname) || (windows && /%5c/i.test(pathname))) {
    throw new TypeError("File URL path must not include encoded path separators");
  }
  return decodeURIComponent(pathname);
}

function encodePath(path: string): string {
  // Match filesystem URL encoding: protect characters that URL parsing would
  // interpret structurally while leaving valid path characters such as a
  // drive-like colon untouched when it appears inside a POSIX path segment.
  return path
    .replaceAll("%", "%25")
    .replaceAll("\\", "%5C")
    .replaceAll("#", "%23")
    .replaceAll("?", "%3F");
}

function parseUncPath(path: string): { host: string; pathname: string } | null {
  if (!runtimeUsesWindowsPaths() && !path.startsWith("\\\\")) return null;
  const portable = path.replaceAll("\\", "/");
  const match = portable.match(/^\/\/([^/]+)(\/.*)$/);
  if (!match?.[1] || !match[2]) return null;
  return { host: match[1], pathname: match[2] };
}

export function fromFileUrl(url: string | URL): string {
  const parsedUrl = typeof url === "string" ? new URL(url) : url;
  if (parsedUrl.protocol !== "file:") {
    throw new TypeError("Must be a file URL");
  }

  const windows = runtimeUsesWindowsPaths();
  const pathname = decodeFilePath(parsedUrl.pathname, windows);
  const host = parsedUrl.hostname;

  if (host && host !== "localhost") {
    return windows ? `\\\\${host}${pathname.replaceAll("/", "\\")}` : `//${host}${pathname}`;
  }

  if (!windows) return pathname;
  return pathname
    .replace(/^\/([A-Za-z]:)/, "$1")
    .replaceAll("/", "\\");
}

export function toFileUrl(path: string): URL {
  if (typeof path !== "string") {
    throw new TypeError(`Path must be a string. Received ${typeof path}`);
  }

  const unc = parseUncPath(path);
  if (unc) {
    return new URL(`file://${unc.host}${encodePath(unc.pathname)}`);
  }

  const portable = path.replaceAll("\\", "/");
  const drive = portable.match(/^([A-Za-z]:)(\/.*)?$/);
  if (drive?.[1]) {
    const pathname = drive[2] ?? "/";
    return new URL(`file:///${drive[1]}${encodePath(pathname)}`);
  }

  const absolute = runtimeUsesWindowsPaths() ? resolve(path) : posix.resolve(path);
  return new URL(`file://${encodePath(absolute)}`);
}
