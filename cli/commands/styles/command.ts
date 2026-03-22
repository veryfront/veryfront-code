import { z } from "zod";
import { getConfig } from "veryfront/config";
import { enhanceAdapterWithFS, getEnv, isExtendedFSAdapter, runtime } from "veryfront/platform";
import { cliLogger, exitProcess } from "#cli/utils";
import {
  buildPreparedCSSArtifactFromFiles,
} from "#veryfront/html/styles-builder/css-pregeneration.ts";
import { resolveStyleContentVersion } from "#veryfront/html/styles-builder/content-version.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import type { StylesArgs } from "./handler.ts";
import { writeJobResultIfConfigured } from "../../utils/write-job-result.ts";

const StyleArtifactBuildConfigSchema = z.object({
  style_profile_hash: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  environment_name: z.string().min(1).optional(),
  release_id: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  const selectorCount = [value.branch, value.environment_name, value.release_id].filter(Boolean)
    .length;
  if (selectorCount !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Exactly one of branch, environment_name, or release_id is required.",
    });
  }
});

type StyleArtifactBuildConfig = z.infer<typeof StyleArtifactBuildConfigSchema>;

interface StyleArtifactBuildResult {
  kind: "style_artifact";
  status: "ready";
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

function parseStyleArtifactBuildConfig(rawConfig: string | undefined): StyleArtifactBuildConfig {
  if (!rawConfig) {
    throw new Error("Missing --config JSON");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    throw new Error("Invalid --config JSON");
  }

  return StyleArtifactBuildConfigSchema.parse(parsed);
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

function getUnderlyingVeryfrontClient(adapter: Awaited<ReturnType<typeof enhanceAdapterWithFS>>): {
  client: VeryfrontApiClient;
  contentContext: ResolvedContentContext | null;
  getAllSourceFiles: () => Promise<Array<{ path: string; content?: string }>>;
} {
  if (!isExtendedFSAdapter(adapter.fs)) {
    throw new Error("Styles build requires a Veryfront FS adapter");
  }

  const fsAdapter = adapter.fs.getUnderlyingAdapter() as {
    getAllSourceFiles?: () => Promise<Array<{ path: string; content?: string }>>;
    getContentContext?: () => ResolvedContentContext | null;
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
    getAllSourceFiles: fsAdapter.getAllSourceFiles,
  };
}

async function markStyleArtifactFailed(
  client: VeryfrontApiClient | null,
  selector: StyleArtifactSelector,
  styleProfileHash: string | null | undefined,
  error: string,
): Promise<void> {
  if (!client || !styleProfileHash) return;

  try {
    await client.upsertStyleArtifact({
      ...(selector.type === "branch" ? { branch: selector.branch } : {}),
      ...(selector.type === "environment" ? { environmentName: selector.environmentName } : {}),
      ...(selector.type === "release" ? { releaseId: selector.releaseId } : {}),
      styleProfileHash,
      status: "failed",
      failureReason: error,
    });
  } catch (updateError) {
    cliLogger.warn("Failed to mark style artifact as failed", updateError);
  }
}

export async function stylesCommand(options: StylesArgs): Promise<void> {
  const buildConfig = parseStyleArtifactBuildConfig(options.config);
  const selector = resolveStyleArtifactSelector(buildConfig);
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
  let resolvedStyleProfileHash: string | null = buildConfig.style_profile_hash ?? null;

  try {
    const sourceAdapter = getUnderlyingVeryfrontClient(adapter);
    client = sourceAdapter.client;
    const cacheKey = projectId || projectSlug;
    const config = await getConfig(projectDir, adapter, { cacheKey });
    const styleProfile = createStyleScopeProfile(config);
    resolvedStyleProfileHash = styleProfile.hash;

    if (buildConfig.style_profile_hash && styleProfile.hash !== buildConfig.style_profile_hash) {
      const message =
        `Style profile hash mismatch: expected ${buildConfig.style_profile_hash}, got ${styleProfile.hash}`;
      await markStyleArtifactFailed(client, selector, buildConfig.style_profile_hash, message);
      throw new Error(message);
    }

    const files = await sourceAdapter.getAllSourceFiles();
    if (files.length === 0) {
      throw new Error("No project files were available to build the style artifact");
    }

    const projectVersion = resolveStyleContentVersion(sourceAdapter.contentContext, {
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
      stylesheetPath: config?.tailwind?.stylesheet,
      minify: true,
      environment: "preview",
      buildMode: "production",
    });

    const resolution = await client.upsertStyleArtifact({
      ...(selector.type === "branch" ? { branch: selector.branch } : {}),
      ...(selector.type === "environment" ? { environmentName: selector.environmentName } : {}),
      ...(selector.type === "release" ? { releaseId: selector.releaseId } : {}),
      styleProfileHash: styleProfile.hash,
      status: "ready",
      artifactHash: build.hash,
    });

    const result: StyleArtifactBuildResult = {
      kind: "style_artifact",
      status: "ready",
      style_profile_hash: styleProfile.hash,
      artifact_hash: build.hash,
      asset_path: resolution.assetPath ?? `/_vf/css/${build.hash}.css`,
      content_type: resolution.contentType ?? "text/css; charset=utf-8",
      etag: resolution.etag ?? `"${build.hash}"`,
      selector: {
        type: selector.type,
        value: selector.value,
      },
    };

    await writeJobResultIfConfigured(result);
    cliLogger.info(`Built style artifact ${build.hash}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markStyleArtifactFailed(
      client,
      selector,
      resolvedStyleProfileHash ?? buildConfig.style_profile_hash,
      message,
    );
    cliLogger.error(message);
    exitProcess(1);
  } finally {
    if (isExtendedFSAdapter(adapter.fs)) {
      await adapter.fs.shutdown();
    }
  }
}
