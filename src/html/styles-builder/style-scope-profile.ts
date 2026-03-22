import type { VeryfrontConfig } from "#veryfront/config";

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
  hash: string;
  ignoredRoots: string[];
  protectedRoots: string[];
  protectedPaths: string[];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function normalizeRelativePath(path: string): string {
  return normalizePath(path).replace(/^\/+/, "").replace(/\/+$/, "");
}

function toRelativeProjectPath(path: string, projectDir?: string): string {
  const normalized = normalizePath(path);
  const normalizedProjectDir = projectDir
    ? normalizePath(projectDir).replace(/\/+$/, "")
    : undefined;

  if (normalizedProjectDir && normalized.startsWith(normalizedProjectDir)) {
    return normalized.slice(normalizedProjectDir.length).replace(/^\/+/, "");
  }

  return normalized.replace(/^\/+/, "");
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
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return hash.toString(36);
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

  const sortedIgnoredRoots = [...ignoredRoots].sort();
  const sortedProtectedRoots = [...protectedRoots].sort();
  const sortedProtectedPaths = [...protectedPaths].sort();

  return {
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
  };
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
  const relativePath = normalizeRelativePath(toRelativeProjectPath(path, projectDir));
  if (!relativePath) return true;
  if (isProtectedPath(profile, relativePath)) return true;

  return !profile.ignoredRoots.some((root) => isWithinPath(relativePath, root));
}

export function shouldTraverseStyleDirectory(
  profile: StyleScopeProfile,
  directoryPath: string,
  projectDir?: string,
): boolean {
  const relativePath = normalizeRelativePath(toRelativeProjectPath(directoryPath, projectDir));
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
