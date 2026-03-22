/**
 * CSS Pre-generation Utility
 *
 * Triggers CSS generation early (after files are fetched) instead of waiting
 * until HTML shell generation during SSR. This runs in parallel with other
 * initialization work, reducing first-request latency by ~2-3 seconds.
 */

import { serverLogger } from "#veryfront/utils";
import { extractCandidatesFromFiles, getProjectCSS } from "./tailwind-compiler.ts";
import {
  createPreparedProjectCSSContext,
  storePreparedProjectCSS,
} from "./prepared-project-css-cache.ts";
import type { StyleScopeProfile } from "./style-scope-profile.ts";

const logger = serverLogger.component("css-pregeneration");

interface CSSPregenerationOptions {
  /** Project slug for cache keying */
  projectSlug: string;
  /** Current content version for the prepared stylesheet artifact */
  projectVersion: string;
  /** Project root used for style scope filtering */
  projectDir?: string;
  /** List of files with content to extract candidates from */
  files: Array<{ path: string; content?: string }>;
  /** Style scope profile for convention-based filtering */
  styleProfile: StyleScopeProfile;
  /** Optional custom stylesheet (globals.css content) */
  stylesheet?: string;
  /** Optional stylesheet path (from config) to locate content in files */
  stylesheetPath?: string;
  /** Enable minification (default: true) */
  minify?: boolean;
  /** Environment segment used for prepared artifact cache partitioning */
  environment?: string;
  /** Build mode recorded in the prepared artifact profile */
  buildMode?: "development" | "production";
}

export interface PreparedCSSArtifactBuildResult {
  css: string;
  hash: string;
  candidateCount: number;
  fromCache: boolean;
  context: ReturnType<typeof createPreparedProjectCSSContext>;
}

export async function buildPreparedCSSArtifactFromFiles(
  options: CSSPregenerationOptions,
): Promise<PreparedCSSArtifactBuildResult> {
  const {
    projectSlug,
    projectVersion,
    projectDir,
    files,
    styleProfile,
    stylesheet,
    stylesheetPath,
    minify = true,
    environment = "preview",
    buildMode = "production",
  } = options;

  const resolvedStylesheet = stylesheet ?? findStylesheetFromFiles(files, stylesheetPath);
  const candidates = extractCandidatesFromFiles(files, {
    projectDir,
    styleProfile,
  });

  const result = await getProjectCSS(projectSlug, resolvedStylesheet, candidates, {
    minify,
    environment,
    buildMode,
  });
  const context = createPreparedProjectCSSContext(
    projectSlug,
    projectVersion,
    resolvedStylesheet,
    styleProfile.hash,
    { minify, environment, buildMode },
  );

  await storePreparedProjectCSS(context, { css: result.css, hash: result.hash });

  return {
    css: result.css,
    hash: result.hash,
    candidateCount: candidates.size,
    fromCache: result.fromCache,
    context,
  };
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
  const {
    projectSlug,
    projectVersion,
    files,
    styleProfile,
    stylesheet,
  } = options;
  const startTime = performance.now();

  try {
    logger.debug("Starting", {
      projectSlug,
      projectVersion,
      fileCount: files.length,
      hasStylesheet: Boolean(stylesheet),
      styleProfileHash: styleProfile.hash,
    });

    const result = await buildPreparedCSSArtifactFromFiles(options);
    const duration = performance.now() - startTime;

    logger.debug("Complete", {
      projectSlug,
      projectVersion,
      candidateCount: result.candidateCount,
      cssLength: result.css.length,
      cssHash: result.hash,
      fromCache: result.fromCache,
      duration: `${duration.toFixed(2)}ms`,
    });
  } catch (error) {
    const duration = performance.now() - startTime;

    logger.warn("Failed", {
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
