import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { addEsmShDeps, isEsmShUrl } from "../url-builder.ts";

export class UrlStrategy implements ImportRewriteStrategy {
  readonly name = "url";
  readonly priority = 7;

  matches(specifier: string): boolean {
    return isEsmShUrl(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    const specifier = addEsmShDeps(info.specifier, ctx.reactVersion);
    return { specifier: specifier === info.specifier ? null : specifier };
  }
}

export const urlStrategy = new UrlStrategy();
