/**
 * Deploy command - Create a release and deploy to an environment
 *
 * Creates a new release from the specified branch (default: main)
 * and deploys it to the target environment (default: production).
 *
 * @module cli/commands/deploy
 */

import { z } from "zod";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { type ApiClient, createApiClient, resolveConfigWithAuth } from "../shared/config.ts";
import { CommonArgs, createArgParser } from "../shared/args.ts";
import {
  confirmPrompt,
  createNoopSpinner,
  createSpinner,
  logInfo,
  logSuccess,
} from "../utils/index.ts";
import { muted } from "../ui/colors.ts";

/**
 * Zod schema for deploy command arguments
 */
export const DeployArgsSchema = z.object({
  branch: z.string().min(1).default("main"),
  env: z.string().min(1).default("production"),
  releaseName: z.string().min(1).optional(),
  dryRun: z.boolean().default(false),
  force: z.boolean().default(false),
  /** Quiet mode - suppress spinner/progress output */
  quiet: z.boolean().default(false),
});

/**
 * Deploy command options (inferred from schema)
 */
export type DeployOptions = z.infer<typeof DeployArgsSchema>;

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

  const spinner = quiet ? createNoopSpinner() : createSpinner("Resolving configuration...");
  spinner.start();

  // Use interactive auth - prompts for login if not authenticated
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

  spinner.start();
  spinner.update(`Creating release from "${branch}"...`);

  const release = await createRelease(client, config.projectSlug, { name: releaseName, branch });

  spinner.update(`Deploying ${release.version} to ${env}...`);

  await createDeployment(client, config.projectSlug, release.id, environment.id);

  spinner.stop();

  if (quiet) return;

  logSuccess(`Deployed ${release.version} to ${env}`);
  logInfo(`  Release: ${release.name} (${release.version})`);
  logInfo(`  Environment: ${env}`);
}
