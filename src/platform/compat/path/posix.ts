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

  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment !== "..") {
      segments.push(segment);
      continue;
    }

    const previous = segments.at(-1);
    if (previous !== undefined && previous !== "..") {
      segments.pop();
    } else if (allowAboveRoot) {
      segments.push("..");
    }
  }

  return segments.join("/");
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

  const absolute = path.startsWith("/");
  const trailingSeparator = path.endsWith("/");
  let normalized = normalizeSegments(path, !absolute);

  if (normalized.length > 0 && trailingSeparator) normalized += "/";
  if (absolute) return normalized.length > 0 ? `/${normalized}` : "/";
  if (normalized.length > 0) return normalized;
  return trailingSeparator ? "./" : ".";
}

function join(...paths: string[]): string {
  let joined = "";
  for (const path of paths) {
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
    absolute = path.startsWith("/");
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

  const fromSegments = resolvedFrom.split("/").filter(Boolean);
  const toSegments = resolvedTo.split("/").filter(Boolean);
  let common = 0;
  while (
    common < fromSegments.length &&
    common < toSegments.length &&
    fromSegments[common] === toSegments[common]
  ) {
    common++;
  }

  return [
    ...Array.from({ length: fromSegments.length - common }, () => ".."),
    ...toSegments.slice(common),
  ].join("/");
}

function dirname(path: string): string {
  assertPath(path);
  if (path.length === 0) return ".";

  const hasRoot = path.startsWith("/");
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
  return path.slice(0, end);
}

function basename(path: string, suffix?: string): string {
  assertPath(path);
  if (suffix !== undefined) assertPath(suffix);

  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end--;
  if (end === 0) return "";

  const start = path.lastIndexOf("/", end - 1) + 1;
  const base = path.slice(start, end);
  if (suffix && suffix.length <= base.length && base.endsWith(suffix)) {
    return base.slice(0, -suffix.length);
  }
  return base;
}

function extname(path: string): string {
  const base = basename(path);
  if (base === "." || base === "..") return "";
  const lastDot = base.lastIndexOf(".");
  return lastDot <= 0 ? "" : base.slice(lastDot);
}

function isAbsolute(path: string): boolean {
  assertPath(path);
  return path.startsWith("/");
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
