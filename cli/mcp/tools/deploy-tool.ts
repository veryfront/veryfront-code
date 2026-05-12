/**
 * MCP tool: vf_trigger_deploy
 *
 * Creates a release from a branch and deploys it to an environment.
 * Wraps the same API calls used by the `vf deploy` CLI command.
 */

import { defineSchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import type { MCPTool } from "veryfront/mcp";
import { getEnvironmentConfig } from "veryfront/config";
import { createApiClient, resolveConfig } from "#cli/shared/config";
import {
  createDeployment,
  createRelease,
  getEnvironmentByName,
} from "../../commands/deploy/command.ts";

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
const triggerDeployInput = getTriggerDeployInput();

export type TriggerDeployInput = InferSchema<ReturnType<typeof getTriggerDeployInput>>;

export interface TriggerDeployResult {
  success: boolean;
  deploymentId?: string;
  release?: { id: string; name: string; version: string };
  environment?: { id: string; name: string };
  error?: string;
}

/**
 * Trigger a deploy via the Veryfront API.
 *
 * Exported for standalone MCP server reuse.
 */
export async function triggerDeploy(
  input: TriggerDeployInput,
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

    const environment = await getEnvironmentByName(
      client,
      input.projectSlug,
      input.environment,
    );
    if (!environment) {
      return {
        success: false,
        error: `Environment "${input.environment}" not found.`,
      };
    }

    const release = await createRelease(client, input.projectSlug, {
      branch: input.branch,
    });

    const deployment = await createDeployment(
      client,
      input.projectSlug,
      release.id,
      environment.id,
    );

    return {
      success: true,
      deploymentId: deployment.id,
      release: { id: release.id, name: release.name, version: release.version },
      environment: { id: environment.id, name: environment.name },
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
    "Creates a release from the specified branch and deploys it to the target environment. " +
    "Returns the deployment ID, release info, and environment info on success. " +
    "Requires a valid API token (set VERYFRONT_API_TOKEN or run 'veryfront login'). " +
    "Do not use for local builds — use vf_build instead. " +
    "Do not use for running tests before deploy — use vf_run_tests instead.",
  inputSchema: triggerDeployInput,
  execute: (input) => triggerDeploy(input),
};
