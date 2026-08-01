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
import { collectCssImportPaths } from "#veryfront/html/styles-builder/css-import-extraction.ts";
import type { HandlerContext } from "../types.ts";
import {
  collectProjectStyleSourceSnapshot,
  type ProjectStyleSourceFile,
} from "./styles-source-file-collector.ts";
import {
  admitProjectStyleSourceFiles,
  isProjectStyleSourceSnapshot,
  type ProjectStyleSourceSnapshot,
} from "#veryfront/html/styles-builder/project-style-source-snapshot.ts";

const logger = serverLogger.component("styles-css-import-scanner");

/**
 * Scan project source files for CSS imports and return the resolved absolute
 * paths, deduplicated. Mirrors the file coverage of the CSS candidate
 * scanner: the FS adapter's `getAllSourceFiles()` in proxy/remote mode, and a
 * recursive local walk otherwise.
 */
export async function extractProjectCssImports(
  ctx: HandlerContext,
  sourceInput?: readonly ProjectStyleSourceFile[] | ProjectStyleSourceSnapshot,
): Promise<string[]> {
  const capturedSnapshot = sourceInput === undefined
    ? await collectProjectStyleSourceSnapshot(ctx)
    : isProjectStyleSourceSnapshot(sourceInput)
    ? sourceInput
    : undefined;
  if (capturedSnapshot?.files === null) {
    throw new TypeError("CSS source snapshot does not contain a source listing");
  }
  const files = capturedSnapshot?.files ?? await admitProjectStyleSourceFiles(
    sourceInput,
    {
      adapter: ctx.adapter,
      projectDir: ctx.projectDir,
      config: ctx.config ?? {},
    },
  );
  const cssImports = collectCssImportPaths(files, ctx.projectDir);

  if (cssImports.length > 0) {
    logger.debug("Discovered module CSS imports", {
      projectDir: ctx.projectDir,
      count: cssImports.length,
    });
  }

  return cssImports;
}
