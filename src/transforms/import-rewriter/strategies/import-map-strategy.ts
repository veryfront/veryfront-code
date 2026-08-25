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

  const globalExact = importMap.imports?.[specifier];
  if (globalExact) return globalExact;

  const esmShMapping = resolveEsmShThroughImportMap(
    specifier,
    scopedImports,
    importMap.imports,
  );
  if (esmShMapping) return esmShMapping;

  if (specifier.endsWith(".js") || specifier.endsWith(".mjs") || specifier.endsWith(".cjs")) {
    const base = specifier.replace(/\.(m|c)?js$/, "");
    const mapped = importMap.imports?.[base];
    if (mapped) return mapped;
  }

  const imports = importMap.imports;
  if (!imports) return null;

  for (const [key, value] of Object.entries(imports)) {
    if (key.endsWith("/") && specifier.startsWith(key)) {
      return value + specifier.slice(key.length);
    }
  }

  return null;
}

export class ImportMapStrategy implements ImportRewriteStrategy {
  readonly name = "import-map";
  readonly priority = 5;

  matches(specifier: string, ctx: RewriteContext): boolean {
    if (ctx.target !== "ssr" || !ctx.importMap) return false;

    const isBare = !specifier.startsWith("http") &&
      !specifier.startsWith("/") &&
      !specifier.startsWith(".");

    return isBare || isEsmShUrl(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    if (!ctx.importMap) return { specifier: null };

    const resolved = resolveImportWithMap(info.specifier, ctx.importMap);
    if (resolved && resolved !== info.specifier) return { specifier: resolved };

    return { specifier: null };
  }
}

export const importMapStrategy = new ImportMapStrategy();
