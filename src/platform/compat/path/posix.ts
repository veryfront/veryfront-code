import {
  primordialArrayJoin as arrayJoin,
  primordialArrayPop as arrayPop,
  primordialArrayPush as arrayPush,
} from "../primordials/array.ts";

const apply = Reflect.apply;
const stringEndsWith = String.prototype.endsWith;
const stringLastIndexOf = String.prototype.lastIndexOf;
const stringSlice = String.prototype.slice;
const stringSplit = String.prototype.split;
const stringStartsWith = String.prototype.startsWith;

function endsWith(value: string, search: string): boolean {
  return apply(stringEndsWith, value, [search]) as boolean;
}

function lastIndexOf(value: string, search: string): number {
  return apply(stringLastIndexOf, value, [search]) as number;
}

function slice(value: string, start: number, end?: number): string {
  return apply(stringSlice, value, end === undefined ? [start] : [start, end]) as string;
}

function split(value: string, separator: string): string[] {
  return apply(stringSplit, value, [separator]) as string[];
}

function startsWith(value: string, search: string): boolean {
  return apply(stringStartsWith, value, [search]) as boolean;
}

/** Dependency-free POSIX path operations for every supported runtime. */
export interface PosixPath {
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
  normalize(path: string): string;
  relative(from: string, to: string): string;
  dirname(path: string): string;
  basename(path: string, suffix?: string): string;
  extname(path: string): string;
  isAbsolute(path: string): boolean;
  readonly sep: "/";
  readonly delimiter: ":";
}

function assertPath(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new TypeError(`Path must be a string. Received ${typeof value}`);
  }
}

function normalizeSegments(path: string, allowAboveRoot: boolean): string {
  const segments: string[] = [];
  const pathSegments = split(path, "/");

  for (let index = 0; index < pathSegments.length; index++) {
    const segment = pathSegments[index]!;
    if (segment.length === 0 || segment === ".") continue;
    if (segment !== "..") {
      arrayPush(segments, segment);
      continue;
    }

    const previous = segments[segments.length - 1];
    if (previous !== undefined && previous !== "..") {
      arrayPop(segments);
    } else if (allowAboveRoot) {
      arrayPush(segments, "..");
    }
  }

  return arrayJoin(segments, "/");
}

function runtimeWorkingDirectory(): string {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { cwd?: () => string };
    process?: { cwd?: () => string };
  };

  if (typeof runtime.Deno?.cwd === "function") {
    const directory = runtime.Deno.cwd();
    assertPath(directory);
    return directory;
  }
  if (typeof runtime.process?.cwd === "function") {
    const directory = runtime.process.cwd();
    assertPath(directory);
    return directory;
  }

  // Browser and worker runtimes resolve relative virtual paths from their root.
  return "/";
}

function normalize(path: string): string {
  assertPath(path);
  if (path.length === 0) return ".";

  const absolute = startsWith(path, "/");
  const trailingSeparator = endsWith(path, "/");
  let normalized = normalizeSegments(path, !absolute);

  if (normalized.length > 0 && trailingSeparator) normalized += "/";
  if (absolute) return normalized.length > 0 ? `/${normalized}` : "/";
  if (normalized.length > 0) return normalized;
  return trailingSeparator ? "./" : ".";
}

function join(...paths: string[]): string {
  let joined = "";
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index]!;
    assertPath(path);
    if (path.length === 0) continue;
    joined = joined.length === 0 ? path : `${joined}/${path}`;
  }
  return joined.length === 0 ? "." : normalize(joined);
}

function resolve(...paths: string[]): string {
  let resolved = "";
  let absolute = false;

  for (let index = paths.length - 1; index >= -1 && !absolute; index--) {
    const path = index >= 0 ? paths[index] : runtimeWorkingDirectory();
    assertPath(path);
    if (path.length === 0) continue;

    resolved = `${path}/${resolved}`;
    absolute = startsWith(path, "/");
  }

  const normalized = normalizeSegments(resolved, !absolute);
  if (absolute) return normalized.length > 0 ? `/${normalized}` : "/";
  return normalized.length > 0 ? normalized : ".";
}

function relative(from: string, to: string): string {
  assertPath(from);
  assertPath(to);

  const resolvedFrom = resolve(from);
  const resolvedTo = resolve(to);
  if (resolvedFrom === resolvedTo) return "";

  const rawFromSegments = split(resolvedFrom, "/");
  const rawToSegments = split(resolvedTo, "/");
  const fromSegments: string[] = [];
  const toSegments: string[] = [];
  for (let index = 0; index < rawFromSegments.length; index++) {
    const segment = rawFromSegments[index]!;
    if (segment.length > 0) arrayPush(fromSegments, segment);
  }
  for (let index = 0; index < rawToSegments.length; index++) {
    const segment = rawToSegments[index]!;
    if (segment.length > 0) arrayPush(toSegments, segment);
  }
  let common = 0;
  while (
    common < fromSegments.length &&
    common < toSegments.length &&
    fromSegments[common] === toSegments[common]
  ) {
    common++;
  }

  const result: string[] = [];
  for (let index = common; index < fromSegments.length; index++) {
    arrayPush(result, "..");
  }
  for (let index = common; index < toSegments.length; index++) {
    arrayPush(result, toSegments[index]!);
  }
  return arrayJoin(result, "/");
}

function dirname(path: string): string {
  assertPath(path);
  if (path.length === 0) return ".";

  const hasRoot = startsWith(path, "/");
  let end = -1;
  let matchedSeparator = true;
  for (let index = path.length - 1; index >= 1; index--) {
    if (path[index] === "/") {
      if (!matchedSeparator) {
        end = index;
        break;
      }
    } else {
      matchedSeparator = false;
    }
  }

  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  return slice(path, 0, end);
}

function basename(path: string, suffix?: string): string {
  assertPath(path);
  if (suffix !== undefined) assertPath(suffix);

  let start = 0;
  let end = -1;
  let matchedSeparator = true;

  if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
    if (suffix === path) return "";

    let suffixIndex = suffix.length - 1;
    let firstNonSeparatorEnd = -1;
    for (let index = path.length - 1; index >= 0; index--) {
      const character = path[index];
      if (character === "/") {
        if (!matchedSeparator) {
          start = index + 1;
          break;
        }
        continue;
      }

      if (firstNonSeparatorEnd === -1) {
        matchedSeparator = false;
        firstNonSeparatorEnd = index + 1;
      }
      if (suffixIndex < 0) continue;

      if (character === suffix[suffixIndex]) {
        suffixIndex--;
        if (suffixIndex === -1) end = index;
      } else {
        suffixIndex = -1;
        end = firstNonSeparatorEnd;
      }
    }

    if (start === end) end = firstNonSeparatorEnd;
    else if (end === -1) end = path.length;
    return slice(path, start, end);
  }

  for (let index = path.length - 1; index >= 0; index--) {
    if (path[index] === "/") {
      if (!matchedSeparator) {
        start = index + 1;
        break;
      }
    } else if (end === -1) {
      matchedSeparator = false;
      end = index + 1;
    }
  }

  return end === -1 ? "" : slice(path, start, end);
}

function extname(path: string): string {
  const base = basename(path);
  if (base === "." || base === "..") return "";
  const lastDot = lastIndexOf(base, ".");
  return lastDot <= 0 ? "" : slice(base, lastDot);
}

function isAbsolute(path: string): boolean {
  assertPath(path);
  return startsWith(path, "/");
}

export const posix: Readonly<PosixPath> = Object.freeze({
  join,
  resolve,
  normalize,
  relative,
  dirname,
  basename,
  extname,
  isAbsolute,
  sep: "/",
  delimiter: ":",
});
