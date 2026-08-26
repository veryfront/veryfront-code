import type { ChunkSuggestion, PageImports } from "./contracts.ts";
import { CHUNK_SIZE_ESTIMATES } from "./limits.ts";
import { hasScheme, readScheme } from "./specifier.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

const CHUNKABLE_SCHEMES = new Set(["http", "https", "jsr", "npm"]);

function getExternalDeps(imports: PageImports): string[] {
  return [...imports.remote, ...imports.shared];
}

function indexDependencyPages(
  pages: Map<string, PageImports>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [path, imports] of pages) {
    for (const dependency of new Set(getExternalDeps(imports))) {
      const dependencyPages = result.get(dependency);
      if (dependencyPages) dependencyPages.push(path);
      else result.set(dependency, [path]);
    }
  }
  return result;
}

function findPagesUsingDeps(
  dependencyPages: Map<string, string[]>,
  dependencies: readonly string[],
): string[] {
  const pages = new Set<string>();
  for (const dependency of dependencies) {
    for (const page of dependencyPages.get(dependency) ?? []) pages.add(page);
  }
  return [...pages].sort(compareStrings);
}

function isVersionedPackageSegment(segment: string, name: string): boolean {
  return segment === name || segment.startsWith(`${name}@`);
}

function isReactPackageSegment(segment: string): boolean {
  return isVersionedPackageSegment(segment, "react") ||
    isVersionedPackageSegment(segment, "react-dom") ||
    segment === "react-server-dom" ||
    segment.startsWith("react-server-dom-") ||
    segment.startsWith("react-server-dom@");
}

function isUrlPackagePrefixSegment(segment: string): boolean {
  const normalized = segment.toLowerCase().replace(/^%40/, "@");
  return normalized === "npm" || /^@v?\d/.test(normalized);
}

function urlContainsReactPackage(dependency: string): boolean {
  let segments: string[];
  try {
    const url = dependency.startsWith("//") ? new URL(`https:${dependency}`) : new URL(dependency);
    segments = url.pathname.split("/").filter(Boolean);
  } catch {
    return false;
  }
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const previousSegment = segments[index - 1];
    if (
      isReactPackageSegment(segment) &&
      (index === 0 ||
        segment.includes("@") ||
        (previousSegment !== undefined &&
          isUrlPackagePrefixSegment(previousSegment)))
    ) {
      return true;
    }
  }
  return false;
}

function isReactRuntimeDependency(dependency: string): boolean {
  if (
    hasScheme(dependency, "http:") ||
    hasScheme(dependency, "https:") ||
    dependency.startsWith("//")
  ) {
    return urlContainsReactPackage(dependency);
  }

  const normalized = hasScheme(dependency, "npm:") ||
      hasScheme(dependency, "jsr:")
    ? dependency.slice(4)
    : dependency;
  const [packageRoot] = normalized.split("/");
  return packageRoot !== undefined &&
    !packageRoot.startsWith("@") &&
    !packageRoot.toLowerCase().startsWith("%40") &&
    isReactPackageSegment(packageRoot);
}

function isPackageSpecifier(
  specifier: string,
  packageName: string,
): boolean {
  return specifier === packageName ||
    specifier.startsWith(`${packageName}/`) ||
    specifier.startsWith(`${packageName}@`);
}

function isUiDependency(dependency: string): boolean {
  const isUrl = hasScheme(dependency, "http:") ||
    hasScheme(dependency, "https:") ||
    dependency.startsWith("//");
  const normalized = (
    hasScheme(dependency, "npm:") || hasScheme(dependency, "jsr:")
      ? dependency.slice(4)
      : dependency
  ).replaceAll("%40", "@");
  if (
    normalized.startsWith("@mui/") ||
    isPackageSpecifier(normalized, "framer-motion") ||
    normalized.startsWith("@headlessui/")
  ) {
    return true;
  }
  if (!isUrl) return false;
  let pathname: string;
  try {
    const url = normalized.startsWith("//") ? new URL(`https:${normalized}`) : new URL(normalized);
    pathname = url.pathname.replaceAll("%40", "@");
  } catch {
    return false;
  }
  return pathname.includes("/@mui/") ||
    pathname.includes("/@headlessui/") ||
    pathname.includes("/framer-motion/") ||
    pathname.includes("/framer-motion@") ||
    pathname.endsWith("/framer-motion");
}

function isChunkableDependency(dependency: string): boolean {
  const scheme = readScheme(dependency);
  return scheme === null || CHUNKABLE_SCHEMES.has(scheme);
}

export function generateChunkSuggestions(
  pages: Map<string, PageImports>,
  sharedDeps: Map<string, number>,
): ChunkSuggestion[] {
  const suggestions: ChunkSuggestion[] = [];
  const assigned = new Set<string>();
  const dependencyPages = indexDependencyPages(pages);
  const dependencyCounts = [...sharedDeps.entries()]
    .filter(([dependency]) => isChunkableDependency(dependency))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);

  function addSuggestion(
    name: string,
    dependencies: string[],
    benefit: number,
  ): void {
    if (dependencies.length === 0) return;
    for (const dependency of dependencies) assigned.add(dependency);
    suggestions.push({
      name,
      deps: dependencies,
      pages: findPagesUsingDeps(dependencyPages, dependencies),
      benefit,
    });
  }

  const reactDeps = dependencyCounts
    .map(([dependency]) => dependency)
    .filter(isReactRuntimeDependency);
  addSuggestion(
    "react-vendor",
    reactDeps,
    CHUNK_SIZE_ESTIMATES.reactRuntime,
  );

  const uiDeps = dependencyCounts
    .map(([dependency]) => dependency)
    .filter((dependency) => !assigned.has(dependency) && isUiDependency(dependency));
  addSuggestion(
    "ui-vendor",
    uiDeps,
    uiDeps.length * CHUNK_SIZE_ESTIMATES.uiLibrary,
  );

  const commonDeps = dependencyCounts
    .filter(([dependency, count]) => count >= 2 && !assigned.has(dependency))
    .map(([dependency]) => dependency);
  const commonPages = findPagesUsingDeps(dependencyPages, commonDeps);
  if (commonDeps.length > 0) {
    suggestions.push({
      name: "common",
      deps: commonDeps,
      pages: commonPages,
      benefit: commonDeps.length *
        commonPages.length *
        CHUNK_SIZE_ESTIMATES.dependency,
    });
  }

  return suggestions.sort((left, right) => {
    const benefitOrder = right.benefit - left.benefit;
    if (benefitOrder !== 0) return benefitOrder;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
}
