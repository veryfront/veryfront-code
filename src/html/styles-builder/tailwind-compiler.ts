import { serverLogger } from "#veryfront/utils";
import { COMPILATION_ERROR } from "#veryfront/errors";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { minifyCSS } from "#veryfront/build/asset-pipeline/tailwind-processor/css-utils.ts";
import { hashCandidates, hashCSS } from "./candidate-extractor.ts";
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
import {
  MAX_CSS_CANDIDATE_BYTES,
  MAX_CSS_CANDIDATES,
  MAX_GENERATED_CSS_BYTES,
  MAX_STYLESHEET_BYTES,
  MAX_TOTAL_CSS_CANDIDATE_BYTES,
  utf8ByteLength,
} from "./resource-limits.ts";

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
const MAX_IN_FLIGHT_PROJECT_CSS = 32;
const MAX_IN_FLIGHT_REGENERATIONS = 32;
const CACHE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CSS_HASH_PATTERN = /^[0-9a-f]{1,16}$/;

export interface TailwindResult {
  css: string;
  error?: string;
}

export interface GenerateOptions {
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

function assertCacheSegment(value: string, label: string): void {
  if (!CACHE_SEGMENT_PATTERN.test(value)) {
    throw COMPILATION_ERROR.create({ detail: `Invalid ${label}` });
  }
}

function assertGenerationInputs(
  stylesheet: string,
  candidates: string[] | Set<string>,
  projectSlug?: string,
): string[] {
  if (utf8ByteLength(stylesheet) > MAX_STYLESHEET_BYTES) {
    throw COMPILATION_ERROR.create({ detail: "Stylesheet exceeds the 2 MiB size limit" });
  }
  if (projectSlug !== undefined) assertCacheSegment(projectSlug, "project slug");

  const count = Array.isArray(candidates) ? candidates.length : candidates.size;
  if (count > MAX_CSS_CANDIDATES) {
    throw COMPILATION_ERROR.create({ detail: "Too many CSS candidates" });
  }

  const normalized = [...candidates];
  let totalBytes = 0;
  for (const candidate of normalized) {
    if (typeof candidate !== "string") {
      throw COMPILATION_ERROR.create({ detail: "CSS candidates must be strings" });
    }
    const candidateBytes = utf8ByteLength(candidate);
    if (candidateBytes > MAX_CSS_CANDIDATE_BYTES) {
      throw COMPILATION_ERROR.create({ detail: "CSS candidate exceeds the size limit" });
    }
    totalBytes += candidateBytes;
    if (totalBytes > MAX_TOTAL_CSS_CANDIDATE_BYTES) {
      throw COMPILATION_ERROR.create({ detail: "CSS candidates exceed the total size limit" });
    }
  }
  return normalized;
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function replaceUnsafeControlCharacters(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    result += code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
      ? " "
      : value[index];
  }
  return result;
}

function safeCompilationMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "CSS compilation failed";
  return replaceUnsafeControlCharacters(
    message
      .replace(/file:\/\/\/[^\s"'()]+/g, "<path>")
      .replace(/\/(?:Users|home|var\/folders)\/[^\s"'()]+/g, "<path>")
      .replace(/\b[A-Za-z]:[\\/][^\s"'()]+/g, "<path>")
      .replace(
        /((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s;,]+/gi,
        "$1<REDACTED>",
      ),
  )
    .slice(0, 2048);
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
  const requestOptions: GenerateOptions = options ? { ...options } : {};
  assertCacheSegment(projectSlug, "project slug");
  if (requestOptions.environment !== undefined) {
    assertCacheSegment(requestOptions.environment, "CSS environment");
  }
  const candidateSnapshot = new Set(
    assertGenerationInputs(stylesheet ?? DEFAULT_STYLESHEET, candidates, projectSlug),
  );
  const context = createProjectCSSRequestContext(projectSlug, stylesheet, candidateSnapshot, {
    minify: requestOptions.minify,
    environment: requestOptions.environment,
    buildMode: requestOptions.buildMode,
  });

  const localHit = await tryGetProjectCSSFromLocalFallback(context, candidateSnapshot);
  if (localHit) return localHit;

  if (!isProjectCSSInitialized()) {
    await initializeProjectCSSCache();
  }

  const distributedHit = await tryGetProjectCSSFromDistributedCache(context, candidateSnapshot);
  if (distributedHit) return distributedHit;

  const inFlight = inFlightProjectCSS.get(context.cacheKey);
  if (inFlight) {
    logger.debug("Project CSS compile single-flight hit");
    return inFlight;
  }
  if (inFlightProjectCSS.size >= MAX_IN_FLIGHT_PROJECT_CSS) {
    throw COMPILATION_ERROR.create({ detail: "Too many concurrent project CSS compilations" });
  }

  const generationPromise = (async () => {
    // Generate fresh CSS
    const result = await generateTailwindCSS(context.stylesheet, candidateSnapshot, {
      ...requestOptions,
      projectSlug,
    });

    if (result.error) {
      const formatted = formatCSSError(result.error);
      logger.error("Project CSS generation failed", { error: "CompilationError" });
      throw COMPILATION_ERROR.create({
        detail:
          `[tailwind] ${formatted.title}: ${formatted.message} Suggestion: ${formatted.suggestion}`,
      });
    }

    const hash = hashCSS(result.css);
    await storeProjectCSS(
      context,
      { css: result.css, hash, candidatesHash: context.candidatesHash },
      candidateSnapshot,
    );

    logger.debug("Project CSS generated", {
      cssLength: result.css.length,
      candidateCount: candidateSnapshot.size,
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
  if (!CSS_HASH_PATTERN.test(expectedHash)) return undefined;
  if (projectSlug !== undefined) assertCacheSegment(projectSlug, "project slug");
  const inFlight = inFlightRegeneration.get(expectedHash);
  if (inFlight) return await inFlight;
  if (inFlightRegeneration.size >= MAX_IN_FLIGHT_REGENERATIONS) {
    logger.warn("CSS regeneration concurrency limit reached");
    return undefined;
  }

  const regenerationPromise = withSpan(
    SpanNames.HTML_REGENERATE_CSS_BY_HASH,
    async () => {
      const inputs = await resolveRegenerationInputs(expectedHash);
      if (!inputs || inputs.candidates.length === 0) {
        logger.debug("Cannot regenerate CSS because cached inputs are unavailable");
        return undefined;
      }

      const result = await generateTailwindCSS(inputs.stylesheet, inputs.candidates, {
        minify: true,
        projectSlug,
      });

      if (result.error) {
        logger.warn("CSS regeneration failed", { error: "CompilationError" });
        return undefined;
      }

      const regeneratedHash = hashCSS(result.css);
      if (regeneratedHash !== expectedHash) {
        logger.debug("CSS regeneration hash mismatch");
        return undefined;
      }

      const regeneratedEntry: CSSCacheEntry = {
        css: result.css,
        candidates: inputs.candidates,
        stylesheet: inputs.stylesheet,
      };
      await persistRegeneratedCSSEntry(regeneratedHash, regeneratedEntry);

      logger.info("CSS regenerated via JIT", {
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
  const generationOptions: GenerateOptions = options ? { ...options } : {};
  const candidateCount = Array.isArray(candidates) ? candidates.length : candidates.size;

  return await withSpan(
    SpanNames.HTML_GENERATE_TAILWIND_CSS,
    async () => {
      const css = stylesheet ?? DEFAULT_STYLESHEET;

      try {
        const candidateArray = assertGenerationInputs(
          css,
          candidates,
          generationOptions.projectSlug,
        );
        const candidateScopeHash = hashCandidates(new Set(candidateArray));
        const comp = await getCompiler(css, generationOptions.projectSlug, candidateScopeHash);
        let output = comp.build(candidateArray);
        if (typeof output !== "string") {
          throw COMPILATION_ERROR.create({ detail: "CSS compiler returned invalid output" });
        }
        if (utf8ByteLength(output) > MAX_GENERATED_CSS_BYTES) {
          throw COMPILATION_ERROR.create({ detail: "Generated CSS exceeds the 16 MiB size limit" });
        }

        if (generationOptions.minify) output = minifyCSS(output);
        if (utf8ByteLength(output) > MAX_GENERATED_CSS_BYTES) {
          throw COMPILATION_ERROR.create({ detail: "Generated CSS exceeds the 16 MiB size limit" });
        }

        logger.debug("Generated CSS", {
          candidateCount: candidateArray.length,
          outputLength: output.length,
        });

        return { css: output };
      } catch (error) {
        const errorMessage = safeCompilationMessage(error);
        logger.error("Compilation failed", { error: errorName(error) });
        return { css: "", error: errorMessage };
      }
    },
    {
      "tailwind.candidate_count": candidateCount,
      "tailwind.has_stylesheet": !!stylesheet,
      "tailwind.minify": generationOptions.minify ?? false,
    },
  );
}

export function formatCSSError(error: Error | string): CSSErrorInfo {
  const message = typeof error === "string" ? error : error.message;
  return formatCSSErrorMessage(message);
}
