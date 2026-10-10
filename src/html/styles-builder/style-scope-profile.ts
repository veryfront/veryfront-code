import type { VeryfrontConfig } from "#veryfront/config";
import { createHash } from "node:crypto";
import { compareStrings } from "#veryfront/utils/compare.ts";
import {
  primordialArrayFilter,
  primordialArrayPush,
  primordialArraySort,
} from "#veryfront/platform/compat/primordials/array.ts";

const Apply = Reflect.apply;
const SetConstructor = Set;
const SetAdd = Set.prototype.add;
const SetDelete = Set.prototype.delete;
const SetForEach = Set.prototype.forEach;
const StringSlice = String.prototype.slice;
const StringStartsWith = String.prototype.startsWith;
const StringLastIndexOf = String.prototype.lastIndexOf;
const JSONStringify = JSON.stringify;
const CreateHash = createHash;
const hashMethods = CreateHash("sha256");
const HashUpdate = hashMethods.update;
const HashDigest = hashMethods.digest;

function sortedSetValues(values: Set<string>): string[] {
  const result: string[] = [];
  Apply(SetForEach, values, [(value: string) => primordialArrayPush(result, value)]);
  return primordialArraySort(result, compareStrings);
}

function somePath(values: readonly string[], predicate: (value: string) => boolean): boolean {
  for (let index = 0; index < values.length; index++) {
    if (predicate(values[index]!)) return true;
  }
  return false;
}

function stringifyPaths(values: readonly string[]): string {
  let result = "[";
  for (let index = 0; index < values.length; index++) {
    if (index > 0) result += ",";
    result += JSONStringify(values[index]);
  }
  return result + "]";
}

const DEFAULT_IGNORED_ROOTS = [
  "knowledge",
  "coverage",
  "dist",
  "build",
  ".git",
  ".veryfront-packed-cli",
  "node_modules",
  ".cache",
];

const DEFAULT_PROTECTED_ROOTS = [
  "app",
  "pages",
  "components",
  "src/app",
  "src/pages",
  "src/components",
];

export interface StyleScopeProfile {
  hash: string;
  ignoredRoots: string[];
  protectedRoots: string[];
  protectedPaths: string[];
}

function normalizePath(path: string): string {
  let normalized = "";
  let previousSlash = false;
  for (let index = 0; index < path.length; index++) {
    const character = path[index] === "\\" ? "/" : path[index]!;
    if (character === "/" && previousSlash) continue;
    normalized += character;
    previousSlash = character === "/";
  }
  return normalized;
}

function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end--;
  return Apply(StringSlice, path, [0, end]) as string;
}

function trimSlashes(path: string, trailing = true): string {
  let start = 0;
  let end = path.length;
  while (path[start] === "/") start++;
  if (trailing) { while (end > start && path[end - 1] === "/") end--; }
  return Apply(StringSlice, path, [start, end]) as string;
}

function normalizeRelativePath(path: string): string {
  return trimSlashes(normalizePath(path));
}

function toRelativeProjectPath(path: string, projectDir?: string): string {
  const normalized = normalizePath(path);
  const normalizedProjectDir = projectDir
    ? trimTrailingSlashes(normalizePath(projectDir))
    : undefined;

  if (normalizedProjectDir && Apply(StringStartsWith, normalized, [normalizedProjectDir])) {
    return trimSlashes(
      Apply(StringSlice, normalized, [normalizedProjectDir.length]) as string,
      false,
    );
  }

  return trimSlashes(normalized, false);
}

function isWithinPath(path: string, root: string): boolean {
  return path === root || Apply(StringStartsWith, path, [`${root}/`]);
}

function getParentDirectory(path: string): string | null {
  const normalized = normalizeRelativePath(path);
  const slashIndex = Apply(StringLastIndexOf, normalized, ["/"]) as number;
  if (slashIndex <= 0) return null;
  return Apply(StringSlice, normalized, [0, slashIndex]) as string;
}

function stableHash(input: string): string {
  const hash = CreateHash("sha256");
  Apply(HashUpdate, hash, [input, "utf8"]);
  return Apply(HashDigest, hash, ["hex"]) as string;
}

function addNormalizedPath(target: Set<string>, value: string | null | undefined): void {
  if (!value) return;
  const normalized = normalizeRelativePath(value);
  if (!normalized) return;
  Apply(SetAdd, target, [normalized]);
}

export function createStyleScopeProfile(config?: VeryfrontConfig): StyleScopeProfile {
  const ignoredRoots = new SetConstructor<string>();
  const protectedRoots = new SetConstructor<string>();
  const protectedPaths = new SetConstructor<string>();

  for (let index = 0; index < DEFAULT_IGNORED_ROOTS.length; index++) {
    Apply(SetAdd, ignoredRoots, [DEFAULT_IGNORED_ROOTS[index]]);
  }
  for (let index = 0; index < DEFAULT_PROTECTED_ROOTS.length; index++) {
    Apply(SetAdd, protectedRoots, [DEFAULT_PROTECTED_ROOTS[index]]);
  }

  addNormalizedPath(protectedRoots, config?.directories?.app);
  addNormalizedPath(protectedRoots, config?.directories?.pages);

  const components = config?.directories?.components ?? [];
  for (let index = 0; index < components.length; index++) {
    addNormalizedPath(protectedRoots, components[index]);
  }

  const explicitPaths = [
    typeof config?.layout === "string" ? config.layout : undefined,
    typeof config?.app === "string" ? config.app : undefined,
    config?.tailwind?.stylesheet,
  ];

  for (let index = 0; index < explicitPaths.length; index++) {
    const path = explicitPaths[index];
    addNormalizedPath(protectedPaths, path);
    addNormalizedPath(protectedRoots, getParentDirectory(path ?? ""));
  }

  Apply(SetForEach, protectedRoots, [(root: string) => Apply(SetDelete, ignoredRoots, [root])]);

  const sortedIgnoredRoots = sortedSetValues(ignoredRoots);
  const sortedProtectedRoots = sortedSetValues(protectedRoots);
  const sortedProtectedPaths = sortedSetValues(protectedPaths);

  return {
    ignoredRoots: sortedIgnoredRoots,
    protectedRoots: sortedProtectedRoots,
    protectedPaths: sortedProtectedPaths,
    hash: stableHash(
      `{"ignoredRoots":${stringifyPaths(sortedIgnoredRoots)},"protectedRoots":${
        stringifyPaths(sortedProtectedRoots)
      },"protectedPaths":${stringifyPaths(sortedProtectedPaths)}}`,
    ),
  };
}

function isProtectedPath(
  profile: StyleScopeProfile,
  relativePath: string,
): boolean {
  return somePath(profile.protectedPaths, (path) => isWithinPath(relativePath, path)) ||
    somePath(profile.protectedRoots, (path) => isWithinPath(relativePath, path));
}

export function shouldIncludeStylePath(
  profile: StyleScopeProfile,
  path: string,
  projectDir?: string,
): boolean {
  const relativePath = normalizeRelativePath(toRelativeProjectPath(path, projectDir));
  if (!relativePath) return true;
  if (isProtectedPath(profile, relativePath)) return true;

  return !somePath(profile.ignoredRoots, (root) => isWithinPath(relativePath, root));
}

export function shouldTraverseStyleDirectory(
  profile: StyleScopeProfile,
  directoryPath: string,
  projectDir?: string,
): boolean {
  const relativePath = normalizeRelativePath(toRelativeProjectPath(directoryPath, projectDir));
  if (!relativePath) return true;
  if (isProtectedPath(profile, relativePath)) return true;

  if (!somePath(profile.ignoredRoots, (root) => isWithinPath(relativePath, root))) return true;

  return somePath(profile.protectedRoots, (root) => isWithinPath(root, relativePath)) ||
    somePath(profile.protectedPaths, (path) => isWithinPath(path, relativePath));
}

export function filterFilesForStyleScope<T extends { path: string }>(
  files: T[],
  profile: StyleScopeProfile,
  projectDir?: string,
): T[] {
  return primordialArrayFilter(
    files,
    (file) => shouldIncludeStylePath(profile, file.path, projectDir),
  );
}
