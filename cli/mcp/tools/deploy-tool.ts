/**
 * MCP tool: vf_trigger_deploy
 *
 * Creates a release from a branch and deploys it to an environment through
 * Deploy Execution (`DeployProject.execute`), the same module behind the
 * `vf deploy` CLI command. Success means the deployment is verified and the
 * environment URL resolves. Read `urlVerification` to tell whether the app
 * itself answered (`served`) or only its access gate did (`gated`).
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import type { MCPTool } from "veryfront/mcp";
import { getEnvironmentConfig } from "veryfront/config";
import { cwd } from "veryfront/platform";
import { getHostEnv } from "#cli/process-env";
import { createDeployProject, type DeployProject } from "../../shared/deployment/deploy-project.ts";
import type { DeployResult } from "../../shared/deployment/result.ts";

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

export type TriggerDeployResult =
  | ({ success: true } & DeployResult)
  | { success: false; error: string };

/**
 * Resolve the API token the auth gate checks before deploying.
 *
 * The environment snapshot only carries an explicitly exported token; a
 * stored `veryfront login` token is registered host-privately so project code
 * served by `veryfront dev` cannot read it out of the process environment.
 * Falling back to `getHostEnv` keeps the gate open for a CLI-authenticated
 * session; deploy execution itself resolves the credential from the token
 * store. A blank exported value must not shadow the stored credential, so the
 * snapshot only wins when it is non-blank.
 */
function resolveApiToken(): string | undefined {
  const exported = getEnvironmentConfig().apiToken?.trim();
  return exported ? exported : getHostEnv("VERYFRONT_API_TOKEN");
}

export interface TriggerDeployOptions {
  projectDir?: string;
  /** Deploy Execution override for tests; production uses createDeployProject(). */
  deployProject?: DeployProject;
}

/**
 * Trigger a deploy via Deploy Execution.
 *
 * Exported for standalone MCP server reuse.
 */
export async function triggerDeploy(
  input: TriggerDeployInput,
  options: TriggerDeployOptions = {},
): Promise<TriggerDeployResult> {
  try {
    if (!resolveApiToken()) {
      return {
        success: false,
        error: "Not authenticated. Run 'veryfront login' first.",
      };
    }

    const deployProject = options.deployProject ?? createDeployProject();
    const outcome = await deployProject.execute({
      projectDir: options.projectDir ?? cwd(),
      projectSlug: input.projectSlug,
      branch: input.branch,
      environment: input.environment,
      mode: "apply",
      source: { kind: "already-pushed" },
    });

    if (outcome.kind !== "deployed") {
      return {
        success: false,
        error: `Deploy did not complete: unexpected outcome "${outcome.kind}".`,
      };
    }

    return { success: true, ...outcome.result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = typeof error === "object" && error !== null
      ? (error as { status?: unknown }).status
      : undefined;

    if (
      message.includes("Missing API token") ||
      message.includes("Authentication required") ||
      status === 401
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
    "from the specified branch, deploys it to the target environment, waits for release assets " +
    "and environment readiness, and returns the deployment evidence including the live URL. " +
    "Success means the deployment is verified and the environment URL resolves. " +
    "Check the returned urlVerification field to tell what the readiness probe established: " +
    "'served' means the app itself answered, 'gated' means only its access gate answered so the " +
    "app was never observed, and 'unprobed' means the project has no static page route to check. " +
    "Requires a valid API token (set VERYFRONT_API_TOKEN or run 'veryfront login'). " +
    "Do not use for local builds; use vf_build instead. " +
    "Do not use for running tests before deploy; use vf_run_tests instead.",
  inputSchema: triggerDeployInput,
  execute: (input) => triggerDeploy(input),
};
