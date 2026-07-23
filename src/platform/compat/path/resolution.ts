import {
  canonicalizeSeparators,
  getRuntimeCwd,
  normalizeCanonicalPath,
  parsePathRoot,
} from "./internals.ts";

/** Resolve path segments to an absolute path. */
export function resolve(...paths: string[]): string {
  let resolvedPath = getRuntimeCwd();

  for (const rawPath of paths) {
    if (!rawPath) continue;
    const path = canonicalizeSeparators(rawPath);
    if (parsePathRoot(path).absolute) {
      resolvedPath = path;
    } else {
      resolvedPath = `${resolvedPath}/${path}`;
    }
  }
  return normalizeCanonicalPath(resolvedPath);
}

export function isAbsolute(path: string): boolean {
  return parsePathRoot(path).absolute;
}

export function relative(from: string, to: string): string {
  const resolvedFrom = resolve(from);
  const resolvedTo = resolve(to);
  const fromRoot = parsePathRoot(resolvedFrom);
  const toRoot = parsePathRoot(resolvedTo);

  if (fromRoot.comparisonRoot !== toRoot.comparisonRoot) return resolvedTo;

  const fromParts = fromRoot.rest.split("/").filter(Boolean);
  const toParts = toRoot.rest.split("/").filter(Boolean);
  const caseInsensitive = fromRoot.windowsLike || toRoot.windowsLike;

  let common = 0;
  const minLen = Math.min(fromParts.length, toParts.length);

  for (let i = 0; i < minLen; i++) {
    const fromPart = caseInsensitive ? fromParts[i]?.toLowerCase() : fromParts[i];
    const toPart = caseInsensitive ? toParts[i]?.toLowerCase() : toParts[i];
    if (fromPart !== toPart) break;
    common++;
  }

  const ups = fromParts.length - common;
  const result = [...new Array(ups).fill(".."), ...toParts.slice(common)];

  return result.join("/") || ".";
}

export function normalize(path: string): string {
  return normalizeCanonicalPath(path);
}
