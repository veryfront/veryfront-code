import type { VeryfrontConfig } from "#veryfront/config";
import type { HTMLGenerationOptions } from "#veryfront/html";
import { getProjectCSS } from "#veryfront/html/styles-builder/index.ts";
import { warmPreparedCSSArtifactFromFiles } from "#veryfront/html/styles-builder/css-pregeneration.ts";
import { resolveStyleContentVersion } from "#veryfront/html/styles-builder/content-version.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { rendererLogger } from "#veryfront/utils";
import {
  captureProjectStyleSourceSnapshot,
  isProjectStyleSourceSnapshot,
  type ProjectStyleSourceSnapshot,
} from "#veryfront/html/styles-builder/project-style-source-snapshot.ts";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import { extractRelativePath } from "#veryfront/utils/route-path-utils.ts";
import { getProjectCandidates } from "./css-candidate-manifest.ts";
import { getRenderCSSGenerationSession } from "./css-generation-session.ts";
import type { HTMLGenerationContext } from "./html-types.ts";

const logger = rendererLogger.component("html-project-css");

export type ProjectCSSResult = Awaited<ReturnType<typeof getProjectCSS>> | null;

interface ProjectCssConfig {
  projectDir: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  mode: "development" | "production";
}

interface ProjectCssDeps {
  createStyleScopeProfile?: typeof createStyleScopeProfile;
  getProjectCSS?: typeof getProjectCSS;
  getProjectContentVersion?: (
    snapshot: ProjectStyleSourceSnapshot | null,
  ) => string | undefined;
  getProjectCandidates?: typeof getProjectCandidates;
  resolveStyleContentVersion?: typeof resolveStyleContentVersion;
  warmPreparedCSSArtifactFromFiles?: typeof warmPreparedCSSArtifactFromFiles;
}

const projectStyleSourceSnapshots = new WeakMap<
  HTMLGenerationContext,
  Promise<ProjectStyleSourceSnapshot | null>
>();

function getProjectStyleSourceSnapshot(
  config: ProjectCssConfig,
  context: HTMLGenerationContext,
): Promise<ProjectStyleSourceSnapshot | null> {
  let snapshot = projectStyleSourceSnapshots.get(context);
  if (snapshot === undefined) {
    snapshot = captureProjectStyleSourceSnapshot({
      adapter: config.adapter,
      projectDir: config.projectDir,
      config: config.config,
      includeStylesheets: true,
    });
    projectStyleSourceSnapshots.set(context, snapshot);
  }
  return snapshot;
}

export function buildRouteManifestKey(pagePath: string, projectDir: string): string {
  const relativePagePath = extractRelativePath(pagePath, projectDir);
  return relativePagePath
    .replace(/\.(tsx|ts|jsx|mdx|md|js)$/, "")
    .replace(/^pages\//, "");
}

export function getProjectContentVersion(
  snapshot: ProjectStyleSourceSnapshot | null,
  deps: Pick<ProjectCssDeps, "resolveStyleContentVersion"> = {},
): string | undefined {
  if (snapshot !== null && !isProjectStyleSourceSnapshot(snapshot)) {
    throw new TypeError("Project content version requires an admitted source snapshot");
  }
  if (snapshot?.contentContext) {
    const resolveContentVersion = deps.resolveStyleContentVersion ?? resolveStyleContentVersion;
    return resolveContentVersion(snapshot.contentContext);
  }
  return snapshot?.projectUpdatedAt;
}

export function startProjectCSSPreparation(
  context: HTMLGenerationContext,
  htmlOptions: HTMLGenerationOptions,
  deps: Pick<ProjectCssDeps, "getProjectCSS"> = {},
): Promise<ProjectCSSResult> | undefined {
  const isLocalProject = htmlOptions.isLocalProject ?? false;
  if (isLocalProject || htmlOptions.environment !== "production") return undefined;

  const projectScope = htmlOptions.projectSlug || htmlOptions.projectId || context.slug;
  if (!projectScope || projectScope === "default") return undefined;

  const getProjectCss = deps.getProjectCSS ?? getProjectCSS;
  const generationSession = getRenderCSSGenerationSession(context.options);
  return getProjectCss(
    projectScope,
    htmlOptions.globalCSS,
    new Set([...(htmlOptions.projectClasses ?? [])]),
    {
      minify: true,
      environment: htmlOptions.environment,
      buildMode: htmlOptions.mode as "development" | "production",
    },
    { generationSession },
  );
}

export function startPreparedCSSWarmup(
  config: ProjectCssConfig,
  context: HTMLGenerationContext,
  htmlOptions: HTMLGenerationOptions,
  deps: Pick<
    ProjectCssDeps,
    "createStyleScopeProfile" | "getProjectContentVersion" | "warmPreparedCSSArtifactFromFiles"
  > = {},
): void {
  const isLocalProject = htmlOptions.isLocalProject ?? false;
  const usesPreviewStylesheet = isLocalProject || htmlOptions.environment !== "production";
  if (!usesPreviewStylesheet) return;

  const projectScope = htmlOptions.projectSlug || htmlOptions.projectId || context.slug;
  if (!projectScope || projectScope === "default") return;

  const createStyleProfile = deps.createStyleScopeProfile ?? createStyleScopeProfile;
  const warmPreparedCss = deps.warmPreparedCSSArtifactFromFiles ?? warmPreparedCSSArtifactFromFiles;
  const styleProfile = createStyleProfile(config.config);
  const stylesheetPath = config.config?.styles?.stylesheet;
  const generationSession = getRenderCSSGenerationSession(context.options);

  getProjectStyleSourceSnapshot(config, context)
    .then((snapshot) => {
      if (snapshot === null || snapshot.files === null) return undefined;
      const resolveProjectContentVersion = deps.getProjectContentVersion ??
        getProjectContentVersion;
      const projectVersion = resolveProjectContentVersion(snapshot) ??
        (config.mode === "development" ? "dev" : "unknown");
      return warmPreparedCss({
        projectSlug: projectScope,
        projectVersion,
        projectDir: config.projectDir,
        files: snapshot.files,
        styleProfile,
        stylesheetPath,
        minify: true,
        environment: "preview",
        buildMode: "production",
        generationSession,
      });
    })
    .catch((error) => {
      logger.debug("Prepared CSS warmup skipped after source scan failure", {
        projectScope,
        phase: "source-snapshot-or-warmup-rejected",
        error: snapshotThrowableDiagnostic(error),
      });
    });
}

export async function extractProjectClassesForRoute(
  config: ProjectCssConfig,
  context: HTMLGenerationContext,
  _appComponentPath?: string,
  deps: Pick<
    ProjectCssDeps,
    "createStyleScopeProfile" | "getProjectContentVersion" | "getProjectCandidates"
  > = {},
): Promise<Set<string>> {
  const classes = new Set<string>();
  const snapshot = await getProjectStyleSourceSnapshot(config, context);
  if (snapshot === null || snapshot.files === null) return classes;
  const files = snapshot.files;
  const projectScope = context.options?.projectSlug || context.options?.projectId ||
    config.projectDir;
  const resolveProjectContentVersion = deps.getProjectContentVersion ?? getProjectContentVersion;
  const projectVersion = resolveProjectContentVersion(snapshot) ??
    (config.mode === "development" ? "dev" : "unknown");

  const createStyleProfile = deps.createStyleScopeProfile ?? createStyleScopeProfile;
  const getProjectCssCandidates = deps.getProjectCandidates ?? getProjectCandidates;
  // Candidates must come from the full source scan, not the route-module
  // manifest: the manifest is populated per pod from request history, so
  // route-scoped candidates omit shared components the pod has not yet
  // observed and produce divergent CSS across replicas for the same page.
  const projectCandidates = getProjectCssCandidates({
    projectScope,
    projectVersion,
    projectDir: config.projectDir,
    styleProfile: createStyleProfile(config.config),
    files,
    developmentMode: config.mode === "development",
  });

  for (const cls of projectCandidates) classes.add(cls);

  logger.debug("extractProjectClasses", {
    filesProcessed: files.length,
    totalClasses: classes.size,
  });

  return classes;
}
