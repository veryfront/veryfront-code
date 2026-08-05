import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { addEsmShDeps, buildPinnedEsmShUrl, isEsmShUrl, parseEsmShUrl } from "../url-builder.ts";
import {
  isPinningEnabledForRewrite,
  resolveDependencyPinForImport,
} from "../dependency-resolution.ts";

/**
 * Apply the dependency pin ladder to an esm.sh URL already written into user
 * source. Studio's component install wrote these URLs unversioned, and a URL is
 * never seen by the bare-specifier ladder, so without this they float forever.
 *
 * React keeps its own resolution ladder and is deliberately excluded.
 */
function pinEsmShUrlSpecifier(specifier: string, ctx: RewriteContext): string {
  if (!isPinningEnabledForRewrite(ctx)) return specifier;

  const parsed = parseEsmShUrl(specifier);
  if (!parsed || parsed.version) return specifier;
  if (parsed.packageName === "react" || parsed.packageName === "react-dom") {
    return specifier;
  }

  const pinned = resolveDependencyPinForImport(parsed.packageName, ctx);
  return pinned ? buildPinnedEsmShUrl(parsed, pinned) : specifier;
}

export class UrlStrategy implements ImportRewriteStrategy {
  readonly name = "url";
  readonly priority = 7;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return isEsmShUrl(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    const pinned = pinEsmShUrlSpecifier(info.specifier, ctx);
    const specifier = addEsmShDeps(pinned, ctx.reactVersion);
    return { specifier: specifier === info.specifier ? null : specifier };
  }
}

export const urlStrategy = new UrlStrategy();
