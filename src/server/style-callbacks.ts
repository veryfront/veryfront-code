import { getConfig, type VeryfrontConfig } from "#veryfront/config";
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
import { invalidateProjectCSSAsync } from "#veryfront/html/styles-builder/css-compiler.ts";

const styleCallbackLog = logger.component("server-style-callbacks");

/** @internal Dependency contract for focused callback tests. */
export interface ServerStyleCallbackDependencies {
  readonly buildPreparedCSSArtifactFromFiles: typeof buildPreparedCSSArtifactFromFiles;
  readonly loadConfig: (
    projectDir: string,
    context: StylePregenerationContext,
  ) => Promise<VeryfrontConfig>;
}

const defaultStyleCallbackDependencies: ServerStyleCallbackDependencies = {
  buildPreparedCSSArtifactFromFiles,
  async loadConfig(projectDir, context) {
    const adapter = await runtime.get();
    const cacheKey = context.contentContext?.releaseId || context.projectSlug;
    return await getConfig(projectDir, adapter, { cacheKey });
  },
};

async function pregenerateProjectStyles(
  files: StylePregenerationFile[],
  context: StylePregenerationContext,
  dependencies: ServerStyleCallbackDependencies,
): Promise<{ hash: string; assetPath: string } | undefined> {
  const { projectDir, projectSlug, contentContext } = context;

  if (!projectDir) {
    styleCallbackLog.debug("Skipping CSS pre-generation without projectDir", {
      projectSlug,
    });
    return undefined;
  }

  const config = context.config
    ? context.config as VeryfrontConfig
    : await dependencies.loadConfig(projectDir, context);
  const stylesheetPath = config.styles?.stylesheet;
  const styleProfile = createStyleScopeProfile(config);

  const stylesheet = findStylesheetFromFiles(files, stylesheetPath, projectDir);
  const projectVersion = resolveStyleContentVersion(contentContext, {
    branch: contentContext?.branch ?? null,
    releaseId: contentContext?.releaseId ?? null,
    environmentName: contentContext?.environmentName ?? null,
  });

  const result = await dependencies.buildPreparedCSSArtifactFromFiles({
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
  return createStyleCallbacks(defaultStyleCallbackDependencies);
}

function createStyleCallbacks(
  dependencies: ServerStyleCallbackDependencies,
): StyleCallbacks {
  return {
    pregenerateStyles: (files, context) => pregenerateProjectStyles(files, context, dependencies),
  };
}

/** @internal Focused dependency seam for style callback contract tests. */
export const serverStyleCallbackInternals = Object.freeze({
  createStyleCallbacks,
});

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
