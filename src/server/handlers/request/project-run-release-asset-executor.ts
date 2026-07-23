import { getEnvironmentConfig } from "#veryfront/config";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { getProjectRunNumberConfig, getProjectRunStringConfig } from "./project-run-config.ts";
import { projectRunErrorMessage } from "./project-run-http-policy.ts";
import type { ProjectRunExecuteResponse, ProjectRunExecutorInput } from "./project-run-types.ts";

export async function executeReleaseAssetBuildRun(
  input: ProjectRunExecutorInput,
): Promise<ProjectRunExecuteResponse> {
  const startedAt = Date.now();
  const config = input.request.config ?? {};
  const projectReference = input.ctx.projectSlug ?? input.request.projectId;
  const releaseId = getProjectRunStringConfig(config, ["release_id", "releaseId"]);
  const releaseVersion = getProjectRunNumberConfig(config, [
    "release_version",
    "releaseVersion",
  ]);
  const tempDir = await Deno.makeTempDir({ prefix: "veryfront-release-assets-" });

  try {
    if (!releaseId || releaseVersion === undefined) {
      throw INVALID_ARGUMENT.create({
        detail: "Missing release_id or release_version for release asset build",
      });
    }

    const { VeryfrontApiClient } = await import(
      "#veryfront/platform/adapters/veryfront-api-client/client.ts"
    );
    const { runReleaseAssetBuild } = await import("#veryfront/release-assets/build-executor.ts");
    const { createCompileProjectCss } = await import(
      "#veryfront/release-assets/css-compile.ts"
    );
    const token = input.req.headers.get("x-token") ?? input.ctx.proxyToken ??
      input.ctx.requestContext?.token ?? "";
    if (!token) throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });

    const apiClient = new VeryfrontApiClient({
      apiBaseUrl: getEnvironmentConfig().apiBaseUrl,
      apiToken: token,
      projectSlug: projectReference,
      projectId: input.ctx.projectId,
    });
    apiClient.setProjectSlug(projectReference);
    const compileProjectCss = createCompileProjectCss({
      projectScope: projectReference,
      config: input.ctx.config,
    });
    const result = await runReleaseAssetBuild({
      projectReference,
      projectId: input.ctx.projectId ?? input.request.projectId,
      releaseId,
      releaseVersion,
      releaseVersionRef: releaseId,
      adapter: input.ctx.adapter,
      client: {
        beginReleaseAssetManifestBuild: (version) =>
          apiClient.beginReleaseAssetManifestBuild(version),
        listAllReleaseFiles: (version) => apiClient.listAllReleaseFiles(version),
        uploadReleaseAsset: (version, hash, contentType, bytes) =>
          apiClient.uploadReleaseAsset(version, hash, contentType, bytes),
        putReleaseAssetManifest: (version, manifest) =>
          apiClient.putReleaseAssetManifest(version, manifest),
        reportReleaseAssetManifestState: (version, state, error) =>
          apiClient.reportReleaseAssetManifestState(version, state, error),
        compileProjectCss,
      },
    }, tempDir);

    return {
      success: result.success,
      result,
      error: result.error ?? null,
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      success: false,
      error: projectRunErrorMessage(error),
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
  }
}
