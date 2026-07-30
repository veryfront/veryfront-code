/**
 * CSS Pre-generation Utility
 *
 * Triggers CSS generation early (after files are fetched) instead of waiting
 * until HTML shell generation during SSR. This runs in parallel with other
 * initialization work, reducing first-request latency by ~2-3 seconds.
 */

import { serverLogger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import { isAbsolute } from "#veryfront/compat/path/resolution.ts";
import {
  createFileSystem,
  type FileSystem,
  isNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import {
  acquireCSSGenerationSession,
  type CSSGenerationSession,
  extractCandidatesFromFiles,
  getProjectCSS,
  isCSSGenerationSession,
} from "./css-compiler.ts";
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
  assertCanonicalStylesheetPath,
  DEFAULT_PROJECT_STYLESHEET_PATHS,
  resolveProjectStylesheetPath,
  sourceFileMatchesStylesheetPath,
} from "./stylesheet-path.ts";
import { hasControlCharacters } from "../../build/utils/string-validation.ts";

const logger = serverLogger.component("css-pregeneration");
const inFlightPreparedCSSBuilds = new Map<string, Promise<void>>();
const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];
const MAX_SOURCE_TREE_DEPTH = 64;
const MAX_SOURCE_TREE_ENTRIES = 100_000;
const MAX_SOURCE_CONTENT_BYTES = 64 * 1024 * 1024;

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
  /** Internal compiler/optimizer pair captured with the prepared identity. */
  generationSession?: CSSGenerationSession;
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

async function resolveCSSGenerationSession(
  minify: boolean,
  session?: CSSGenerationSession,
): Promise<CSSGenerationSession> {
  const resolved = session ?? await acquireCSSGenerationSession(minify);
  if (!isCSSGenerationSession(resolved)) {
    throw new TypeError("Prepared CSS generation session was not acquired by core");
  }
  if (resolved.minify !== minify) {
    throw new TypeError(
      "Prepared CSS generation session minification mode does not match",
    );
  }
  return resolved;
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

  const discoveredStylesheet = stylesheet ??
    findStylesheetFromFiles(files, stylesheetPath, projectDir);
  if (stylesheetPath !== undefined && discoveredStylesheet === undefined) {
    throw new TypeError(
      `Configured stylesheet ${JSON.stringify(stylesheetPath)} was not available in project source`,
    );
  }
  const candidates = extractCandidatesFromFiles(files, {
    projectDir,
    styleProfile,
  });
  const session = await resolveCSSGenerationSession(
    minify,
    options.generationSession,
  );
  const resolvedStylesheet = discoveredStylesheet ??
    session.compilationSession.defaultStylesheet;

  const result = await getProjectCSS(projectSlug, resolvedStylesheet, candidates, {
    minify,
    environment,
    buildMode,
  }, { generationSession: session });
  const context = createPreparedProjectCSSContext(
    projectSlug,
    projectVersion,
    resolvedStylesheet,
    styleProfile.hash,
    {
      cssPipelineIdentity: session.cacheIdentity,
      minify,
      environment,
      buildMode,
    },
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
  if (!isAbsolute(options.projectDir)) {
    throw new TypeError("CSS source project directory must be absolute");
  }
  const fs = options.fs ?? createFileSystem();
  const files: Array<{ path: string; content?: string }> = [];
  const encoder = new TextEncoder();
  let visitedEntries = 0;
  let sourceBytes = 0;

  const scanDir = async (directoryPath: string, depth: number): Promise<void> => {
    if (depth > MAX_SOURCE_TREE_DEPTH) {
      throw new TypeError(
        `CSS source tree exceeds ${MAX_SOURCE_TREE_DEPTH} directory levels`,
      );
    }

    const entries = [];
    for await (const entry of fs.readDir(directoryPath)) {
      visitedEntries++;
      if (visitedEntries > MAX_SOURCE_TREE_ENTRIES) {
        throw new TypeError(
          `CSS source tree exceeds ${MAX_SOURCE_TREE_ENTRIES} entries`,
        );
      }
      entries.push(entry);
    }
    entries.sort((left, right) => left.name === right.name ? 0 : left.name < right.name ? -1 : 1);

    for (const entry of entries) {
      if (
        entry.name.length === 0 ||
        entry.name === "." ||
        entry.name === ".." ||
        entry.name.includes("/") ||
        entry.name.includes("\\") ||
        hasControlCharacters(entry.name)
      ) {
        throw new TypeError("CSS source directory returned an invalid entry name");
      }
      const fullPath = join(directoryPath, entry.name);

      if (entry.isSymlink) continue;

      if (entry.isDirectory) {
        if (shouldTraverseStyleDirectory(options.styleProfile, fullPath, options.projectDir)) {
          await scanDir(fullPath, depth + 1);
        }
        continue;
      }

      if (!entry.isFile) continue;
      if (!shouldIncludeStylePath(options.styleProfile, fullPath, options.projectDir)) continue;
      if (!SOURCE_EXTENSIONS.some((extension) => entry.name.toLowerCase().endsWith(extension))) {
        continue;
      }

      if (fs.lstat && (await fs.lstat(fullPath)).isSymlink) continue;
      const info = await fs.stat(fullPath);
      if (!Number.isSafeInteger(info.size) || info.size < 0) {
        throw new TypeError(`CSS source file has an invalid size: ${entry.name}`);
      }
      if (info.size > MAX_SOURCE_CONTENT_BYTES - sourceBytes) {
        throw new TypeError(
          `CSS source content exceeds ${MAX_SOURCE_CONTENT_BYTES} bytes`,
        );
      }
      const content = await fs.readTextFile(fullPath);
      const contentBytes = encoder.encode(content).byteLength;
      if (contentBytes > MAX_SOURCE_CONTENT_BYTES - sourceBytes) {
        throw new TypeError(
          `CSS source content exceeds ${MAX_SOURCE_CONTENT_BYTES} bytes`,
        );
      }
      sourceBytes += contentBytes;
      files.push({ path: fullPath, content });
    }
  };

  await scanDir(options.projectDir, 0);
  return files;
}

async function assertNoStylesheetSymlink(
  fs: FileSystem,
  projectDir: string,
  relativePath: string,
): Promise<void> {
  if (!fs.lstat) return;

  let candidate = projectDir;
  for (const segment of relativePath.split("/")) {
    candidate = join(candidate, segment);
    if ((await fs.lstat(candidate)).isSymlink) {
      throw new TypeError(
        `Stylesheet path cannot traverse a symbolic link: ${JSON.stringify(relativePath)}`,
      );
    }
  }
}

export async function readLocalProjectStylesheet(
  projectDir: string,
  stylesheetPath?: string,
  fs: FileSystem = createFileSystem(),
): Promise<string | undefined> {
  if (stylesheetPath !== undefined) {
    const canonicalPath = assertCanonicalStylesheetPath(stylesheetPath);
    const absolutePath = resolveProjectStylesheetPath(projectDir, canonicalPath);
    await assertNoStylesheetSymlink(fs, projectDir, canonicalPath);
    return await fs.readTextFile(absolutePath);
  }

  for (const relativePath of DEFAULT_PROJECT_STYLESHEET_PATHS) {
    const absolutePath = resolveProjectStylesheetPath(projectDir, relativePath);
    try {
      await assertNoStylesheetSymlink(fs, projectDir, relativePath);
      return await fs.readTextFile(absolutePath);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
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
  const discoveredStylesheet = options.stylesheet ??
    findStylesheetFromFiles(options.files, options.stylesheetPath, options.projectDir);
  if (options.stylesheetPath !== undefined && discoveredStylesheet === undefined) {
    throw new TypeError(
      `Configured stylesheet ${
        JSON.stringify(options.stylesheetPath)
      } was not available in project source`,
    );
  }
  const minify = options.minify ?? true;
  const session = await resolveCSSGenerationSession(
    minify,
    options.generationSession,
  );
  const stylesheet = discoveredStylesheet ?? session.compilationSession.defaultStylesheet;
  const context = createPreparedProjectCSSContext(
    options.projectSlug,
    options.projectVersion,
    stylesheet,
    options.styleProfile.hash,
    {
      cssPipelineIdentity: session.cacheIdentity,
      minify,
      environment: options.environment ?? "preview",
      buildMode: options.buildMode ?? "production",
    },
  );

  if (await tryGetPreparedProjectCSS(context)) return false;
  if (inFlightPreparedCSSBuilds.has(context.cacheKey)) return false;

  const task = buildPreparedCSSArtifactFromFiles({
    ...options,
    stylesheet,
    generationSession: session,
  }).then(() => {
    logger.debug("Warm prepared CSS complete", {
      projectSlug: options.projectSlug,
      projectVersion: options.projectVersion,
      cacheKey: context.cacheKey,
    });
  }).catch((error) => {
    logger.debug("Warm prepared CSS failed", {
      projectSlug: options.projectSlug,
      projectVersion: options.projectVersion,
      cacheKey: context.cacheKey,
      error: error instanceof Error ? error.message : String(error),
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
 * This extracts stylesheet candidates from source files and generates CSS,
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
  projectDir?: string,
): string | undefined {
  if (stylesheetPath !== undefined) {
    const canonicalPath = assertCanonicalStylesheetPath(stylesheetPath);
    const matches = files.filter((file) =>
      typeof file.content === "string" &&
      sourceFileMatchesStylesheetPath(file.path, canonicalPath, {
        allowRelativePrefix: true,
      })
    );
    if (matches.length > 1) {
      throw new TypeError(
        `Configured stylesheet ${
          JSON.stringify(canonicalPath)
        } matched multiple project source files`,
      );
    }
    return matches[0]?.content;
  }

  return findGlobalStylesheet(files, projectDir);
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
  projectDir?: string,
): string | undefined {
  for (const path of DEFAULT_PROJECT_STYLESHEET_PATHS) {
    const matches = files.filter((file) =>
      typeof file.content === "string" &&
      (file.path === path ||
        (projectDir !== undefined &&
          sourceFileMatchesStylesheetPath(file.path, path, { projectDir })))
    );
    if (matches.length > 1) {
      throw new TypeError(
        `Conventional stylesheet ${JSON.stringify(path)} matched multiple project source files`,
      );
    }
    if (matches.length === 1) return matches[0]?.content;
  }

  return undefined;
}
