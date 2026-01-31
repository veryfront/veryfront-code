/**
 * CSS Pre-generation Utility
 *
 * Triggers CSS generation early (after files are fetched) instead of waiting
 * until HTML shell generation during SSR. This runs in parallel with other
 * initialization work, reducing first-request latency by ~2-3 seconds.
 */

import { serverLogger as logger } from "#veryfront/utils";
import { extractCandidatesFromFiles, getProjectCSS } from "./tailwind-compiler.ts";

export interface CSSPregenerationOptions {
  /** Project slug for cache keying */
  projectSlug: string;
  /** List of files with content to extract candidates from */
  files: Array<{ path: string; content?: string }>;
  /** Optional custom stylesheet (globals.css content) */
  stylesheet?: string;
  /** Optional stylesheet path (from config) to locate content in files */
  stylesheetPath?: string;
  /** Enable minification (default: true) */
  minify?: boolean;
}

/**
 * Pre-generate and cache CSS from file list.
 *
 * This extracts Tailwind candidates from source files and generates CSS,
 * storing it in the distributed cache for later retrieval during SSR.
 *
 * Should be called after files are fetched but before SSR starts.
 * This is non-blocking and fire-and-forget - errors are logged but not thrown.
 *
 * @param options Pre-generation options
 * @returns Promise that resolves when CSS is generated (or immediately on error)
 */
export async function pregenerateCSSFromFiles(
  options: CSSPregenerationOptions,
): Promise<void> {
  const { projectSlug, files, stylesheet, stylesheetPath, minify = true } = options;
  const startTime = performance.now();

  try {
    const candidates = extractCandidatesFromFiles(files);

    if (candidates.size === 0) {
      logger.debug("[CSSPregeneration] No candidates found, skipping", {
        projectSlug,
        fileCount: files.length,
      });
      return;
    }

    const resolvedStylesheet = stylesheet ?? findStylesheetFromFiles(files, stylesheetPath);

    logger.debug("[CSSPregeneration] Starting", {
      projectSlug,
      fileCount: files.length,
      candidateCount: candidates.size,
      hasStylesheet: Boolean(resolvedStylesheet),
    });

    const result = await getProjectCSS(projectSlug, resolvedStylesheet, candidates, { minify });
    const duration = performance.now() - startTime;

    logger.debug("[CSSPregeneration] Complete", {
      projectSlug,
      candidateCount: candidates.size,
      cssLength: result.css.length,
      cssHash: result.hash,
      fromCache: result.fromCache,
      duration: `${duration.toFixed(2)}ms`,
    });
  } catch (error) {
    const duration = performance.now() - startTime;

    logger.warn("[CSSPregeneration] Failed", {
      projectSlug,
      error: error instanceof Error ? error.message : String(error),
      duration: `${duration.toFixed(2)}ms`,
    });
  }
}

/**
 * Find stylesheet content from file list using a configured path or defaults.
 */
export function findStylesheetFromFiles(
  files: Array<{ path: string; content?: string }>,
  stylesheetPath?: string,
): string | undefined {
  if (stylesheetPath) {
    const normalized = stylesheetPath.replace(/^\/+/, "");
    const file = files.find(
      (f) => f.content && (f.path === normalized || f.path.endsWith(`/${normalized}`)),
    );
    if (file?.content) return file.content;
  }

  return findGlobalStylesheet(files);
}

/**
 * Find the globals.css content from a file list.
 *
 * Searches for common stylesheet file patterns:
 * - globals.css, global.css
 * - styles/globals.css
 * - app/globals.css
 *
 * @param files List of files with content
 * @returns Stylesheet content or undefined if not found
 */
export function findGlobalStylesheet(
  files: Array<{ path: string; content?: string }>,
): string | undefined {
  const stylesheetPatterns = [
    /globals\.css$/,
    /global\.css$/,
    /styles\/globals\.css$/,
    /app\/globals\.css$/,
    /src\/globals\.css$/,
    /src\/styles\/globals\.css$/,
  ];

  for (const pattern of stylesheetPatterns) {
    const file = files.find((f) => f.content && pattern.test(f.path));
    if (file?.content) return file.content;
  }

  return undefined;
}
