import { serverLogger } from "#veryfront/utils";
import { COMPILATION_ERROR } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { minifyCSS } from "#veryfront/build/asset-pipeline/tailwind-processor/css-utils.ts";
import { hashCSS } from "./candidate-extractor.ts";
import { formatCSSErrorMessage } from "./tailwind-compiler-utils.ts";
import { getCompiler } from "./tailwind-compiler-cache.ts";
import {
  type CSSCacheEntry,
  DEFAULT_STYLESHEET,
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

// Re-export extracted modules for backward compatibility
export { extractCandidates, extractCandidatesFromFiles, hashCSS } from "./candidate-extractor.ts";
export { loadModuleFromEsmSh } from "./plugin-loader.ts";
export {
  clearPluginCache,
  getCompilerCacheStats,
  invalidateCompiler,
} from "./tailwind-compiler-cache.ts";
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

const logger = serverLogger.component("tailwind");
const inFlightProjectCSS = new Map<
  string,
  Promise<{ css: string; hash: string; fromCache: boolean }>
>();
const inFlightRegeneration = new Map<string, Promise<string | undefined>>();

export interface TailwindResult {
  css: string;
  error?: string;
}

export interface GenerateOptions {
  minify?: boolean;
  environment?: string;
  buildMode?: "development" | "production";
}

export interface CSSErrorInfo {
  title: string;
  message: string;
  suggestion: string;
}

// ============================================================================
// Project CSS orchestration
// ============================================================================

export async function getProjectCSS(
  projectSlug: string,
  stylesheet: string | undefined,
  candidates: Set<string>,
  options?: GenerateOptions,
): Promise<{ css: string; hash: string; fromCache: boolean }> {
  const context = createProjectCSSRequestContext(projectSlug, stylesheet, candidates, {
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
    const result = await generateTailwindCSS(context.stylesheet, candidates, options);

    if (result.error) {
      const formatted = formatCSSError(result.error);
      logger.error("Project CSS generation failed", {
        projectSlug: context.projectSlug,
        error: formatted.message,
        suggestion: formatted.suggestion,
      });
      throw COMPILATION_ERROR.create({
        detail:
          `[tailwind] ${formatted.title}: ${formatted.message} Suggestion: ${formatted.suggestion}`,
      });
    }

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
export async function regenerateCSSByHash(expectedHash: string): Promise<string | undefined> {
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

      const result = await generateTailwindCSS(inputs.stylesheet, inputs.candidates, {
        minify: true,
      });

      if (result.error) {
        logger.warn("CSS regeneration failed", {
          hash: expectedHash,
          error: result.error,
        });
        return undefined;
      }

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
// Core Tailwind CSS generation
// ============================================================================

export async function generateTailwindCSS(
  stylesheet: string | undefined,
  candidates: string[] | Set<string>,
  options?: GenerateOptions,
): Promise<TailwindResult> {
  const candidateArray = Array.isArray(candidates) ? candidates : [...candidates];

  return await withSpan(
    SpanNames.HTML_GENERATE_TAILWIND_CSS,
    async () => {
      const css = stylesheet ?? DEFAULT_STYLESHEET;

      try {
        const comp = await getCompiler(css);
        let output = comp.build(candidateArray);

        if (options?.minify) output = minifyCSS(output);

        logger.debug("Generated CSS", {
          candidateCount: candidateArray.length,
          outputLength: output.length,
        });

        return { css: output };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Compilation failed", { error: errorMessage });
        return { css: "", error: errorMessage };
      }
    },
    {
      "tailwind.candidate_count": candidateArray.length,
      "tailwind.has_stylesheet": !!stylesheet,
      "tailwind.minify": options?.minify ?? false,
    },
  );
}

export function formatCSSError(error: Error | string): CSSErrorInfo {
  const message = typeof error === "string" ? error : error.message;
  return formatCSSErrorMessage(message);
}
