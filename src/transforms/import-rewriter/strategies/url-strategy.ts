/**
 * URL import handling strategy.
 *
 * Priority: 7
 * Handles: esm.sh URLs that need deps added
 */

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

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return isEsmShUrl(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    // Add deps to esm.sh URLs that don't have them
    const withDeps = addEsmShDeps(info.specifier, ctx.reactVersion);

    if (withDeps !== info.specifier) {
      return { specifier: withDeps };
    }

    return { specifier: null };
  }
}

export const urlStrategy = new UrlStrategy();
