import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { getReactImportMap } from "../url-builder.ts";

export class ReactStrategy implements ImportRewriteStrategy {
  readonly name = "react";
  readonly priority = 0;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return (
      specifier === "react" ||
      specifier === "react-dom" ||
      specifier.startsWith("react/") ||
      specifier.startsWith("react-dom/")
    );
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    const importMap = getReactImportMap(ctx.reactVersion);
    const mapped = importMap[info.specifier];

    if (mapped) return { specifier: mapped };

    if (!info.specifier.startsWith("react/")) return { specifier: null };

    const prefix = importMap["react/"];
    if (!prefix) return { specifier: null };

    return { specifier: prefix + info.specifier.slice("react/".length) };
  }
}

export const reactStrategy = new ReactStrategy();
