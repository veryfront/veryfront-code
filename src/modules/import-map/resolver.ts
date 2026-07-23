import type { ImportMapConfig } from "./types.ts";

interface ESMShPackageSpecifier {
  packageName: string;
  subpath: string;
}

function getOwnMapping(
  imports: Record<string, string> | undefined,
  specifier: string,
): string | undefined {
  if (!imports || !Object.prototype.hasOwnProperty.call(imports, specifier)) return undefined;
  const value: unknown = imports[specifier];
  return typeof value === "string" ? value : undefined;
}

function isEsmShUrl(url: string): boolean {
  return url.startsWith("https://esm.sh/") || url.startsWith("http://esm.sh/");
}

function parseEsmShPackage(url: string): ESMShPackageSpecifier | null {
  if (!isEsmShUrl(url)) return null;

  try {
    const pathname = new URL(url).pathname.slice(1).replace(/^v\d+\//, "");
    const match = pathname.startsWith("@")
      ? pathname.match(/^(@[^/]+\/[^/@]+)(?:@[^/]+)?(\/.*)?$/)
      : pathname.match(/^([^/@]+)(?:@[^/]+)?(\/.*)?$/);
    const packageName = match?.[1];
    if (!packageName) return null;
    return { packageName, subpath: match?.[2] ?? "" };
  } catch {
    return null;
  }
}

function getScopedImports(
  scopes: ImportMapConfig["scopes"],
  scope: string | undefined,
): Record<string, string> | undefined {
  if (!scope || !scopes) return undefined;

  let bestKey: string | undefined;
  for (const key of Object.keys(scopes)) {
    if (scope !== key && !scope.startsWith(key)) continue;
    if (bestKey === undefined || key.length > bestKey.length) bestKey = key;
  }
  if (bestKey === undefined) return undefined;
  const mappings: unknown = scopes[bestKey];
  return typeof mappings === "object" && mappings !== null && !Array.isArray(mappings)
    ? mappings as Record<string, string>
    : undefined;
}

function resolveMappedSpecifier(
  specifier: string,
  imports: Record<string, string> | undefined,
): string | undefined {
  if (!imports) return undefined;

  const exact = getOwnMapping(imports, specifier);
  if (exact !== undefined) return exact;

  let bestPrefix: string | undefined;
  for (const key of Object.keys(imports)) {
    if (!key.endsWith("/") || !specifier.startsWith(key)) continue;
    if (bestPrefix === undefined || key.length > bestPrefix.length) bestPrefix = key;
  }
  if (bestPrefix === undefined) return undefined;
  const target: unknown = imports[bestPrefix];
  if (typeof target !== "string" || !target.endsWith("/")) return undefined;
  return target + specifier.slice(bestPrefix.length);
}

function resolveFromLayers(
  specifier: string,
  scopedImports: Record<string, string> | undefined,
  globalImports: Record<string, string> | undefined,
): string | undefined {
  return resolveMappedSpecifier(specifier, scopedImports) ??
    resolveMappedSpecifier(specifier, globalImports);
}

/** Resolve a module specifier using global and longest-prefix scoped import-map entries. */
export function resolveImport(
  specifier: string,
  importMap: ImportMapConfig,
  scope?: string,
): string {
  const scopedImports = getScopedImports(importMap.scopes, scope);
  const direct = resolveFromLayers(specifier, scopedImports, importMap.imports);
  if (direct !== undefined) return direct;

  const esmShSpecifier = parseEsmShPackage(specifier);
  if (esmShSpecifier) {
    const { packageName, subpath } = esmShSpecifier;
    if (subpath) {
      const subpathMapping = resolveFromLayers(
        packageName + subpath,
        scopedImports,
        importMap.imports,
      );
      if (subpathMapping !== undefined) return subpathMapping;
    }

    const packageMapping = getOwnMapping(scopedImports, packageName) ??
      getOwnMapping(importMap.imports, packageName);
    if (packageMapping !== undefined) {
      if (!subpath) return packageMapping;
      const isRemote = packageMapping.startsWith("http://") ||
        packageMapping.startsWith("https://") ||
        packageMapping.startsWith("npm:");
      return isRemote ? packageMapping + subpath : packageMapping;
    }
  }

  if (/\.(?:m|c)?js$/.test(specifier)) {
    const base = specifier.replace(/\.(?:m|c)?js$/, "");
    const mapped = resolveFromLayers(base, scopedImports, importMap.imports);
    if (mapped !== undefined) return mapped;
  }

  return specifier;
}
