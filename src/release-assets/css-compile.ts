/**
 * Release Asset Manifest — production CSS compiler.
 *
 * Provides the `compileProjectCss` implementation injected into the build
 * executor's client. It compiles a project's Tailwind CSS directly through the
 * core compiler (`generateTailwindCSS`) against the candidates the executor
 * extracted from the materialized release file set, using the project
 * stylesheet the executor resolved from that same file set.
 *
 * Why this is safe to run inside the project runtime:
 * - It uses `generateTailwindCSS`, NOT `getProjectCSS`. `getProjectCSS` pulls in
 *   the distributed/project-CSS cache (`initializeProjectCSSCache`,
 *   prepared-project-css, style-artifact resolution) — the very machinery whose
 *   per-route candidate contract and distributed-cache init motivated deferring
 *   CSS from the builder. `generateTailwindCSS` is the pure compile primitive:
 *   it resolves the `CSSProcessor` extension (auto-registering the built-in
 *   `@veryfront/ext-css-tailwind` on first use) and calls
 *   `compiler.build(candidates)` with no cross-request/distributed state.
 * - Work is bounded: one compile over the candidate set the executor already
 *   gathered, output minified, no background tasks.
 * - It is defensive by construction: every failure path returns `null` so the
 *   executor keeps its `css:no-pipeline` / `css:compile-failed` gap and proceeds.
 *
 * @module release-assets/css-compile
 */

import { serverLogger } from "#veryfront/utils";
import type { VeryfrontConfig } from "#veryfront/config";
import { generateTailwindCSS, hashCSS } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";

const logger = serverLogger.component("release-asset-css-compile");

export interface CompileProjectCssResult {
  css: string;
  styleProfileHash: string | null;
}

export interface CompileProjectCssOptions {
  /** Project scope (slug or id) — isolates the compiler cache per project. */
  projectScope: string;
  /** Resolved project config, used to derive the style-scope profile. */
  config?: VeryfrontConfig;
}

/**
 * Build a `compileProjectCss` function bound to a specific release build.
 *
 * The returned function matches the build executor's injected client signature:
 * `(candidates, stylesheet) => Promise<{ css, styleProfileHash } | null>`. It
 * NEVER throws — any failure resolves to `null` so the executor records a CSS
 * gap and proceeds.
 */
export function createCompileProjectCss(
  options: CompileProjectCssOptions,
): (
  candidates: Set<string>,
  stylesheet: string | undefined,
) => Promise<CompileProjectCssResult | null> {
  return async (
    candidates: Set<string>,
    stylesheet: string | undefined,
  ): Promise<CompileProjectCssResult | null> => {
    try {
      // A stylesheet can emit base/custom CSS without any utility candidates
      // (CSS variables, global rules), so only skip when there is neither a
      // stylesheet nor any candidates to compile.
      if (candidates.size === 0 && !stylesheet) {
        logger.debug("No CSS candidates or stylesheet for release; skipping compile", {
          projectScope: options.projectScope,
        });
        return null;
      }

      const styleProfile = createStyleScopeProfile(options.config);

      const result = await generateTailwindCSS(stylesheet, candidates, {
        minify: true,
        environment: "production",
        buildMode: "production",
        projectSlug: options.projectScope,
      });

      if (result.error || !result.css) {
        logger.warn("Release asset CSS compile produced no output", {
          projectScope: options.projectScope,
          error: result.error,
        });
        return null;
      }

      logger.debug("Release asset CSS compiled", {
        projectScope: options.projectScope,
        candidateCount: candidates.size,
        cssLength: result.css.length,
        cssHash: hashCSS(result.css),
        styleProfileHash: styleProfile.hash,
      });

      return { css: result.css, styleProfileHash: styleProfile.hash };
    } catch (error) {
      // Defensive: any failure → null so the executor keeps the CSS gap.
      logger.warn("Release asset CSS compile failed (returning null)", {
        projectScope: options.projectScope,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
}
