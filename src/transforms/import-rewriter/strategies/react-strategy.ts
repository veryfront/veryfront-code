import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { getReactImportMap } from "../url-builder.ts";

const MAX_REACT_IMPORT_MAP_CACHE_ENTRIES = 64;

export class ReactStrategy implements ImportRewriteStrategy {
  readonly name = "react";
  readonly priority = 0;

  private importMapCache = new Map<string, Record<string, string>>();

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return (
      specifier === "react" ||
      specifier === "react-dom" ||
      specifier.startsWith("react/") ||
      specifier.startsWith("react-dom/")
    );
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    const importMap = this.getImportMap(ctx.reactVersion);
    const mapped = importMap[info.specifier];

    if (mapped) return { specifier: mapped };

    if (!info.specifier.startsWith("react/")) return { specifier: null };

    const prefix = importMap["react/"];
    if (!prefix) return { specifier: null };

    return { specifier: prefix + info.specifier.slice("react/".length) };
  }

  private getImportMap(version: string): Record<string, string> {
    const cached = this.importMapCache.get(version);
    if (cached) {
      this.importMapCache.delete(version);
      this.importMapCache.set(version, cached);
      return cached;
    }

    const importMap = getReactImportMap(version);
    if (this.importMapCache.size >= MAX_REACT_IMPORT_MAP_CACHE_ENTRIES) {
      const oldestVersion = this.importMapCache.keys().next().value;
      if (oldestVersion !== undefined) this.importMapCache.delete(oldestVersion);
    }
    this.importMapCache.set(version, importMap);
    return importMap;
  }
}

export const reactStrategy = new ReactStrategy();
