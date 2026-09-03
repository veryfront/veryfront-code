import {
  type EnvironmentConfig,
  findHostedConfigIncompatibility,
  findVeryfrontConfigFile,
  formatHostedConfigIncompatibility,
  getConfig,
  getEnvironmentConfig,
} from "veryfront/config";
import { runtime } from "#cli/runtime-adapter";
import { createFileSystem, isNotFoundError } from "veryfront/platform";
import { join, relative, resolve } from "veryfront/platform/path";
import { isWithinDirectory, normalizePath } from "veryfront/utils";
import {
  HOSTED_ENVIRONMENT_NAMES,
  isHostedEnvironmentName,
  parseProjectDomain,
} from "veryfront/server";
import {
  describeReadyReleaseAssetManifestRejection,
  isSafeBoundedText,
  parseReadyReleaseAssetManifestResponse,
  readUntrustedOwnDataProperty,
  type ReadyReleaseAssetManifestResponse,
  type ReleaseAssetManifestResponse,
  routeForPage,
} from "veryfront/release-assets";
import {
  CONFIG_NOT_DEPLOYABLE,
  DEPLOYMENT_ERROR,
  ENVIRONMENT_NOT_FOUND,
  ENVIRONMENT_NOT_ROUTABLE,
  RELEASE_MISSING_VERSION,
  SOURCE_DIGEST_MISMATCH,
  VeryfrontError,
} from "veryfront/errors";
import {
  computeSourceDigest,
  normalizeControlPlane,
  type ProjectTarget,
  PUSH_RECEIPT_RELATIVE_PATH,
  type PushReceipt,
  readPushReceipt,
  resolveGitSource,
  validatePushReceipt,
} from "../deployment-provenance.ts";
import { normalizeProjectSlug } from "../slug.ts";
import { reserveProjectSlug } from "../reserve-slug.ts";
import {
  getErrorStatus,
  inferProjectSlugFromDirectory,
  projectApiReference,
  ProjectReferenceNotFoundError,
  type ProjectResolutionClient,
  type ProjectResolutionOutcome,
  resolveOrCreateProject,
  shouldPersistProjectLink,
} from "../project-resolution.ts";
import {
  isRetryableApiReadError,
  type ProjectReferenceSource,
  resolveConfigWithAuth,
  resolveConfigWithAuthDetails,
  type ResolvedConfig,
} from "../config.ts";
import { pushCommand } from "../../commands/push/index.ts";
import {
  createHttpDeployControlPlane,
  type DeployControlPlane,
  type DeployDeployment,
  type DeployEnvironment,
  type DeploymentRoutingConvergence,
  type DeployRelease,
  type EnvironmentAccessTarget,
} from "./control-plane.ts";
import type { DeployResult } from "./result.ts";

export interface DeployProjectRequest {
  projectDir: string;
  /**
   * Explicit project reference for callers that target a project by slug
   * (for example MCP tools). Takes precedence over receipt, link, and
   * inference, and never persists a local project link. Requires
   * `source: { kind: "already-pushed" }` — a request-scoped deploy never
   * pushes local sources on the caller's behalf.
   */
  projectSlug?: string;
  branch?: string;
  environment: string;
  releaseName?: string;
  mode: "apply" | "dry-run";
  source: { kind: "ensure-pushed" } | { kind: "already-pushed" };
}

export interface DeployPollingPolicy {
  assetManifestPollIntervalMs?: number;
  assetManifestTimeoutMs?: number;
  environmentPollIntervalMs?: number;
  environmentTimeoutMs?: number;
}

export type DeployStepName =
  | "resolve-config"
  | "push-source"
  | "resolve-target"
  | "verify-source"
  | "create-release"
  | "verify-release-source"
  | "wait-release-assets"
  | "create-deployment"
  | "verify-deployment"
  | "wait-environment-url";

export type DeployEvent =
  | {
    kind: "step";
    step: DeployStepName;
    phase: "started" | "completed";
  }
  | {
    kind: "warning";
    code: "routing-convergence-unconfirmed" | "environment-url-unverified";
    message: string;
  };

export interface DeployObserver {
  onEvent(event: DeployEvent): void | Promise<void>;
}

export interface DeployPlan {
  branch: string;
  projectId: string | null;
  projectSlug: string;
  environment: string;
  environmentId: string | null;
  controlPlane: string;
  plannedActions: Array<"create-project" | "push-source" | "create-release" | "deploy">;
}

export type DeployProjectOutcome =
  | { kind: "deployed"; result: DeployResult }
  | { kind: "dry-run"; plan: DeployPlan };

export interface DeployProject {
  execute(
    request: DeployProjectRequest,
    observer?: DeployObserver,
  ): Promise<DeployProjectOutcome>;
}

interface DeploymentVerification {
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

interface ReleaseSourceVerification {
  projectId: string;
  releaseId: string;
  releaseVersion: string;
  commitSha: string | null;
  sourceDigest: string;
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

async function emit(
  observer: DeployObserver | undefined,
  event: DeployEvent,
): Promise<void> {
  await observer?.onEvent(event);
}

async function step<T>(
  observer: DeployObserver | undefined,
  stepName: DeployStepName,
  operation: () => Promise<T>,
): Promise<T> {
  await emit(observer, { kind: "step", step: stepName, phase: "started" });
  const result = await operation();
  await emit(observer, { kind: "step", step: stepName, phase: "completed" });
  return result;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureProjectLinkedForDeploy(
  projectDir: string,
  env: EnvironmentConfig,
  receipt: PushReceipt | null,
  mode: DeployProjectRequest["mode"],
  controlPlaneFactory: (config: ResolvedConfig) => DeployControlPlane,
  explicitProjectSlug?: string,
): Promise<{
  config: ResolvedConfig;
  controlPlane: DeployControlPlane;
  project: ProjectTarget | null;
  plannedProjectSlug: string;
}> {
  const details = await resolveConfigWithAuthDetails(projectDir, env);
  const initial = details.config;
  const requestReference = explicitProjectSlug ? normalizeProjectSlug(explicitProjectSlug) : null;
  const projectReferenceSource: ProjectReferenceSource = requestReference
    ? { kind: "argument", name: "--project" }
    : details.projectReferenceSource;
  const isInferredReference = projectReferenceSource.kind === "inferred";
  const projectReference = requestReference ??
    (isInferredReference
      ? normalizeProjectSlug(initial.projectSlug || await inferProjectSlugFromDirectory(projectDir))
      : initial.projectSlug);
  const config = requestReference
    ? { ...initial, projectId: undefined, projectSlug: requestReference }
    : { ...initial, projectSlug: projectReference };
  const controlPlane = controlPlaneFactory(config);

  const suggestedSlug = normalizeProjectSlug(projectReference);
  if (isInferredReference && receipt) {
    throw new Error(
      `The local push receipt is orphaned: ${PUSH_RECEIPT_RELATIVE_PATH} targets project "${receipt.projectSlug}", but deploy inferred "${suggestedSlug}" because there is no explicit config or local project link. Remove the receipt and run veryfront push again, or relink this project before deploying.`,
    );
  }

  const resolutionClient: ProjectResolutionClient = {
    getProject: (reference) => controlPlane.getProject(reference),
    reserveSlug: async (slug, options) => {
      const reserved = await reserveProjectSlug(
        slug,
        initial.apiToken,
        env,
        initial.apiUrl,
        options,
      );
      return { slug: reserved.slug, projectId: reserved.projectId };
    },
  };

  let outcome: ProjectResolutionOutcome;
  try {
    outcome = await resolveOrCreateProject({
      projectDir,
      config,
      source: projectReferenceSource,
      client: resolutionClient,
      createMissingReference: false,
      dryRun: mode === "dry-run",
    });
  } catch (error) {
    if (error instanceof ProjectReferenceNotFoundError) {
      throw new Error(
        `Project "${projectReference}" was not found. Check the project reference or remove it to let deploy create a project for this directory.`,
      );
    }
    if (isInferredReference || error instanceof VeryfrontError) throw error;
    throw new Error(
      `Could not check project "${projectReference}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (outcome.kind === "planned-create") {
    const dryRunConfig = { ...initial, projectSlug: outcome.plannedSlug };
    return {
      config: dryRunConfig,
      controlPlane: controlPlaneFactory(dryRunConfig),
      project: null,
      plannedProjectSlug: outcome.plannedSlug,
    };
  }

  // A source that never owns the local link keeps its own reference: only the
  // slug is refreshed from the control plane, never the id.
  const resolvedConfig = shouldPersistProjectLink(projectReferenceSource)
    ? outcome.config
    : { ...config, projectSlug: outcome.project.slug };
  return {
    config: resolvedConfig,
    controlPlane: controlPlaneFactory(resolvedConfig),
    project: outcome.project,
    plannedProjectSlug: outcome.project.slug,
  };
}

/**
 * How an `ensure-pushed` deploy has to upload the local source, if at all.
 *
 * - `"bootstrap"` — no receipt exists, so there is no remote state to
 *   reconcile against and the first push may write the branch outright.
 * - `"refresh"`  — a receipt for *this* deploy target exists but no longer
 *   describes the checkout, so the source is pushed again under the normal
 *   conflict checks.
 * - `"none"`     — nothing to push, either because the receipt still describes
 *   the checkout or because deploy must refuse rather than upload.
 */
export type BootstrapPushKind = "none" | "bootstrap" | "refresh";

/** The deploy target a receipt has to match before it may be refreshed. */
export interface BootstrapPushTarget {
  controlPlane: string;
  branch: string;
  /** Omitted while the project is only planned, so nothing to compare yet. */
  projectId?: string | null;
  projectSlug?: string | null;
}

/**
 * Whether a receipt describes the same place this deploy is about to write.
 *
 * A receipt aimed elsewhere is the evidence {@link validatePushReceipt} needs
 * to refuse the deploy. Pushing over it would overwrite that evidence with a
 * receipt that matches, turning a refusal into a silent redirect, so a
 * mismatched receipt never selects an automatic push.
 */
function receiptTargetsDeploy(receipt: PushReceipt, target: BootstrapPushTarget): boolean {
  if (
    normalizeControlPlane(receipt.controlPlane) !== normalizeControlPlane(target.controlPlane)
  ) {
    return false;
  }
  if (receipt.branch !== target.branch) return false;
  if (target.projectId && receipt.projectId !== target.projectId) return false;
  if (target.projectSlug && receipt.projectSlug !== target.projectSlug) return false;
  return true;
}

/**
 * Whether an `ensure-pushed` deploy has to upload the local source first.
 *
 * Holding a receipt is not evidence that the receipt still describes the
 * working tree. Uncommitted work is the gap no later check can close: it leaves
 * HEAD untouched, so a commit comparison sees a match that is not one, and
 * deploying on it would serve the previous upload while reporting the edited
 * source as live. That state — along with no receipt at all, a receipt that
 * never proved a clean source, and a project outside Git — is pushed again, so
 * `veryfront up` refreshes the source instead of deploying a stale one.
 *
 * Every refusal {@link validatePushReceipt} owns is checked *before* dirtiness
 * can select a push, because the push rewrites the receipt those refusals read.
 * A different control plane, project, or branch, and a HEAD that has moved off
 * the pushed commit, therefore still reach the operator as an error telling
 * them to push, exactly as they do from a clean checkout. That keeps deploy's
 * standing contract intact: committed work is never uploaded behind the
 * operator's back, and a dirty tree never converts a refusal into an upload.
 */
export async function resolveBootstrapPush(
  receipt: PushReceipt | null,
  source: DeployProjectRequest["source"],
  projectDir: string,
  target: BootstrapPushTarget,
): Promise<BootstrapPushKind> {
  if (source.kind !== "ensure-pushed") return "none";
  if (!receipt) return "bootstrap";
  if (!receiptTargetsDeploy(receipt, target)) return "none";
  // A receipt that never recorded a clean commit proves nothing about the
  // checkout, so there is no commit to compare and the source is refreshed.
  if (!receipt.clean || !receipt.commitSha) return "refresh";
  const gitSource = await resolveGitSource(projectDir);
  if (gitSource.commitSha !== receipt.commitSha) return "none";
  return gitSource.clean ? "none" : "refresh";
}

export function assertProjectOwnership(
  resourceType: "Environment" | "Release",
  resource: { id: string; projectId?: string },
  projectId: string,
): void {
  if (resource.projectId && resource.projectId !== projectId) {
    throw DEPLOYMENT_ERROR.create({
      detail: `${resourceType} ${resource.id} does not belong to resolved project ${projectId}`,
    });
  }
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

function formatSourceReference(commitSha: string | null): string {
  return commitSha ? `pushed commit ${commitSha}` : "pushed source digest";
}

async function getReleaseSourceDigest(
  controlPlane: DeployControlPlane,
  projectReference: string,
  releaseId: string,
): Promise<string> {
  const files = [];
  for await (const file of controlPlane.listReleaseFiles(projectReference, releaseId)) {
    files.push(file);
  }
  return computeSourceDigest(files);
}

function boundedReleaseSourceVerificationOptions(
  options: VerificationRetryOptions,
): Required<VerificationRetryOptions> {
  const attempts = options.attempts === undefined
    ? MAX_RELEASE_SOURCE_VERIFICATION_ATTEMPTS
    : Number.isFinite(options.attempts)
    ? Math.min(MAX_RELEASE_SOURCE_VERIFICATION_ATTEMPTS, Math.max(1, Math.trunc(options.attempts)))
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

export async function verifyReleaseSource(
  controlPlane: DeployControlPlane,
  projectReference: string,
  expected: ReleaseSourceExpectation,
  options: VerificationRetryOptions = {},
): Promise<ReleaseSourceVerification> {
  const release = await controlPlane.getRelease(projectReference, expected.releaseId);
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
    sourceDigest = await getReleaseSourceDigest(controlPlane, projectReference, expected.releaseId);
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
  controlPlane: DeployControlPlane,
  projectReference: string,
  expected: DeploymentExpectation,
  options: DeploymentVerificationOptions = {},
): Promise<DeploymentVerification> {
  const deployment = await controlPlane.getDeployment(projectReference, expected.deploymentId);
  if (
    deployment.id !== expected.deploymentId || deployment.releaseId !== expected.releaseId ||
    deployment.environmentId !== expected.environmentId
  ) {
    throw new Error(
      `Deployment ${expected.deploymentId} does not reference release ${expected.releaseId} and environment ${expected.environmentId}`,
    );
  }

  const verifiedRelease = options.verifiedRelease ?? await verifyReleaseSource(
    controlPlane,
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
    throw new Error(`Verified release source does not match deployment ${expected.deploymentId}`);
  }

  const attempts = Math.max(1, options.attempts ?? 20);
  const delayMs = Math.max(0, options.delayMs ?? 500);
  let observedEnvironment: DeployEnvironment | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    observedEnvironment = await controlPlane.getEnvironment(
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

/**
 * Refuse a configuration file Veryfront Cloud can never read.
 *
 * A hosted project's config is evaluated as data, not imported, so a config
 * that imports an extension is rejected on every request: the deploy reports
 * success and the environment answers 500 to all traffic. Deciding it here
 * costs one parse and turns that into a message before anything is created.
 *
 * Only rejections the source alone decides reach this far (see
 * `findHostedConfigIncompatibility`), so a config whose values depend on
 * deployment environment variables is never blocked by a difference between
 * that environment and the developer's.
 */
async function assertConfigIsDeployable(projectDir: string): Promise<void> {
  const fs = createFileSystem();
  const configFile = await findVeryfrontConfigFile(projectDir, (path) => fs.exists(path));
  if (!configFile) return;

  let source: string;
  try {
    source = await fs.readTextFile(configFile.path);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }

  const incompatibility = await findHostedConfigIncompatibility(source, configFile.fileName);
  if (!incompatibility) return;

  throw CONFIG_NOT_DEPLOYABLE.create({
    detail: formatHostedConfigIncompatibility(incompatibility, configFile.fileName),
    context: {
      configFile: configFile.fileName,
      code: incompatibility.code,
      reason: incompatibility.reason,
      ...(incompatibility.line === undefined ? {} : { line: incompatibility.line }),
    },
  });
}

/** Explicit form of the comparator-less sort: UTF-16 code-unit order. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
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

  return [...routes].sort(compareCodeUnits);
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

/** Upper bound for a plausible manifest state value from the control plane. */
const MAX_MANIFEST_STATE_LENGTH = 64;

/**
 * The manifest row appears the moment the project runtime begins the build, so
 * never seeing one is a different failure from a build that is merely slow: the
 * control plane's signed `task:release-asset-build` dispatch never reached the
 * builder. Something in front of the runtime's control-plane handler answered
 * it, and the operator needs to be told that rather than sent to inspect a
 * build that never started.
 */
const RELEASE_ASSET_BUILD_NEVER_STARTED_HINT =
  "No manifest was ever created for this release, so the release asset build " +
  'dispatch (POST /api/control-plane/runs/{runId}/execute, target "task:release-asset-build") ' +
  "never reached the builder on the deployed runtime. Check the runtime logs for this " +
  "release, and any request gate in front of it such as the project's middleware.ts or a " +
  "security policy in veryfront.config.";

function releaseAssetPollingTimeoutError(options: {
  timeoutMs: number;
  lastState: string;
  /** The most recent retryable read failure, or `null` if the last read succeeded. */
  lastTransientFailure: string | null;
  /** Whether any read ever returned a manifest row. */
  observedManifest: boolean;
  /** Whether any read ever failed retryably, including reads a later success followed. */
  observedTransientFailure: boolean;
}): Error {
  const { lastState, lastTransientFailure, observedManifest, observedTransientFailure } = options;
  const timeoutSeconds = Math.ceil(options.timeoutMs / 1000);
  // Only claim the dispatch never landed when nothing else can explain the
  // silence: a manifest read that failed leaves the build state unknown for
  // that window, so it rules out the stronger claim even if later reads
  // succeeded and returned no row.
  const neverStarted = !observedManifest && !observedTransientFailure;
  return new Error(
    `Release assets were not ready within ${timeoutSeconds}s (last state: ${lastState}${
      lastTransientFailure === null ? "" : `; last control-plane failure: ${lastTransientFailure}`
    }). ${
      neverStarted
        ? RELEASE_ASSET_BUILD_NEVER_STARTED_HINT
        : "Check the release asset build and run deploy again."
    }`,
  );
}

async function readReleaseAssetManifestBeforeDeadline(options: {
  controlPlane: DeployControlPlane;
  projectSlug: string;
  releaseId: string;
  remainingMs: number;
  timeoutError: Error;
}): Promise<Awaited<ReturnType<DeployControlPlane["getReleaseAssetManifest"]>>> {
  const abortController = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(options.timeoutError);
      abortController.abort();
    }, options.remainingMs);
  });

  try {
    return await Promise.race([
      options.controlPlane.getReleaseAssetManifest(options.projectSlug, options.releaseId, {
        signal: abortController.signal,
      }),
      deadline,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function waitForReleaseAssetManifest(
  controlPlane: DeployControlPlane,
  projectSlug: string,
  releaseId: string,
  options: {
    expectedRoutes?: string[];
    pollIntervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<ReadyReleaseAssetManifestResponse> {
  const pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 2_000);
  const timeoutMs = Math.max(pollIntervalMs, options.timeoutMs ?? 120_000);
  const expectedRoutes = options.expectedRoutes ?? [];
  const deadline = Date.now() + timeoutMs;
  let lastState = "missing";
  let lastTransientFailure: string | null = null;
  let observedManifest = false;
  let observedTransientFailure = false;

  for (;;) {
    const remainingMs = deadline - Date.now();
    const timeoutError = releaseAssetPollingTimeoutError({
      timeoutMs,
      lastState,
      lastTransientFailure,
      observedManifest,
      observedTransientFailure,
    });
    if (remainingMs <= 0) throw timeoutError;

    let raw: Awaited<ReturnType<DeployControlPlane["getReleaseAssetManifest"]>> = null;
    try {
      raw = await readReleaseAssetManifestBeforeDeadline({
        controlPlane,
        projectSlug,
        releaseId,
        remainingMs,
        timeoutError,
      });
      lastTransientFailure = null;
      if (raw === null) lastState = "missing";
    } catch (error) {
      if (!isRetryableApiReadError(error)) throw error;
      const status = getErrorStatus(error);
      lastTransientFailure = status === undefined
        ? "a transient connection failure"
        : `HTTP ${status}`;
      observedTransientFailure = true;
    }
    if (raw !== null) {
      observedManifest = true;
      const state = readUntrustedOwnDataProperty(raw, "state");
      if (!isSafeBoundedText(state, MAX_MANIFEST_STATE_LENGTH)) {
        throw new Error(`Release assets for ${releaseId} returned an invalid state response`);
      }
      lastState = state;

      if (state === "ready") {
        const result = parseReadyReleaseAssetManifestResponse(raw, releaseId);
        if (!result) {
          // Naming the failing check matters: a schema mismatch is fixed by
          // deploying a matching framework build, while "rebuild the assets"
          // sends the operator to rebuild against the same mismatched builder.
          const reason = describeReadyReleaseAssetManifestRejection(raw, releaseId);
          throw DEPLOYMENT_ERROR.create({
            detail: `Release assets for ${releaseId} could not be read: ${reason}.`,
            context: { releaseId },
          });
        }
        assertReadyManifestCoversPageRoutes(releaseId, result, expectedRoutes);
        return result;
      }
      if (state === "partial") {
        throw DEPLOYMENT_ERROR.create({
          detail:
            `Release asset build produced an unsupported partial manifest for release ${releaseId}.`,
          context: { releaseId },
        });
      }
      if (state === "failed") {
        throw DEPLOYMENT_ERROR.create({
          detail: `Release asset build failed for release ${releaseId}.`,
          context: { releaseId },
        });
      }
      if (state === "superseded") {
        throw new Error(
          `Release assets for ${releaseId} were superseded by a newer build. Run deploy again.`,
        );
      }
      if (state !== "queued" && state !== "building") {
        throw new Error(
          `Release assets for ${releaseId} returned an unsupported state response: ${state}`,
        );
      }
    }

    await wait(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
}

/** The environment's own domain, or null when it has none configured. */
function configuredEnvironmentDomain(environment: DeployEnvironment): string | null {
  const domain = environment.domains?.[0];
  if (!domain) return null;
  return domain.startsWith("http://") || domain.startsWith("https://")
    ? domain
    : `https://${domain}`;
}

/**
 * Rejects an environment whose name has no address the deploy could ever reach.
 *
 * The hosted URL is synthesised as `{slug}.{environment}.veryfront.com`, which
 * only resolves for the labels in `HOSTED_ENVIRONMENT_NAMES`. Any other label —
 * `development`, `qa`, anything an operator invented in Studio — has no wildcard
 * certificate and no routing rule, so the readiness probe cannot succeed: it
 * fails the TLS handshake, or the proxy answers `404 No project configured for
 * domain`. Both are retried as transient, so without this check the deploy
 * pushes source, builds assets, commits a deployment, and only then spends the
 * full readiness window before failing with a message about the deployment.
 *
 * A configured custom domain removes the constraint entirely — routing then has
 * nothing to do with the environment's name — so this only guards the fallback.
 *
 * Call this only for a deploy that will actually ask for that address. A project
 * with no static page route probes nothing, so its name never has to resolve.
 */
function assertEnvironmentIsReachable(environment: DeployEnvironment): void {
  if (configuredEnvironmentDomain(environment) !== null) return;
  if (isHostedEnvironmentName(environment.name)) return;

  throw ENVIRONMENT_NOT_ROUTABLE.create({
    detail: `Environment "${environment.name}" has no Veryfront-hosted address. ` +
      `Veryfront serves ${
        HOSTED_ENVIRONMENT_NAMES.join(", ")
      } at https://<slug>.<environment>.veryfront.com; ` +
      `no other environment name resolves. Deploy to one of those, or attach a custom domain ` +
      `to "${environment.name}" in Studio under Environments and deploy again.`,
    context: { environmentName: environment.name, hostedEnvironments: HOSTED_ENVIRONMENT_NAMES },
  });
}

function buildEnvironmentUrl(projectSlug: string, environment: DeployEnvironment): string {
  return configuredEnvironmentDomain(environment) ??
    buildCanonicalEnvironmentUrl(projectSlug, environment.name);
}

function buildCanonicalEnvironmentUrl(projectSlug: string, environmentName: string): string {
  return `https://${projectSlug}.${environmentName}.veryfront.com`;
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

interface EnvironmentReadinessTarget {
  projectSlug: string;
  environmentName: string;
  url: string;
  route?: string | null;
  protected: boolean;
  apiToken: string;
  /**
   * A token bound to this environment, obtained by exchanging `apiToken`, and
   * sent to the gate in its place. Not a session: the API refuses it as one.
   */
  environmentAccessToken?: string;
}

interface EnvironmentReadinessProbe {
  url: string;
  authenticate: boolean;
  acceptAuthenticationChallenge: boolean;
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

const MAX_JWT_SEGMENT_CODE_UNITS = 8 * 1024;

/** Decode one base64url JWT segment into a plain object, or null if it is not one. */
function decodeJwtSegment(segment: string | undefined): object | null {
  if (segment === undefined) return null;
  if (segment.length === 0 || segment.length > MAX_JWT_SEGMENT_CODE_UNITS) return null;
  try {
    const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Whether a stored credential could satisfy the protected-environment gate.
 *
 * The gate reads `userId` from the verified JWT payload and has no API-key
 * branch, so presenting an opaque key only leaks it. Reads what the gate
 * reads, and withholds anything it cannot recognise.
 */
function isSessionCredential(apiToken: string): boolean {
  const segments = apiToken.split(".");
  if (segments.length !== 3) return false;

  const header = decodeJwtSegment(segments[0]);
  if (header === null || typeof readUntrustedOwnDataProperty(header, "alg") !== "string") {
    return false;
  }

  const payload = decodeJwtSegment(segments[1]);
  if (payload === null) return false;
  const userId = readUntrustedOwnDataProperty(payload, "userId");
  return typeof userId === "string" && userId.length > 0;
}

function buildEnvironmentReadinessProbes(
  target: EnvironmentReadinessTarget,
): EnvironmentReadinessProbe[] {
  const route = target.route === undefined ? "/" : target.route;
  if (route === null) return [];

  // Without a session credential the probe cannot get past the gate. Its
  // challenge still proves routing resolves and the proxy is serving this
  // environment — the most this step can establish, and the deployment it
  // would otherwise fail is already committed and verified. Same allowance the
  // protected custom-domain probe below already makes.
  const canAuthenticate = isSessionCredential(target.environmentAccessToken ?? target.apiToken);
  // A gate that refuses an exchanged token says something about the key
  // owner's access, not about the app. The deployment is already committed, so
  // that reads as gated rather than failing the deploy.
  const tolerateChallenge = !canAuthenticate || target.environmentAccessToken !== undefined;

  const targetUrl = buildEnvironmentProbeUrl(target.url, route);
  if (target.protected && !isMatchingVeryfrontHostedUrl(new URL(targetUrl), target)) {
    const challengeProbe = {
      url: targetUrl,
      authenticate: false,
      acceptAuthenticationChallenge: true,
    };
    // The canonical companion probe only exists where the platform routes it.
    // An environment on a custom domain may be named anything, and synthesising
    // an address for a name hosting cannot serve would poll an unreachable host
    // to the deadline after the custom domain has already answered.
    if (!isHostedEnvironmentName(target.environmentName)) return [challengeProbe];
    return [
      challengeProbe,
      {
        url: buildEnvironmentProbeUrl(
          buildCanonicalEnvironmentUrl(target.projectSlug, target.environmentName),
          route,
        ),
        authenticate: canAuthenticate,
        acceptAuthenticationChallenge: tolerateChallenge,
      },
    ];
  }
  return [{
    url: target.protected ? secureEnvironmentProbeUrl(targetUrl) : targetUrl,
    authenticate: target.protected && canAuthenticate,
    acceptAuthenticationChallenge: target.protected && tolerateChallenge,
  }];
}

/**
 * Why no environment access token could be obtained. A bounded class, never the
 * server's words: the warning that names it is operator-facing output.
 */
type EnvironmentAccessFailure =
  | "unsupported"
  | "refused"
  | "rate_limited"
  | "unreachable"
  | "unusable";

/** What the deploy could obtain to probe past a protected environment's gate. */
type EnvironmentAccess =
  | { kind: "session" }
  | { kind: "exchanged"; token: string }
  | { kind: "unavailable"; failure: EnvironmentAccessFailure; status?: number };

function classifyEnvironmentAccessFailure(error: unknown): EnvironmentAccess {
  const status = getErrorStatus(error);
  if (status === 404 || status === 405 || status === 501) {
    return { kind: "unavailable", failure: "unsupported", status };
  }
  if (status === 401 || status === 403) return { kind: "unavailable", failure: "refused", status };
  if (status === 429) return { kind: "unavailable", failure: "rate_limited", status };
  return { kind: "unavailable", failure: "unreachable", ...(status ? { status } : {}) };
}

/**
 * An API key cannot pass the gate, but the API can exchange it for a token
 * bound to this environment that does. Failing to obtain one must not fail a
 * committed deploy: the probe then establishes what it always could, that the
 * gate answers.
 */
async function resolveEnvironmentAccess(
  controlPlane: DeployControlPlane,
  apiToken: string,
  target: EnvironmentAccessTarget,
): Promise<EnvironmentAccess> {
  if (isSessionCredential(apiToken)) return { kind: "session" };
  try {
    const credential = await controlPlane.createEnvironmentAccessToken(target);
    if (!isSessionCredential(credential.accessToken)) {
      return { kind: "unavailable", failure: "unusable" };
    }
    return { kind: "exchanged", token: credential.accessToken };
  } catch (error) {
    return classifyEnvironmentAccessFailure(error);
  }
}

function describeEnvironmentAccessFailure(
  access: Extract<EnvironmentAccess, { kind: "unavailable" }>,
): string {
  const status = access.status === undefined ? "" : ` (HTTP ${access.status})`;
  switch (access.failure) {
    case "unsupported":
      return `the Cloud API does not offer the environment access token exchange${status}`;
    case "refused":
      return `the Cloud API refused to issue an environment access token for this API key${status}`;
    case "rate_limited":
      return `the Cloud API rate limited the environment access token exchange${status}`;
    case "unusable":
      return "the Cloud API returned a token the gate cannot read";
    case "unreachable":
      return `the environment access token exchange did not complete${status}`;
  }
}

function isVeryfrontSignInUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (hostname === "veryfront.com" || hostname === "veryfront.org") &&
    (url.pathname === "/sign-in" || url.pathname.startsWith("/sign-in/"));
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

/** A challenge is a sign-in redirect, a 401, or a 403; say which one arrived. */
function describeAuthenticationChallenge(
  probe: EnvironmentReadinessProbe,
  status: number,
  signInRedirect: boolean,
): string {
  if (probe.authenticate) {
    return `Could not authenticate the protected environment URL ${probe.url}. Run veryfront login and deploy again.`;
  }
  if (signInRedirect) {
    return `Environment URL ${probe.url} redirected to sign-in. Check its protection settings and deploy again.`;
  }
  return `Environment URL ${probe.url} returned HTTP ${status}. Check its protection settings and deploy again.`;
}

function isTransientEnvironmentStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Readiness does not depend on response payload cleanup.
  }
}

/**
 * What the readiness step actually established about the environment URL.
 *
 * `served` is the only outcome in which the app itself was observed answering.
 * A protected environment challenges an unauthenticated probe at the access
 * gate, and this CLI cannot get past that gate holding an API key rather than a
 * session, so `gated` means routing resolves and nothing more: the app behind
 * it may be answering 503 to every signed-in visitor. Reporting the two the
 * same way is what lets a broken deployment finish with a green tick.
 */
export type EnvironmentReadiness =
  | Readonly<{ kind: "served" }>
  | Readonly<{ kind: "unprobed" }>
  | Readonly<{ kind: "gated"; url: string; status: number }>;

export async function waitForEnvironmentReady(
  target: EnvironmentReadinessTarget,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<EnvironmentReadiness> {
  const pollIntervalMs = options.pollIntervalMs === undefined ||
      !Number.isFinite(options.pollIntervalMs)
    ? DEFAULT_ENVIRONMENT_POLL_INTERVAL_MS
    : Math.max(1, Math.trunc(options.pollIntervalMs));
  const timeoutMs = options.timeoutMs === undefined || !Number.isFinite(options.timeoutMs)
    ? DEFAULT_ENVIRONMENT_TIMEOUT_MS
    : Math.max(1, Math.trunc(options.timeoutMs));
  const deadline = Date.now() + timeoutMs;
  const probes = buildEnvironmentReadinessProbes(target);
  let servedBy: EnvironmentReadiness | null = null;
  let gatedBy: EnvironmentReadiness | null = null;

  for (const probe of probes) {
    const headers = new Headers({ "Cache-Control": "no-cache" });
    if (probe.authenticate) {
      headers.set("Cookie", `authToken=${target.environmentAccessToken ?? target.apiToken}`);
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
        const served = response.status >= 200 && response.status < 300 ||
          response.status >= 300 && response.status < 400 && !signInRedirect;
        const gated = !served && probe.acceptAuthenticationChallenge && authenticationChallenge;
        const ready = served || gated;
        await cancelResponseBody(response);

        if (ready) {
          if (served) servedBy = { kind: "served" };
          else if (gated && !gatedBy) {
            gatedBy = { kind: "gated", url: probe.url, status: response.status };
          }
          break;
        }
        if (authenticationChallenge) {
          // A bare Error here reaches the operator as `unknown-error`.
          throw DEPLOYMENT_ERROR.create({
            detail: describeAuthenticationChallenge(probe, response.status, signInRedirect),
            context: { url: probe.url, status: response.status },
          });
        }
        if (!isTransientEnvironmentStatus(response.status)) {
          throw DEPLOYMENT_ERROR.create({
            detail:
              `Environment URL ${probe.url} returned HTTP ${response.status}. Check the environment configuration and deploy again.`,
            context: { url: probe.url, status: response.status },
          });
        }
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw DEPLOYMENT_ERROR.create({
          detail: `Environment URL ${probe.url} did not become ready within ${
            Math.ceil(timeoutMs / 1000)
          }s (last response: ${lastResponse}). Check the deployment and run deploy again.`,
          context: { url: probe.url, timeoutMs },
        });
      }
      await wait(Math.min(pollIntervalMs, remainingMs));
    }
  }

  // Order matters: one probe seeing the app answer outweighs another that only
  // reached the gate. With no probe at all, or, unreachably, a loop that neither
  // broke nor threw, the honest answer is that nothing was checked, never that
  // the app served.
  if (servedBy) return servedBy;
  if (gatedBy) return gatedBy;
  return { kind: "unprobed" };
}

/**
 * The remedy that actually changes the probe credential for this token source.
 *
 * `veryfront login` only helps when nothing outranks the stored session.
 * `resolveApiTokenForMode` in `cli/shared/config.ts` resolves a shell
 * `VERYFRONT_API_TOKEN` and a `veryfront.json` `apiToken` ahead of the token
 * store, so for those two sources signing in leaves the next deploy gated the
 * same way. Naming the overriding key is the only step an operator can act on.
 */
function getProbeCredentialRemedy(source: ResolvedConfig["apiTokenSource"]): string {
  if (source === "env") {
    return "VERYFRONT_API_TOKEN is set in this shell and is resolved ahead of any stored session, so veryfront login does not change what the probe sends. Open the URL signed in, or unset that variable, run veryfront login, and deploy again, to confirm the app responds.";
  }
  if (source === "config-file") {
    return "The apiToken in veryfront.json is resolved ahead of any stored session, so veryfront login does not change what the probe sends. Open the URL signed in, or remove that token, run veryfront login, and deploy again, to confirm the app responds.";
  }
  return "Open the URL signed in, or run veryfront login and deploy again, to confirm the app responds.";
}

/**
 * The signal a deploy owes an operator when it never saw the app answer.
 *
 * Failing here is wrong, because the deployment is committed and verified, and
 * a protected environment challenging an API key is the expected case for CI.
 * Reporting it as a verified URL is what let a permanently-503 app deploy with
 * a green tick and no signal at all.
 */
function getEnvironmentUrlWarning(
  readiness: EnvironmentReadiness,
  apiTokenSource: ResolvedConfig["apiTokenSource"],
  access: EnvironmentAccess,
): string | null {
  if (readiness.kind !== "gated") return null;
  const prefix = `Deployment committed, but ${readiness.url} was never observed serving this app:`;
  if (access.kind === "exchanged") {
    return `${prefix} the access gate refused the environment access token with HTTP ${readiness.status}. Check that the API key owner is a member of this project, or open the URL signed in, to confirm the app responds.`;
  }
  if (access.kind === "unavailable") {
    const remedy = access.failure === "refused"
      ? "Use an API key for this project whose owner can read it, or open the URL signed in, to confirm the app responds."
      : getProbeCredentialRemedy(apiTokenSource);
    return `${prefix} the access gate answered HTTP ${readiness.status} and ${
      describeEnvironmentAccessFailure(access)
    }. ${remedy}`;
  }
  return `${prefix} the access gate answered HTTP ${readiness.status} and this CLI has no session credential to probe past it. ${
    getProbeCredentialRemedy(apiTokenSource)
  }`;
}

function getDeploymentRoutingConvergenceWarning(deployment: DeployDeployment): string | null {
  const convergence = deployment.routingConvergence;
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

function createDeployResult({
  verification,
  release,
  environment,
  deployment,
  environmentUrl,
  readiness,
  config,
  branch,
}: {
  verification: DeploymentVerification;
  release: DeployRelease;
  environment: DeployEnvironment;
  deployment: DeployDeployment;
  environmentUrl: string;
  readiness: EnvironmentReadiness;
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
    urlVerification: readiness.kind,
    protected: environment.protected,
    routingConvergence: deployment.routingConvergence as DeploymentRoutingConvergence | undefined ??
      null,
    commitSha: verification.commitSha,
    sourceDigest: verification.sourceDigest,
    controlPlane: controlPlaneFromConfig(config),
    branch,
  };
}

function controlPlaneFromConfig(config: ResolvedConfig): string {
  const url = new URL(config.apiUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

function dryRunPlan(input: {
  branch: string;
  project: ProjectTarget | null;
  projectSlug: string;
  environmentName: string;
  environment: DeployEnvironment | null;
  controlPlane: DeployControlPlane;
  bootstrapPush: boolean;
}): DeployPlan {
  return {
    branch: input.branch,
    projectId: input.project?.id ?? null,
    projectSlug: input.project?.slug ?? input.projectSlug,
    environment: input.environmentName,
    environmentId: input.environment?.id ?? null,
    controlPlane: input.controlPlane.controlPlane,
    plannedActions: [
      ...(input.project ? [] : ["create-project" as const]),
      ...(input.bootstrapPush ? ["push-source" as const] : []),
      "create-release",
      "deploy",
    ],
  };
}

export function createDeployProject(options: {
  polling?: DeployPollingPolicy;
  controlPlaneFactory?: (config: ResolvedConfig) => DeployControlPlane;
} = {}): DeployProject {
  const polling = options.polling ?? {};
  const createControlPlane = options.controlPlaneFactory ?? createHttpDeployControlPlane;

  return {
    async execute(unresolvedRequest, observer) {
      const request = {
        ...unresolvedRequest,
        projectDir: resolve(unresolvedRequest.projectDir),
      };
      if (request.projectSlug && request.source.kind === "ensure-pushed") {
        throw DEPLOYMENT_ERROR.create({
          detail:
            `An explicit projectSlug requires source { kind: "already-pushed" }: request-scoped deploys never push local sources. Run veryfront push first, or omit projectSlug to deploy the locally configured project.`,
        });
      }
      const environmentConfig = await step(
        observer,
        "resolve-config",
        async () => {
          // Naming a project deploys what that project already has, so the
          // working directory is not the source under review and its config
          // must not decide this deploy.
          if (request.projectSlug === undefined) {
            await assertConfigIsDeployable(request.projectDir);
          }
          return await getEnvironmentConfig();
        },
      );
      const receipt = await readPushReceipt(request.projectDir);
      const branch = request.branch ?? "main";
      const setup = await ensureProjectLinkedForDeploy(
        request.projectDir,
        environmentConfig,
        receipt,
        request.mode,
        createControlPlane,
        request.projectSlug,
      );
      let { config, controlPlane, project } = setup;
      const bootstrapPushKind = await resolveBootstrapPush(
        receipt,
        request.source,
        request.projectDir,
        {
          controlPlane: config.apiUrl,
          branch,
          projectId: project?.id ?? null,
          projectSlug: project?.slug ?? null,
        },
      );
      const bootstrapPush = bootstrapPushKind !== "none";

      if (request.mode === "dry-run" && !project) {
        return {
          kind: "dry-run",
          plan: dryRunPlan({
            branch,
            project,
            projectSlug: setup.plannedProjectSlug,
            environmentName: request.environment,
            environment: null,
            controlPlane,
            bootstrapPush,
          }),
        };
      }

      if (bootstrapPush) {
        await step(observer, "push-source", async () => {
          await pushCommand({
            projectDir: request.projectDir,
            branch,
            // Only the very first push of a project has no receipt to
            // reconcile against, so only it may write the branch outright.
            // Refreshing an established push keeps the normal remote-conflict
            // checks, or a collaborator's edit to an untouched file would be
            // overwritten by an unrelated local one; and it prunes source that
            // disappeared locally, or the deleted file would stay in the
            // upload and be deployed as live.
            force: bootstrapPushKind === "bootstrap",
            prune: bootstrapPushKind === "refresh",
            dryRun: request.mode === "dry-run",
            quiet: true,
          });
        });
        config = await resolveConfigWithAuth(request.projectDir, environmentConfig);
        controlPlane = createControlPlane(config);
      }

      // Read from the project directory, before the environment is resolved,
      // because whether this deploy needs a hosted address at all decides
      // whether an unroutable environment name is fatal to it.
      const expectedPageRoutes = await collectProjectPageRoutes(request.projectDir);
      const readinessRoute = expectedPageRoutes.find((route) => !route.includes("[")) ?? null;

      const environment = await step(observer, "resolve-target", async () => {
        if (!project) project = await controlPlane.getProject(projectApiReference(config));
        const resolvedEnvironment = await controlPlane.getEnvironment(
          project.id,
          request.environment,
        );
        if (!resolvedEnvironment) {
          throw ENVIRONMENT_NOT_FOUND.create({
            detail: `Environment "${request.environment}" not found`,
          });
        }
        assertProjectOwnership("Environment", resolvedEnvironment, project.id);
        // Only a deploy that will ask the platform for a page address depends on
        // the name resolving. A project with no static page route sends no
        // readiness probe at all, so its deploy never touches the synthesised
        // host and must not be refused for a name it never resolves. When the
        // address is needed this still runs before any release or deployment
        // exists, so an unreachable target costs one API call rather than a full
        // deploy and a readiness window.
        if (readinessRoute !== null) assertEnvironmentIsReachable(resolvedEnvironment);
        return resolvedEnvironment;
      });

      if (request.mode === "dry-run") {
        // Naming a project also makes the source already-pushed, which would
        // otherwise skip this check: the dry run then reported a deploy that
        // the byte-identical apply refused, because the apply compares the
        // receipt against the named project. `--skip-source-push` keeps its
        // existing dry-run behaviour; the caller has said the source is handled.
        if (
          !bootstrapPush &&
          (request.source.kind === "ensure-pushed" || request.projectSlug !== undefined)
        ) {
          await resolvePushedSource({
            projectDir: request.projectDir,
            controlPlane: config.apiUrl,
            projectId: project!.id,
            projectSlug: project!.slug,
            branch,
          });
        }
        return {
          kind: "dry-run",
          plan: dryRunPlan({
            branch,
            project,
            projectSlug: setup.plannedProjectSlug,
            environmentName: request.environment,
            environment,
            controlPlane,
            bootstrapPush,
          }),
        };
      }

      const source = await step(observer, "verify-source", async () =>
        resolvePushedSource({
          projectDir: request.projectDir,
          controlPlane: config.apiUrl,
          projectId: project!.id,
          projectSlug: project!.slug,
          branch,
        }));

      const release = await step(observer, "create-release", async () => {
        const created = await controlPlane.createRelease(project!.id, {
          ...(request.releaseName ? { name: request.releaseName } : {}),
          branch,
        });
        if (!created.version) {
          throw RELEASE_MISSING_VERSION.create({ detail: `Release ${created.id} has no version` });
        }
        return created;
      });

      const verifiedRelease = await step(
        observer,
        "verify-release-source",
        async () =>
          verifyReleaseSource(controlPlane, project!.id, {
            projectId: project!.id,
            releaseId: release.id,
            releaseName: release.name,
            commitSha: source.commitSha,
            sourceDigest: source.sourceDigest,
          }),
      );

      await step(observer, "wait-release-assets", async () => {
        await waitForReleaseAssetManifest(controlPlane, project!.slug, release.id, {
          expectedRoutes: expectedPageRoutes,
          pollIntervalMs: polling.assetManifestPollIntervalMs,
          timeoutMs: polling.assetManifestTimeoutMs,
        });
      });

      const deployment = await step(
        observer,
        "create-deployment",
        async () =>
          controlPlane.createDeployment(project!.id, {
            releaseId: release.id,
            environmentId: environment.id,
          }),
      );

      const verification = await step(
        observer,
        "verify-deployment",
        async () =>
          verifyDeployment(controlPlane, project!.id, {
            projectId: project!.id,
            projectSlug: project!.slug,
            environmentId: environment.id,
            environmentName: request.environment,
            releaseId: release.id,
            releaseName: release.name,
            deploymentId: deployment.id,
            commitSha: source.commitSha,
            sourceDigest: source.sourceDigest,
          }, { verifiedRelease }),
      );

      const environmentUrl = buildReadyEnvironmentUrl(
        buildEnvironmentUrl(verification.projectSlug, environment),
        readinessRoute,
      );
      let access: EnvironmentAccess = { kind: "session" };
      const readiness = await step(
        observer,
        "wait-environment-url",
        async () => {
          if (environment.protected) {
            access = await resolveEnvironmentAccess(controlPlane, config.apiToken, {
              projectId: project!.id,
              environmentName: environment.name,
            });
          }
          return waitForEnvironmentReady({
            projectSlug: verification.projectSlug,
            environmentName: environment.name,
            url: environmentUrl,
            route: readinessRoute,
            protected: environment.protected,
            apiToken: config.apiToken,
            ...(access.kind === "exchanged" ? { environmentAccessToken: access.token } : {}),
          }, {
            pollIntervalMs: polling.environmentPollIntervalMs,
            timeoutMs: polling.environmentTimeoutMs,
          });
        },
      );

      const urlWarning = getEnvironmentUrlWarning(readiness, config.apiTokenSource, access);
      if (urlWarning) {
        await emit(observer, {
          kind: "warning",
          code: "environment-url-unverified",
          message: urlWarning,
        });
      }

      const warning = getDeploymentRoutingConvergenceWarning(deployment);
      if (warning) {
        await emit(observer, {
          kind: "warning",
          code: "routing-convergence-unconfirmed",
          message: warning,
        });
      }

      return {
        kind: "deployed",
        result: createDeployResult({
          verification,
          release,
          environment,
          deployment,
          environmentUrl,
          readiness,
          config,
          branch,
        }),
      };
    },
  };
}
