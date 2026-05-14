/**
 * Deploy command - Create a release and deploy to an environment
 *
 * Creates a new release from the specified branch (default: main)
 * and deploys it to the target environment (default: production).
 *
 * @module cli/commands/deploy
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { cwd } from "veryfront/platform";
import { type ApiClient, createApiClient, resolveConfigWithAuth } from "#cli/shared/config";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import { confirmPrompt, logInfo, logSuccess } from "#cli/utils";
import { createNoopSpinner, createSpinner, muted } from "#cli/ui";
import { isJsonMode, streamJsonLine } from "../../shared/json-output.ts";

/**
 * Schema factory for deploy command arguments
 */
export const getDeployArgsSchema = defineSchema((v) =>
  v.object({
    branch: v.string().min(1).default("main"),
    env: v.string().min(1).default("production"),
    releaseName: v.string().min(1).optional(),
    dryRun: v.boolean().default(false),
    force: v.boolean().default(false),
    /** Quiet mode - suppress spinner/progress output */
    quiet: v.boolean().default(false),
  })
);

export const DeployArgsSchema = lazySchema(getDeployArgsSchema);

/**
 * Deploy command options (inferred from schema)
 */
export type DeployOptions = InferSchema<ReturnType<typeof getDeployArgsSchema>>;

/**
 * Parse CLI arguments into validated DeployOptions
 */
export const parseDeployArgs = createArgParser(DeployArgsSchema, {
  branch: CommonArgs.branch,
  env: CommonArgs.env,
  releaseName: CommonArgs.releaseName,
  dryRun: CommonArgs.dryRun,
  force: CommonArgs.force,
  quiet: CommonArgs.quiet,
});

/**
 * Environment from the API
 */
interface Environment {
  id: string;
  name: string;
  protected: boolean;
}

/**
 * Release from the API
 */
interface Release {
  id: string;
  name: string;
  version: string;
  export_status: string;
  build_status: string;
  deploy_status: string;
}

/**
 * Deployment from the API
 */
interface Deployment {
  id: string;
  release: string;
  environment: string;
}

/**
 * List environments response from API
 */
interface ListEnvironmentsResponse {
  data: Environment[];
  page_info?: {
    next?: string;
  };
}

/**
 * Get environment by name (with pagination support)
 */
export async function getEnvironmentByName(
  client: ApiClient,
  projectSlug: string,
  name: string,
): Promise<Environment | null> {
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = { limit: "100" };
    if (cursor) params.cursor = cursor;

    const response = await client.get<ListEnvironmentsResponse>(
      `/projects/${projectSlug}/environments`,
      params,
    );

    const found = response.data.find((e) => e.name === name);
    if (found) return found;

    cursor = response.page_info?.next;
  } while (cursor);

  return null;
}

/**
 * Create a new release
 */
export function createRelease(
  client: ApiClient,
  projectSlug: string,
  options?: { name?: string; branch?: string },
): Promise<Release> {
  const body: Record<string, string> = {};
  if (options?.name) body.name = options.name;
  if (options?.branch) body.branch = options.branch;

  return client.post<Release>(`/projects/${projectSlug}/releases`, body);
}

/**
 * Create a new deployment
 */
export function createDeployment(
  client: ApiClient,
  projectSlug: string,
  releaseId: string,
  environmentId: string,
): Promise<Deployment> {
  return client.post<Deployment>(`/projects/${projectSlug}/deployments`, {
    release_id: releaseId,
    environment_id: environmentId,
  });
}

/**
 * Create a release and deploy to an environment
 */
export async function deployCommand(options: DeployOptions): Promise<void> {
  const { branch, env, releaseName, dryRun, force, quiet } = options;

  if (isJsonMode()) {
    return deployCommandJson(options);
  }

  let spinner = quiet ? createNoopSpinner() : createSpinner("Resolving configuration...");

  const config = await resolveConfigWithAuth(cwd());
  const client = createApiClient(config);

  spinner.update(`Looking up environment "${env}"...`);

  const environment = await getEnvironmentByName(client, config.projectSlug, env);
  if (!environment) {
    spinner.stop();
    throw new Error(`Environment "${env}" not found`);
  }

  spinner.stop();

  if (dryRun) {
    if (!quiet) logInfo(`Would create release from "${branch}" and deploy to "${env}"`);
    return;
  }

  if (!force) {
    const confirmed = await confirmPrompt(
      `Create release from "${branch}" and deploy to "${env}"?`,
      true,
    );
    if (!confirmed) {
      console.log(`  ${muted("Deploy cancelled.")}`);
      return;
    }
  }

  spinner = quiet ? createNoopSpinner() : createSpinner(`Creating release from "${branch}"...`);

  const release = await createRelease(client, config.projectSlug, { name: releaseName, branch });

  spinner.update(`Deploying ${release.version} to ${env}...`);

  await createDeployment(client, config.projectSlug, release.id, environment.id);

  spinner.stop();

  if (quiet) return;

  logSuccess(`Deployed ${release.version} to ${env}`);
  logInfo(`  Release: ${release.name} (${release.version})`);
  logInfo(`  Environment: ${env}`);

  const { getPostDeployTips } = await import("../../help/tips.ts");
  console.log(getPostDeployTips());
}

async function deployCommandJson(options: DeployOptions): Promise<void> {
  const { branch, env, releaseName, dryRun, force } = options;

  try {
    // JSON mode requires --force or --yes to prevent accidental deploys
    const { isInteractive } = await import("../../shared/interactive.ts");
    if (!force && isInteractive()) {
      streamJsonLine({
        type: "result",
        success: false,
        error:
          "Deploy in JSON mode requires --force or --yes to confirm. This prevents accidental production deploys.",
      });
      const { exit } = await import("veryfront/platform");
      exit(1);
      return;
    }

    streamJsonLine({ type: "step", name: "resolve-config", status: "started" });
    const config = await resolveConfigWithAuth(cwd());
    const client = createApiClient(config);
    streamJsonLine({ type: "step", name: "resolve-config", status: "completed" });

    streamJsonLine({ type: "step", name: "resolve-environment", status: "started" });
    const environment = await getEnvironmentByName(client, config.projectSlug, env);
    if (!environment) {
      streamJsonLine({
        type: "result",
        success: false,
        error: `Environment "${env}" not found`,
      });
      const { exit } = await import("veryfront/platform");
      exit(1);
      return;
    }
    streamJsonLine({ type: "step", name: "resolve-environment", status: "completed" });

    if (dryRun) {
      streamJsonLine({
        type: "result",
        success: true,
        data: { dryRun: true, branch, environment: env },
      });
      return;
    }

    streamJsonLine({ type: "step", name: "create-release", status: "started" });
    const release = await createRelease(client, config.projectSlug, {
      name: releaseName,
      branch,
    });
    streamJsonLine({ type: "step", name: "create-release", status: "completed" });

    streamJsonLine({ type: "step", name: "deploy", status: "started" });
    await createDeployment(client, config.projectSlug, release.id, environment.id);
    streamJsonLine({ type: "step", name: "deploy", status: "completed" });

    streamJsonLine({
      type: "result",
      success: true,
      data: {
        release: { id: release.id, name: release.name, version: release.version },
        environment: env,
        branch,
      },
    });
  } catch (error) {
    streamJsonLine({
      type: "result",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    const { exit } = await import("veryfront/platform");
    exit(1);
  }
}
