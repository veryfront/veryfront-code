/**
 * Provider-neutral CSS generation and cache orchestration.
 *
 * Tailwind-named exports remain as compatibility aliases, but core neither
 * imports nor discovers Tailwind. An explicit CSSProcessor owns compilation;
 * an explicit CSSOptimizationEngine owns minification.
 */

import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { formatInstallCommand } from "#veryfront/extensions/install-command.ts";
import { getRecommendation } from "#veryfront/extensions/recommendations.ts";
import {
  captureCSSOptimizationEngine,
  type CSSOptimizationEngine,
  CSSOptimizationEngineName,
} from "#veryfront/extensions/css/index.ts";
import {
  freezeExtensionContract,
  getExtensionOwnPropertyDescriptor,
  isDataPropertyDescriptor,
  isExtensionArray,
} from "#veryfront/extensions/property-inspection.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { assertCSSPipelineIdentity, serverLogger } from "#veryfront/utils";
import { normalizeCSSCandidates } from "#veryfront/utils/css-candidate-admission.ts";
import {
  assertCSSFileContent,
  assertCSSOutputContent,
} from "#veryfront/utils/css-content-admission.ts";
import { isProxy as isProxyWithoutHooks } from "node:util/types";
import { formatCSSErrorMessage } from "./tailwind-compiler-utils.ts";
import {
  acquireCSSCompilationSession,
  buildCSSWithSession,
  type CSSCompilationSession,
} from "./tailwind-compiler-cache.ts";
import {
  type CSSCacheEntry,
  persistRegeneratedCSSEntry,
  resolveRegenerationInputs,
} from "./css-hash-cache.ts";
import { hashCSS, hashString, isCSSContentHash } from "./css-identity.ts";
import {
  createProjectCSSRequestContext,
  initializeProjectCSSCache,
  isProjectCSSInitialized,
  storeProjectCSS,
  tryGetProjectCSSFromDistributedCache,
  tryGetProjectCSSFromLocalFallback,
} from "./project-css-cache.ts";

// Re-export provider-neutral helpers under their established public names.
export { extractCandidates, extractCandidatesFromFiles } from "./candidate-extractor.ts";
export { hashCSS } from "./css-identity.ts";
export {
  getCompilerCacheStats,
  getCSSCompilationCacheIdentity,
  invalidateCompiler,
} from "./tailwind-compiler-cache.ts";
export { cacheCSSAsync, clearCSSCache, getCSSByHash, getCSSByHashAsync } from "./css-hash-cache.ts";
export {
  initializeProjectCSSCache,
  invalidateProjectCSS,
  invalidateProjectCSSAsync,
  isProjectCSSCacheDistributed,
} from "./project-css-cache.ts";

const logger = serverLogger.component("css-compiler");
const apply = Reflect.apply;
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const CSS_PIPELINE_IDENTITY_SCHEMA = "veryfront.css-pipeline.v2";
const cssGenerationSessions = new WeakSet<object>();
let reportedMissingOptimizationEngine = false;
const inFlightProjectCSS = new Map<
  string,
  Promise<{ css: string; hash: string; fromCache: boolean }>
>();
const inFlightProjectCSSOwners = new Map<string, object>();
const inFlightRegeneration = new Map<string, Promise<string | undefined>>();
const inFlightRegenerationOwners = new Map<string, object>();

export interface CSSGenerationResult {
  readonly css: string;
  readonly cacheIdentity: string;
}

/** Backward-compatible name for a provider-neutral CSS generation result. */
export type TailwindResult = CSSGenerationResult;

export interface CSSGenerationOptions {
  minify?: boolean;
  environment?: string;
  buildMode?: "development" | "production";
  projectSlug?: string;
}

/** Backward-compatible name for provider-neutral CSS generation options. */
export type GenerateOptions = CSSGenerationOptions;

export interface CSSErrorInfo {
  title: string;
  message: string;
  suggestion: string;
}

export interface CSSGenerationSession {
  readonly minify: boolean;
  readonly cacheIdentity: string;
  readonly compilationSession: CSSCompilationSession;
  readonly optimizationEngine?: CSSOptimizationEngine;
}

export interface CSSGenerationDependencies {
  readonly generationSession?: CSSGenerationSession;
}

function getCSSPipelineCacheIdentity(
  compilationIdentity: string,
  optimizationIdentity: string | undefined,
): string {
  return assertCSSPipelineIdentity(
    `${CSS_PIPELINE_IDENTITY_SCHEMA}:${hashString(compilationIdentity)}:${
      optimizationIdentity === undefined ? "unminified" : hashString(optimizationIdentity)
    }`,
    "CSS pipeline identity",
  );
}

/** Capture all output-affecting providers before the operation performs an await. */
export function acquireCSSGenerationSession(minify: boolean): CSSGenerationSession {
  const compilationSession = acquireCSSCompilationSession();
  // Minification is an optional enhancement, not a precondition for serving
  // CSS. No first-party package registers a CSSOptimizationEngine -- it ships
  // only in @veryfront/ext-css-lightning, which `veryfront` does not depend on
  // -- while the production shell always asks for minify:true. Resolving
  // through `resolve()` therefore made the fail-closed path unreachable-by-
  // design for a default project: it could only ever fire as an outage. Absent
  // an engine the CSS is emitted unminified and the identity below records it
  // as such, so no cache can serve a stale minified entry in its place.
  const optimizationProvider = minify ? tryResolve<unknown>(CSSOptimizationEngineName) : undefined;
  if (optimizationProvider !== undefined) {
    // Re-arm: an engine that disappears later is a new regression to report.
    reportedMissingOptimizationEngine = false;
  } else if (minify && !reportedMissingOptimizationEngine) {
    // Warn, not debug: this is a silent quality regression for a project that
    // did select an optimizer and whose registration failed. It must not be
    // indistinguishable from a project that never wanted one.
    //
    // Once per process, not once per acquisition: regenerateCSSByHash acquires
    // a session on every cold-cache request, which made this the single most
    // frequent line in a hosted project's logs.
    //
    // State the effect and the whole remedy. An earlier revision borrowed
    // `resolve()`'s "install it with: deno add <package>" hint, which is only
    // true for an auto-activating extension: `@veryfront/ext-css-lightning`
    // declares `activation: "explicit"`, so installing it registers nothing
    // until a `veryfront.config.ts` `extensions` entry activates it. Advice
    // that stops at the install reads as actionable and leaves the CSS exactly
    // as unminified as before. The contract name stays out of the instruction:
    // it is an internal registration hook the guides never mention, and
    // `component=css-compiler` already identifies the source.
    //
    // Naming the package is likewise not enough to act on, so the install step
    // is a command the reader can paste. `formatInstallCommand` derives it from
    // the manifest that owns the project's dependencies rather than hard-coding
    // one client: a bare `deno add @veryfront/ext-css-lightning` resolves
    // against JSR, which hosts no `@veryfront` package, and the compiled Deno
    // binary builds `--runtime node` scaffolds whose own `npm ci` would ignore
    // any deno.json a `deno add` wrote.
    reportedMissingOptimizationEngine = true;
    const recommendation = getRecommendation(CSSOptimizationEngineName);
    logger.warn(
      recommendation === undefined
        ? "Veryfront emits unminified CSS because no CSS optimizer is active"
        : `Veryfront emits unminified CSS because no CSS optimizer is active. Install one with: ${
          formatInstallCommand(recommendation)
        }, then add it to "extensions" in veryfront.config.ts`,
    );
  }
  const optimizationEngine = optimizationProvider === undefined
    ? undefined
    : captureCSSOptimizationEngine(optimizationProvider);
  const session: CSSGenerationSession = {
    minify,
    compilationSession,
    optimizationEngine,
    cacheIdentity: getCSSPipelineCacheIdentity(
      compilationSession.cacheIdentity,
      optimizationEngine?.cacheIdentity,
    ),
  };
  apply(weakSetAdd, cssGenerationSessions, [session]);
  return freezeExtensionContract(session);
}

function resolveGenerationSession(
  minify: boolean,
  session: CSSGenerationSession | undefined,
): CSSGenerationSession {
  const resolved = session ?? acquireCSSGenerationSession(minify);
  if (!apply(weakSetHas, cssGenerationSessions, [resolved])) {
    throw new TypeError("CSS generation session was not acquired by core");
  }
  if (resolved.minify !== minify) {
    throw new TypeError("CSS generation session minification mode does not match the request");
  }
  return resolved;
}

function readOptimizedCSS(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    isExtensionArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    throw new TypeError("CSSOptimizationEngine result must be a non-Proxy object");
  }
  let cssDescriptor: PropertyDescriptor | undefined;
  let sourceMapDescriptor: PropertyDescriptor | undefined;
  try {
    cssDescriptor = getExtensionOwnPropertyDescriptor(value, "css");
    sourceMapDescriptor = getExtensionOwnPropertyDescriptor(value, "sourceMap");
  } catch (cause) {
    throw new TypeError("CSSOptimizationEngine result could not be inspected", { cause });
  }
  if (!isDataPropertyDescriptor(cssDescriptor) || typeof cssDescriptor.value !== "string") {
    throw new TypeError("CSSOptimizationEngine result.css must be an own string data property");
  }
  if (
    sourceMapDescriptor !== undefined &&
    (!isDataPropertyDescriptor(sourceMapDescriptor) ||
      (sourceMapDescriptor.value !== undefined && typeof sourceMapDescriptor.value !== "string"))
  ) {
    throw new TypeError(
      "CSSOptimizationEngine result.sourceMap must be an own string data property when present",
    );
  }
  assertCSSOutputContent(cssDescriptor.value, "CSS optimizer output");
  return cssDescriptor.value;
}

function optimizeCSS(
  engine: CSSOptimizationEngine,
  css: string,
  projectSlug: string | undefined,
): string {
  const request = freezeExtensionContract({
    css,
    sourcePath: projectSlug === undefined
      ? "veryfront://runtime/styles.css"
      : `veryfront://project/${hashString(projectSlug)}/styles.css`,
    minify: true,
    sourceMap: false,
  });
  return readOptimizedCSS(engine.optimize(request));
}

// ---------------------------------------------------------------------------
// Project CSS orchestration
// ---------------------------------------------------------------------------

export async function getProjectCSS(
  projectSlug: string,
  stylesheet: string | undefined,
  candidates: string[] | Set<string>,
  options?: CSSGenerationOptions,
  dependencies: CSSGenerationDependencies = {},
): Promise<{ css: string; hash: string; fromCache: boolean }> {
  const admittedCandidates = normalizeCSSCandidates(candidates);
  const minify = options?.minify === true;
  const generationSession = resolveGenerationSession(
    minify,
    dependencies.generationSession,
  );
  const resolvedStylesheet = stylesheet ?? generationSession.compilationSession.defaultStylesheet;
  assertCSSFileContent(resolvedStylesheet, "Project CSS stylesheet");
  const context = createProjectCSSRequestContext(
    projectSlug,
    resolvedStylesheet,
    admittedCandidates,
    {
      cssPipelineIdentity: generationSession.cacheIdentity,
      minify,
      environment: options?.environment,
      buildMode: options?.buildMode,
    },
  );

  const localHit = await tryGetProjectCSSFromLocalFallback(context, admittedCandidates);
  if (localHit) return localHit;

  if (!isProjectCSSInitialized()) await initializeProjectCSSCache();
  const distributedHit = await tryGetProjectCSSFromDistributedCache(
    context,
    admittedCandidates,
  );
  if (distributedHit) return distributedHit;

  const pending = inFlightProjectCSS.get(context.cacheKey);
  if (pending) return await pending;

  const generation = (async () => {
    const result = await generateTailwindCSS(
      context.stylesheet,
      admittedCandidates,
      { ...options, projectSlug },
      { generationSession },
    );
    const hash = hashCSS(result.css);
    await storeProjectCSS(
      context,
      { css: result.css, hash, candidatesHash: context.candidatesHash },
      admittedCandidates,
    );
    return { css: result.css, hash, fromCache: false };
  })();
  const owner = {};
  inFlightProjectCSS.set(context.cacheKey, generation);
  inFlightProjectCSSOwners.set(context.cacheKey, owner);
  try {
    return await generation;
  } finally {
    if (inFlightProjectCSSOwners.get(context.cacheKey) === owner) {
      inFlightProjectCSS.delete(context.cacheKey);
      inFlightProjectCSSOwners.delete(context.cacheKey);
    }
  }
}

// ---------------------------------------------------------------------------
// CSS JIT regeneration
// ---------------------------------------------------------------------------

export async function regenerateCSSByHash(
  expectedHash: string,
  projectSlug: string | undefined,
): Promise<string | undefined> {
  if (!isCSSContentHash(expectedHash)) return undefined;
  // The session tolerates an absent optimizer and records the result in its
  // cache identity, so asking for minify here is safe whether or not an engine
  // is registered. The request below must pass the same value, or
  // resolveGenerationSession rejects the pair.
  const minify = true;
  const generationSession = acquireCSSGenerationSession(minify);
  const inFlightKey = `${hashString(generationSession.cacheIdentity)}:${expectedHash}`;
  const pending = inFlightRegeneration.get(inFlightKey);
  if (pending) return await pending;

  const regeneration = withSpan(
    SpanNames.HTML_REGENERATE_CSS_BY_HASH,
    async () => {
      const inputs = await resolveRegenerationInputs(
        expectedHash,
        generationSession.cacheIdentity,
      );
      if (!inputs || inputs.candidates.length === 0) return undefined;

      const result = await generateTailwindCSS(
        inputs.stylesheet,
        inputs.candidates,
        { minify, projectSlug },
        { generationSession },
      );
      if (hashCSS(result.css) !== expectedHash) return undefined;

      const entry: CSSCacheEntry = {
        css: result.css,
        candidates: inputs.candidates,
        stylesheet: inputs.stylesheet,
        pipelineIdentity: generationSession.cacheIdentity,
      };
      await persistRegeneratedCSSEntry(expectedHash, entry);
      return result.css;
    },
    { "css.hash": expectedHash },
  );
  const owner = {};
  inFlightRegeneration.set(inFlightKey, regeneration);
  inFlightRegenerationOwners.set(inFlightKey, owner);
  try {
    return await regeneration;
  } finally {
    if (inFlightRegenerationOwners.get(inFlightKey) === owner) {
      inFlightRegeneration.delete(inFlightKey);
      inFlightRegenerationOwners.delete(inFlightKey);
    }
  }
}

// ---------------------------------------------------------------------------
// Provider-neutral generation (legacy name retained for API compatibility)
// ---------------------------------------------------------------------------

export async function generateTailwindCSS(
  stylesheet: string | undefined,
  candidates: string[] | Set<string>,
  options?: CSSGenerationOptions,
  dependencies: CSSGenerationDependencies = {},
): Promise<CSSGenerationResult> {
  const admittedCandidates = normalizeCSSCandidates(candidates);
  const minify = options?.minify === true;
  const generationSession = resolveGenerationSession(
    minify,
    dependencies.generationSession,
  );
  const resolvedStylesheet = stylesheet ?? generationSession.compilationSession.defaultStylesheet;
  assertCSSFileContent(resolvedStylesheet, "CSS generation stylesheet");

  return await withSpan(
    SpanNames.HTML_GENERATE_TAILWIND_CSS,
    async () => {
      const compiled = await buildCSSWithSession(
        generationSession.compilationSession,
        resolvedStylesheet,
        options?.projectSlug,
        admittedCandidates,
      );
      const css = generationSession.optimizationEngine
        ? optimizeCSS(generationSession.optimizationEngine, compiled, options?.projectSlug)
        : compiled;
      assertCSSOutputContent(css, "Generated CSS output");
      logger.debug("Generated CSS", {
        candidateCount: admittedCandidates.length,
        outputLength: css.length,
        minified: minify,
      });
      return { css, cacheIdentity: generationSession.cacheIdentity };
    },
    {
      "tailwind.candidate_count": admittedCandidates.length,
      "tailwind.has_stylesheet": stylesheet !== undefined,
      "tailwind.minify": minify,
    },
  );
}

export function formatCSSError(error: Error | string): CSSErrorInfo {
  const message = typeof error === "string" ? error : error.message;
  return formatCSSErrorMessage(message);
}
