/**
 * React import rewriting strategy.
 *
 * Priority: 0 (first)
 * Handles: react, react-dom, react/*, react-dom/*
 */

import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.js";
import { getReactImportMap } from "../url-builder.js";

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

    if (mapped) {
      return { specifier: mapped };
    }

    // Handle react/* subpaths not explicitly mapped
    if (info.specifier.startsWith("react/")) {
      const prefix = importMap["react/"];
      if (prefix) {
        const subpath = info.specifier.slice("react/".length);
        return { specifier: prefix + subpath };
      }
    }

    return { specifier: null };
  }

  private getImportMap(version: string): Record<string, string> {
    let cached = this.importMapCache.get(version);
    if (!cached) {
      cached = getReactImportMap(version);
      this.importMapCache.set(version, cached);
    }
    return cached;
  }
}

export const reactStrategy = new ReactStrategy();
