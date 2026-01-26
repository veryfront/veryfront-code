/**
 * Deploy command - Create a release and deploy to an environment
 *
 * Creates a new release from the specified branch (default: main)
 * and deploys it to the target environment (default: production).
 *
 * @module cli/commands/deploy
 */
import { z } from "zod";
import { cwd } from "../../platform/compat/process.js";
import { createApiClient, resolveConfig } from "../shared/config.js";
import { confirmPrompt, createSpinner, logInfo, logSuccess } from "../utils/index.js";
import { muted } from "../ui/colors.js";
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
 * Parse CLI arguments into validated DeployOptions
 */
export function parseDeployArgs(args) {
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
 * Get environment by name (with pagination support)
 */
export async function getEnvironmentByName(client, projectSlug, name) {
    let cursor;
    do {
        const params = { limit: "100", ...(cursor ? { cursor } : {}) };
        const response = await client.get(`/projects/${projectSlug}/environments`, params);
        const found = response.data.find((e) => e.name === name);
        if (found)
            return found;
        cursor = response.page_info?.next;
    } while (cursor);
    return null;
}
/**
 * Create a new release
 */
export function createRelease(client, projectSlug, options) {
    const body = {
        ...(options?.name ? { name: options.name } : {}),
        ...(options?.branch ? { branch: options.branch } : {}),
    };
    return client.post(`/projects/${projectSlug}/releases`, body);
}
/**
 * Create a new deployment
 */
export function createDeployment(client, projectSlug, releaseId, environmentId) {
    return client.post(`/projects/${projectSlug}/deployments`, {
        release_id: releaseId,
        environment_id: environmentId,
    });
}
function createNoopSpinner() {
    return { start: () => { }, stop: () => { }, update: (_msg) => { } };
}
/**
 * Create a release and deploy to an environment
 */
export async function deployCommand(options) {
    const { branch = "main", env = "production", releaseName, dryRun = false, force = false, quiet = false, } = options;
    const spinner = quiet ? createNoopSpinner() : createSpinner("Resolving configuration...");
    spinner.start();
    const config = await resolveConfig(cwd());
    const client = createApiClient(config);
    spinner.update(`Looking up environment "${env}"...`);
    const environment = await getEnvironmentByName(client, config.projectSlug, env);
    if (!environment) {
        spinner.stop();
        throw new Error(`Environment "${env}" not found`);
    }
    spinner.stop();
    if (dryRun) {
        if (!quiet)
            logInfo(`Would create release from "${branch}" and deploy to "${env}"`);
        return;
    }
    if (!force) {
        const confirmed = await confirmPrompt(`Create release from "${branch}" and deploy to "${env}"?`, true);
        if (!confirmed) {
            console.log("  " + muted("Deploy cancelled."));
            return;
        }
    }
    spinner.start();
    spinner.update(`Creating release from "${branch}"...`);
    const release = await createRelease(client, config.projectSlug, { name: releaseName, branch });
    spinner.update(`Deploying ${release.version} to ${env}...`);
    await createDeployment(client, config.projectSlug, release.id, environment.id);
    spinner.stop();
    if (quiet)
        return;
    logSuccess(`Deployed ${release.version} to ${env}`);
    logInfo(`  Release: ${release.name} (${release.version})`);
    logInfo(`  Environment: ${env}`);
}
