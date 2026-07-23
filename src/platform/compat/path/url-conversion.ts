import { isAbsolute, resolve } from "./resolution.ts";
import { canonicalizeSeparators, normalizeCanonicalPath } from "./internals.ts";

export function fromFileUrl(url: string | URL): string {
  const parsed = url instanceof URL ? url : new URL(url);
  if (parsed.protocol !== "file:") {
    throw new TypeError("Must be a file URL");
  }
  if (/%2f|%5c/i.test(parsed.pathname)) {
    throw new TypeError("File URL path must not contain encoded separators");
  }

  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    throw new TypeError("File URL path contains invalid percent encoding");
  }

  if (parsed.hostname && parsed.hostname !== "localhost") {
    return normalizeCanonicalPath(`//${parsed.hostname}${path}`);
  }
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  return canonicalizeSeparators(path);
}

export function toFileUrl(path: string): URL {
  const absolute = normalizeCanonicalPath(isAbsolute(path) ? path : resolve(path));
  const encodedPath = absolute.replace(/%/g, "%25");

  if (encodedPath.startsWith("//")) {
    const [hostname, ...segments] = encodedPath.slice(2).split("/");
    const result = new URL("file:///");
    result.hostname = hostname ?? "";
    result.pathname = `/${segments.join("/")}`;
    return result;
  }

  const result = new URL("file:///");
  result.pathname = /^[A-Za-z]:\//.test(encodedPath) ? `/${encodedPath}` : encodedPath;
  return result;
}
