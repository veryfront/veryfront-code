/**
 * Styles Candidate Scanner
 *
 * Extracts CSS processor candidate class names from project source files.
 * Supports two strategies: FS adapter with getAllSourceFiles() for remote/proxy
 * mode, and local filesystem scanning as fallback for local development.
 *
 * @module server/handlers/dev/styles-candidate-scanner
 */

import { resolveStyleContentVersion } from "#veryfront/html/styles-builder/content-version.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { getProjectCandidates } from "#veryfront/rendering/orchestrator/css-candidate-manifest.ts";
import type { HandlerContext } from "../types.ts";
import { MAX_CSS_SELECTOR_TOKENS } from "#veryfront/utils/constants/css.ts";
import { FRAMEWORK_CANDIDATES } from "./framework-candidates.generated.ts";
import {
  collectProjectStyleSourceFiles,
  type ProjectStyleSourceFile,
  resolveStyleSourceProvider,
} from "./styles-source-file-collector.ts";

/** De-duplicated set of framework candidates, computed once at import time. */
const frameworkCandidates = new Set<string>(FRAMEWORK_CANDIDATES);

interface CandidateExtractionContext {
  /** Authoritative source version already resolved by the request handler. */
  projectVersion?: string;
  /** Authoritative source mutability, independent of adapter introspection. */
  developmentMode?: boolean;
}

/**
 * Extract CSS processor candidate class names from all project source files.
 *
 * Tries the FS adapter's `getAllSourceFiles()` first (available in proxy/remote
 * mode). Falls back to recursive local directory scanning when no adapter or
 * method is available (local dev mode).
 */
export async function extractProjectCandidates(
  ctx: HandlerContext,
  extractionContext: Readonly<CandidateExtractionContext> = {},
  sourceFiles?: readonly ProjectStyleSourceFile[],
): Promise<Set<string>> {
  const styleProfile = createStyleScopeProfile(ctx.config);
  const candidates = new Set<string>(frameworkCandidates);
  const hasAuthoritativeContext = extractionContext.projectVersion !== undefined &&
    extractionContext.developmentMode !== undefined;
  const sourceProvider = hasAuthoritativeContext ? undefined : resolveStyleSourceProvider(ctx);
  const contentContext = !hasAuthoritativeContext &&
      typeof sourceProvider?.getContentContext === "function"
    ? sourceProvider.getContentContext.call(sourceProvider)
    : null;
  const files = sourceFiles ? [...sourceFiles] : await collectProjectStyleSourceFiles(ctx);

  for (
    const cls of getProjectCandidates({
      projectScope: ctx.projectSlug ?? contentContext?.projectSlug ?? ctx.projectDir,
      projectVersion: extractionContext.projectVersion ??
        resolveStyleContentVersion(contentContext, {
          releaseId: ctx.releaseId,
          branch: ctx.parsedDomain?.branch,
          environmentName: ctx.environmentName,
        }),
      projectDir: ctx.projectDir,
      styleProfile,
      files,
      developmentMode: extractionContext.developmentMode ??
        contentContext?.sourceType === "branch",
    })
  ) {
    if (!candidates.has(cls) && candidates.size >= MAX_CSS_SELECTOR_TOKENS) {
      throw new TypeError(
        `CSS candidate extraction cannot exceed ${MAX_CSS_SELECTOR_TOKENS} candidates`,
      );
    }
    candidates.add(cls);
  }

  return candidates;
}
