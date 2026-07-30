import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { getConfig } from "veryfront/config";
import {
  createStyleArtifactTuple,
  enhanceAdapterWithFS,
  getEnv,
  isExtendedFSAdapter,
  type ProjectStyleArtifactResolution,
  runtime,
  type StyleArtifactTuple,
  type VeryfrontApiClient,
} from "veryfront/platform";
import {
  acquireCSSGenerationSession,
  buildPreparedCSSArtifactFromFiles,
  createStyleScopeProfile,
  resolveStyleContentVersion,
} from "veryfront/rendering/styles";
import { isCSSPipelineIdentity, isStyleProfileHash } from "veryfront/utils";
import { cliLogger, exitProcess } from "#cli/utils";
import type { StylesArgs } from "./handler.ts";
import { writeRunResultIfConfigured } from "../../utils/write-run-result.ts";

const getStyleArtifactBuildConfigSchema = defineSchema((v) =>
  v.object({
    css_pipeline_identity: v.string().refine(
      isCSSPipelineIdentity,
      "CSS pipeline identity must be bounded, trimmed, NFC-normalized, and free of control characters",
    ),
    style_profile_hash: v.string().refine(
      isStyleProfileHash,
      "Style profile hash must be a full lowercase SHA-256 digest",
    ),
    branch: v.string().min(1).optional(),
    environment_name: v.string().min(1).optional(),
    release_id: v.string().min(1).optional(),
  }).superRefine((value, ctx) => {
    const selectorCount = [value.branch, value.environment_name, value.release_id].filter(Boolean)
      .length;
    if (selectorCount !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Exactly one of branch, environment_name, or release_id is required.",
      });
    }
  })
);

const StyleArtifactBuildConfigSchema = lazySchema(getStyleArtifactBuildConfigSchema);

type StyleArtifactBuildConfig = InferSchema<ReturnType<typeof getStyleArtifactBuildConfigSchema>>;

interface StyleBuildContentContext {
  sourceType: "branch" | "environment" | "release";
  branch?: string;
  environmentName?: string;
  releaseId?: string;
}

export interface StyleArtifactBuildResult {
  kind: "style_artifact";
  status: "ready";
  css_pipeline_identity: string;
  style_profile_hash: string;
  artifact_hash: string;
  asset_path: string;
  content_type: string;
  etag: string;
  selector: {
    type: "branch" | "environment" | "release";
    value: string;
  };
}

type StyleArtifactSelector =
  | { branch: string; environmentName?: never; releaseId?: never; type: "branch"; value: string }
  | {
    branch?: never;
    environmentName: string;
    releaseId?: never;
    type: "environment";
    value: string;
  }
  | { branch?: never; environmentName?: never; releaseId: string; type: "release"; value: string };

export function createAcknowledgedStyleArtifactBuildResult(
  tuple: StyleArtifactTuple,
  selector: StyleArtifactSelector,
  buildHash: string,
  resolution: ProjectStyleArtifactResolution,
): StyleArtifactBuildResult {
  if (resolution.status !== "ready" || resolution.artifactHash !== buildHash) {
    throw new Error("Control plane did not acknowledge the built style artifact");
  }
  return {
    kind: "style_artifact",
    status: "ready",
    css_pipeline_identity: tuple.cssPipelineIdentity,
    style_profile_hash: tuple.styleProfileHash,
    artifact_hash: resolution.artifactHash,
    asset_path: resolution.assetPath,
    content_type: resolution.contentType,
    etag: resolution.etag,
    selector: { type: selector.type, value: selector.value },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeStyleArtifactBuildConfigInput(parsed: unknown): unknown {
  if (!isRecord(parsed)) {
    return parsed;
  }

  if (parsed.source === "webhook" && isRecord(parsed.payload)) {
    return parsed.payload;
  }

  return parsed;
}

export function parseStyleArtifactBuildConfig(
  rawConfig: string | undefined,
): StyleArtifactBuildConfig {
  if (!rawConfig) {
    throw new Error("Missing --config JSON");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    throw new Error("Invalid --config JSON");
  }

  const config = StyleArtifactBuildConfigSchema.parse(
    normalizeStyleArtifactBuildConfigInput(parsed),
  );
  createStyleArtifactTuple({
    cssPipelineIdentity: config.css_pipeline_identity,
    styleProfileHash: config.style_profile_hash,
    ...(config.branch === undefined ? {} : { branch: config.branch }),
    ...(config.environment_name === undefined ? {} : { environmentName: config.environment_name }),
    ...(config.release_id === undefined ? {} : { releaseId: config.release_id }),
  });
  return config;
}

function resolveStyleArtifactSelector(
  config: StyleArtifactBuildConfig,
): StyleArtifactSelector {
  if (config.branch) {
    return {
      branch: config.branch,
      type: "branch",
      value: config.branch,
    };
  }

  if (config.environment_name) {
    return {
      environmentName: config.environment_name,
      type: "environment",
      value: config.environment_name,
    };
  }

  return {
    releaseId: config.release_id!,
    type: "release",
    value: config.release_id!,
  };
}

function resolveContentContextSelector(
  selector: StyleArtifactSelector,
): { type: "branch"; branch: string } | { type: "environment"; name: string } | {
  type: "release";
  releaseId: string;
} {
  if (selector.type === "branch") {
    return { type: "branch", branch: selector.branch };
  }

  if (selector.type === "environment") {
    return { type: "environment", name: selector.environmentName };
  }

  return { type: "release", releaseId: selector.releaseId };
}

function requireEnv(name: string): string {
  const value = getEnv(name)?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function getUnderlyingVeryfrontClient(
  adapter: Awaited<ReturnType<typeof enhanceAdapterWithFS>>,
): {
  client: VeryfrontApiClient;
  contentContext: StyleBuildContentContext | null;
  getAllSourceFiles: () => Promise<Array<{ path: string; content?: string }>>;
} {
  if (!isExtendedFSAdapter(adapter.fs)) {
    throw new Error("Styles build requires a Veryfront FS adapter");
  }

  const fsAdapter = adapter.fs.getUnderlyingAdapter() as {
    getAllSourceFiles?: () => Promise<Array<{ path: string; content?: string }>>;
    getContentContext?: () => StyleBuildContentContext | null;
    getClient?: () => VeryfrontApiClient;
  };

  if (
    typeof fsAdapter.getAllSourceFiles !== "function" ||
    typeof fsAdapter.getClient !== "function"
  ) {
    throw new Error("Styles build requires a Veryfront source adapter");
  }

  return {
    client: fsAdapter.getClient(),
    contentContext: typeof fsAdapter.getContentContext === "function"
      ? fsAdapter.getContentContext()
      : null,
    getAllSourceFiles: fsAdapter.getAllSourceFiles.bind(fsAdapter),
  };
}

async function markStyleArtifactFailed(
  client: VeryfrontApiClient | null,
  tuple: StyleArtifactTuple,
  error: string,
): Promise<void> {
  if (!client) return;

  const resolution = await client.upsertStyleArtifact({
    ...tuple,
    status: "failed",
    failureReason: error,
  });
  if (resolution.status !== "failed") {
    throw new Error("Control plane did not acknowledge the failed style artifact result");
  }
}

function assertSourceSelectorMatches(
  selector: StyleArtifactSelector,
  contentContext: StyleBuildContentContext | null,
): void {
  const matches = selector.type === "branch"
    ? contentContext?.sourceType === "branch" && contentContext.branch === selector.branch
    : selector.type === "environment"
    ? contentContext?.sourceType === "environment" &&
      contentContext.environmentName === selector.environmentName
    : contentContext?.sourceType === "release" && contentContext.releaseId === selector.releaseId;
  if (!matches) {
    throw new Error("Resolved project source did not match the requested style artifact selector");
  }
}

export async function stylesCommand(options: StylesArgs): Promise<void> {
  const buildConfig = parseStyleArtifactBuildConfig(options.config);
  const selector = resolveStyleArtifactSelector(buildConfig);
  const tuple = createStyleArtifactTuple({
    cssPipelineIdentity: buildConfig.css_pipeline_identity,
    styleProfileHash: buildConfig.style_profile_hash,
    ...(selector.type === "branch" ? { branch: selector.branch } : {}),
    ...(selector.type === "environment" ? { environmentName: selector.environmentName } : {}),
    ...(selector.type === "release" ? { releaseId: selector.releaseId } : {}),
  });
  const projectSlug = requireEnv("VERYFRONT_PROJECT_SLUG");
  const apiToken = requireEnv("VERYFRONT_API_TOKEN");
  const apiBaseUrl = requireEnv("VERYFRONT_API_BASE_URL");
  const projectId = getEnv("VERYFRONT_PROJECT_ID")?.trim();
  const projectDir = Deno.cwd();

  const baseAdapter = await runtime.get();
  const adapter = await enhanceAdapterWithFS(
    baseAdapter,
    {
      fs: {
        type: "veryfront-api",
        projectDir,
        veryfront: {
          apiBaseUrl,
          apiToken,
          projectSlug,
          projectId,
          contentSource: resolveContentContextSelector(selector),
        },
      },
    },
    projectDir,
  );

  let client: VeryfrontApiClient | null = null;

  try {
    const sourceAdapter = getUnderlyingVeryfrontClient(adapter);
    client = sourceAdapter.client;
    assertSourceSelectorMatches(selector, sourceAdapter.contentContext);
    const cacheKey = projectId || projectSlug;
    const config = await getConfig(projectDir, adapter, { cacheKey });
    const styleProfile = createStyleScopeProfile(config);
    const generationSession = await acquireCSSGenerationSession(true);

    if (tuple.cssPipelineIdentity !== generationSession.cacheIdentity) {
      const message =
        `CSS pipeline identity mismatch: expected ${tuple.cssPipelineIdentity}, got ${generationSession.cacheIdentity}`;
      throw new Error(message);
    }
    if (styleProfile.hash !== tuple.styleProfileHash) {
      const message =
        `Style profile hash mismatch: expected ${tuple.styleProfileHash}, got ${styleProfile.hash}`;
      throw new Error(message);
    }

    const files = await sourceAdapter.getAllSourceFiles();
    if (files.length === 0) {
      throw new Error("No project files were available to build the style artifact");
    }

    const projectVersion = resolveStyleContentVersion(null, {
      branch: sourceAdapter.contentContext?.branch ?? null,
      releaseId: sourceAdapter.contentContext?.releaseId ?? null,
      environmentName: sourceAdapter.contentContext?.environmentName ?? null,
    });
    const build = await buildPreparedCSSArtifactFromFiles({
      projectSlug,
      projectVersion,
      projectDir,
      files,
      styleProfile,
      stylesheetPath: config?.styles?.stylesheet,
      minify: true,
      environment: "preview",
      buildMode: "production",
      generationSession,
    });

    const resolution = await client.upsertStyleArtifact({
      ...tuple,
      artifactHash: build.hash,
    });
    const result = createAcknowledgedStyleArtifactBuildResult(
      tuple,
      selector,
      build.hash,
      resolution,
    );

    await writeRunResultIfConfigured(result);
    cliLogger.info(`Built style artifact ${build.hash}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await markStyleArtifactFailed(client, tuple, message);
    } catch (reportError) {
      cliLogger.error(message);
      throw new AggregateError(
        [error, reportError],
        `${message}; failed to report style artifact failure`,
      );
    }
    cliLogger.error(message);
    exitProcess(1);
  } finally {
    if (isExtendedFSAdapter(adapter.fs)) {
      await adapter.fs.shutdown();
    }
  }
}
