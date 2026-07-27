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
import { createFileSystem, cwd } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import {
  type ApiClient,
  createApiClient,
  readConfigFile,
  resolveConfigWithAuth,
  type ResolvedConfig,
  writeProjectSlug,
} from "#cli/shared/config";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import { confirmPrompt, logInfo, logSuccess, logWarning } from "#cli/utils";
import { createNoopSpinner, createSpinner, muted } from "#cli/ui";
import { reserveProjectSlug } from "#cli/shared/reserve-slug";
import { normalizeProjectSlug } from "#cli/shared/slug";
import { pushCommand } from "../push/index.ts";
import { isAutoConfirmEnabled } from "../../shared/interactive.ts";
import { isJsonMode, streamJsonLine } from "../../shared/json-output.ts";
import {
  computeSourceDigest,
  getProjectTarget,
  normalizeControlPlane,
  readPushReceipt,
  resolveGitSource,
  validatePushReceipt,
} from "../../shared/deployment-provenance.ts";
import type { ReleaseAssetManifestResponse } from "#veryfront/release-assets/manifest-schema.ts";
import { routeForPage } from "#veryfront/release-assets/route-path.ts";

/**
 * Schema factory for deploy command arguments
 */
export const getDeployArgsSchema = defineSchema((v) =>
  v.object({
    projectDir: v.string().optional(),
    branch: v.string().min(1).default("main"),
    env: v.string().min(1).default("production"),
    releaseName: v.string().min(1).optional(),
    dryRun: v.boolean().default(false),
    force: v.boolean().default(false),
    /** Quiet mode - suppress spinner/progress output */
    quiet: v.boolean().default(false),
    /** Internal option used by commands that already pushed source. */
    skipSourcePush: v.boolean().default(false),
  })
);

export const DeployArgsSchema = lazySchema(getDeployArgsSchema);

/**
 * Deploy command options (inferred from schema)
 */
type ParsedDeployOptions = InferSchema<ReturnType<typeof getDeployArgsSchema>>;
export type DeployOptions = Omit<ParsedDeployOptions, "skipSourcePush"> & {
  skipSourcePush?: boolean;
  assetManifestPollIntervalMs?: number;
  assetManifestTimeoutMs?: number;
};

/**
 * Parse CLI arguments into validated DeployOptions
 */
export const parseDeployArgs = createArgParser(DeployArgsSchema, {
  projectDir: CommonArgs.projectDir,
  branch: CommonArgs.branch,
  env: CommonArgs.env,
  releaseName: CommonArgs.releaseName,
  dryRun: CommonArgs.dryRun,
  force: CommonArgs.force,
  quiet: CommonArgs.quiet,
});

export function requiresExplicitDeployConfirmation(force: boolean): boolean {
  return !force && !isAutoConfirmEnabled();
}

/**
 * Environment from the API
 */
interface EnvironmentDeployment {
  id: string;
  release: {
    id: string;
    name: string | null;
  } | null;
}

interface Environment {
  id: string;
  name: string;
  protected: boolean;
  project_id?: string;
  project?: string | { id: string };
  projectId?: string;
  deployment?: EnvironmentDeployment | null;
  domains?: string[];
}

/**
 * Release from the API
 */
interface Release {
  id: string;
  name: string;
  version: string | null;
  project_id?: string;
  project?: string | { id: string };
  projectId?: string;
  export_status: string;
  build_status: string;
  deploy_status: string;
}

/**
 * Deployment from the API
 */
interface DeploymentResponse {
  id: string;
  release_id?: string;
  environment_id?: string;
  release?: string | { id: string };
  environment?: string | { id: string };
  routing_convergence?: DeploymentRoutingConvergence;
}

export type DeploymentRoutingConvergence =
  | { status: "converged"; acknowledged: number; recipients: number }
  | { status: "pending" }
  | { status: "skipped" };

export interface Deployment {
  id: string;
  release_id: string;
  environment_id: string;
  routing_convergence?: DeploymentRoutingConvergence;
}

export interface DeploymentVerification {
  projectId: string;
  projectSlug: string;
  environmentId: string;
  environmentName: string;
  releaseId: string;
  releaseVersion: string;
  deploymentId: string;
  commitSha: string;
  sourceDigest: string;
}

export interface ReleaseSourceVerification {
  projectId: string;
  releaseId: string;
  releaseVersion: string;
  commitSha: string;
  sourceDigest: string;
}

interface ReleaseSourceExpectation {
  projectId: string;
  releaseId: string;
  commitSha: string;
  sourceDigest: string;
  releaseName?: string;
}

interface DeploymentExpectation {
  projectId: string;
  projectSlug: string;
  environmentId: string;
  environmentName: string;
  releaseId: string;
  deploymentId: string;
  commitSha: string;
  sourceDigest: string;
  releaseName?: string;
}

interface VerificationRetryOptions {
  attempts?: number;
  delayMs?: number;
}

interface DeploymentVerificationOptions extends VerificationRetryOptions {
  releaseSource?: VerificationRetryOptions;
  verifiedRelease?: ReleaseSourceVerification;
}

const MAX_RELEASE_SOURCE_VERIFICATION_ATTEMPTS = 20;
const MAX_RELEASE_SOURCE_VERIFICATION_DELAY_MS = 500;

// Release creation can precede source-snapshot materialization. Only a
// successfully read, well-formed digest mismatch enters this convergence loop;
// validation and exhausted API-client transport errors still fail closed.
function boundedReleaseSourceVerificationOptions(
  options: VerificationRetryOptions,
): Required<VerificationRetryOptions> {
  const attempts = options.attempts === undefined
    ? MAX_RELEASE_SOURCE_VERIFICATION_ATTEMPTS
    : Number.isFinite(options.attempts)
    ? Math.min(
      MAX_RELEASE_SOURCE_VERIFICATION_ATTEMPTS,
      Math.max(1, Math.trunc(options.attempts)),
    )
    : MAX_RELEASE_SOURCE_VERIFICATION_ATTEMPTS;
  const delayMs = options.delayMs === undefined
    ? MAX_RELEASE_SOURCE_VERIFICATION_DELAY_MS
    : Number.isFinite(options.delayMs)
    ? Math.min(
      MAX_RELEASE_SOURCE_VERIFICATION_DELAY_MS,
      Math.max(0, Math.trunc(options.delayMs)),
    )
    : MAX_RELEASE_SOURCE_VERIFICATION_DELAY_MS;
  return { attempts, delayMs };
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

interface ReleaseFileVersion {
  path: string;
  content?: unknown;
  data?: unknown;
}

interface ListReleaseVersionsResponse {
  data: ReleaseFileVersion[];
  page_info?: {
    next?: string;
  };
}

function referenceId(value: string | { id: string } | undefined): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

function normalizeEnvironment(environment: Environment): Environment {
  const projectId = environment.project_id ?? environment.projectId ??
    referenceId(environment.project);
  return projectId ? { ...environment, project_id: projectId } : environment;
}

function normalizeRelease(release: Release): Release {
  const projectId = release.project_id ?? release.projectId ?? referenceId(release.project);
  return projectId ? { ...release, project_id: projectId } : release;
}

function normalizeDeployment(deployment: DeploymentResponse): Deployment {
  const releaseId = deployment.release_id ?? referenceId(deployment.release);
  const environmentId = deployment.environment_id ?? referenceId(deployment.environment);
  if (!releaseId || !environmentId) {
    throw new Error(`Deployment ${deployment.id} response is missing release or environment IDs`);
  }
  return {
    id: deployment.id,
    release_id: releaseId,
    environment_id: environmentId,
    routing_convergence: deployment.routing_convergence,
  };
}

export function getDeploymentRoutingConvergenceWarning(
  deployment: Deployment,
): string | null {
  const convergence = deployment.routing_convergence;
  if (!convergence) return null;

  if (
    convergence.status === "converged" &&
    convergence.recipients > 0 &&
    convergence.acknowledged >= convergence.recipients
  ) {
    return null;
  }

  return `Deployment ${deployment.id} committed, but data-plane routing convergence was not confirmed; bounded cache expiry remains the recovery path`;
}

export function assertProjectOwnership(
  resourceType: "Environment" | "Release",
  resource: { id: string; project_id?: string },
  projectId: string,
): void {
  if (resource.project_id && resource.project_id !== projectId) {
    throw new Error(
      `${resourceType} ${resource.id} does not belong to resolved project ${projectId}`,
    );
  }
}

function getReleaseFileContent(file: ReleaseFileVersion): string {
  const content = typeof file.content === "string" ? file.content : undefined;
  let legacyBody: string | undefined;

  if (typeof file.data === "string") {
    let envelope: unknown;
    try {
      envelope = JSON.parse(file.data);
    } catch {
      throw new Error(`Release file ${file.path} has invalid version data`);
    }
    if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
      throw new Error(`Release file ${file.path} has invalid version data`);
    }

    const record = envelope as Record<string, unknown>;
    if (typeof record.body !== "string") {
      throw new Error(`Release file ${file.path} version data has no body`);
    }
    if (typeof record.path === "string" && record.path !== file.path) {
      throw new Error(`Release file ${file.path} version data references ${record.path}`);
    }
    legacyBody = record.body;
  }

  if (content !== undefined && legacyBody !== undefined && content !== legacyBody) {
    throw new Error(`Release file ${file.path} has conflicting content fields`);
  }
  const value = content ?? legacyBody;
  if (value === undefined) throw new Error(`Release file ${file.path} has no content`);
  return value;
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
    if (found) return normalizeEnvironment(found);

    cursor = response.page_info?.next;
  } while (cursor);

  return null;
}

export function getProject(client: ApiClient, projectReference: string) {
  return getProjectTarget(client, projectReference);
}

export async function getRelease(
  client: ApiClient,
  projectReference: string,
  releaseId: string,
): Promise<Release> {
  const release = await client.get<Release>(
    `/projects/${projectReference}/releases/${releaseId}`,
  );
  return normalizeRelease(release);
}

export async function getDeployment(
  client: ApiClient,
  projectReference: string,
  deploymentId: string,
): Promise<Deployment> {
  const deployment = await client.get<DeploymentResponse>(
    `/projects/${projectReference}/deployments/${deploymentId}`,
  );
  return normalizeDeployment(deployment);
}

export async function getReleaseSourceDigest(
  client: ApiClient,
  projectReference: string,
  releaseId: string,
): Promise<string> {
  const files: ReleaseFileVersion[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = { limit: "100" };
    if (cursor) params.cursor = cursor;
    const response = await client.get<ListReleaseVersionsResponse>(
      `/projects/${projectReference}/releases/${releaseId}/versions`,
      params,
    );
    files.push(...response.data);
    cursor = response.page_info?.next;
  } while (cursor);

  return computeSourceDigest(files.map((file) => ({
    path: file.path,
    content: getReleaseFileContent(file),
  })));
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
  if (options?.branch) body.branch_reference = options.branch;

  return normalizeRelease(await client.post<Release>(`/projects/${projectSlug}/releases`, body));
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
  const deployment = await client.post<DeploymentResponse>(
    `/projects/${projectSlug}/deployments`,
    {
      release_id: releaseId,
      environment_id: environmentId,
    },
  );
  return normalizeDeployment(deployment);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifyReleaseSource(
  client: ApiClient,
  projectReference: string,
  expected: ReleaseSourceExpectation,
  options: VerificationRetryOptions = {},
): Promise<ReleaseSourceVerification> {
  const release = await getRelease(client, projectReference, expected.releaseId);
  if (release.id !== expected.releaseId) {
    throw new Error(`Release read-back returned ${release.id}; expected ${expected.releaseId}`);
  }
  assertProjectOwnership("Release", release, expected.projectId);
  if (expected.releaseName && release.name !== expected.releaseName) {
    throw new Error(`Release ${expected.releaseId} no longer matches the created release name`);
  }
  if (!release.version) {
    throw new Error(`Release ${expected.releaseId} has no version`);
  }

  const { attempts, delayMs } = boundedReleaseSourceVerificationOptions(options);
  let sourceDigest = "";

  for (let attempt = 0; attempt < attempts; attempt++) {
    sourceDigest = await getReleaseSourceDigest(client, projectReference, expected.releaseId);
    if (sourceDigest === expected.sourceDigest) {
      return {
        projectId: expected.projectId,
        releaseId: expected.releaseId,
        releaseVersion: release.version,
        commitSha: expected.commitSha,
        sourceDigest,
      };
    }

    if (attempt < attempts - 1 && delayMs > 0) await wait(delayMs);
  }

  throw new Error(
    `Release ${expected.releaseId} source does not match pushed commit ${expected.commitSha}: expected source digest ${expected.sourceDigest}; last observed ${sourceDigest}`,
  );
}

export async function verifyDeployment(
  client: ApiClient,
  projectReference: string,
  expected: DeploymentExpectation,
  options: DeploymentVerificationOptions = {},
): Promise<DeploymentVerification> {
  const deployment = await getDeployment(client, projectReference, expected.deploymentId);
  if (
    deployment.id !== expected.deploymentId || deployment.release_id !== expected.releaseId ||
    deployment.environment_id !== expected.environmentId
  ) {
    throw new Error(
      `Deployment ${expected.deploymentId} does not reference release ${expected.releaseId} and environment ${expected.environmentId}`,
    );
  }

  const verifiedRelease = options.verifiedRelease ?? await verifyReleaseSource(
    client,
    projectReference,
    expected,
    options.releaseSource,
  );
  if (
    verifiedRelease.projectId !== expected.projectId ||
    verifiedRelease.releaseId !== expected.releaseId ||
    verifiedRelease.commitSha !== expected.commitSha ||
    verifiedRelease.sourceDigest !== expected.sourceDigest
  ) {
    throw new Error(
      `Verified release source does not match deployment ${expected.deploymentId}`,
    );
  }

  const attempts = Math.max(1, options.attempts ?? 20);
  const delayMs = Math.max(0, options.delayMs ?? 500);
  let observedEnvironment: Environment | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    observedEnvironment = await getEnvironmentByName(
      client,
      projectReference,
      expected.environmentName,
    );

    if (observedEnvironment) {
      assertProjectOwnership("Environment", observedEnvironment, expected.projectId);
    }

    if (
      observedEnvironment?.id === expected.environmentId &&
      observedEnvironment.deployment?.id === expected.deploymentId &&
      observedEnvironment.deployment.release?.id === expected.releaseId
    ) {
      return {
        projectId: expected.projectId,
        projectSlug: expected.projectSlug,
        environmentId: expected.environmentId,
        environmentName: expected.environmentName,
        releaseId: expected.releaseId,
        releaseVersion: verifiedRelease.releaseVersion,
        deploymentId: expected.deploymentId,
        commitSha: expected.commitSha,
        sourceDigest: verifiedRelease.sourceDigest,
      };
    }

    if (attempt < attempts - 1 && delayMs > 0) await wait(delayMs);
  }

  const observedDeploymentId = observedEnvironment?.deployment?.id ?? "none";
  const observedReleaseId = observedEnvironment?.deployment?.release?.id ?? "none";
  throw new Error(
    `Deployment verification failed: environment "${expected.environmentName}" still points to deployment ${observedDeploymentId} / release ${observedReleaseId}; expected deployment ${expected.deploymentId} / release ${expected.releaseId}`,
  );
}

export async function resolvePushedSource(input: {
  projectDir: string;
  controlPlane: string;
  projectId: string;
  projectSlug: string;
  branch: string;
  requireClean: boolean;
}): Promise<{ commitSha: string; sourceDigest: string }> {
  const receipt = await readPushReceipt(input.projectDir);
  if (!receipt) {
    throw new Error(
      `No verified push found for branch "${input.branch}". Run veryfront push --branch ${input.branch} before deploying.`,
    );
  }

  const gitSource = await resolveGitSource(input.projectDir);
  const commitSha = validatePushReceipt(receipt, {
    controlPlane: input.controlPlane,
    projectId: input.projectId,
    projectSlug: input.projectSlug,
    branch: input.branch,
    commitSha: gitSource.commitSha,
    clean: gitSource.clean,
    requireClean: input.requireClean,
  });
  return { commitSha, sourceDigest: receipt.sourceDigest };
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function buildEnvironmentUrl(projectSlug: string, environment: Environment): string {
  const domain = environment.domains?.[0];
  if (domain) {
    return domain.startsWith("http://") || domain.startsWith("https://")
      ? domain
      : `https://${domain}`;
  }
  return `https://${projectSlug}.${environment.name}.veryfront.com`;
}

async function inferDeployProjectSlug(projectDir: string): Promise<string> {
  const fs = createFileSystem();
  const packagePath = join(projectDir, "package.json");

  try {
    if (await fs.exists(packagePath)) {
      const pkg = JSON.parse(await fs.readTextFile(packagePath)) as { name?: string };
      if (pkg.name) return normalizeProjectSlug(pkg.name);
    }
  } catch {
    // Fall back to the directory name below.
  }

  const dirName = projectDir.split(/[/\\]/).filter(Boolean).pop() ?? "my-app";
  return normalizeProjectSlug(dirName);
}

async function ensureProjectLinkedForDeploy(
  projectDir: string,
  env: EnvironmentConfig,
  dryRun: boolean,
  quiet: boolean,
): Promise<ResolvedConfig> {
  const initial = await resolveConfigWithAuth(projectDir, env);
  const configFile = await readConfigFile(projectDir);
  const hasPersistedSlug = Boolean(configFile?.projectSlug);
  const suggestedSlug = normalizeProjectSlug(
    initial.projectSlug || await inferDeployProjectSlug(projectDir),
  );
  const client = createApiClient({ ...initial, projectSlug: suggestedSlug });

  try {
    await getProject(client, suggestedSlug);
    if (!hasPersistedSlug && !dryRun) {
      await writeProjectSlug(projectDir, suggestedSlug);
      if (!quiet) logInfo(`Linked project ${suggestedSlug}`);
    }
    return { ...initial, projectSlug: suggestedSlug };
  } catch (error) {
    if (getErrorStatus(error) !== 404) {
      throw new Error(
        `Could not check project "${suggestedSlug}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (dryRun) {
    if (!quiet) logInfo(`Would create project ${suggestedSlug}`);
    return { ...initial, projectSlug: suggestedSlug };
  }

  const created = await reserveProjectSlug(
    suggestedSlug,
    initial.apiToken,
    env,
    initial.apiUrl,
    { allowAlternativeSlug: false },
  );
  await writeProjectSlug(projectDir, created.slug);
  if (!quiet) logInfo(`Created project ${created.slug}`);
  return { ...initial, projectSlug: created.slug };
}

async function collectProjectPageRoutes(projectDir: string): Promise<string[]> {
  const fs = createFileSystem();
  const routes = new Set<string>();

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      if (!(await fs.exists(dir))) return;
      entries = await fs.readDir(dir);
    } catch {
      return;
    }

    for await (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) {
        await walk(path);
        continue;
      }
      if (!/\.(tsx|ts|jsx|mdx|js)$/.test(entry.name)) continue;

      const relativePath = path.slice(projectDir.length + 1).replace(/\\/g, "/");
      const route = routeForPage(relativePath);
      if (route) routes.add(route);
    }
  }

  await Promise.all([
    walk(join(projectDir, "app")),
    walk(join(projectDir, "pages")),
  ]);

  return [...routes].sort();
}

function assertReadyManifestCoversPageRoutes(
  releaseId: string,
  result: ReleaseAssetManifestResponse,
  expectedRoutes: string[],
): void {
  const manifest = result.manifest;
  if (!manifest) {
    throw new Error(
      `Release assets for ${releaseId} are ready but no manifest body was returned. Check the release asset build and run deploy again.`,
    );
  }

  const moduleCount = Object.keys(manifest.modules).length;
  const missingRoutes = expectedRoutes.filter((route) => !manifest.routes[route]);
  if (moduleCount === 0 || missingRoutes.length > 0) {
    throw new Error(
      `Release assets for ${releaseId} are ready but do not include browser modules for this app. ${
        missingRoutes.length > 0 ? `Missing routes: ${missingRoutes.join(", ")}. ` : ""
      }The deployed page would not hydrate; check the release asset build and run deploy again.`,
    );
  }
}

export async function waitForReleaseAssetManifest(
  client: ApiClient,
  projectSlug: string,
  releaseId: string,
  options: {
    expectedRoutes?: string[];
    pollIntervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<ReleaseAssetManifestResponse> {
  const pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 2_000);
  const timeoutMs = Math.max(pollIntervalMs, options.timeoutMs ?? 120_000);
  const expectedRoutes = options.expectedRoutes ?? [];
  const deadline = Date.now() + timeoutMs;
  let lastState = "missing";

  for (;;) {
    try {
      const result = await client.get<ReleaseAssetManifestResponse>(
        `/projects/${projectSlug}/releases/${releaseId}/asset-manifest`,
      );
      lastState = result.state;

      if (result.state === "ready") {
        assertReadyManifestCoversPageRoutes(releaseId, result, expectedRoutes);
        return result;
      }
      if (result.state === "failed") {
        throw new Error(`Release asset build failed for release ${releaseId}`);
      }
    } catch (error) {
      if (getErrorStatus(error) !== 404) throw error;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      const timeoutSeconds = Math.ceil(timeoutMs / 1000);
      throw new Error(
        `Release assets were not ready within ${timeoutSeconds}s (last state: ${lastState}). Check the release asset build and run deploy again.`,
      );
    }

    await wait(Math.min(pollIntervalMs, remainingMs));
  }
}

/**
 * Create a release and deploy to an environment
 */
export async function deployCommand(options: DeployOptions): Promise<void> {
  const {
    projectDir = cwd(),
    branch,
    env,
    releaseName,
    dryRun,
    force,
    quiet,
    skipSourcePush,
    assetManifestPollIntervalMs,
    assetManifestTimeoutMs,
  } = options;

  if (isJsonMode()) {
    return deployCommandJson(options);
  }

  let spinner = quiet ? createNoopSpinner() : createSpinner("Resolving configuration...");

  const environmentConfig = getEnvironmentConfig();
  let config = await ensureProjectLinkedForDeploy(projectDir, environmentConfig, dryRun, quiet);
  const expectedPageRoutes = await collectProjectPageRoutes(projectDir);

  if (!skipSourcePush) {
    spinner.update(`Pushing source to "${branch}"...`);
    spinner.stop();
    await pushCommand({
      projectDir,
      branch,
      force: true,
      dryRun,
      quiet: true,
    });
    spinner = quiet ? createNoopSpinner() : createSpinner("Resolving configuration...");
    config = await resolveConfigWithAuth(projectDir, environmentConfig);
  }

  const client = createApiClient(config);

  spinner.update("Resolving project...");
  const project = await getProject(client, config.projectSlug);

  spinner.update(`Looking up environment "${env}"...`);

  const environment = await getEnvironmentByName(client, project.id, env);
  if (!environment) {
    spinner.stop();
    throw new Error(`Environment "${env}" not found`);
  }

  try {
    assertProjectOwnership("Environment", environment, project.id);
  } catch (error) {
    spinner.stop();
    throw error;
  }

  if (dryRun) {
    spinner.stop();
    if (!quiet) logInfo(`Would create release from "${branch}" and deploy to "${env}"`);
    return;
  }

  spinner.update("Verifying pushed source...");
  let source: { commitSha: string; sourceDigest: string };
  try {
    source = await resolvePushedSource({
      projectDir,
      controlPlane: config.apiUrl,
      projectId: project.id,
      projectSlug: project.slug,
      branch,
      requireClean: env === "production",
    });
  } finally {
    spinner.stop();
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

  let release: Release;
  let deployment: Deployment;
  let verification: DeploymentVerification;
  try {
    release = await createRelease(client, project.id, { name: releaseName, branch });
    if (!release.version) throw new Error(`Release ${release.id} has no version`);

    spinner.update(`Verifying ${release.version} source...`);
    const verifiedRelease = await verifyReleaseSource(client, project.id, {
      projectId: project.id,
      releaseId: release.id,
      releaseName: release.name,
      commitSha: source.commitSha,
      sourceDigest: source.sourceDigest,
    });

    spinner.update(`Waiting for release assets for ${release.version}...`);
    await waitForReleaseAssetManifest(client, project.slug, release.id, {
      expectedRoutes: expectedPageRoutes,
      pollIntervalMs: assetManifestPollIntervalMs,
      timeoutMs: assetManifestTimeoutMs,
    });

    spinner.update(`Deploying ${release.version} to ${env}...`);
    deployment = await createDeployment(client, project.id, release.id, environment.id);

    spinner.update(`Verifying ${env} deployment...`);
    verification = await verifyDeployment(client, project.id, {
      projectId: project.id,
      projectSlug: project.slug,
      environmentId: environment.id,
      environmentName: env,
      releaseId: release.id,
      releaseName: release.name,
      deploymentId: deployment.id,
      commitSha: source.commitSha,
      sourceDigest: source.sourceDigest,
    }, { verifiedRelease });
    spinner.stop();
  } catch (error) {
    spinner.stop();
    throw error;
  }

  if (quiet) return;

  logSuccess(`Deployed ${verification.releaseVersion} to ${env}`);
  logInfo(`  Project: ${verification.projectSlug} (${verification.projectId})`);
  logInfo(`  Environment: ${env} (${verification.environmentId})`);
  logInfo(
    `  Release: ${release.name} (${verification.releaseVersion}, ${verification.releaseId})`,
  );
  logInfo(`  Deployment: ${verification.deploymentId}`);
  if (deployment.routing_convergence?.status === "converged") {
    logInfo(
      `  Data plane: ${deployment.routing_convergence.acknowledged}/${deployment.routing_convergence.recipients} proxy replicas converged`,
    );
  }
  const routingConvergenceWarning = getDeploymentRoutingConvergenceWarning(deployment);
  if (routingConvergenceWarning) logWarning(routingConvergenceWarning);
  logInfo(`  URL: ${buildEnvironmentUrl(verification.projectSlug, environment)}`);
  logInfo(`  Protected: ${environment.protected ? "yes" : "no"}`);
  logInfo(`  Commit: ${verification.commitSha}`);
  logInfo(`  Source digest: ${verification.sourceDigest}`);
  logInfo(`  Control plane: ${normalizeControlPlane(config.apiUrl)}`);

  const { getPostDeployTips } = await import("../../help/tips.ts");
  console.log(getPostDeployTips());
}

async function deployCommandJson(options: DeployOptions): Promise<void> {
  const {
    projectDir = cwd(),
    branch,
    env,
    releaseName,
    dryRun,
    force,
    assetManifestPollIntervalMs,
    assetManifestTimeoutMs,
  } = options;

  try {
    // JSON mode requires --force or --yes to prevent accidental deploys
    if (requiresExplicitDeployConfirmation(force)) {
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
    const config = await resolveConfigWithAuth(projectDir);
    const client = createApiClient(config);
    const expectedPageRoutes = await collectProjectPageRoutes(projectDir);
    streamJsonLine({ type: "step", name: "resolve-config", status: "completed" });

    streamJsonLine({ type: "step", name: "resolve-target", status: "started" });
    const project = await getProject(client, config.projectSlug);
    const environment = await getEnvironmentByName(client, project.id, env);
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
    assertProjectOwnership("Environment", environment, project.id);
    streamJsonLine({ type: "step", name: "resolve-target", status: "completed" });

    if (dryRun) {
      streamJsonLine({
        type: "result",
        success: true,
        data: {
          dryRun: true,
          branch,
          projectId: project.id,
          projectSlug: project.slug,
          environment: env,
          environmentId: environment.id,
          controlPlane: normalizeControlPlane(config.apiUrl),
        },
      });
      return;
    }

    streamJsonLine({ type: "step", name: "verify-source", status: "started" });
    const source = await resolvePushedSource({
      projectDir,
      controlPlane: config.apiUrl,
      projectId: project.id,
      projectSlug: project.slug,
      branch,
      requireClean: env === "production",
    });
    streamJsonLine({ type: "step", name: "verify-source", status: "completed" });

    streamJsonLine({ type: "step", name: "create-release", status: "started" });
    const release = await createRelease(client, project.id, {
      name: releaseName,
      branch,
    });
    if (!release.version) throw new Error(`Release ${release.id} has no version`);
    streamJsonLine({ type: "step", name: "create-release", status: "completed" });

    streamJsonLine({ type: "step", name: "verify-release-source", status: "started" });
    const verifiedRelease = await verifyReleaseSource(client, project.id, {
      projectId: project.id,
      releaseId: release.id,
      releaseName: release.name,
      commitSha: source.commitSha,
      sourceDigest: source.sourceDigest,
    });
    streamJsonLine({ type: "step", name: "verify-release-source", status: "completed" });

    streamJsonLine({ type: "step", name: "wait-release-assets", status: "started" });
    await waitForReleaseAssetManifest(client, project.slug, release.id, {
      expectedRoutes: expectedPageRoutes,
      pollIntervalMs: assetManifestPollIntervalMs,
      timeoutMs: assetManifestTimeoutMs,
    });
    streamJsonLine({ type: "step", name: "wait-release-assets", status: "completed" });

    streamJsonLine({ type: "step", name: "deploy", status: "started" });
    const deployment = await createDeployment(
      client,
      project.id,
      release.id,
      environment.id,
    );
    streamJsonLine({ type: "step", name: "deploy", status: "completed" });

    streamJsonLine({ type: "step", name: "verify-deployment", status: "started" });
    const verification = await verifyDeployment(client, project.id, {
      projectId: project.id,
      projectSlug: project.slug,
      environmentId: environment.id,
      environmentName: env,
      releaseId: release.id,
      releaseName: release.name,
      deploymentId: deployment.id,
      commitSha: source.commitSha,
      sourceDigest: source.sourceDigest,
    }, { verifiedRelease });
    streamJsonLine({ type: "step", name: "verify-deployment", status: "completed" });

    const routingConvergenceWarning = getDeploymentRoutingConvergenceWarning(deployment);
    if (routingConvergenceWarning) {
      streamJsonLine({
        type: "warning",
        code: "routing-convergence-unconfirmed",
        message: routingConvergenceWarning,
      });
    }

    streamJsonLine({
      type: "result",
      success: true,
      data: {
        projectId: verification.projectId,
        projectSlug: verification.projectSlug,
        release: {
          id: verification.releaseId,
          name: release.name,
          version: verification.releaseVersion,
        },
        environment: env,
        environmentId: verification.environmentId,
        deploymentId: verification.deploymentId,
        url: buildEnvironmentUrl(verification.projectSlug, environment),
        protected: environment.protected,
        routingConvergence: deployment.routing_convergence ?? null,
        commitSha: verification.commitSha,
        sourceDigest: verification.sourceDigest,
        controlPlane: normalizeControlPlane(config.apiUrl),
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
