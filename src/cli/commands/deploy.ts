/**
 * Deploy command - Create a release and deploy to an environment
 *
 * Creates a new release from the specified branch (default: main)
 * and deploys it to the target environment (default: production).
 *
 * @module cli/commands/deploy
 */

import { z } from "zod";
import { cliLogger } from "@veryfront/utils";
import { cwd } from "@veryfront/platform/compat/process.ts";
import {
  type ApiClient,
  createApiClient,
  resolveConfig,
} from "../shared/config.ts";
import {
  confirmPrompt,
  createSpinner,
  logInfo,
  logSuccess,
} from "../utils/index.ts";
import type { ParsedArgs } from "../index/types.ts";

/**
 * Zod schema for deploy command arguments
 */
export const DeployArgsSchema = z.object({
  branch: z.string().min(1).default("main"),
  env: z.string().min(1).default("production"),
  releaseName: z.string().min(1).optional(),
  dryRun: z.boolean().default(false),
  force: z.boolean().default(false),
});

/**
 * Deploy command options (inferred from schema)
 */
export type DeployOptions = z.infer<typeof DeployArgsSchema>;

/**
 * Parse CLI arguments into validated DeployOptions
 */
export function parseDeployArgs(args: ParsedArgs): z.SafeParseReturnType<unknown, DeployOptions> {
  const rawArgs = {
    branch: args.branch ? String(args.branch) : args.b ? String(args.b) : undefined,
    env: args.env ? String(args.env) : undefined,
    releaseName: args["release-name"] ? String(args["release-name"]) : undefined,
    dryRun: Boolean(args["dry-run"]),
    force: Boolean(args.force) || Boolean(args.f),
  };
  return DeployArgsSchema.safeParse(rawArgs);
}

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
 * Get environment by name
 */
export async function getEnvironmentByName(
  client: ApiClient,
  projectSlug: string,
  name: string,
): Promise<Environment | null> {
  const response = await client.get<{ data: Environment[] }>(
    `/projects/${projectSlug}/environments`,
  );
  return response.data.find((e) => e.name === name) || null;
}

/**
 * Create a new release
 */
export async function createRelease(
  client: ApiClient,
  projectSlug: string,
  options?: { name?: string; branch?: string },
): Promise<Release> {
  const body: Record<string, string> = {};
  if (options?.name) body.name = options.name;
  if (options?.branch) body.branch = options.branch;
  return await client.post<Release>(
    `/projects/${projectSlug}/releases`,
    body,
  );
}

/**
 * Create a new deployment
 */
export async function createDeployment(
  client: ApiClient,
  projectSlug: string,
  releaseId: string,
  environmentId: string,
): Promise<Deployment> {
  return await client.post<Deployment>(
    `/projects/${projectSlug}/deployments`,
    { release_id: releaseId, environment_id: environmentId },
  );
}

/**
 * Create a release and deploy to an environment
 */
export async function deployCommand(options: DeployOptions): Promise<void> {
  const {
    branch = "main",
    env = "production",
    releaseName,
    dryRun = false,
    force = false,
  } = options;

  const spinner = createSpinner("Resolving configuration...");
  spinner.start();

  const config = await resolveConfig(cwd());
  const client = createApiClient(config);

  spinner.update(`Looking up environment "${env}"...`);

  // Look up environment
  const environment = await getEnvironmentByName(client, config.projectSlug, env);
  if (!environment) {
    spinner.stop();
    throw new Error(`Environment "${env}" not found`);
  }

  spinner.stop();

  // Dry run
  if (dryRun) {
    logInfo(`Would create release from "${branch}" and deploy to "${env}"`);
    return;
  }

  // Confirm
  if (!force) {
    const confirmed = await confirmPrompt(
      `Create release from "${branch}" and deploy to "${env}"?`,
      true,
    );
    if (!confirmed) {
      cliLogger.info("Deploy cancelled.");
      return;
    }
  }

  // Step 1: Create release
  spinner.start();
  spinner.update(`Creating release from "${branch}"...`);

  const release = await createRelease(client, config.projectSlug, {
    name: releaseName,
    branch: branch !== "main" ? branch : undefined,
  });

  spinner.update(`Deploying ${release.version} to ${env}...`);

  // Step 2: Create deployment
  await createDeployment(
    client,
    config.projectSlug,
    release.id,
    environment.id,
  );

  spinner.stop();

  logSuccess(`Deployed ${release.version} to ${env}`);
  logInfo(`  Release: ${release.name} (${release.version})`);
  logInfo(`  Environment: ${env}`);
}
