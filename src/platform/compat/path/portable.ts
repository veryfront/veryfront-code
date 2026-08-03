import type { PathObject } from "./types.ts";
import {
  primordialArrayAt as arrayAt,
  primordialArrayFilter as arrayFilter,
  primordialArrayJoin as arrayJoin,
  primordialArrayPop as arrayPop,
  primordialArrayPush as arrayPush,
} from "../primordials/array.ts";

interface RootInfo {
  absolute: boolean;
  device: string;
  rest: string;
  root: string;
}

export function hasWindowsLikePath(path: string): boolean {
  return path.includes("\\") ||
    /^[A-Za-z]:/.test(path);
}

export function toPortableSeparators(path: string): string {
  return path.replaceAll("\\", "/");
}

function analyzeRoot(path: string, windows: boolean): RootInfo {
  const portable = toPortableSeparators(path);

  if (windows) {
    const unc = portable.match(
      /^\/\/([^/]+)\/+([^/]+)(\/+(.*))?$/,
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

    const drive = portable.match(/^([A-Za-z]:)(\/+)?(.*)$/);
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

  if (portable.startsWith("/")) {
    return {
      absolute: true,
      device: "",
      rest: portable.replace(/^\/+/, ""),
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
    return root.device.startsWith("//") ? `${root.device}/` : root.root;
  }
  return root.root.endsWith("/") ? `${root.root}${tail}` : `${root.root}/${tail}`;
}

function normalizeTail(rest: string, absolute: boolean): string[] {
  const normalized: string[] = [];

  for (const segment of rest.split("/")) {
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
    canonical.endsWith("/") &&
    canonical.length > root.root.length
  ) {
    canonical = canonical.slice(0, -1);
  }
  return canonical;
}

function rootKey(root: RootInfo, windows: boolean): string {
  const value = root.device || root.root;
  return windows ? value.toLowerCase() : value;
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

  const hadTrailingSeparator = /[\\/]$/.test(path);
  if (hadTrailingSeparator && result === ".") return "./";
  if (
    hadTrailingSeparator &&
    result !== root.root &&
    !result.endsWith("/")
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
    canonical.endsWith("/") &&
    canonical.length > root.root.length
  ) {
    canonical = canonical.slice(0, -1);
  }

  if (canonical === root.root || canonical === root.device) {
    return root.root || root.device || ".";
  }

  const lastSeparator = canonical.lastIndexOf("/");
  if (lastSeparator === -1) return root.device || ".";
  if (lastSeparator < root.root.length) return root.root || "/";
  if (lastSeparator === 0) return "/";
  return canonical.slice(0, lastSeparator);
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
    canonical.endsWith("/") &&
    canonical.length > root.root.length
  ) {
    canonical = canonical.slice(0, -1);
  }

  if (
    windows &&
    root.device.startsWith("//") &&
    root.rest === ""
  ) {
    return root.device.slice(root.device.lastIndexOf("/") + 1);
  }

  if (canonical === root.root || canonical === root.device) return "";

  const lastSeparator = canonical.lastIndexOf("/");
  let base = canonical.slice(lastSeparator + 1);
  if (
    !root.absolute &&
    root.device &&
    lastSeparator === -1 &&
    base.startsWith(root.device)
  ) {
    base = base.slice(root.device.length);
  }

  if (ext !== undefined && ext !== "" && base.endsWith(ext)) {
    if (ext.length < base.length) return base.slice(0, -ext.length);
  }
  return base;
}

export function portableExtname(path: string, windows: boolean): string {
  const base = portableBasename(path, undefined, windows);
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0 || base === "." || base === "..") return "";
  return base.slice(lastDot);
}

export function portableIsAbsolute(path: string, windows: boolean): boolean {
  return analyzeRoot(path, windows).absolute;
}

export function portableResolve(
  paths: readonly string[],
  windows: boolean,
): string {
  let resolved = runtimeCwd();

  for (const rawPath of paths) {
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
    normalized.endsWith("/") &&
    normalized !== root.root &&
    normalized !== `${root.device}/`
  ) {
    return normalized.slice(0, -1);
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
    const equal = windows ? fromPart.toLowerCase() === toPart.toLowerCase() : fromPart === toPart;
    if (!equal) break;
    common++;
  }

  const result = [
    ...Array.from({ length: fromParts.length - common }, () => ".."),
    ...toParts.slice(common),
  ];
  return result.join("/") || ".";
}

export function portableParse(path: string, windows: boolean): PathObject {
  const root = analyzeRoot(path, windows);
  let canonical = canonicalPath(path, windows);
  while (
    canonical.endsWith("/") &&
    canonical.length > root.root.length
  ) {
    canonical = canonical.slice(0, -1);
  }

  const base = windows && root.device.startsWith("//") && root.rest === ""
    ? ""
    : portableBasename(canonical, undefined, windows);
  const ext = portableExtname(base, windows);
  const name = base.slice(0, base.length - ext.length);
  let dir = "";

  if (base === "") {
    dir = root.root;
  } else if (
    canonical.includes("/") ||
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
  const ext = rawExt && !rawExt.startsWith(".") ? `.${rawExt}` : rawExt;
  const base = pathObject.base ||
    `${pathObject.name ?? ""}${ext}`;
  const directory = dir || root;

  if (!directory) return base;
  if (!base) return directory;
  if (directory.endsWith("/") || (windows && /^[A-Za-z]:$/.test(directory))) {
    return `${directory}${base}`;
  }
  return `${directory}/${base}`;
}
