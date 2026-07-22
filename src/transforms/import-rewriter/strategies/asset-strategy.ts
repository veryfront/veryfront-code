import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { COMPILATION_ERROR } from "#veryfront/errors";

/**
 * Static asset extensions that are not JavaScript modules.
 *
 * `.css` is deliberately absent — CSS imports are supported and are stripped
 * by the pipeline's CSS stage before import resolution runs, so they never
 * reach this strategy.
 */
const ASSET_EXTENSION_PATTERN =
  /\.(?:svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf)(?:\?.*)?$/i;

/**
 * Reject `import logo from "@/assets/logo.svg"`.
 *
 * Veryfront serves static assets from `public/` at the root path; it has no
 * asset-import model, so there is nothing to rewrite such a specifier to.
 * Previously the alias and relative strategies fell through to their
 * "no extension, add .js" branch and emitted `assets/logo.svg.js`, so the
 * failure surfaced as:
 *
 *     Module not found "file:///_vf_modules/assets/logo.svg.js"
 *
 * naming a file the author never wrote, in a directory that does not exist.
 * Failing here instead names the real file and the supported alternative.
 */
export class AssetStrategy implements ImportRewriteStrategy {
  readonly name = "asset";
  // Ahead of the alias (1) and relative strategies so it sees both
  // `@/assets/logo.svg` and `./logo.svg`.
  readonly priority = 0.6;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return ASSET_EXTENSION_PATTERN.test(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    // Name the importing file relative to the project. A path outside it is a
    // machine path, so only the file name goes in the message.
    const importer = ctx.filePath.startsWith(ctx.projectDir)
      ? ctx.filePath.slice(ctx.projectDir.length).replace(/^\/+/, "")
      : ctx.filePath.split("/").pop() ?? ctx.filePath;
    const fileName = (info.specifier.split("/").pop() ?? info.specifier).split(/[?#]/, 1)[0] ??
      info.specifier;

    throw COMPILATION_ERROR.create({
      detail: `Cannot import the static asset "${info.specifier}" as a module (in ${importer}). ` +
        `Veryfront serves static assets from public/ at the root path. ` +
        `Move the file to public/${fileName} and reference it by URL instead, ` +
        `for example <img src="/${fileName}" />. ` +
        `See docs/guides/project-structure.md.`,
    });
  }
}

export const assetStrategy = new AssetStrategy();
