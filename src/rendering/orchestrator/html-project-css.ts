import type { VeryfrontConfig } from "#veryfront/config";
import type { HTMLGenerationOptions } from "#veryfront/html";
import { getProjectCSS } from "#veryfront/html/styles-builder/index.ts";
import { warmPreparedCSSArtifactFromFiles } from "#veryfront/html/styles-builder/css-pregeneration.ts";
import { resolveStyleContentVersion } from "#veryfront/html/styles-builder/content-version.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type {
  FSAdapter,
  ResolvedContentContext,
} from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { rendererLogger } from "#veryfront/utils";
import { extractRelativePath } from "#veryfront/utils/route-path-utils.ts";
import { getProjectCandidates } from "./css-candidate-manifest.ts";
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
    config: Pick<ProjectCssConfig, "adapter" | "mode">,
  ) => string | undefined;
  getProjectCandidates?: typeof getProjectCandidates;
  resolveStyleContentVersion?: typeof resolveStyleContentVersion;
  warmPreparedCSSArtifactFromFiles?: typeof warmPreparedCSSArtifactFromFiles;
}

type SourceFileEntry = { path: string; content?: string };

type FsWithUnderlyingAdapter = { getUnderlyingAdapter: () => FSAdapter };

function hasUnderlyingAdapter(fs: unknown): fs is FsWithUnderlyingAdapter {
  return typeof (fs as Partial<FsWithUnderlyingAdapter>).getUnderlyingAdapter === "function";
}

function getUnderlyingFsAdapter(adapter: RuntimeAdapter): FSAdapter | undefined {
  if (!hasUnderlyingAdapter(adapter.fs)) return undefined;
  return adapter.fs.getUnderlyingAdapter();
}

export function buildRouteManifestKey(pagePath: string, projectDir: string): string {
  const relativePagePath = extractRelativePath(pagePath, projectDir);
  return relativePagePath
    .replace(/\.(tsx|ts|jsx|mdx|md|js)$/, "")
    .replace(/^pages\//, "");
}

export function getProjectContentVersion(
  config: Pick<ProjectCssConfig, "adapter" | "mode">,
  deps: Pick<ProjectCssDeps, "resolveStyleContentVersion"> = {},
): string | undefined {
  const fsAdapter = getUnderlyingFsAdapter(config.adapter) as {
    getContentContext?: () => ResolvedContentContext | null;
    getProjectData?: () => { updated_at?: string } | undefined;
  } | undefined;

  if (!fsAdapter) return undefined;

  const contentContext = typeof fsAdapter.getContentContext === "function"
    ? fsAdapter.getContentContext()
    : null;
  if (contentContext) {
    const resolveContentVersion = deps.resolveStyleContentVersion ?? resolveStyleContentVersion;
    return resolveContentVersion(contentContext);
  }

  return fsAdapter.getProjectData?.()?.updated_at;
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
  return getProjectCss(
    projectScope,
    htmlOptions.globalCSS,
    new Set([...(htmlOptions.projectClasses ?? [])]),
    {
      minify: true,
      environment: htmlOptions.environment,
      buildMode: htmlOptions.mode as "development" | "production",
    },
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

  const fsAdapter = getUnderlyingFsAdapter(config.adapter) as {
    getAllSourceFiles?: () => SourceFileEntry[] | Promise<SourceFileEntry[]>;
  } | undefined;
  if (typeof fsAdapter?.getAllSourceFiles !== "function") return;

  const projectScope = htmlOptions.projectSlug || htmlOptions.projectId || context.slug;
  if (!projectScope || projectScope === "default") return;

  const resolveProjectContentVersion = deps.getProjectContentVersion ?? getProjectContentVersion;
  const projectVersion = resolveProjectContentVersion(config) ??
    (config.mode === "development" ? "dev" : "unknown");
  const createStyleProfile = deps.createStyleScopeProfile ?? createStyleScopeProfile;
  const warmPreparedCss = deps.warmPreparedCSSArtifactFromFiles ?? warmPreparedCSSArtifactFromFiles;
  const styleProfile = createStyleProfile(config.config);
  const stylesheetPath = config.config?.tailwind?.stylesheet;

  Promise.resolve(fsAdapter.getAllSourceFiles())
    .then((files) =>
      warmPreparedCss({
        projectSlug: projectScope,
        projectVersion,
        projectDir: config.projectDir,
        files,
        styleProfile,
        stylesheetPath,
        minify: true,
        environment: "preview",
        buildMode: "production",
      })
    )
    .catch((error) => {
      logger.debug("Prepared CSS warmup skipped after source scan failure", {
        projectScope,
        error: error instanceof Error ? error.message : String(error),
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
  const fsAdapter = getUnderlyingFsAdapter(config.adapter) as {
    getAllSourceFiles?: () => SourceFileEntry[] | Promise<SourceFileEntry[]>;
  } | undefined;

  if (typeof fsAdapter?.getAllSourceFiles !== "function") return classes;

  const files = await fsAdapter.getAllSourceFiles();
  const projectScope = context.options?.projectSlug || context.options?.projectId ||
    config.projectDir;
  const resolveProjectContentVersion = deps.getProjectContentVersion ?? getProjectContentVersion;
  const projectVersion = resolveProjectContentVersion(config) ??
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
