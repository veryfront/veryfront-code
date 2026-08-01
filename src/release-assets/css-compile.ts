/**
 * Release Asset Manifest — production CSS compiler.
 *
 * Provides the `compileProjectCss` implementation injected into the build
 * executor's client. It compiles project CSS through an explicitly registered
 * processor (`generateTailwindCSS` is retained as a compatibility name) against the candidates
 * extracted from the materialized release file set, using the project
 * stylesheet the executor resolved from that same file set.
 *
 * Why this is safe to run inside the project runtime:
 * - It uses `generateTailwindCSS`, NOT `getProjectCSS`. `getProjectCSS` pulls in
 *   the distributed/project-CSS cache (`initializeProjectCSSCache`,
 *   prepared-project-css, style-artifact resolution) — the very machinery whose
 *   per-route candidate contract and distributed-cache init motivated deferring
 *   CSS from the builder. The compile primitive captures explicit compiler and
 *   optimizer providers once and performs no discovery, network loading, or
 *   empty-output fallback.
 * - Work is bounded: one compile over the candidate set the executor already
 *   gathered, output minified, no background tasks.
 * - `null` means only that there is no stylesheet and no candidate to compile.
 *   Provider/compiler failures propagate to the executor, which records its
 *   explicit `css:compile-failed` gap.
 *
 * @module release-assets/css-compile
 */

import { serverLogger } from "#veryfront/utils";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  acquireCSSGenerationSession,
  generateTailwindCSS,
  hashCSS,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { composeCSSStyleProfileHash } from "#veryfront/html/styles-builder/css-identity.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";

const logger = serverLogger.component("release-asset-css-compile");

export interface CompileProjectCssResult {
  css: string;
  styleProfileHash: string | null;
}

export interface CompileProjectCssOptions {
  /** Project scope (slug or id) — isolates the compiler cache per project. */
  projectScope: string;
  /** Fallback project config, used when the executor cannot provide release config. */
  config?: VeryfrontConfig;
}

export interface CompileProjectCssRuntimeOptions {
  /** Project config resolved from the materialized release file set. */
  config?: VeryfrontConfig;
}

/**
 * Build a `compileProjectCss` function bound to a specific release build.
 *
 * The returned function matches the build executor's injected client signature:
 * `(candidates, stylesheet, options) => Promise<{ css, styleProfileHash } | null>`.
 * Missing providers and compilation failures reject; only a genuinely empty
 * CSS input resolves to `null`.
 */
export function createCompileProjectCss(
  options: CompileProjectCssOptions,
): (
  candidates: Set<string>,
  stylesheet: string | undefined,
  runtimeOptions?: CompileProjectCssRuntimeOptions,
) => Promise<CompileProjectCssResult | null> {
  return async (
    candidates: Set<string>,
    stylesheet: string | undefined,
    runtimeOptions?: CompileProjectCssRuntimeOptions,
  ): Promise<CompileProjectCssResult | null> => {
    // A stylesheet can emit base/custom CSS without any utility candidates
    // (CSS variables, global rules), so only skip when there is neither a
    // stylesheet nor any candidates to compile.
    if (candidates.size === 0 && !stylesheet) {
      logger.debug("No CSS candidates or stylesheet for release; skipping compile", {
        projectScope: options.projectScope,
      });
      return null;
    }

    const styleProfile = createStyleScopeProfile(runtimeOptions?.config ?? options.config);
    const generationSession = acquireCSSGenerationSession(true);
    const resolvedStylesheet = stylesheet ??
      generationSession.compilationSession.defaultStylesheet;

    const result = await generateTailwindCSS(resolvedStylesheet, candidates, {
      minify: true,
      environment: "production",
      buildMode: "production",
      projectSlug: options.projectScope,
    }, { generationSession });

    if (result.css.length === 0) {
      throw new TypeError("Release asset CSS compiler produced an empty output");
    }

    const styleArtifactProfileHash = composeCSSStyleProfileHash(
      styleProfile.hash,
      result.cacheIdentity,
    );

    logger.debug("Release asset CSS compiled", {
      projectScope: options.projectScope,
      candidateCount: candidates.size,
      cssLength: result.css.length,
      cssHash: hashCSS(result.css),
      styleProfileHash: styleArtifactProfileHash,
    });

    return { css: result.css, styleProfileHash: styleArtifactProfileHash };
  };
}
