/**
 * Deploy command - Create a release and deploy to an environment
 *
 * Creates a new release from the specified branch, or main when no branch is
 * specified, then deploys it to the target environment (default: production).
 *
 * @module cli/commands/deploy
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { createFileSystem, cwd, runtime } from "veryfront/platform";
import { join, relative, resolve } from "veryfront/platform/path";
import { type EnvironmentConfig, getConfig, getEnvironmentConfig } from "veryfront/config";
import {
  type ApiClient,
  createApiClient,
  type ProjectReferenceSource,
  resolveConfigWithAuth,
  resolveConfigWithAuthDetails,
  type ResolvedConfig,
} from "#cli/shared/config";
import { writeProjectLink } from "../../shared/project-link.ts";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import { exitProcess, isVerbose, logInfo, logSuccess, logWarning } from "#cli/utils";
import {
  DEPLOYMENT_ERROR,
  ENVIRONMENT_NOT_FOUND,
  RELEASE_MISSING_VERSION,
  SOURCE_DIGEST_MISMATCH,
  UNKNOWN_ERROR,
  VeryfrontError,
} from "veryfront/errors";
import { brand, createNoopSpinner, createSpinner, dim, formatDuration } from "#cli/ui";
import { reserveProjectSlug } from "#cli/shared/reserve-slug";
import { normalizeProjectSlug } from "#cli/shared/slug";
import { pushCommand } from "../push/index.ts";
import { createStreamErrorResult, isJsonMode, streamJsonLine } from "../../shared/json-output.ts";
import {
  computeSourceDigest,
  normalizeControlPlane,
  type ProjectTarget,
  PUSH_RECEIPT_RELATIVE_PATH,
  type PushReceipt,
  readPushReceipt,
  resolveGitSource,
  validatePushReceipt,
} from "../../shared/deployment-provenance.ts";
import { type ReleaseAssetManifestResponse, routeForPage } from "veryfront/release-assets";
import {
  createHttpDeployControlPlane,
  type DeployDeployment,
  type DeployEnvironment,
  type DeploymentRoutingConvergence,
  type DeployRelease,
} from "../../shared/deployment/control-plane.ts";
import {
  createDeployProject,
  type DeployEvent,
  type DeployPlan,
  type DeployProject,
  type DeployProjectOutcome,
  type DeployStepName,
} from "../../shared/deployment/deploy-project.ts";
import type { DeployResult } from "../../shared/deployment/result.ts";
import { parseProjectDomain } from "veryfront/server";
import { isWithinDirectory, normalizePath } from "veryfront/utils";

/**
 * Schema factory for deploy command arguments
 */
export const getDeployArgsSchema = defineSchema((v) =>
  v.object({
    projectDir: v.string().optional(),
    branch: v.string().min(1).optional(),
    env: v.string().min(1).default("production"),
    releaseName: v.string().min(1).optional(),
    dryRun: v.boolean().default(false),
    /** Deprecated compatibility flag; invoking deploy already authorizes the operation. */
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
  /** Internal composition control for parent commands that own the JSON result. */
  suppressJsonOutput?: boolean;
  assetManifestPollIntervalMs?: number;
  assetManifestTimeoutMs?: number;
  environmentPollIntervalMs?: number;
  environmentTimeoutMs?: number;
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
export type { DeploymentRoutingConvergence };

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
  commitSha: string | null;
  sourceDigest: string;
}

export type { DeployResult };

function createDeployResult({
  verification,
  release,
  environment,
  deployment,
  environmentUrl,
  config,
  branch,
}: {
  verification: DeploymentVerification;
  release: Release;
  environment: Environment;
  deployment: Deployment;
  environmentUrl: string;
  config: ResolvedConfig;
  branch: string;
}): DeployResult {
  return {
    projectId: verification.projectId,
    projectSlug: verification.projectSlug,
    release: {
      id: verification.releaseId,
      name: release.name,
      version: verification.releaseVersion,
    },
    environment: verification.environmentName,
    environmentId: verification.environmentId,
    deploymentId: verification.deploymentId,
    url: environmentUrl,
    protected: environment.protected,
    routingConvergence: deployment.routing_convergence ?? null,
    commitSha: verification.commitSha,
    sourceDigest: verification.sourceDigest,
    controlPlane: normalizeControlPlane(config.apiUrl),
    branch,
  };
}

export interface ReleaseSourceVerification {
  projectId: string;
  releaseId: string;
  releaseVersion: string;
  commitSha: string | null;
  sourceDigest: string;
}

export interface EnvironmentReadinessOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface EnvironmentReadinessTarget {
  projectSlug: string;
  environmentName: string;
  url: string;
  route?: string | null;
  protected: boolean;
  apiToken: string;
}

interface ReleaseSourceExpectation {
  projectId: string;
  releaseId: string;
  commitSha: string | null;
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
  commitSha: string | null;
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
const DEFAULT_ENVIRONMENT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_ENVIRONMENT_TIMEOUT_MS = 120_000;

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
    throw DEPLOYMENT_ERROR.create({
      detail: `${resourceType} ${resource.id} does not belong to resolved project ${projectId}`,
    });
  }
}

function controlPlaneConfig(projectSlug: string): ResolvedConfig {
  return {
    apiUrl: "https://control.invalid/api",
    apiToken: "",
    projectSlug,
  };
}

function toEnvironment(environment: DeployEnvironment): Environment {
  const legacyEnvironment = (environment as DeployEnvironment & {
    legacyEnvironment?: Environment;
  }).legacyEnvironment;
  if (legacyEnvironment) return legacyEnvironment;

  return {
    id: environment.id,
    name: environment.name,
    protected: environment.protected,
    ...(environment.projectId ? { project_id: environment.projectId } : {}),
    ...(environment.deployment !== undefined ? { deployment: environment.deployment } : {}),
    ...(environment.domains ? { domains: environment.domains } : {}),
  };
}

function toRelease(release: DeployRelease): Release {
  const legacyRelease = (release as DeployRelease & { legacyRelease?: Release }).legacyRelease;
  if (legacyRelease) return legacyRelease;

  return {
    id: release.id,
    name: release.name,
    version: release.version,
    ...(release.projectId ? { project_id: release.projectId } : {}),
  } as Release;
}

function toDeployment(deployment: DeployDeployment): Deployment {
  return {
    id: deployment.id,
    release_id: deployment.releaseId,
    environment_id: deployment.environmentId,
    routing_convergence: deployment.routingConvergence,
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
  const environment = await createHttpDeployControlPlane(controlPlaneConfig(projectSlug), client)
    .getEnvironment(projectSlug, name);
  return environment ? toEnvironment(environment) : null;
}

export function getProject(client: ApiClient, projectReference: string) {
  return createHttpDeployControlPlane(controlPlaneConfig(projectReference), client)
    .getProject(projectReference);
}

export async function getRelease(
  client: ApiClient,
  projectReference: string,
  releaseId: string,
): Promise<Release> {
  return toRelease(
    await createHttpDeployControlPlane(controlPlaneConfig(projectReference), client)
      .getRelease(projectReference, releaseId),
  );
}

export async function getDeployment(
  client: ApiClient,
  projectReference: string,
  deploymentId: string,
): Promise<Deployment> {
  return toDeployment(
    await createHttpDeployControlPlane(controlPlaneConfig(projectReference), client)
      .getDeployment(projectReference, deploymentId),
  );
}

export async function getReleaseSourceDigest(
  client: ApiClient,
  projectReference: string,
  releaseId: string,
): Promise<string> {
  const files = [];
  for await (
    const file of createHttpDeployControlPlane(controlPlaneConfig(projectReference), client)
      .listReleaseFiles(projectReference, releaseId)
  ) {
    files.push(file);
  }
  return computeSourceDigest(files);
}

/**
 * Create a new release
 */
export async function createRelease(
  client: ApiClient,
  projectSlug: string,
  options?: { name?: string; branch?: string },
): Promise<Release> {
  return toRelease(
    await createHttpDeployControlPlane(controlPlaneConfig(projectSlug), client)
      .createRelease(projectSlug, {
        ...(options?.name ? { name: options.name } : {}),
        branch: options?.branch ?? "",
      }),
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
  return toDeployment(
    await createHttpDeployControlPlane(controlPlaneConfig(projectSlug), client)
      .createDeployment(projectSlug, { releaseId, environmentId }),
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSourceReference(commitSha: string | null): string {
  return commitSha ? `pushed commit ${commitSha}` : "pushed source digest";
}

export async function verifyReleaseSource(
  client: ApiClient,
  projectReference: string,
  expected: ReleaseSourceExpectation,
  options: VerificationRetryOptions = {},
): Promise<ReleaseSourceVerification> {
  const release = await getRelease(client, projectReference, expected.releaseId);
  if (release.id !== expected.releaseId) {
    throw DEPLOYMENT_ERROR.create({
      detail: `Release read-back returned ${release.id}; expected ${expected.releaseId}`,
    });
  }
  assertProjectOwnership("Release", release, expected.projectId);
  if (expected.releaseName && release.name !== expected.releaseName) {
    throw DEPLOYMENT_ERROR.create({
      detail: `Release ${expected.releaseId} no longer matches the created release name`,
    });
  }
  if (!release.version) {
    throw RELEASE_MISSING_VERSION.create({
      detail: `Release ${expected.releaseId} has no version`,
    });
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

  throw SOURCE_DIGEST_MISMATCH.create({
    detail: `Release ${expected.releaseId} source does not match ${
      formatSourceReference(expected.commitSha)
    }: expected source digest ${expected.sourceDigest}; last observed ${sourceDigest}`,
  });
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
}): Promise<{ commitSha: string | null; sourceDigest: string }> {
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

function buildCanonicalEnvironmentUrl(
  projectSlug: string,
  environmentName: string,
): string {
  return `https://${projectSlug}.${environmentName}.veryfront.com`;
}

function isMatchingVeryfrontHostedUrl(
  url: URL,
  target: EnvironmentReadinessTarget,
): boolean {
  const hostname = url.hostname.toLowerCase();
  if (!hostname.endsWith(".veryfront.com") && !hostname.endsWith(".veryfront.org")) {
    return false;
  }
  const parsed = parseProjectDomain(hostname);
  return parsed.isVeryfrontDomain &&
    parsed.slug === target.projectSlug.toLowerCase() &&
    parsed.environment === target.environmentName.toLowerCase();
}

function isVeryfrontSignInUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (hostname === "veryfront.com" || hostname === "veryfront.org") &&
    (url.pathname === "/sign-in" || url.pathname.startsWith("/sign-in/"));
}

interface EnvironmentReadinessProbe {
  url: string;
  authenticate: boolean;
  acceptAuthenticationChallenge: boolean;
}

function buildEnvironmentProbeUrl(baseUrl: string, route: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(
      `Environment URL "${baseUrl}" is invalid. Check the environment configuration and deploy again.`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Environment URL "${baseUrl}" must use HTTP or HTTPS. Check the environment configuration and deploy again.`,
    );
  }
  if (!route.startsWith("/")) {
    throw new Error(`Environment readiness route "${route}" must start with "/".`);
  }

  const probeUrl = new URL(route, url);
  return route === "/" ? probeUrl.origin : probeUrl.href;
}

function buildReadyEnvironmentUrl(baseUrl: string, route: string | null): string {
  return route ? buildEnvironmentProbeUrl(baseUrl, route) : baseUrl;
}

function secureEnvironmentProbeUrl(url: string): string {
  const secureUrl = new URL(url);
  secureUrl.protocol = "https:";
  return secureUrl.href;
}

function buildEnvironmentReadinessProbes(
  target: EnvironmentReadinessTarget,
): EnvironmentReadinessProbe[] {
  const route = target.route === undefined ? "/" : target.route;
  if (route === null) return [];

  const targetUrl = buildEnvironmentProbeUrl(target.url, route);
  if (target.protected && !isMatchingVeryfrontHostedUrl(new URL(targetUrl), target)) {
    return [
      {
        url: targetUrl,
        authenticate: false,
        acceptAuthenticationChallenge: true,
      },
      {
        url: buildEnvironmentProbeUrl(
          buildCanonicalEnvironmentUrl(target.projectSlug, target.environmentName),
          route,
        ),
        authenticate: true,
        acceptAuthenticationChallenge: false,
      },
    ];
  }
  return [{
    url: target.protected ? secureEnvironmentProbeUrl(targetUrl) : targetUrl,
    authenticate: target.protected,
    acceptAuthenticationChallenge: false,
  }];
}

function isSignInRedirect(response: Response, requestUrl: string): boolean {
  if (response.status < 300 || response.status >= 400) return false;
  const location = response.headers.get("location");
  if (!location) return false;

  try {
    return isVeryfrontSignInUrl(new URL(location, requestUrl));
  } catch {
    return false;
  }
}

function isTransientEnvironmentStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 425 || status === 429 ||
    status >= 500;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Readiness does not depend on response payload cleanup.
  }
}

export async function waitForEnvironmentReady(
  target: EnvironmentReadinessTarget,
  options: EnvironmentReadinessOptions = {},
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs === undefined ||
      !Number.isFinite(options.pollIntervalMs)
    ? DEFAULT_ENVIRONMENT_POLL_INTERVAL_MS
    : Math.max(1, Math.trunc(options.pollIntervalMs));
  const timeoutMs = options.timeoutMs === undefined || !Number.isFinite(options.timeoutMs)
    ? DEFAULT_ENVIRONMENT_TIMEOUT_MS
    : Math.max(1, Math.trunc(options.timeoutMs));
  const deadline = Date.now() + timeoutMs;
  for (const probe of buildEnvironmentReadinessProbes(target)) {
    const headers = new Headers({ "Cache-Control": "no-cache" });
    if (probe.authenticate) {
      headers.set("Cookie", `authToken=${target.apiToken}`);
    }
    let lastResponse = "no response";

    for (;;) {
      let response: Response | undefined;
      try {
        response = await fetch(probe.url, {
          method: "GET",
          redirect: "manual",
          headers,
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        });
      } catch {
        lastResponse = "network error";
      }

      if (response) {
        lastResponse = `HTTP ${response.status}`;
        const signInRedirect = isSignInRedirect(response, probe.url);
        const authenticationChallenge = signInRedirect ||
          response.status === 401 ||
          response.status === 403;
        const ready = response.status >= 200 && response.status < 300 ||
          response.status >= 300 && response.status < 400 && !signInRedirect ||
          probe.acceptAuthenticationChallenge && authenticationChallenge;
        await cancelResponseBody(response);

        if (ready) break;
        if (authenticationChallenge) {
          const message = probe.authenticate
            ? `Could not authenticate the protected environment URL ${probe.url}. Run veryfront login and deploy again.`
            : `Environment URL ${probe.url} redirected to sign-in. Check its protection settings and deploy again.`;
          throw new Error(message);
        }
        if (!isTransientEnvironmentStatus(response.status)) {
          throw new Error(
            `Environment URL ${probe.url} returned HTTP ${response.status}. Check the environment configuration and deploy again.`,
          );
        }
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(
          `Environment URL ${probe.url} did not become ready within ${
            Math.ceil(timeoutMs / 1000)
          }s (last response: ${lastResponse}). Check the deployment and run deploy again.`,
        );
      }
      await wait(Math.min(pollIntervalMs, remainingMs));
    }
  }
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

function shouldPersistProjectLink(source: ProjectReferenceSource): boolean {
  return source.kind === "inferred" || source.kind === "local-link";
}

function projectApiReference(config: ResolvedConfig): string {
  return config.projectId ?? config.projectSlug;
}

function needsBootstrapPush(
  receipt: PushReceipt | null,
  skipSourcePush: boolean | undefined,
): boolean {
  return !skipSourcePush && !receipt;
}

async function persistProjectLink(
  projectDir: string,
  config: ResolvedConfig,
  project: ProjectTarget,
): Promise<ResolvedConfig> {
  await writeProjectLink(projectDir, {
    controlPlane: config.apiUrl,
    projectId: project.id,
    projectSlug: project.slug,
  });
  return { ...config, projectId: project.id, projectSlug: project.slug };
}

async function ensureProjectLinkedForDeploy(
  projectDir: string,
  env: EnvironmentConfig,
  receipt: PushReceipt | null,
  dryRun: boolean,
  quiet: boolean,
): Promise<{
  config: ResolvedConfig;
  client: ApiClient;
  project: ProjectTarget | null;
  plannedProjectSlug: string;
}> {
  const details = await resolveConfigWithAuthDetails(projectDir, env);
  const initial = details.config;
  const projectReferenceSource = details.projectReferenceSource;
  const isInferredReference = projectReferenceSource.kind === "inferred";
  const projectReference = isInferredReference
    ? normalizeProjectSlug(initial.projectSlug || await inferDeployProjectSlug(projectDir))
    : initial.projectSlug;
  const config = { ...initial, projectSlug: projectReference };
  const client = createApiClient(config);

  if (!isInferredReference) {
    try {
      const project = await getProject(client, projectApiReference(config));
      const resolvedConfig = shouldPersistProjectLink(projectReferenceSource)
        ? dryRun
          ? { ...config, projectId: project.id, projectSlug: project.slug }
          : await persistProjectLink(projectDir, config, project)
        : { ...config, projectSlug: project.slug };
      return {
        config: resolvedConfig,
        client,
        project,
        plannedProjectSlug: project.slug,
      };
    } catch (error) {
      if (getErrorStatus(error) !== 404) {
        throw new Error(
          `Could not check project "${projectReference}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    throw new Error(
      `Project "${projectReference}" was not found. Check the project reference or remove it to let deploy create a project for this directory.`,
    );
  }

  const suggestedSlug = normalizeProjectSlug(projectReference);
  if (receipt) {
    throw new Error(
      `The local push receipt is orphaned: ${PUSH_RECEIPT_RELATIVE_PATH} targets project "${receipt.projectSlug}", but deploy inferred "${suggestedSlug}" because there is no explicit config or local project link. Remove the receipt and run veryfront push again, or relink this project before deploying.`,
    );
  }

  if (dryRun) {
    if (!quiet) logInfo(`Would create project ${suggestedSlug}`);
    return {
      config: { ...initial, projectSlug: suggestedSlug },
      client: createApiClient({ ...initial, projectSlug: suggestedSlug }),
      project: null,
      plannedProjectSlug: suggestedSlug,
    };
  }

  const created = await reserveProjectSlug(
    suggestedSlug,
    initial.apiToken,
    env,
    initial.apiUrl,
  );
  if (!quiet && isVerbose()) logInfo(`Created project ${created.slug}`);
  const createdConfig = { ...initial, projectSlug: created.slug };
  const createdClient = createApiClient(createdConfig);
  const project = created.projectId
    ? { id: created.projectId, slug: created.slug }
    : await getProject(createdClient, created.slug);
  const linkedConfig = await persistProjectLink(projectDir, createdConfig, project);
  return {
    config: linkedConfig,
    client: createdClient,
    project,
    plannedProjectSlug: created.slug,
  };
}

async function getProjectRouteDirectories(
  projectDir: string,
): Promise<{ app: string; pages: string }> {
  const adapter = await runtime.get();
  const config = await getConfig(projectDir, adapter);
  return {
    app: normalizeConfiguredRouteDirectory(config.directories?.app ?? "app"),
    pages: normalizeConfiguredRouteDirectory(config.directories?.pages ?? "pages"),
  };
}

function normalizeConfiguredRouteDirectory(path: string): string {
  return path.replace(/\\/g, "/");
}

function isAbsoluteConfiguredRouteDirectory(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

function resolveProjectRouteDirectory(
  projectDir: string,
  directory: string,
  name: "app" | "pages",
): string {
  if (isAbsoluteConfiguredRouteDirectory(directory)) {
    throw new Error(
      `Configured ${name} directory "${directory}" must be project-relative. Set directories.${name} to a path inside the project, for example "${name}" or "src/${name}".`,
    );
  }

  const projectRoot = normalizePath(projectDir);
  const routeRoot = normalizePath(resolve(projectRoot, directory));
  if (!isWithinDirectory(projectRoot, routeRoot)) {
    throw new Error(
      `Configured ${name} directory "${directory}" resolves outside the project directory. Set directories.${name} to a project-relative path inside the project.`,
    );
  }
  return routeRoot;
}

async function collectProjectPageRoutes(projectDir: string): Promise<string[]> {
  const fs = createFileSystem();
  const directories = await getProjectRouteDirectories(projectDir);
  const routes = new Set<string>();

  async function walk(rootDir: string, dir: string, routeRoot: "app" | "pages"): Promise<void> {
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
        await walk(rootDir, path, routeRoot);
        continue;
      }
      if (!/\.(tsx|ts|jsx|mdx|js)$/.test(entry.name)) continue;

      const relativePath = relative(rootDir, path).replace(/\\/g, "/");
      if (relativePath === "." || relativePath === ".." || relativePath.startsWith("../")) {
        continue;
      }
      const route = routeForPage(`${routeRoot}/${relativePath}`);
      if (route) routes.add(route);
    }
  }

  const appDir = resolveProjectRouteDirectory(projectDir, directories.app, "app");
  const pagesDir = resolveProjectRouteDirectory(projectDir, directories.pages, "pages");
  await Promise.all([
    walk(appDir, appDir, "app"),
    walk(pagesDir, pagesDir, "pages"),
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
  const missingRoutes = expectedRoutes.filter((route) => {
    const modules = manifest.routes[route]?.modules;
    return !modules || modules.length === 0;
  });
  if (expectedRoutes.length > 0 && (moduleCount === 0 || missingRoutes.length > 0)) {
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
  const controlPlane = createHttpDeployControlPlane(controlPlaneConfig(projectSlug), client);

  for (;;) {
    const result = await controlPlane.getReleaseAssetManifest(projectSlug, releaseId);
    if (result) {
      lastState = result.state;

      if (result.state === "ready") {
        assertReadyManifestCoversPageRoutes(releaseId, result, expectedRoutes);
        return result;
      }
      if (result.state === "failed") {
        throw new Error(`Release asset build failed for release ${releaseId}`);
      }
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
export async function deployCommand(options: DeployOptions): Promise<DeployResult | null> {
  return deployCommandWithProjectForTesting(options);
}

export interface DeployCommandTestingSeams {
  createDeployProject?: (options: DeployOptions) => DeployProject;
}

export async function deployCommandWithProjectForTesting(
  options: DeployOptions,
  seams: DeployCommandTestingSeams = {},
): Promise<DeployResult | null> {
  if (isJsonMode() && !options.suppressJsonOutput) {
    return deployCommandJson(options, seams);
  }

  return deployCommandHuman(options, seams);
}

function createDeployRunner(options: DeployOptions, seams: DeployCommandTestingSeams) {
  const fakeProject = seams.createDeployProject?.(options);
  if (fakeProject) return fakeProject;

  return createDeployProject({
    polling: {
      assetManifestPollIntervalMs: options.assetManifestPollIntervalMs,
      assetManifestTimeoutMs: options.assetManifestTimeoutMs,
      environmentPollIntervalMs: options.environmentPollIntervalMs,
      environmentTimeoutMs: options.environmentTimeoutMs,
    },
  });
}

function toDeployRequest(options: DeployOptions) {
  return {
    projectDir: options.projectDir ?? cwd(),
    branch: options.branch,
    environment: options.env,
    releaseName: options.releaseName,
    mode: options.dryRun ? "dry-run" as const : "apply" as const,
    source: options.skipSourcePush
      ? { kind: "already-pushed" as const }
      : { kind: "ensure-pushed" as const },
  };
}

function formatDryRunActions(plan: DeployPlan): string {
  return plan.plannedActions.includes("push-source")
    ? `push source to "${plan.branch}", create release, and deploy to "${plan.environment}"`
    : `create release and deploy to "${plan.environment}"`;
}

function logDryRunPlan(plan: DeployPlan, quiet: boolean): void {
  if (quiet) return;
  const suffix = plan.projectId ? "" : ` for project ${plan.projectSlug}`;
  logInfo(`Would ${formatDryRunActions(plan)}${suffix}`);
}

function commandStepName(stepName: DeployStepName): string {
  return stepName === "create-deployment" ? "deploy" : stepName;
}

function progressForEvent(
  event: Extract<DeployEvent, { kind: "step" }>,
  env: string,
  verbose: boolean,
): string | null {
  if (event.phase !== "started") return null;
  switch (event.step) {
    case "resolve-config":
      return verbose ? "Resolving configuration..." : "Linking project...";
    case "push-source":
      return verbose ? "Pushing source..." : "Uploading source...";
    case "resolve-target":
    case "verify-source":
    case "create-release":
    case "verify-release-source":
    case "wait-release-assets":
      return verbose ? progressDetailForBuildStep(event.step, env) : "Building release...";
    case "create-deployment":
      return `Deploying to ${env}...`;
    case "verify-deployment":
      return verbose ? `Verifying ${env} deployment...` : `Deploying to ${env}...`;
    case "wait-environment-url":
      return verbose ? `Waiting for ${env} URL...` : `Verifying ${env} URL...`;
  }
}

function progressDetailForBuildStep(stepName: DeployStepName, env: string): string {
  switch (stepName) {
    case "resolve-target":
      return `Looking up environment "${env}"...`;
    case "verify-source":
      return "Verifying pushed source...";
    case "create-release":
      return "Creating release...";
    case "verify-release-source":
      return "Verifying release source...";
    case "wait-release-assets":
      return "Waiting for release assets...";
    default:
      return "Building release...";
  }
}

async function deployCommandHuman(
  options: DeployOptions,
  seams: DeployCommandTestingSeams,
): Promise<DeployResult | null> {
  const { env, dryRun, quiet = false } = options;
  const startedAt = Date.now();
  const verbose = isVerbose();
  let progressText = verbose ? "Resolving configuration..." : "Linking project...";
  const spinner = quiet ? createNoopSpinner() : createSpinner(progressText);
  const updateProgress = (next: string | null): void => {
    if (!next) return;
    if (next === progressText) return;
    progressText = next;
    spinner.update(next);
  };
  let warning: string | null = null;
  let outcome: DeployProjectOutcome;
  try {
    outcome = await createDeployRunner(options, seams).execute(toDeployRequest(options), {
      onEvent(event) {
        if (event.kind === "warning") {
          warning = event.message;
          return;
        }
        updateProgress(progressForEvent(event, env, verbose));
      },
    });
  } catch (error) {
    spinner.stop();
    throw error;
  }
  spinner.stop();

  if (outcome.kind === "dry-run") {
    logDryRunPlan(outcome.plan, quiet);
    return null;
  }

  const result = outcome.result;

  if (quiet) return result;

  logSuccess(
    `Deployed ${result.projectSlug} to ${env} in ${formatDuration(Date.now() - startedAt)}`,
  );
  console.log();
  console.log(`  ${brand(result.url)}`);
  console.log(
    `  ${
      dim(
        `${result.protected ? "Protected" : "Public"} · Release ${result.release.version}`,
      )
    }`,
  );
  console.log();

  if (verbose) {
    logInfo(`  Project: ${result.projectSlug} (${result.projectId})`);
    logInfo(`  Environment: ${env} (${result.environmentId})`);
    logInfo(
      `  Release: ${result.release.name} (${result.release.version}, ${result.release.id})`,
    );
    logInfo(`  Deployment: ${result.deploymentId}`);
    if (result.routingConvergence?.status === "converged") {
      logInfo(
        `  Data plane: ${result.routingConvergence.acknowledged}/${result.routingConvergence.recipients} proxy replicas converged`,
      );
    }
    logInfo(
      result.commitSha
        ? `  Commit: ${result.commitSha}`
        : "  Commit: unavailable (source digest verified)",
    );
    logInfo(`  Source digest: ${result.sourceDigest}`);
    logInfo(`  Control plane: ${result.controlPlane}`);
  }

  if (warning) logWarning(warning);

  if (verbose) {
    const { getPostDeployTips } = await import("../../help/tips.ts");
    console.log(getPostDeployTips());
  }

  return result;
}

async function deployCommandJson(
  options: DeployOptions,
  seams: DeployCommandTestingSeams,
): Promise<DeployResult | null> {
  try {
    const outcome = await createDeployRunner(options, seams).execute(toDeployRequest(options), {
      onEvent(event) {
        if (event.kind === "warning") {
          streamJsonLine({
            type: "warning",
            code: event.code,
            message: event.message,
          });
          return;
        }
        streamJsonLine({
          type: "step",
          name: commandStepName(event.step),
          status: event.phase,
        });
      },
    });

    if (outcome.kind === "dry-run") {
      streamJsonLine({
        type: "result",
        success: true,
        data: { dryRun: true, ...outcome.plan },
      });
      return null;
    }

    const result = outcome.result;
    streamJsonLine({
      type: "result",
      success: true,
      data: result,
    });
    return result;
  } catch (error) {
    const vfErr = error instanceof VeryfrontError ? error : UNKNOWN_ERROR.create({
      detail: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error : undefined,
    });
    streamJsonLine(
      createStreamErrorResult({
        code: "RUNTIME_ERROR",
        slug: vfErr.slug,
        message: vfErr.detail ?? vfErr.message,
      }),
    );
    exitProcess(1);
    return null;
  }
}
