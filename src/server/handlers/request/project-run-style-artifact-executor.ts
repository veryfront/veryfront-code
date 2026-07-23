import { getEnvironmentConfig } from "#veryfront/config";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/client.ts";
import type { StyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { API_CLIENT_ERROR, INVALID_ARGUMENT } from "#veryfront/errors";
import { HTTP_UNAVAILABLE } from "#veryfront/utils/constants/index.ts";
import type { HandlerContext } from "../types.ts";
import { getProjectRunStringConfig } from "./project-run-config.ts";
import { projectRunErrorMessage } from "./project-run-http-policy.ts";
import type { ProjectRunExecuteResponse, ProjectRunExecutorInput } from "./project-run-types.ts";

type StyleArtifactBuildSelector = {
  branch?: string;
  environmentName?: string;
  releaseId?: string;
};

type StyleArtifactSourceFile = { path: string; content?: string };

type StyleArtifactSourceProvider = {
  getAllSourceFiles: () => Promise<StyleArtifactSourceFile[]> | StyleArtifactSourceFile[];
  getContentContext?: () => ResolvedContentContext | null;
};

type OptionalTextFileReader = {
  readOptionalTextFile(path: string): Promise<string>;
};

const DEFAULT_STYLESHEET_PATHS = [
  "globals.css",
  "global.css",
  "styles/globals.css",
  "app/globals.css",
  "src/globals.css",
  "src/styles/globals.css",
];

function optionalString(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveStyleArtifactBuildSelector(
  config: Record<string, unknown>,
  ctx: HandlerContext,
): StyleArtifactBuildSelector {
  const selector: StyleArtifactBuildSelector = {
    branch: getProjectRunStringConfig(config, ["branch"]) ??
      optionalString(ctx.parsedDomain?.branch),
    environmentName: getProjectRunStringConfig(config, [
      "environment_name",
      "environmentName",
    ]) ?? optionalString(ctx.environmentName),
    releaseId: getProjectRunStringConfig(config, ["release_id", "releaseId"]) ??
      optionalString(ctx.releaseId),
  };
  const count = [selector.branch, selector.environmentName, selector.releaseId]
    .filter((value) => typeof value === "string" && value.length > 0).length;
  if (count !== 1) {
    throw INVALID_ARGUMENT.create({ detail: "Exactly one style artifact selector is required" });
  }
  return selector;
}

function getStyleArtifactSourceProvider(ctx: HandlerContext): StyleArtifactSourceProvider | null {
  const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
  if (typeof wrappedFs.getUnderlyingAdapter !== "function") return null;
  const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
    getAllSourceFiles?: StyleArtifactSourceProvider["getAllSourceFiles"];
    getContentContext?: StyleArtifactSourceProvider["getContentContext"];
  };
  if (typeof fsAdapter.getAllSourceFiles !== "function") return null;
  return {
    getAllSourceFiles: fsAdapter.getAllSourceFiles.bind(fsAdapter),
    getContentContext: typeof fsAdapter.getContentContext === "function"
      ? fsAdapter.getContentContext.bind(fsAdapter)
      : undefined,
  };
}

function stylesheetCandidatePaths(stylesheetPath?: string): string[] {
  return stylesheetPath ? [stylesheetPath.replace(/^\/+/, "")] : DEFAULT_STYLESHEET_PATHS;
}

function getOptionalTextFileReader(ctx: HandlerContext): OptionalTextFileReader | null {
  const wrappedFs = ctx.adapter.fs as {
    getUnderlyingAdapter?: () => unknown;
    readOptionalTextFile?: OptionalTextFileReader["readOptionalTextFile"];
  };
  if (typeof wrappedFs.readOptionalTextFile === "function") {
    return { readOptionalTextFile: wrappedFs.readOptionalTextFile.bind(wrappedFs) };
  }
  if (typeof wrappedFs.getUnderlyingAdapter !== "function") return null;
  const underlying = wrappedFs.getUnderlyingAdapter() as Partial<OptionalTextFileReader>;
  return typeof underlying.readOptionalTextFile === "function"
    ? { readOptionalTextFile: underlying.readOptionalTextFile.bind(underlying) }
    : null;
}

async function readStylesheetFromAdapter(
  ctx: HandlerContext,
  stylesheetPath?: string,
): Promise<string | undefined> {
  const optionalReader = getOptionalTextFileReader(ctx);
  for (const candidate of stylesheetCandidatePaths(stylesheetPath)) {
    try {
      const content = optionalReader
        ? await optionalReader.readOptionalTextFile(candidate)
        : await ctx.adapter.fs.readFile(candidate);
      const text = typeof content === "string" ? content : new TextDecoder().decode(content);
      if (text) return text;
    } catch {
      // Continue through the bounded set of conventional stylesheet paths.
    }
  }
  return undefined;
}

async function resolveStyleArtifactSourceFiles(
  ctx: HandlerContext,
  styleProfile: StyleScopeProfile,
  collectLocalProjectSourceFiles: (
    options: { projectDir: string; styleProfile: StyleScopeProfile },
  ) => Promise<StyleArtifactSourceFile[]>,
): Promise<{ files: StyleArtifactSourceFile[]; contentContext: ResolvedContentContext | null }> {
  const sourceProvider = getStyleArtifactSourceProvider(ctx);
  if (sourceProvider) {
    return {
      files: await sourceProvider.getAllSourceFiles(),
      contentContext: sourceProvider.getContentContext?.() ?? null,
    };
  }
  if (ctx.isLocalProject === false) {
    throw API_CLIENT_ERROR.create({
      detail: "Remote project source provider is unavailable",
      status: HTTP_UNAVAILABLE,
    });
  }
  return {
    files: await collectLocalProjectSourceFiles({ projectDir: ctx.projectDir, styleProfile }),
    contentContext: null,
  };
}

export async function executeStyleArtifactBuildRun(
  input: ProjectRunExecutorInput,
): Promise<ProjectRunExecuteResponse> {
  const startedAt = Date.now();
  const config = input.request.config ?? {};
  const projectReference = input.ctx.projectSlug ?? input.request.projectId;
  let apiClient: VeryfrontApiClient | null = null;
  let selector: StyleArtifactBuildSelector | null = null;
  let styleProfileHash: string | null = null;

  try {
    const { VeryfrontApiClient } = await import(
      "#veryfront/platform/adapters/veryfront-api-client/client.ts"
    );
    const {
      buildPreparedCSSArtifactFromFiles,
      collectLocalProjectSourceFiles,
      findStylesheetFromFiles,
      readLocalProjectStylesheet,
    } = await import("#veryfront/html/styles-builder/css-pregeneration.ts");
    const { resolveStyleContentVersion } = await import(
      "#veryfront/html/styles-builder/content-version.ts"
    );
    const { createStyleScopeProfile } = await import(
      "#veryfront/html/styles-builder/style-scope-profile.ts"
    );
    const token = input.req.headers.get("x-token") ?? input.ctx.proxyToken ??
      input.ctx.requestContext?.token ?? "";
    if (!token) throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });

    apiClient = new VeryfrontApiClient({
      apiBaseUrl: getEnvironmentConfig().apiBaseUrl,
      apiToken: token,
      projectSlug: projectReference,
      projectId: input.ctx.projectId,
    });
    apiClient.setProjectSlug(projectReference);
    selector = resolveStyleArtifactBuildSelector(config, input.ctx);
    const styleProfile = createStyleScopeProfile(input.ctx.config);
    const requestedStyleProfileHash = getProjectRunStringConfig(config, [
      "style_profile_hash",
      "styleProfileHash",
    ]);
    styleProfileHash = requestedStyleProfileHash ?? styleProfile.hash;
    if (requestedStyleProfileHash && requestedStyleProfileHash !== styleProfile.hash) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Style profile hash mismatch: expected ${requestedStyleProfileHash}, got ${styleProfile.hash}`,
      });
    }

    const { files, contentContext } = await resolveStyleArtifactSourceFiles(
      input.ctx,
      styleProfile,
      collectLocalProjectSourceFiles,
    );
    if (files.length === 0) {
      throw INVALID_ARGUMENT.create({
        detail: "No project source files were available to build the style artifact",
      });
    }
    const stylesheetPath = input.ctx.config?.tailwind?.stylesheet;
    const stylesheet = findStylesheetFromFiles(files, stylesheetPath) ??
      (getStyleArtifactSourceProvider(input.ctx)
        ? await readStylesheetFromAdapter(input.ctx, stylesheetPath)
        : await readLocalProjectStylesheet(input.ctx.projectDir, stylesheetPath));
    const result = await buildPreparedCSSArtifactFromFiles({
      projectSlug: projectReference,
      projectVersion: resolveStyleContentVersion(contentContext, {
        branch: selector.branch,
        environmentName: selector.environmentName,
        releaseId: selector.releaseId,
      }),
      projectDir: input.ctx.projectDir,
      files,
      styleProfile,
      stylesheet,
      stylesheetPath,
      minify: true,
      environment: "preview",
      buildMode: "production",
    });
    await apiClient.upsertStyleArtifact({
      ...selector,
      styleProfileHash,
      status: "ready",
      artifactHash: result.hash,
      assetPath: `/_vf/css/${result.hash}.css`,
      contentType: "text/css; charset=utf-8",
      buildRunId: input.request.runId,
    });
    return {
      success: true,
      result: {
        state: "ready",
        artifactHash: result.hash,
        assetPath: `/_vf/css/${result.hash}.css`,
        candidateCount: result.candidateCount,
        fromCache: result.fromCache,
      },
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    if (apiClient && selector && styleProfileHash) {
      await apiClient.upsertStyleArtifact({
        ...selector,
        styleProfileHash,
        status: "failed",
        buildRunId: input.request.runId,
        failureReason: projectRunErrorMessage(error),
      }).catch(() => undefined);
    }
    return {
      success: false,
      error: projectRunErrorMessage(error),
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  }
}
