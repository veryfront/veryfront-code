/**
 * Styles CSS Import Scanner
 *
 * Discovers CSS files imported by project source modules (side-effect imports
 * like `import "./styles.css"` in app/layout.tsx, `@/` alias imports, and CSS
 * module imports). The production SSR pipeline collects these imports while
 * loading modules and merges them into the page stylesheet; the page-agnostic
 * /_vf_styles/styles.css dev route has no module-loading pass, so this scanner
 * recovers the same information from project sources using the shared
 * css-import-extraction helpers.
 *
 * @module server/handlers/dev/styles-css-import-scanner
 */

import { serverLogger } from "#veryfront/utils";
import { normalizePath } from "#veryfront/utils/path-utils.ts";
import {
  collectCssImportPaths,
  CSS_IMPORTING_SOURCE_EXTENSIONS,
} from "#veryfront/html/styles-builder/css-import-extraction.ts";
import {
  createStyleScopeProfile,
  shouldIncludeStylePath,
  shouldTraverseStyleDirectory,
} from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import type { HandlerContext } from "../types.ts";

const logger = serverLogger.component("styles-css-import-scanner");

interface SourceFileProvider {
  getAllSourceFiles?: () =>
    | Array<{ path: string; content?: string }>
    | Promise<Array<{ path: string; content?: string }>>;
}

/**
 * Scan project source files for CSS imports and return the resolved absolute
 * paths, deduplicated. Mirrors the file coverage of the Tailwind candidate
 * scanner: the FS adapter's `getAllSourceFiles()` in proxy/remote mode, and a
 * recursive local walk otherwise.
 */
export async function extractProjectCssImports(ctx: HandlerContext): Promise<string[]> {
  const files = await collectSourceFiles(ctx);
  const cssImports = collectCssImportPaths(files, ctx.projectDir);

  if (cssImports.length > 0) {
    logger.debug("Discovered module CSS imports", {
      projectDir: ctx.projectDir,
      count: cssImports.length,
    });
  }

  return cssImports;
}

async function collectSourceFiles(
  ctx: HandlerContext,
): Promise<Array<{ path: string; content: string }>> {
  const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
  const fsAdapter = typeof wrappedFs.getUnderlyingAdapter === "function"
    ? wrappedFs.getUnderlyingAdapter() as SourceFileProvider
    : undefined;

  if (typeof fsAdapter?.getAllSourceFiles === "function") {
    const files = await fsAdapter.getAllSourceFiles();
    const collected: Array<{ path: string; content: string }> = [];

    for (const file of files) {
      if (!CSS_IMPORTING_SOURCE_EXTENSIONS.some((ext) => file.path.endsWith(ext))) continue;
      const absolutePath = file.path.startsWith("/")
        ? normalizePath(file.path)
        : normalizePath(join(ctx.projectDir, file.path));
      const content = file.content ?? await readFileOrNull(ctx, absolutePath);
      if (content === null) continue;
      collected.push({ path: absolutePath, content });
    }

    return collected;
  }

  return scanLocalSourceFiles(ctx);
}

async function readFileOrNull(ctx: HandlerContext, path: string): Promise<string | null> {
  try {
    return await ctx.adapter.fs.readFile(path);
  } catch (_) {
    /* expected: skip files that can't be read */
    return null;
  }
}

/** Fallback for local development mode: walk the project directory on disk. */
async function scanLocalSourceFiles(
  ctx: HandlerContext,
): Promise<Array<{ path: string; content: string }>> {
  const styleProfile = createStyleScopeProfile(ctx.config);
  const fs = createFileSystem();
  const collected: Array<{ path: string; content: string }> = [];

  const scanDir = async (dir: string): Promise<void> => {
    let entries: AsyncIterable<{ name: string; isDirectory: boolean; isFile: boolean }>;
    try {
      entries = fs.readDir(dir);
    } catch (_) {
      /* expected: directory may not exist */
      return;
    }

    for await (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        if (shouldTraverseStyleDirectory(styleProfile, fullPath, ctx.projectDir)) {
          await scanDir(fullPath);
        }
        continue;
      }

      if (!entry.isFile) continue;
      if (!shouldIncludeStylePath(styleProfile, fullPath, ctx.projectDir)) continue;
      if (!CSS_IMPORTING_SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;

      const content = await readFileOrNull(ctx, fullPath);
      if (content === null) continue;
      collected.push({ path: normalizePath(fullPath), content });
    }
  };

  try {
    await scanDir(ctx.projectDir);
  } catch (error) {
    logger.warn("Failed to scan local files for CSS imports", {
      projectDir: ctx.projectDir,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return collected;
}
