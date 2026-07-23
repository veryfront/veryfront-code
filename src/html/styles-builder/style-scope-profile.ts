import type { VeryfrontConfig } from "#veryfront/config";
import { resolveRelativePath } from "#veryfront/modules/react-loader/path-resolver.ts";

const DEFAULT_IGNORED_ROOTS = [
  "knowledge",
  "coverage",
  "dist",
  "build",
  ".git",
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
  readonly hash: string;
  readonly ignoredRoots: readonly string[];
  readonly protectedRoots: readonly string[];
  readonly protectedPaths: readonly string[];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function normalizeRelativePath(path: string): string {
  try {
    return resolveRelativePath(normalizePath(path), ".").replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function toRelativeProjectPath(path: string, projectDir?: string): string | null {
  const normalized = normalizePath(path);
  try {
    return resolveRelativePath(normalized, projectDir ? normalizePath(projectDir) : ".");
  } catch {
    return null;
  }
}

function isWithinPath(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function getParentDirectory(path: string): string | null {
  const normalized = normalizeRelativePath(path);
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) return null;
  return normalized.slice(0, slashIndex);
}

function stableHash(input: string): string {
  let high = 0x811c9dc5;
  let low = 0x9e3779b9;
  for (const byte of new TextEncoder().encode(input)) {
    high = Math.imul(high ^ byte, 0x01000193);
    low = Math.imul(low ^ byte, 0x01000193);
  }
  return (high >>> 0).toString(16).padStart(8, "0") +
    (low >>> 0).toString(16).padStart(8, "0");
}

function addNormalizedPath(target: Set<string>, value: string | null | undefined): void {
  if (!value) return;
  const normalized = normalizeRelativePath(value);
  if (!normalized) return;
  target.add(normalized);
}

export function createStyleScopeProfile(config?: VeryfrontConfig): StyleScopeProfile {
  const ignoredRoots = new Set<string>(DEFAULT_IGNORED_ROOTS);
  const protectedRoots = new Set<string>(DEFAULT_PROTECTED_ROOTS);
  const protectedPaths = new Set<string>();

  addNormalizedPath(protectedRoots, config?.directories?.app);
  addNormalizedPath(protectedRoots, config?.directories?.pages);

  for (const path of config?.directories?.components ?? []) {
    addNormalizedPath(protectedRoots, path);
  }

  const explicitPaths = [
    typeof config?.layout === "string" ? config.layout : undefined,
    typeof config?.app === "string" ? config.app : undefined,
    config?.tailwind?.stylesheet,
  ];

  for (const path of explicitPaths) {
    addNormalizedPath(protectedPaths, path);
    addNormalizedPath(protectedRoots, getParentDirectory(path ?? ""));
  }

  for (const root of protectedRoots) {
    ignoredRoots.delete(root);
  }

  const sortedIgnoredRoots = Object.freeze([...ignoredRoots].sort());
  const sortedProtectedRoots = Object.freeze([...protectedRoots].sort());
  const sortedProtectedPaths = Object.freeze([...protectedPaths].sort());

  return Object.freeze({
    ignoredRoots: sortedIgnoredRoots,
    protectedRoots: sortedProtectedRoots,
    protectedPaths: sortedProtectedPaths,
    hash: stableHash(
      JSON.stringify({
        ignoredRoots: sortedIgnoredRoots,
        protectedRoots: sortedProtectedRoots,
        protectedPaths: sortedProtectedPaths,
      }),
    ),
  });
}

function isProtectedPath(
  profile: StyleScopeProfile,
  relativePath: string,
): boolean {
  return profile.protectedPaths.some((path) => isWithinPath(relativePath, path)) ||
    profile.protectedRoots.some((path) => isWithinPath(relativePath, path));
}

export function shouldIncludeStylePath(
  profile: StyleScopeProfile,
  path: string,
  projectDir?: string,
): boolean {
  const projectPath = toRelativeProjectPath(path, projectDir);
  if (projectPath === null) return false;
  const relativePath = normalizeRelativePath(projectPath);
  if (!relativePath) return true;
  if (isProtectedPath(profile, relativePath)) return true;

  return !profile.ignoredRoots.some((root) => isWithinPath(relativePath, root));
}

export function shouldTraverseStyleDirectory(
  profile: StyleScopeProfile,
  directoryPath: string,
  projectDir?: string,
): boolean {
  const projectPath = toRelativeProjectPath(directoryPath, projectDir);
  if (projectPath === null) return false;
  const relativePath = normalizeRelativePath(projectPath);
  if (!relativePath) return true;
  if (isProtectedPath(profile, relativePath)) return true;

  const ignoredRoot = profile.ignoredRoots.find((root) => isWithinPath(relativePath, root));
  if (!ignoredRoot) return true;

  return profile.protectedRoots.some((root) => isWithinPath(root, relativePath)) ||
    profile.protectedPaths.some((path) => isWithinPath(path, relativePath));
}

export function filterFilesForStyleScope<T extends { path: string }>(
  files: T[],
  profile: StyleScopeProfile,
  projectDir?: string,
): T[] {
  return files.filter((file) => shouldIncludeStylePath(profile, file.path, projectDir));
}
