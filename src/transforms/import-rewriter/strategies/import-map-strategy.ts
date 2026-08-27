import type {
  ImportMapConfig,
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { isEsmShUrl } from "../url-builder.ts";
import { resolveEsmShThroughImportMap } from "#veryfront/transforms/shared/esm-sh-import-map.ts";

export function resolveImportWithMap(
  specifier: string,
  importMap: ImportMapConfig,
  scope?: string,
): string | null {
  const scopedImports = scope ? importMap.scopes?.[scope] : undefined;

  const scopedExact = scopedImports?.[specifier];
  if (scopedExact) return scopedExact;

  const esmShMapping = resolveEsmShThroughImportMap(
    specifier,
    scopedImports,
    undefined,
  );
  if (esmShMapping) return esmShMapping;

  const globalExact = importMap.imports?.[specifier];
  if (globalExact) return globalExact;

  const globalEsmShMapping = resolveEsmShThroughImportMap(
    specifier,
    undefined,
    importMap.imports,
  );
  if (globalEsmShMapping) return globalEsmShMapping;

  if (specifier.endsWith(".js") || specifier.endsWith(".mjs") || specifier.endsWith(".cjs")) {
    const base = specifier.replace(/\.(m|c)?js$/, "");
    const mapped = importMap.imports?.[base];
    if (mapped) return mapped;
  }

  const imports = importMap.imports;
  if (!imports) return null;

  let prefixMatch: { key: string; value: string } | undefined;
  for (const [key, value] of Object.entries(imports)) {
    if (
      key.endsWith("/") && specifier.startsWith(key) &&
      (prefixMatch === undefined || key.length > prefixMatch.key.length)
    ) {
      prefixMatch = { key, value };
    }
  }
  if (prefixMatch !== undefined) {
    return prefixMatch.value + specifier.slice(prefixMatch.key.length);
  }

  return null;
}

export function isRuntimeImportMapSpecifier(specifier: string): boolean {
  const isBare = !specifier.startsWith("http") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith(".");

  return isBare || isEsmShUrl(specifier);
}

export class ImportMapStrategy implements ImportRewriteStrategy {
  readonly name = "import-map";
  readonly priority = 5;

  matches(specifier: string, ctx: RewriteContext): boolean {
    if (ctx.target !== "ssr" || !ctx.importMap) return false;
    return isRuntimeImportMapSpecifier(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    if (!ctx.importMap) return { specifier: null };

    const resolved = resolveImportWithMap(info.specifier, ctx.importMap);
    if (resolved && resolved !== info.specifier) return { specifier: resolved };

    return { specifier: null };
  }
}

export const importMapStrategy = new ImportMapStrategy();
