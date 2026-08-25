/**
 * Release Asset Manifest — production CSS compiler.
 *
 * Provides the `compileProjectCss` implementation injected into the build
 * executor's client. It compiles project CSS directly through the
 * provider-neutral compiler (`generateCSS`) against the candidates the executor
 * extracted from the materialized release file set, using the project
 * stylesheet the executor resolved from that same file set.
 *
 * Why this is safe to run inside the project runtime:
 * - It uses `generateCSS`, NOT `getProjectCSS`. `getProjectCSS` pulls in
 *   the distributed/project-CSS cache (`initializeProjectCSSCache`,
 *   prepared-project-css, style-artifact resolution) — the very machinery whose
 *   per-route candidate contract and distributed-cache init motivated deferring
 *   CSS from the builder. `generateCSS` is the pure compile primitive:
 *   it resolves the explicitly composed `CSSProcessor` extension and calls
 *   `compiler.build(candidates)` with no cross-request/distributed state.
 * - Work is bounded: one compile over the candidate set the executor already
 *   gathered, no background tasks.
 * - Configuration and compile failures propagate; a release must not publish
 *   a silent CSS gap.
 *
 * Minification is requested, not required. `CSSOptimizationEngine` ships only
 * in `@veryfront/ext-css-lightning`, which `first-party-defaults.ts` marks
 * `selection: "explicit"`. A scaffolded project has no optimiser, so a
 * release that asks for minification and gets none is the normal case, not an
 * outage. `acquireCSSGenerationSession` degrades to unminified output and
 * records that in `cacheIdentity`, which travels into the manifest as
 * `cssPipelineIdentity`; nothing downstream assumes minified bytes, and no
 * cache can serve a stale minified entry in its place. A *missing optional
 * capability* is a skip; a *failing* one still fails the release.
 *
 * @module release-assets/css-compile
 */

import {
  assertCSSPipelineIdentity,
  assertStyleProfileHash,
} from "#veryfront/utils/css-artifact-identity.ts";
import { serverLogger } from "#veryfront/utils/logger/index.ts";
import { COMPILATION_ERROR } from "#veryfront/errors";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  acquireCSSGenerationSession,
  generateTailwindCSS,
  hashCSS,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { RELEASE_ASSET_MAX_SIZE_BYTES } from "./constants.ts";
import { hasControlCharacters } from "./string-validation.ts";

const logger = serverLogger.component("release-asset-css-compile");
const MAX_PROJECT_SCOPE_LENGTH = 256;
const MAX_CSS_CANDIDATES = 100_000;
const MAX_CSS_CANDIDATE_LENGTH = 2_048;
const textEncoder = new TextEncoder();

/** Successful bounded CSS compilation output. */
export interface CompileProjectCssResult {
  readonly css: string;
  readonly styleProfileHash: string;
  readonly cssPipelineIdentity: string;
}

/** Configuration captured by a release-scoped CSS compiler. */
export interface CompileProjectCssOptions {
  /** Project scope (slug or id) — isolates the compiler cache per project. */
  projectScope: string;
}

/** Per-build configuration resolved from the materialized release. */
export interface CompileProjectCssRuntimeOptions {
  /** Validated project config resolved from the exact materialized release. */
  config: VeryfrontConfig;
}

/**
 * Build a `compileProjectCss` function bound to a specific release build.
 *
 * The returned function matches the build executor's injected client signature:
 * `(candidates, stylesheet, options) => Promise<{ css, styleProfileHash,
 * cssPipelineIdentity } | null>`.
 * The factory rejects invalid configuration synchronously. The returned
 * function returns `null` only when there is no stylesheet and no candidate;
 * malformed input and compile failures reject.
 */
export function createCompileProjectCss(
  options: CompileProjectCssOptions,
): (
  candidates: Set<string>,
  stylesheet: string | undefined,
  runtimeOptions: CompileProjectCssRuntimeOptions,
) => Promise<CompileProjectCssResult | null> {
  if (
    !options ||
    typeof options !== "object" ||
    typeof options.projectScope !== "string" ||
    options.projectScope.length === 0 ||
    options.projectScope.length > MAX_PROJECT_SCOPE_LENGTH ||
    options.projectScope.trim() !== options.projectScope ||
    hasControlCharacters(options.projectScope)
  ) {
    throw new TypeError("Release CSS project scope is invalid");
  }

  return async (
    candidates: Set<string>,
    stylesheet: string | undefined,
    runtimeOptions: CompileProjectCssRuntimeOptions,
  ): Promise<CompileProjectCssResult | null> => {
    if (!(candidates instanceof Set) || candidates.size > MAX_CSS_CANDIDATES) {
      throw new TypeError(
        `Release asset CSS candidates must be a Set with at most ${MAX_CSS_CANDIDATES} entries`,
      );
    }
    const candidateSnapshot = new Set<string>();
    for (const candidate of candidates) {
      if (
        typeof candidate !== "string" ||
        candidate.length === 0 ||
        candidate.length > MAX_CSS_CANDIDATE_LENGTH ||
        hasControlCharacters(candidate)
      ) {
        throw new TypeError("Release asset CSS candidate is invalid");
      }
      candidateSnapshot.add(candidate);
    }
    if (
      stylesheet !== undefined &&
      (typeof stylesheet !== "string" ||
        textEncoder.encode(stylesheet).byteLength > RELEASE_ASSET_MAX_SIZE_BYTES)
    ) {
      throw new TypeError(
        `Release asset stylesheet exceeds ${RELEASE_ASSET_MAX_SIZE_BYTES} bytes`,
      );
    }

    // A stylesheet can emit base/custom CSS without any utility candidates
    // (CSS variables, global rules), so only skip when there is neither a
    // stylesheet nor any candidates to compile.
    if (candidateSnapshot.size === 0 && !stylesheet) {
      logger.debug("No CSS candidates or stylesheet for release; skipping compile", {
        projectScope: options.projectScope,
      });
      return null;
    }

    if (!runtimeOptions || typeof runtimeOptions !== "object" || !runtimeOptions.config) {
      throw new TypeError("Release CSS config is unavailable");
    }

    const styleProfileHash = assertStyleProfileHash(
      createStyleScopeProfile(runtimeOptions.config).hash,
      "Release CSS style profile hash",
    );
    const generationSession = acquireCSSGenerationSession(true);
    const cssPipelineIdentity = assertCSSPipelineIdentity(
      generationSession.cacheIdentity,
      "Release CSS pipeline identity",
    );

    const result = await generateTailwindCSS(stylesheet, candidateSnapshot, {
      minify: true,
      environment: "production",
      buildMode: "production",
      projectSlug: options.projectScope,
    }, { generationSession });

    if (!result.css) {
      throw COMPILATION_ERROR.create({
        detail: "Release asset CSS compilation produced empty output",
      });
    }
    if (textEncoder.encode(result.css).byteLength > RELEASE_ASSET_MAX_SIZE_BYTES) {
      throw new TypeError(
        `Release asset CSS output exceeds ${RELEASE_ASSET_MAX_SIZE_BYTES} bytes`,
      );
    }

    logger.debug("Release asset CSS compiled", {
      projectScope: options.projectScope,
      candidateCount: candidateSnapshot.size,
      cssLength: result.css.length,
      cssHash: hashCSS(result.css),
      styleProfileHash,
      cssPipelineIdentity,
    });

    return { css: result.css, styleProfileHash, cssPipelineIdentity };
  };
}
