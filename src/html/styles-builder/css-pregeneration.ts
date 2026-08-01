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
import { hashCandidates } from "./css-identity.ts";
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
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isFileSnapshotChangedError } from "#veryfront/platform/adapters/file-snapshot-error.ts";
import { captureSnapshotTextReader } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import {
  MAX_CSS_DIRECTORY_DEPTH,
  MAX_CSS_DIRECTORY_ENTRIES,
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_TOTAL_BYTES,
} from "#veryfront/utils/constants/css.ts";
import {
  admitProjectStyleSourceFiles,
  snapshotProjectStyleSourceFiles,
  snapshotSuppliedProjectStyleSourceFiles,
} from "./project-style-source-snapshot.ts";

const logger = serverLogger.component("css-pregeneration");
const inFlightPreparedCSSBuilds = new Map<string, Promise<void>>();
const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];

interface CSSPregenerationOptions {
  /** Project slug for cache keying */
  projectSlug: string;
  /** Current content version for the prepared stylesheet artifact */
  projectVersion: string;
  /** Project root used for style scope filtering */
  projectDir?: string;
  /** Runtime adapter used only when a supplied source entry omits content. */
  adapter?: RuntimeAdapter;
  /** List of files with content to extract candidates from */
  files: readonly { path: string; content?: string }[];
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

interface PreparedCSSArtifactBuildPlan {
  readonly projectSlug: string;
  readonly candidates: Set<string>;
  readonly stylesheet: string;
  readonly minify: boolean;
  readonly environment: string;
  readonly buildMode: "development" | "production";
  readonly session: CSSGenerationSession;
  readonly context: ReturnType<typeof createPreparedProjectCSSContext>;
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

async function resolvePreparedCSSArtifactBuildPlan(
  options: CSSPregenerationOptions,
): Promise<PreparedCSSArtifactBuildPlan> {
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
  const admittedFiles = await admitProjectStyleSourceFiles(files, {
    adapter: options.adapter,
    projectDir,
    styleProfile,
    includeStylesheets: true,
  });

  const discoveredStylesheet = stylesheet ??
    findStylesheetFromFiles(admittedFiles, stylesheetPath, projectDir);
  if (stylesheetPath !== undefined && discoveredStylesheet === undefined) {
    throw new TypeError(
      `Configured stylesheet ${JSON.stringify(stylesheetPath)} was not available in project source`,
    );
  }
  const candidates = extractCandidatesFromFiles(admittedFiles, {
    projectDir,
    styleProfile,
  });
  const session = await resolveCSSGenerationSession(
    minify,
    options.generationSession,
  );
  const resolvedStylesheet = discoveredStylesheet ??
    session.compilationSession.defaultStylesheet;
  const context = createPreparedProjectCSSContext(
    projectSlug,
    projectVersion,
    resolvedStylesheet,
    styleProfile.hash,
    {
      cssPipelineIdentity: session.cacheIdentity,
      candidatesHash: hashCandidates(candidates),
      minify,
      environment,
      buildMode,
    },
  );

  return Object.freeze({
    projectSlug,
    candidates,
    stylesheet: resolvedStylesheet,
    minify,
    environment,
    buildMode,
    session,
    context,
  });
}

async function executePreparedCSSArtifactBuildPlan(
  plan: PreparedCSSArtifactBuildPlan,
): Promise<PreparedCSSArtifactBuildResult> {
  const result = await getProjectCSS(plan.projectSlug, plan.stylesheet, plan.candidates, {
    minify: plan.minify,
    environment: plan.environment,
    buildMode: plan.buildMode,
  }, { generationSession: plan.session });

  await storePreparedProjectCSS(plan.context, { css: result.css, hash: result.hash });

  return {
    css: result.css,
    hash: result.hash,
    candidateCount: plan.candidates.size,
    fromCache: result.fromCache,
    context: plan.context,
  };
}

export async function buildPreparedCSSArtifactFromFiles(
  options: CSSPregenerationOptions,
): Promise<PreparedCSSArtifactBuildResult> {
  return await executePreparedCSSArtifactBuildPlan(
    await resolvePreparedCSSArtifactBuildPlan(options),
  );
}

export async function collectLocalProjectSourceFiles(
  options: LocalProjectSourceFilesOptions,
): Promise<Array<{ path: string; content?: string }>> {
  if (!isAbsolute(options.projectDir)) {
    throw new TypeError("CSS source project directory must be absolute");
  }
  const fs = options.fs ?? createFileSystem();
  const reader = captureSnapshotTextReader(fs, "Local CSS source filesystem");
  const files: Array<{ path: string; content?: string }> = [];
  let visitedEntries = 0;
  let selectedFiles = 0;
  let sourceBytes = 0;

  const scanDir = async (directoryPath: string, depth: number): Promise<void> => {
    if (depth > MAX_CSS_DIRECTORY_DEPTH) {
      throw new TypeError(
        `CSS source tree exceeds ${MAX_CSS_DIRECTORY_DEPTH} directory levels`,
      );
    }

    const entries = [];
    for await (const entry of fs.readDir(directoryPath)) {
      visitedEntries++;
      if (visitedEntries > MAX_CSS_DIRECTORY_ENTRIES) {
        throw new TypeError(
          `CSS source tree exceeds ${MAX_CSS_DIRECTORY_ENTRIES} entries`,
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

      selectedFiles++;
      if (selectedFiles > MAX_CSS_FILES) {
        throw new TypeError(`CSS source content exceeds ${MAX_CSS_FILES} files`);
      }

      const remainingBytes = MAX_CSS_TOTAL_BYTES - sourceBytes;
      const { content, byteLength } = await reader.readUtf8(
        fullPath,
        options.projectDir,
        Math.max(1, Math.min(MAX_CSS_FILE_BYTES, remainingBytes)),
        "CSS source file",
      );
      if (byteLength > remainingBytes) {
        throw new TypeError(
          `CSS source content exceeds ${MAX_CSS_TOTAL_BYTES} bytes`,
        );
      }
      sourceBytes += byteLength;
      files.push({ path: fullPath, content });
    }
  };

  await scanDir(options.projectDir, 0);
  return [
    ...await snapshotProjectStyleSourceFiles(files, {
      projectDir: options.projectDir,
      styleProfile: options.styleProfile,
    }),
  ];
}

export async function readLocalProjectStylesheet(
  projectDir: string,
  stylesheetPath?: string,
  fs: FileSystem = createFileSystem(),
): Promise<string | undefined> {
  if (stylesheetPath !== undefined) {
    const canonicalPath = assertCanonicalStylesheetPath(stylesheetPath);
    const absolutePath = resolveProjectStylesheetPath(projectDir, canonicalPath);
    const reader = captureSnapshotTextReader(fs, "Local stylesheet filesystem");
    return (await reader.readUtf8(
      absolutePath,
      projectDir,
      MAX_CSS_FILE_BYTES,
      "Project stylesheet",
    )).content;
  }

  const reader = captureSnapshotTextReader(fs, "Local stylesheet filesystem");
  for (const relativePath of DEFAULT_PROJECT_STYLESHEET_PATHS) {
    const absolutePath = resolveProjectStylesheetPath(projectDir, relativePath);
    try {
      return (await reader.readUtf8(
        absolutePath,
        projectDir,
        MAX_CSS_FILE_BYTES,
        "Project stylesheet",
      )).content;
    } catch (error) {
      if (isFileSnapshotChangedError(error) || !isNotFoundError(error)) throw error;
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
  const plan = await resolvePreparedCSSArtifactBuildPlan(options);
  const context = plan.context;

  if (await tryGetPreparedProjectCSS(context)) return false;
  if (inFlightPreparedCSSBuilds.has(context.cacheKey)) return false;

  const task = executePreparedCSSArtifactBuildPlan(plan).then(() => {
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
      error: snapshotThrowableDiagnostic(error),
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
  const startTime = performance.now();

  try {
    const files = await admitProjectStyleSourceFiles(options.files, {
      adapter: options.adapter,
      projectDir: options.projectDir,
      styleProfile: options.styleProfile,
      includeStylesheets: true,
    });
    logger.debug("Starting", {
      projectSlug: options.projectSlug,
      projectVersion: options.projectVersion,
      fileCount: files.length,
      hasStylesheet: typeof options.stylesheet === "string",
      styleProfileHash: options.styleProfile.hash,
    });

    const result = await buildPreparedCSSArtifactFromFiles({
      projectSlug: options.projectSlug,
      projectVersion: options.projectVersion,
      projectDir: options.projectDir,
      adapter: options.adapter,
      files,
      styleProfile: options.styleProfile,
      stylesheet: options.stylesheet,
      stylesheetPath: options.stylesheetPath,
      minify: options.minify,
      environment: options.environment,
      buildMode: options.buildMode,
      generationSession: options.generationSession,
    });
    const duration = performance.now() - startTime;

    logger.debug("Complete", {
      projectSlug: options.projectSlug,
      projectVersion: options.projectVersion,
      candidateCount: result.candidateCount,
      cssLength: result.css.length,
      cssHash: result.hash,
      fromCache: result.fromCache,
      duration: `${duration.toFixed(2)}ms`,
    });
  } catch (error) {
    const duration = performance.now() - startTime;

    logger.warn("Failed", {
      projectSlug: options.projectSlug,
      error: snapshotThrowableDiagnostic(error),
      duration: `${duration.toFixed(2)}ms`,
    });
  }
}

/**
 * Find stylesheet content from file list using a configured path or defaults.
 */
export function findStylesheetFromFiles(
  files: readonly { path: string; content?: string }[],
  stylesheetPath?: string,
  projectDir?: string,
): string | undefined {
  const admittedFiles = snapshotSuppliedProjectStyleSourceFiles(files, {
    projectDir,
    includeStylesheets: true,
  });
  if (stylesheetPath !== undefined) {
    const canonicalPath = assertCanonicalStylesheetPath(stylesheetPath);
    const matches = admittedFiles.filter((file) =>
      typeof file.content === "string" &&
      sourceFileMatchesStylesheetPath(file.path, canonicalPath, {
        ...(projectDir === undefined ? { allowRelativePrefix: true } : { projectDir }),
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

  return findGlobalStylesheet(admittedFiles, projectDir);
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
  files: readonly { path: string; content?: string }[],
  projectDir?: string,
): string | undefined {
  const admittedFiles = snapshotSuppliedProjectStyleSourceFiles(files, {
    projectDir,
    includeStylesheets: true,
  });
  for (const path of DEFAULT_PROJECT_STYLESHEET_PATHS) {
    const matches = admittedFiles.filter((file) =>
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
