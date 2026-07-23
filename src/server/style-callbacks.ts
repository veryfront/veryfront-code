import { getConfig } from "#veryfront/config";
import {
  invalidateProjectCandidateManifests,
} from "#veryfront/rendering/orchestrator/css-candidate-manifest.ts";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import type {
  InvalidationCallbacks,
  StyleCallbacks,
  StylePregenerationContext,
  StylePregenerationFile,
} from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { logger } from "#veryfront/utils";
import {
  buildPreparedCSSArtifactFromFiles,
  findStylesheetFromFiles,
} from "#veryfront/html/styles-builder/css-pregeneration.ts";
import { resolveStyleContentVersion } from "#veryfront/html/styles-builder/content-version.ts";
import {
  invalidatePreparedProjectCSSAsync,
} from "#veryfront/html/styles-builder/prepared-project-css-cache.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { invalidateProjectCSSAsync } from "#veryfront/html/styles-builder/tailwind-compiler.ts";

const styleCallbackLog = logger.component("server-style-callbacks");

async function pregenerateProjectStyles(
  files: StylePregenerationFile[],
  context: StylePregenerationContext,
): Promise<{ hash: string; assetPath: string } | undefined> {
  const { projectDir, projectSlug, contentContext } = context;

  if (!projectDir) {
    styleCallbackLog.debug("Skipping CSS pre-generation without projectDir", {
      projectSlug,
    });
    return undefined;
  }

  let stylesheetPath: string | undefined;
  let styleProfile = createStyleScopeProfile();

  try {
    const adapter = await runtime.get();
    const cacheKey = contentContext?.releaseId || projectSlug;
    const config = await getConfig(projectDir, adapter, { cacheKey });
    stylesheetPath = config?.tailwind?.stylesheet;
    styleProfile = createStyleScopeProfile(config);
  } catch (error) {
    styleCallbackLog.debug("Failed to load config for CSS pre-generation", {
      projectSlug,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const stylesheet = findStylesheetFromFiles(files, stylesheetPath);
  const projectVersion = resolveStyleContentVersion(contentContext, {
    branch: contentContext?.branch ?? null,
    releaseId: contentContext?.releaseId ?? null,
    environmentName: contentContext?.environmentName ?? null,
  });

  const result = await buildPreparedCSSArtifactFromFiles({
    projectSlug,
    projectVersion,
    projectDir,
    files,
    styleProfile,
    stylesheet,
    stylesheetPath,
    minify: true,
    environment: "preview",
    buildMode: "production",
  });

  styleCallbackLog.debug("CSS pre-generation complete", {
    projectSlug,
    projectVersion,
    cssHash: result.hash,
    candidateCount: result.candidateCount,
    fromCache: result.fromCache,
  });

  return { hash: result.hash, assetPath: `/_vf/css/${result.hash}.css` };
}

export function createServerStyleCallbacks(): StyleCallbacks {
  return { pregenerateStyles: pregenerateProjectStyles };
}

export function createServerStyleInvalidationCallbacks(): Pick<
  InvalidationCallbacks,
  "clearProjectCSSCache"
> {
  return {
    clearProjectCSSCache: async (projectSlug) => {
      invalidateProjectCandidateManifests(projectSlug);
      const outcomes = await Promise.allSettled([
        invalidateProjectCSSAsync(projectSlug),
        invalidatePreparedProjectCSSAsync(projectSlug),
      ]);
      const failures = outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [outcome.reason] : []
      );
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `Failed to invalidate distributed CSS caches for ${projectSlug}`,
        );
      }
    },
  };
}
