/**
 * MCP tool: vf_trigger_deploy
 *
 * Creates a release from a branch and deploys it to an environment.
 * Wraps the same API calls used by the `vf deploy` CLI command.
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import type { MCPTool } from "veryfront/mcp";
import { getEnvironmentConfig } from "veryfront/config";
import { cwd } from "veryfront/platform";
import { createApiClient, resolveConfig } from "#cli/shared/config";
import {
  assertProjectOwnership,
  createDeployment,
  createRelease,
  getEnvironmentByName,
  getProject,
  resolvePushedSource,
  verifyDeployment,
  verifyReleaseSource,
} from "../../commands/deploy/command.ts";
import { normalizeControlPlane } from "../../shared/deployment-provenance.ts";

const getTriggerDeployInput = defineSchema((v) =>
  v.object({
    projectSlug: v.string().describe(
      "The project slug to deploy. Example: 'my-app'.",
    ),
    environment: v.string().optional().default("production").describe(
      "Target environment name. Defaults to 'production'.",
    ),
    branch: v.string().optional().default("main").describe(
      "Git branch to create the release from. Defaults to 'main'.",
    ),
  })
);
const triggerDeployInput = lazySchema(getTriggerDeployInput);

export type TriggerDeployInput = InferSchema<ReturnType<typeof getTriggerDeployInput>>;

export interface TriggerDeployResult {
  success: boolean;
  project?: { id: string; slug: string };
  deploymentId?: string;
  release?: { id: string; name: string; version: string };
  environment?: { id: string; name: string };
  commitSha?: string;
  sourceDigest?: string;
  controlPlane?: string;
  error?: string;
}

export interface TriggerDeployOptions {
  projectDir?: string;
}

/**
 * Trigger a deploy via the Veryfront API.
 *
 * Exported for standalone MCP server reuse.
 */
export async function triggerDeploy(
  input: TriggerDeployInput,
  options: TriggerDeployOptions = {},
): Promise<TriggerDeployResult> {
  try {
    const env = getEnvironmentConfig();
    const apiToken = env.apiToken;

    if (!apiToken) {
      return {
        success: false,
        error: "Not authenticated. Run 'veryfront login' first.",
      };
    }

    const config = await resolveConfig(undefined, {
      ...env,
      apiToken,
      projectSlug: input.projectSlug,
    });

    const client = createApiClient(config);
    const project = await getProject(client, input.projectSlug);

    const environment = await getEnvironmentByName(
      client,
      project.id,
      input.environment,
    );
    if (!environment) {
      return {
        success: false,
        error: `Environment "${input.environment}" not found.`,
      };
    }
    assertProjectOwnership("Environment", environment, project.id);

    const source = await resolvePushedSource({
      projectDir: options.projectDir ?? cwd(),
      controlPlane: config.apiUrl,
      projectId: project.id,
      projectSlug: project.slug,
      branch: input.branch,
      requireClean: input.environment === "production",
    });

    const release = await createRelease(client, project.id, {
      branch: input.branch,
    });
    if (!release.version) {
      return {
        success: false,
        error: `Release ${release.id} has no version.`,
      };
    }

    const verifiedRelease = await verifyReleaseSource(client, project.id, {
      projectId: project.id,
      releaseId: release.id,
      releaseName: release.name,
      commitSha: source.commitSha,
      sourceDigest: source.sourceDigest,
    });

    const deployment = await createDeployment(
      client,
      project.id,
      release.id,
      environment.id,
    );
    const verification = await verifyDeployment(client, project.id, {
      projectId: project.id,
      projectSlug: project.slug,
      environmentId: environment.id,
      environmentName: input.environment,
      releaseId: release.id,
      releaseName: release.name,
      deploymentId: deployment.id,
      commitSha: source.commitSha,
      sourceDigest: source.sourceDigest,
    }, { verifiedRelease });

    return {
      success: true,
      project: { id: verification.projectId, slug: verification.projectSlug },
      deploymentId: verification.deploymentId,
      release: {
        id: verification.releaseId,
        name: release.name,
        version: verification.releaseVersion,
      },
      environment: { id: verification.environmentId, name: verification.environmentName },
      commitSha: verification.commitSha,
      sourceDigest: verification.sourceDigest,
      controlPlane: normalizeControlPlane(config.apiUrl),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes("Missing API token") ||
      message.includes("Authentication required") ||
      message.includes("401")
    ) {
      return {
        success: false,
        error: "Not authenticated. Run 'veryfront login' first.",
      };
    }

    return { success: false, error: message };
  }
}

export const vfTriggerDeploy: MCPTool<TriggerDeployInput, TriggerDeployResult> = {
  name: "vf_trigger_deploy",
  title: "Trigger Deploy",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  description:
    "Use this when you need to deploy a project to an environment via the Veryfront API. " +
    "Requires a successful vf push from the current project, then creates and verifies a release " +
    "from the specified branch and deploys it to the target environment. " +
    "Returns project, deployment, release, environment, and commit evidence on success. " +
    "Requires a valid API token (set VERYFRONT_API_TOKEN or run 'veryfront login'). " +
    "Do not use for local builds — use vf_build instead. " +
    "Do not use for running tests before deploy — use vf_run_tests instead.",
  inputSchema: triggerDeployInput,
  execute: (input) => triggerDeploy(input),
};
