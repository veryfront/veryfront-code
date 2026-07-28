import type { ImportMapConfig } from "./types.ts";

type StringMappings = Record<string, string> | undefined;

function getOwnMapping<T>(
  mappings: Record<string, T> | undefined,
  specifier: string,
): T | undefined {
  return mappings && Object.hasOwn(mappings, specifier) ? mappings[specifier] : undefined;
}

function findPrefixMapping(
  mappings: StringMappings,
  specifier: string,
): string | undefined {
  if (!mappings) return undefined;

  let bestKey: string | undefined;
  for (const key of Object.keys(mappings)) {
    if (
      !key.endsWith("/") ||
      !specifier.startsWith(key) ||
      (bestKey !== undefined && key.length <= bestKey.length)
    ) {
      continue;
    }
    bestKey = key;
  }

  if (bestKey === undefined) return undefined;
  const target = getOwnMapping(mappings, bestKey);
  return target === undefined ? undefined : target + specifier.slice(bestKey.length);
}

function findScopeMappings(
  importMap: ImportMapConfig,
  scope: string | undefined,
): StringMappings {
  if (!scope || !importMap.scopes) return undefined;

  let bestScope: string | undefined;
  for (const candidate of Object.keys(importMap.scopes)) {
    if (
      scope !== candidate &&
      !scope.startsWith(candidate)
    ) {
      continue;
    }
    if (bestScope === undefined || candidate.length > bestScope.length) {
      bestScope = candidate;
    }
  }
  return bestScope === undefined ? undefined : getOwnMapping(importMap.scopes, bestScope);
}

function resolveFromMappings(
  specifier: string,
  scopedImports: StringMappings,
  globalImports: StringMappings,
): string | undefined {
  return getOwnMapping(scopedImports, specifier) ??
    findPrefixMapping(scopedImports, specifier) ??
    getOwnMapping(globalImports, specifier) ??
    findPrefixMapping(globalImports, specifier);
}

/** Check if URL is an esm.sh URL */
function isEsmShUrl(url: string): boolean {
  return url.startsWith("https://esm.sh/") || url.startsWith("http://esm.sh/");
}

interface ESMShSpecifier {
  packageName: string;
  subpath: string;
}

function extractEsmShSpecifier(url: string): ESMShSpecifier | null {
  if (!isEsmShUrl(url)) return null;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/(?:v\d+\/)?/, "");
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;

    if (parts[0]?.startsWith("@")) {
      if (parts.length < 2) return null;
      const packageSegment = parts[1]!;
      const versionIndex = packageSegment.lastIndexOf("@");
      const unversionedPackage = versionIndex > 0
        ? packageSegment.slice(0, versionIndex)
        : packageSegment;
      if (!unversionedPackage) return null;
      return {
        packageName: `${parts[0]}/${unversionedPackage}`,
        subpath: parts.length > 2 ? `/${parts.slice(2).join("/")}` : "",
      };
    }

    const packageSegment = parts[0]!;
    const versionIndex = packageSegment.indexOf("@");
    const packageName = versionIndex > 0 ? packageSegment.slice(0, versionIndex) : packageSegment;
    if (!packageName) return null;
    return {
      packageName,
      subpath: parts.length > 1 ? `/${parts.slice(1).join("/")}` : "",
    };
  } catch (_) {
    /* expected: URL may be malformed */
    return null;
  }
}

function appendUrlSubpath(mapping: string, subpath: string): string {
  if (!subpath) return mapping;
  if (
    !mapping.startsWith("http://") &&
    !mapping.startsWith("https://") &&
    !mapping.startsWith("npm:")
  ) {
    return mapping;
  }

  if (mapping.startsWith("npm:")) {
    const [withoutFragment, fragment = ""] = mapping.split("#", 2);
    const [base, query = ""] = withoutFragment!.split("?", 2);
    return `${base}${subpath}${query ? `?${query}` : ""}${fragment ? `#${fragment}` : ""}`;
  }

  try {
    const parsed = new URL(mapping);
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}${subpath}`;
    return parsed.href;
  } catch (_) {
    return mapping;
  }
}

export function resolveImport(
  specifier: string,
  importMap: ImportMapConfig,
  scope?: string,
): string {
  const scopedImports = findScopeMappings(importMap, scope);
  const globalImports = importMap.imports;

  const directMapping = resolveFromMappings(
    specifier,
    scopedImports,
    globalImports,
  );
  if (directMapping !== undefined) return directMapping;

  if (isEsmShUrl(specifier)) {
    const parsedSpecifier = extractEsmShSpecifier(specifier);
    if (parsedSpecifier) {
      const { packageName, subpath } = parsedSpecifier;

      // Always check for explicit subpath mapping first (e.g., "react/jsx-runtime")
      // This takes priority over appending subpath to base package mapping
      if (subpath) {
        const subpathMapping = resolveFromMappings(
          packageName + subpath,
          scopedImports,
          globalImports,
        );
        if (subpathMapping !== undefined) return subpathMapping;
      }

      const mapping = resolveFromMappings(
        packageName,
        scopedImports,
        globalImports,
      );
      if (mapping !== undefined) {
        return appendUrlSubpath(mapping, subpath);
      }
    }
  }

  if (specifier.endsWith(".js") || specifier.endsWith(".mjs") || specifier.endsWith(".cjs")) {
    const base = specifier.replace(/\.(m|c)?js$/, "");
    const mapped = resolveFromMappings(base, scopedImports, globalImports);
    if (mapped !== undefined) return mapped;
  }

  return specifier;
}
