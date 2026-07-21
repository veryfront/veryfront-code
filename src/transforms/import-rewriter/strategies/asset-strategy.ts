import {
  classifySpecifier,
  type ImportRewriteStrategy,
  type ImportSpecifierInfo,
  type RewriteContext,
  type RewriteResult,
} from "../types.ts";
import { relativeToProjectDir } from "../project-paths.ts";
import { COMPILATION_ERROR } from "#veryfront/errors";

/**
 * Static asset extensions that are not JavaScript modules.
 *
 * Two common non-code extensions are deliberately absent:
 *
 * - `.css` is supported. The pipeline's CSS stage strips CSS imports before
 *   import resolution runs, so they never reach this strategy.
 * - `.json` is supported through `with { type: "json" }`, which the compile
 *   stage preserves. `matches()` sees the specifier only, never the import
 *   attributes, so it cannot tell a supported JSON import from an unsupported
 *   one and must leave both alone.
 */
const ASSET_EXTENSION_PATTERN =
  /\.(?:svg|png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|ogg|pdf|wasm|node|txt|ya?ml|csv)(?:\?.*)?$/i;

const IMAGE_EXTENSIONS = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|bmp|tiff?)$/i;
const FONT_EXTENSIONS = /\.(?:woff2?|ttf|otf|eot)$/i;
const VIDEO_EXTENSIONS = /\.(?:mp4|webm|mov)$/i;

/** Strip a `?raw`-style suffix, which is part of the specifier and not of the file name. */
function withoutQuery(specifier: string): string {
  const queryIndex = specifier.indexOf("?");
  return queryIndex === -1 ? specifier : specifier.slice(0, queryIndex);
}

/**
 * Path the file would have under `public/`.
 *
 * The directories the specifier walks through are kept, so a project with both
 * `assets/icons/logo.svg` and `assets/brand/logo.svg` gets two distinct
 * destinations. For an alias specifier the first segment is the asset root
 * (`@/assets/icons/logo.svg` maps to `icons/logo.svg`); a relative specifier
 * has no such root to drop.
 */
function publicPath(specifier: string): string {
  const path = withoutQuery(specifier);

  if (path.startsWith("@/")) {
    const segments = path.slice(2).split("/").filter(Boolean);
    return (segments.length > 1 ? segments.slice(1) : segments).join("/");
  }

  return path.split("/").filter((segment) => segment !== "." && segment !== "..").join("/");
}

/** How to reference the file once it is served from `public/`. */
function usageExample(publicUrl: string): string {
  if (IMAGE_EXTENSIONS.test(publicUrl)) {
    return `reference it by URL instead, for example <img src="${publicUrl}" />`;
  }

  if (FONT_EXTENSIONS.test(publicUrl)) {
    return `load it from your stylesheet instead, for example an @font-face rule with src: url("${publicUrl}")`;
  }

  if (VIDEO_EXTENSIONS.test(publicUrl)) {
    return `reference it by URL instead, for example <video src="${publicUrl}"></video>`;
  }

  return `reference ${publicUrl} directly instead`;
}

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
  // Ahead of the alias (1) and relative (3) strategies so it sees both
  // `@/assets/logo.svg` and `./logo.svg`.
  readonly priority = 0.6;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    // The advice this strategy gives is "move the file into public/", which
    // only applies to a file in the project. Every other specifier kind belongs
    // to a strategy that knows where the file really lives: a package, another
    // project, an import map entry, or a remote URL.
    const type = classifySpecifier(specifier);
    if (type !== "alias" && type !== "relative") return false;

    return ASSET_EXTENSION_PATTERN.test(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    // Name the importing file relative to the project. A path outside it is a
    // machine path, so only the file name goes in the message.
    const importer = relativeToProjectDir(ctx.filePath, ctx.projectDir) ??
      ctx.filePath.split("/").pop() ?? ctx.filePath;
    const destination = publicPath(info.specifier);
    const publicUrl = `/${destination}`;

    throw COMPILATION_ERROR.create({
      detail: `Cannot import the static asset "${info.specifier}" as a module (in ${importer}). ` +
        `Veryfront serves static assets from public/ at the root path. ` +
        `Move the file to public/${destination} and ${usageExample(publicUrl)}. ` +
        `See docs/guides/project-structure.md.`,
    });
  }
}

export const assetStrategy = new AssetStrategy();
