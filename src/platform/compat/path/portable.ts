import type { PathObject } from "./types.ts";
import {
  primordialArrayAt as arrayAt,
  primordialArrayFilter as arrayFilter,
  primordialArrayJoin as arrayJoin,
  primordialArrayPop as arrayPop,
  primordialArrayPush as arrayPush,
} from "../primordials/array.ts";

const apply = Reflect.apply;
const arraySlice = Array.prototype.slice;
const regExpExec = RegExp.prototype.exec;
const stringEndsWith = String.prototype.endsWith;
const stringIncludes = String.prototype.includes;
const stringLastIndexOf = String.prototype.lastIndexOf;
const stringReplaceAll = String.prototype.replaceAll;
const stringSlice = String.prototype.slice;
const stringSplit = String.prototype.split;
const stringStartsWith = String.prototype.startsWith;
const stringToLowerCase = String.prototype.toLowerCase;

function includes(value: string, search: string): boolean {
  return apply(stringIncludes, value, [search]) as boolean;
}

function startsWith(value: string, search: string): boolean {
  return apply(stringStartsWith, value, [search]) as boolean;
}

function endsWith(value: string, search: string): boolean {
  return apply(stringEndsWith, value, [search]) as boolean;
}

function slice(value: string, start: number, end?: number): string {
  return apply(stringSlice, value, end === undefined ? [start] : [start, end]) as string;
}

function lastIndexOf(value: string, search: string): number {
  return apply(stringLastIndexOf, value, [search]) as number;
}

function matches(pattern: RegExp, value: string): RegExpExecArray | null {
  return apply(regExpExec, pattern, [value]) as RegExpExecArray | null;
}

interface RootInfo {
  absolute: boolean;
  device: string;
  rest: string;
  root: string;
}

export function hasWindowsLikePath(path: string): boolean {
  return includes(path, "\\") || matches(/^[A-Za-z]:/, path) !== null;
}

export function toPortableSeparators(path: string): string {
  return apply(stringReplaceAll, path, ["\\", "/"]) as string;
}

function analyzeRoot(path: string, windows: boolean): RootInfo {
  const portable = toPortableSeparators(path);

  if (windows) {
    const unc = matches(
      /^\/\/([^/]+)\/+([^/]+)(\/+(.*))?$/,
      portable,
    );
    if (unc?.[1] && unc[2]) {
      const device = `//${unc[1]}/${unc[2]}`;
      return {
        absolute: true,
        device,
        rest: unc[4] ?? "",
        root: unc[3] === undefined ? device : `${device}/`,
      };
    }

    const drive = matches(/^([A-Za-z]:)(\/+)?(.*)$/, portable);
    if (drive?.[1] !== undefined) {
      const absolute = drive[2] !== undefined;
      return {
        absolute,
        device: drive[1],
        rest: drive[3] ?? "",
        root: absolute ? `${drive[1]}/` : drive[1],
      };
    }
  }

  if (startsWith(portable, "/")) {
    let restStart = 0;
    while (portable[restStart] === "/") restStart++;
    return {
      absolute: true,
      device: "",
      rest: slice(portable, restStart),
      root: "/",
    };
  }

  return {
    absolute: false,
    device: "",
    rest: portable,
    root: "",
  };
}

function appendRoot(root: RootInfo, tail: string): string {
  if (root.root === "") return tail || ".";
  if (!root.absolute) return `${root.root}${tail || "."}`;
  if (!tail) {
    return startsWith(root.device, "//") ? `${root.device}/` : root.root;
  }
  return endsWith(root.root, "/") ? `${root.root}${tail}` : `${root.root}/${tail}`;
}

function normalizeTail(rest: string, absolute: boolean): string[] {
  const normalized: string[] = [];
  const segments = apply(stringSplit, rest, ["/"]) as string[];

  // Path normalization is reached by shared-runtime coordination after tenant
  // code has loaded. Avoid the live Array iterator so post-import prototype
  // mutation cannot turn canonical lockfile lookup into a process-wide outage.
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    if (segment === "" || segment === ".") continue;

    if (segment !== "..") {
      arrayPush(normalized, segment);
      continue;
    }

    const previous = arrayAt(normalized, -1);
    if (previous !== undefined && previous !== "..") {
      arrayPop(normalized);
    } else if (!absolute) {
      arrayPush(normalized, "..");
    }
  }

  return normalized;
}

function canonicalPath(path: string, windows: boolean): string {
  return windows ? toPortableSeparators(path) : path;
}

export function removeTrailingSeparatorsExceptRoot(
  path: string,
  windows: boolean,
): string {
  const root = analyzeRoot(path, windows);
  let canonical = canonicalPath(path, windows);
  while (
    endsWith(canonical, "/") &&
    canonical.length > root.root.length
  ) {
    canonical = slice(canonical, 0, -1);
  }
  return canonical;
}

function rootKey(root: RootInfo, windows: boolean): string {
  const value = root.device || root.root;
  return windows ? apply(stringToLowerCase, value, []) as string : value;
}

export function runtimeUsesWindowsPaths(): boolean {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { build?: { os?: string } };
    process?: { platform?: string };
  };
  if (typeof runtime.Deno?.build?.os === "string") {
    return runtime.Deno.build.os === "windows";
  }
  return runtime.process?.platform === "win32";
}

function runtimeCwd(): string {
  const deno = (globalThis as {
    Deno?: { cwd?: () => string };
  }).Deno;
  try {
    if (typeof deno?.cwd === "function") return deno.cwd();
  } catch {
    // Continue to the next runtime source.
  }

  const process = (globalThis as {
    process?: { cwd?: () => string };
  }).process;
  try {
    if (typeof process?.cwd === "function") return process.cwd();
  } catch {
    // Browsers do not expose a process working directory.
  }

  // Browser builds use a virtual root because no host working directory exists.
  return "/";
}

export function portableNormalize(path: string, windows: boolean): string {
  if (path === "") return ".";

  const root = analyzeRoot(path, windows);
  const tail = arrayJoin(normalizeTail(root.rest, root.absolute), "/");
  let result = appendRoot(root, tail);

  const hadTrailingSeparator = matches(/[\\/]$/, path) !== null;
  if (hadTrailingSeparator && result === ".") return "./";
  if (
    hadTrailingSeparator &&
    result !== root.root &&
    !endsWith(result, "/")
  ) {
    result += "/";
  }

  return result;
}

export function portableJoin(paths: readonly string[], windows: boolean): string {
  const nonempty = arrayFilter(paths, (path) => path.length > 0);
  if (nonempty.length === 0) return "/";
  return portableNormalize(arrayJoin(nonempty, "/"), windows);
}

export function portableDirname(path: string, windows: boolean): string {
  if (path.length === 0) return ".";

  const root = analyzeRoot(path, windows);
  let canonical = canonicalPath(path, windows);
  while (
    endsWith(canonical, "/") &&
    canonical.length > root.root.length
  ) {
    canonical = slice(canonical, 0, -1);
  }

  if (canonical === root.root || canonical === root.device) {
    return root.root || root.device || ".";
  }

  const lastSeparator = lastIndexOf(canonical, "/");
  if (lastSeparator === -1) return root.device || ".";
  if (lastSeparator < root.root.length) return root.root || "/";
  if (lastSeparator === 0) return "/";
  return slice(canonical, 0, lastSeparator);
}

export function portableBasename(
  path: string,
  ext: string | undefined,
  windows: boolean,
): string {
  if (path.length === 0) return "";

  const root = analyzeRoot(path, windows);
  let canonical = canonicalPath(path, windows);
  const originalPath = canonical;
  if (ext !== undefined && ext !== "" && ext === originalPath) return "";
  while (
    endsWith(canonical, "/") &&
    canonical.length > root.root.length
  ) {
    canonical = slice(canonical, 0, -1);
  }

  if (
    windows &&
    startsWith(root.device, "//") &&
    root.rest === ""
  ) {
    return slice(root.device, lastIndexOf(root.device, "/") + 1);
  }

  if (canonical === root.root || canonical === root.device) return "";

  const lastSeparator = lastIndexOf(canonical, "/");
  let base = slice(canonical, lastSeparator + 1);
  if (
    !root.absolute &&
    root.device &&
    lastSeparator === -1 &&
    startsWith(base, root.device)
  ) {
    base = slice(base, root.device.length);
  }

  if (ext !== undefined && ext !== "" && endsWith(base, ext)) {
    if (ext.length < base.length) return slice(base, 0, -ext.length);
  }
  return base;
}

export function portableExtname(path: string, windows: boolean): string {
  const base = portableBasename(path, undefined, windows);
  const lastDot = lastIndexOf(base, ".");
  if (lastDot <= 0 || base === "." || base === "..") return "";
  return slice(base, lastDot);
}

export function portableIsAbsolute(path: string, windows: boolean): boolean {
  return analyzeRoot(path, windows).absolute;
}

export function portableResolve(
  paths: readonly string[],
  windows: boolean,
): string {
  let resolved = runtimeCwd();

  for (let index = 0; index < paths.length; index++) {
    const rawPath = paths[index]!;
    if (rawPath.length === 0) continue;

    const path = toPortableSeparators(rawPath);
    const incoming = analyzeRoot(path, windows);
    const current = analyzeRoot(resolved, windows);

    if (incoming.absolute && incoming.device) {
      resolved = path;
    } else if (incoming.absolute) {
      resolved = windows && current.device ? `${current.device}/${incoming.rest}` : path;
    } else if (incoming.device) {
      resolved = rootKey(incoming, true) === rootKey(current, true)
        ? `${current.root}${current.rest}/${incoming.rest}`
        : `${incoming.device}/${incoming.rest}`;
    } else {
      resolved = `${resolved}/${path}`;
    }
  }

  const normalized = portableNormalize(resolved, windows);
  const root = analyzeRoot(normalized, windows);
  if (
    endsWith(normalized, "/") &&
    normalized !== root.root &&
    normalized !== `${root.device}/`
  ) {
    return slice(normalized, 0, -1);
  }
  return normalized;
}

export function portableRelative(
  from: string,
  to: string,
  windows: boolean,
): string {
  const resolvedFrom = portableResolve([from], windows);
  const resolvedTo = portableResolve([to], windows);
  const fromRoot = analyzeRoot(resolvedFrom, windows);
  const toRoot = analyzeRoot(resolvedTo, windows);

  if (rootKey(fromRoot, windows) !== rootKey(toRoot, windows)) {
    return resolvedTo;
  }

  const fromParts = normalizeTail(fromRoot.rest, true);
  const toParts = normalizeTail(toRoot.rest, true);
  let common = 0;

  while (common < fromParts.length && common < toParts.length) {
    const fromPart = fromParts[common]!;
    const toPart = toParts[common]!;
    const equal = windows
      ? apply(stringToLowerCase, fromPart, []) === apply(stringToLowerCase, toPart, [])
      : fromPart === toPart;
    if (!equal) break;
    common++;
  }

  const result: string[] = [];
  for (let index = common; index < fromParts.length; index++) {
    arrayPush(result, "..");
  }
  const remainingToParts = apply(arraySlice, toParts, [common]) as string[];
  for (let index = 0; index < remainingToParts.length; index++) {
    arrayPush(result, remainingToParts[index]!);
  }
  return arrayJoin(result, "/") || ".";
}

export function portableParse(path: string, windows: boolean): PathObject {
  const root = analyzeRoot(path, windows);
  let canonical = canonicalPath(path, windows);
  while (
    endsWith(canonical, "/") &&
    canonical.length > root.root.length
  ) {
    canonical = slice(canonical, 0, -1);
  }

  const base = windows && startsWith(root.device, "//") && root.rest === ""
    ? ""
    : portableBasename(canonical, undefined, windows);
  const ext = portableExtname(base, windows);
  const name = slice(base, 0, base.length - ext.length);
  let dir = "";

  if (base === "") {
    dir = root.root;
  } else if (
    includes(canonical, "/") ||
    (windows && root.device !== "")
  ) {
    dir = portableDirname(canonical, windows);
  }

  return {
    root: root.root,
    dir,
    base,
    ext,
    name,
  };
}

export function portableFormat(
  pathObject: PathObject,
  windows: boolean,
): string {
  const root = toPortableSeparators(pathObject.root ?? "");
  const dir = toPortableSeparators(pathObject.dir ?? "");
  const rawExt = pathObject.ext ?? "";
  const ext = rawExt && !startsWith(rawExt, ".") ? `.${rawExt}` : rawExt;
  const base = pathObject.base ||
    `${pathObject.name ?? ""}${ext}`;
  const directory = dir || root;

  if (!directory) return base;
  if (!base) return directory;
  if (endsWith(directory, "/") || (windows && matches(/^[A-Za-z]:$/, directory) !== null)) {
    return `${directory}${base}`;
  }
  return `${directory}/${base}`;
}
