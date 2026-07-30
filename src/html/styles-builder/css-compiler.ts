import { assertCSSPipelineIdentity, serverLogger } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { minifyCSS } from "#veryfront/build/asset-pipeline/css-optimizer/css-minifier.ts";
import {
  acquireConfiguredCSSOptimization,
  type CSSOptimizationSession,
} from "#veryfront/build/asset-pipeline/css-optimizer/optimization-engine.ts";
import { hashCSS, isCSSContentHash } from "./css-identity.ts";
import { formatCSSErrorMessage } from "./css-compiler-utils.ts";
import {
  acquireCSSCompilationSession,
  type CSSCompilationSession,
  getCompiler,
} from "./css-compiler-cache.ts";
import {
  type CSSCacheEntry,
  persistRegeneratedCSSEntry,
  resolveRegenerationInputs,
} from "./css-hash-cache.ts";
import {
  createProjectCSSRequestContext,
  initializeProjectCSSCache,
  isProjectCSSInitialized,
  storeProjectCSS,
  tryGetProjectCSSFromDistributedCache,
  tryGetProjectCSSFromLocalFallback,
} from "./project-css-cache.ts";

// Re-export provider-neutral compiler and cache helpers.
export { extractCandidates, extractCandidatesFromFiles, hashCSS } from "./candidate-extractor.ts";
export {
  getCompilerCacheStats,
  getCSSCompilationCacheIdentity,
  invalidateCompiler,
} from "./css-compiler-cache.ts";
export {
  cacheCSSAsync,
  cacheCSSInputsAsync,
  clearCSSCache,
  getCSSByHash,
  getCSSByHashAsync,
} from "./css-hash-cache.ts";
export {
  initializeProjectCSSCache,
  invalidateProjectCSS,
  invalidateProjectCSSAsync,
  isProjectCSSCacheDistributed,
} from "./project-css-cache.ts";

const logger = serverLogger.component("css-compiler");
const inFlightProjectCSS = new Map<
  string,
  Promise<{ css: string; hash: string; fromCache: boolean }>
>();
const inFlightRegeneration = new Map<string, Promise<string | undefined>>();

export interface CSSGenerationResult {
  css: string;
}

export interface CSSGenerationOptions {
  minify?: boolean;
  environment?: string;
  buildMode?: "development" | "production";
  projectSlug?: string;
}

export interface CSSErrorInfo {
  title: string;
  message: string;
  suggestion: string;
}

export interface CSSGenerationDependencies {
  /** Already captured compiler/optimizer pair for this generation. */
  generationSession?: CSSGenerationSession;
}

export interface CSSGenerationSession {
  readonly minify: boolean;
  readonly cacheIdentity: string;
  readonly compilationSession: CSSCompilationSession;
  readonly optimizationSession?: CSSOptimizationSession;
}

const cssGenerationSessions = new WeakSet<object>();

/** True only for sessions created by this module's atomic acquisition path. */
export function isCSSGenerationSession(
  value: unknown,
): value is CSSGenerationSession {
  return typeof value === "object" &&
    value !== null &&
    cssGenerationSessions.has(value);
}

/** Capture the compiler and optional optimizer before any cache lookup awaits. */
export async function acquireCSSGenerationSession(
  minify: boolean,
  optimizationSession?: CSSOptimizationSession,
): Promise<CSSGenerationSession> {
  const optimizer = minify ? optimizationSession ?? acquireConfiguredCSSOptimization() : undefined;
  const compilationSession = await acquireCSSCompilationSession();
  const session: CSSGenerationSession = {
    minify,
    compilationSession,
    optimizationSession: optimizer,
    cacheIdentity: getCSSPipelineCacheIdentity(
      compilationSession.cacheIdentity,
      minify,
      optimizer,
    ),
  };
  cssGenerationSessions.add(session);
  return Object.freeze(session);
}

async function resolveGenerationSession(
  minify: boolean,
  session: CSSGenerationSession | undefined,
): Promise<CSSGenerationSession> {
  const resolved = session ?? await acquireCSSGenerationSession(minify);
  if (!isCSSGenerationSession(resolved)) {
    throw new TypeError("CSS generation session was not acquired by core");
  }
  if (resolved.minify !== minify) {
    throw new TypeError(
      "CSS generation session minification mode does not match the request",
    );
  }
  return resolved;
}

/** Compose every output-affecting compiler identity for CSS caches. */
export function getCSSPipelineCacheIdentity(
  compilationIdentity: string,
  minify: boolean,
  session?: CSSOptimizationSession,
): string {
  const capturedCompilationIdentity = assertCSSPipelineIdentity(
    compilationIdentity,
    "CSS compilation identity",
  );
  if (!minify) return capturedCompilationIdentity;
  if (!session) {
    throw new TypeError(
      "A captured CSS optimization engine is required for a minified pipeline identity",
    );
  }
  return assertCSSPipelineIdentity(
    JSON.stringify([
      "veryfront.css-pipeline.v1",
      capturedCompilationIdentity,
      session.cacheIdentity,
    ]),
  );
}

// ============================================================================
// Project CSS orchestration
// ============================================================================

export async function getProjectCSS(
  projectSlug: string,
  stylesheet: string | undefined,
  candidates: Set<string>,
  options?: CSSGenerationOptions,
  dependencies: CSSGenerationDependencies = {},
): Promise<{ css: string; hash: string; fromCache: boolean }> {
  const shouldMinify = options?.minify === true;
  const generationSession = await resolveGenerationSession(
    shouldMinify,
    dependencies.generationSession,
  );
  const resolvedStylesheet = stylesheet ?? generationSession.compilationSession.defaultStylesheet;
  const context = createProjectCSSRequestContext(projectSlug, resolvedStylesheet, candidates, {
    cssPipelineIdentity: generationSession.cacheIdentity,
    minify: options?.minify,
    environment: options?.environment,
    buildMode: options?.buildMode,
  });

  const localHit = await tryGetProjectCSSFromLocalFallback(context, candidates);
  if (localHit) return localHit;

  if (!isProjectCSSInitialized()) {
    await initializeProjectCSSCache();
  }

  const distributedHit = await tryGetProjectCSSFromDistributedCache(context, candidates);
  if (distributedHit) return distributedHit;

  const inFlight = inFlightProjectCSS.get(context.cacheKey);
  if (inFlight) {
    logger.debug("Project CSS compile single-flight hit", {
      projectSlug: context.projectSlug,
      cacheKeySuffix: context.cacheKey.slice(-24),
    });
    return inFlight;
  }

  const generationPromise = (async () => {
    // Generate fresh CSS
    const result = await generateCSS(context.stylesheet, candidates, {
      ...options,
      projectSlug,
    }, { generationSession });

    const hash = hashCSS(result.css);
    await storeProjectCSS(
      context,
      { css: result.css, hash, candidatesHash: context.candidatesHash },
      candidates,
    );

    logger.debug("Project CSS generated", {
      projectSlug: context.projectSlug,
      hash,
      cssLength: result.css.length,
      candidateCount: candidates.size,
    });

    return { css: result.css, hash, fromCache: false };
  })();

  inFlightProjectCSS.set(context.cacheKey, generationPromise);

  try {
    return await generationPromise;
  } finally {
    inFlightProjectCSS.delete(context.cacheKey);
  }
}

// ============================================================================
// CSS JIT regeneration
// ============================================================================

/**
 * Regenerate CSS by hash using cached inputs.
 * This is the JIT regeneration path - any pod can regenerate without fetching files.
 *
 * Tries unified cache (CSS + inputs together) first, then falls back to legacy
 * separate inputs cache for backward compatibility with existing cached data.
 *
 * @param expectedHash - The CSS hash to regenerate
 * @returns The regenerated CSS if inputs are cached and hash matches, undefined otherwise
 */
export async function regenerateCSSByHash(
  expectedHash: string,
  projectSlug: string | undefined,
): Promise<string | undefined> {
  if (!isCSSContentHash(expectedHash)) return undefined;

  const inFlight = inFlightRegeneration.get(expectedHash);
  if (inFlight) return await inFlight;

  const regenerationPromise = withSpan(
    SpanNames.HTML_REGENERATE_CSS_BY_HASH,
    async () => {
      const inputs = await resolveRegenerationInputs(expectedHash);
      if (!inputs || inputs.candidates.length === 0) {
        logger.debug("Cannot regenerate CSS - no cached inputs", { hash: expectedHash });
        return undefined;
      }

      const result = await generateCSS(inputs.stylesheet, inputs.candidates, {
        minify: true,
        projectSlug,
      });

      const regeneratedHash = hashCSS(result.css);
      if (regeneratedHash !== expectedHash) {
        logger.debug("CSS regeneration hash mismatch", {
          expected: expectedHash,
          got: regeneratedHash,
        });
        return undefined;
      }

      const regeneratedEntry: CSSCacheEntry = {
        css: result.css,
        candidates: inputs.candidates,
        stylesheet: inputs.stylesheet,
      };
      await persistRegeneratedCSSEntry(regeneratedHash, regeneratedEntry);

      logger.info("CSS regenerated via JIT", {
        hash: expectedHash,
        cssLength: result.css.length,
        candidateCount: inputs.candidates.length,
      });

      return result.css;
    },
    { "css.hash": expectedHash },
  );

  inFlightRegeneration.set(expectedHash, regenerationPromise);

  try {
    return await regenerationPromise;
  } finally {
    inFlightRegeneration.delete(expectedHash);
  }
}

// ============================================================================
// Core provider-neutral CSS generation
// ============================================================================

export async function generateCSS(
  stylesheet: string | undefined,
  candidates: string[] | Set<string>,
  options?: CSSGenerationOptions,
  dependencies: CSSGenerationDependencies = {},
): Promise<CSSGenerationResult> {
  const generationSession = await resolveGenerationSession(
    options?.minify === true,
    dependencies.generationSession,
  );
  const candidateArray = [...new Set(candidates)].sort();

  return await withSpan(
    SpanNames.HTML_GENERATE_CSS,
    async () => {
      const css = stylesheet ?? generationSession.compilationSession.defaultStylesheet;

      const comp = await getCompiler(
        css,
        options?.projectSlug,
        candidateArray,
        generationSession.compilationSession,
      );
      let output = comp.build(candidateArray);

      if (options?.minify) {
        output = await minifyCSS(
          output,
          generationSession.optimizationSession,
        );
      }

      logger.debug("Generated CSS", {
        candidateCount: candidateArray.length,
        outputLength: output.length,
      });

      return { css: output };
    },
    {
      "css.candidate_count": candidateArray.length,
      "css.has_stylesheet": !!stylesheet,
      "css.minify": options?.minify ?? false,
    },
  );
}

export function formatCSSError(error: Error | string): CSSErrorInfo {
  const message = typeof error === "string" ? error : error.message;
  return formatCSSErrorMessage(message);
}
