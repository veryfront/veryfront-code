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
 * - Configuration is validated synchronously. Once configured, compile-time
 *   failures return `null` so the executor records a CSS gap and proceeds.
 *
 * @module release-assets/css-compile
 */

import { serverLogger } from "#veryfront/utils";
import type { VeryfrontConfig } from "#veryfront/config";
import { generateTailwindCSS, hashCSS } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
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
  css: string;
  styleProfileHash: string | null;
}

/** Configuration captured by a release-scoped CSS compiler. */
export interface CompileProjectCssOptions {
  /** Project scope (slug or id) — isolates the compiler cache per project. */
  projectScope: string;
  /** Fallback project config, used when the executor cannot provide release config. */
  config?: VeryfrontConfig;
}

/** Per-build configuration resolved from the materialized release. */
export interface CompileProjectCssRuntimeOptions {
  /** Project config resolved from the materialized release file set. */
  config?: VeryfrontConfig;
}

/**
 * Build a `compileProjectCss` function bound to a specific release build.
 *
 * The returned function matches the build executor's injected client signature:
 * `(candidates, stylesheet, options) => Promise<{ css, styleProfileHash } | null>`. It
 * The factory rejects invalid configuration synchronously. The returned
 * function never throws: compile failures resolve to `null` so the executor
 * records a CSS gap and proceeds.
 */
export function createCompileProjectCss(
  options: CompileProjectCssOptions,
): (
  candidates: Set<string>,
  stylesheet: string | undefined,
  runtimeOptions?: CompileProjectCssRuntimeOptions,
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
    runtimeOptions?: CompileProjectCssRuntimeOptions,
  ): Promise<CompileProjectCssResult | null> => {
    try {
      if (!(candidates instanceof Set) || candidates.size > MAX_CSS_CANDIDATES) {
        logger.warn("Release asset CSS candidates exceed the supported boundary", {
          projectScope: options.projectScope,
          candidateCount: candidates instanceof Set ? candidates.size : null,
          limit: MAX_CSS_CANDIDATES,
        });
        return null;
      }
      const candidateSnapshot = new Set<string>();
      for (const candidate of candidates) {
        if (
          typeof candidate !== "string" ||
          candidate.length === 0 ||
          candidate.length > MAX_CSS_CANDIDATE_LENGTH ||
          hasControlCharacters(candidate)
        ) {
          logger.warn("Release asset CSS candidate is invalid", {
            projectScope: options.projectScope,
          });
          return null;
        }
        candidateSnapshot.add(candidate);
      }
      if (
        stylesheet !== undefined &&
        (typeof stylesheet !== "string" ||
          textEncoder.encode(stylesheet).byteLength > RELEASE_ASSET_MAX_SIZE_BYTES)
      ) {
        logger.warn("Release asset stylesheet exceeds the supported boundary", {
          projectScope: options.projectScope,
          limit: RELEASE_ASSET_MAX_SIZE_BYTES,
        });
        return null;
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

      const styleProfile = createStyleScopeProfile(runtimeOptions?.config ?? options.config);

      const result = await generateTailwindCSS(stylesheet, candidateSnapshot, {
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
      if (textEncoder.encode(result.css).byteLength > RELEASE_ASSET_MAX_SIZE_BYTES) {
        logger.warn("Release asset CSS compile output exceeds the asset limit", {
          projectScope: options.projectScope,
          limit: RELEASE_ASSET_MAX_SIZE_BYTES,
        });
        return null;
      }

      logger.debug("Release asset CSS compiled", {
        projectScope: options.projectScope,
        candidateCount: candidateSnapshot.size,
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
