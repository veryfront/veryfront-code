/**
 * CSS Pre-generation Utility
 *
 * Triggers CSS generation early (after files are fetched) instead of waiting
 * until HTML shell generation during SSR. This runs in parallel with other
 * initialization work, reducing first-request latency by ~2-3 seconds.
 */

import { serverLogger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { resolveRelativePath } from "#veryfront/modules/react-loader/path-resolver.ts";
import { extractCandidatesFromFiles, getProjectCSS } from "./tailwind-compiler.ts";
import {
  createPreparedProjectCSSContext,
  storePreparedProjectCSS,
  tryGetPreparedProjectCSS,
} from "./prepared-project-css-cache.ts";
import {
  shouldIncludeStylePath,
  shouldTraverseStyleDirectory,
  type StyleScopeProfile,
} from "./style-scope-profile.ts";
import {
  MAX_STYLE_SOURCE_FILE_BYTES,
  MAX_STYLE_SOURCE_FILES,
  MAX_STYLESHEET_BYTES,
  MAX_TOTAL_STYLE_SOURCE_BYTES,
  utf8ByteLength,
} from "./resource-limits.ts";

const logger = serverLogger.component("css-pregeneration");
const inFlightPreparedCSSBuilds = new Map<string, Promise<void>>();
const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];
const MAX_LOCAL_SOURCE_DEPTH = 64;
const MAX_LOCAL_SOURCE_ENTRIES = 100_000;
const MAX_IN_FLIGHT_PREPARED_CSS_BUILDS = 32;

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

interface LocalProjectSourceFilesOptions {
  projectDir: string;
  styleProfile: StyleScopeProfile;
  fs?: FileSystem;
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

export async function collectLocalProjectSourceFiles(
  options: LocalProjectSourceFilesOptions,
): Promise<Array<{ path: string; content?: string }>> {
  const fs = options.fs ?? createFileSystem();
  const files: Array<{ path: string; content?: string }> = [];
  let totalBytes = 0;
  let visitedEntries = 0;

  const scanDir = async (directoryPath: string, depth: number): Promise<void> => {
    if (depth > MAX_LOCAL_SOURCE_DEPTH) {
      throw new TypeError("Style source directory depth exceeds the scan limit");
    }
    let entries: AsyncIterable<{
      name: string;
      isFile: boolean;
      isDirectory: boolean;
      isSymlink?: boolean;
    }>;
    try {
      entries = fs.readDir(directoryPath);
    } catch {
      return;
    }

    for await (const entry of entries) {
      visitedEntries++;
      if (visitedEntries > MAX_LOCAL_SOURCE_ENTRIES) {
        throw new TypeError("Style source entries exceed the scan limit");
      }
      if (entry.isSymlink) continue;
      const fullPath = join(directoryPath, entry.name);

      if (entry.isDirectory) {
        if (shouldTraverseStyleDirectory(options.styleProfile, fullPath, options.projectDir)) {
          await scanDir(fullPath, depth + 1);
        }
        continue;
      }

      if (!entry.isFile) continue;
      if (!shouldIncludeStylePath(options.styleProfile, fullPath, options.projectDir)) continue;
      if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;

      if (files.length >= MAX_STYLE_SOURCE_FILES) {
        throw new TypeError("Style source file count exceeds the scan limit");
      }

      let fileInfo: Awaited<ReturnType<FileSystem["stat"]>>;
      let content: string;
      try {
        fileInfo = await fs.stat(fullPath);
        if (fileInfo.size > MAX_STYLE_SOURCE_FILE_BYTES) continue;
        content = await fs.readTextFile(fullPath);
      } catch {
        // ignore unreadable files during warmup
        continue;
      }

      const contentBytes = utf8ByteLength(content);
      if (contentBytes > MAX_STYLE_SOURCE_FILE_BYTES) continue;
      if (totalBytes + contentBytes > MAX_TOTAL_STYLE_SOURCE_BYTES) {
        throw new TypeError("Style source bytes exceed the scan limit");
      }
      files.push({ path: fullPath, content });
      totalBytes += contentBytes;
    }
  };

  await scanDir(options.projectDir, 0);
  return files;
}

export async function readLocalProjectStylesheet(
  projectDir: string,
  stylesheetPath?: string,
  fs: FileSystem = createFileSystem(),
): Promise<string | undefined> {
  const hasConfiguredStylesheet = Boolean(stylesheetPath);
  const candidatePaths = hasConfiguredStylesheet ? [stylesheetPath!.replace(/^\/+/, "")] : [
    "globals.css",
    "global.css",
    "styles/globals.css",
    "app/globals.css",
    "src/globals.css",
    "src/styles/globals.css",
  ];

  for (const candidatePath of candidatePaths) {
    let relativePath: string;
    try {
      relativePath = resolveRelativePath(candidatePath, projectDir);
    } catch (error) {
      if (hasConfiguredStylesheet) {
        throw new TypeError("Configured stylesheet path is invalid", { cause: error });
      }
      continue;
    }
    const absolutePath = join(projectDir, relativePath);
    let fileInfo: Awaited<ReturnType<FileSystem["stat"]>>;
    try {
      if (fs.realPath) {
        const [realProjectDir, realCandidate] = await Promise.all([
          fs.realPath(projectDir),
          fs.realPath(absolutePath),
        ]);
        resolveRelativePath(realCandidate, realProjectDir);
      }
      fileInfo = await fs.stat(absolutePath);
    } catch (error) {
      if (hasConfiguredStylesheet) {
        throw new TypeError("Configured stylesheet could not be read", { cause: error });
      }
      continue;
    }

    if (!fileInfo.isFile) {
      if (hasConfiguredStylesheet) {
        throw new TypeError("Configured stylesheet path must reference a file");
      }
      continue;
    }
    if (fileInfo.size > MAX_STYLESHEET_BYTES) {
      if (hasConfiguredStylesheet) {
        throw new TypeError("Configured stylesheet exceeds the 2 MiB size limit");
      }
      continue;
    }

    let content: string;
    try {
      content = await fs.readTextFile(absolutePath);
    } catch (error) {
      if (hasConfiguredStylesheet) {
        throw new TypeError("Configured stylesheet could not be read", { cause: error });
      }
      continue;
    }
    if (utf8ByteLength(content) > MAX_STYLESHEET_BYTES) {
      if (hasConfiguredStylesheet) {
        throw new TypeError("Configured stylesheet exceeds the 2 MiB size limit");
      }
      continue;
    }
    return content;
  }

  return undefined;
}

/**
 * Trigger prepared CSS generation in the background when the artifact is not
 * already cached or currently being built.
 */
export async function warmPreparedCSSArtifactFromFiles(
  options: CSSPregenerationOptions,
): Promise<boolean> {
  const stylesheet = options.stylesheet ??
    findStylesheetFromFiles(options.files, options.stylesheetPath);
  const context = createPreparedProjectCSSContext(
    options.projectSlug,
    options.projectVersion,
    stylesheet,
    options.styleProfile.hash,
    {
      minify: options.minify ?? true,
      environment: options.environment ?? "preview",
      buildMode: options.buildMode ?? "production",
    },
  );

  if (await tryGetPreparedProjectCSS(context)) return false;
  if (inFlightPreparedCSSBuilds.has(context.cacheKey)) return false;
  if (inFlightPreparedCSSBuilds.size >= MAX_IN_FLIGHT_PREPARED_CSS_BUILDS) return false;

  const task = buildPreparedCSSArtifactFromFiles({
    ...options,
    stylesheet,
  }).then(() => {
    logger.debug("Warm prepared CSS complete");
  }).catch((error) => {
    logger.debug("Warm prepared CSS failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }).finally(() => {
    inFlightPreparedCSSBuilds.delete(context.cacheKey);
  });

  inFlightPreparedCSSBuilds.set(context.cacheKey, task);
  return true;
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
    files,
    styleProfile,
    stylesheet,
  } = options;
  const startTime = performance.now();

  try {
    logger.debug("Starting", {
      fileCount: files.length,
      hasStylesheet: Boolean(stylesheet),
      styleProfileHash: styleProfile.hash,
    });

    const result = await buildPreparedCSSArtifactFromFiles(options);
    const duration = performance.now() - startTime;

    logger.debug("Complete", {
      candidateCount: result.candidateCount,
      cssLength: result.css.length,
      cssHash: result.hash,
      fromCache: result.fromCache,
      duration: `${duration.toFixed(2)}ms`,
    });
  } catch (error) {
    const duration = performance.now() - startTime;

    logger.warn("Failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
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
    let normalized: string;
    try {
      normalized = resolveRelativePath(stylesheetPath.replace(/^\/+/, ""), ".");
    } catch {
      return findGlobalStylesheet(files);
    }
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
    /(?:^|\/)globals\.css$/,
    /(?:^|\/)global\.css$/,
  ];

  for (const pattern of stylesheetPatterns) {
    const file = files.find((f) => f.content && pattern.test(f.path));
    if (file?.content) return file.content;
  }

  return undefined;
}
