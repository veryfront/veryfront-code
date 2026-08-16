/**
 * Push command - Upload local project files to a Veryfront branch
 *
 * Scans local files and uploads them to the API using relative paths.
 * Creates a branch when the requested branch does not already exist.
 *
 * @module cli/commands/push
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { join, relative } from "veryfront/platform/path";
import { cliLogger } from "#cli/utils";
import { cwd } from "veryfront/platform";
import { createFileSystem } from "veryfront/platform";
import {
  type ApiClient,
  createApiClient,
  type ProjectReferenceSource,
  resolveConfigWithAuthDetails,
  type ResolvedConfig,
} from "#cli/shared/config";
import {
  canPersistAlternativeSlug,
  getErrorStatus,
  projectApiReference,
  ProjectReferenceNotFoundError,
  type ProjectResolutionClient,
  type ProjectResolutionOutcome,
  resolveOrCreateProject,
  shouldPersistProjectLink,
  slugConflictAction,
} from "#cli/shared/project-resolution";
import { ProjectSlugConflictError, reserveProjectSlug } from "#cli/shared/reserve-slug";
import { isVerbose, logInfo, logSuccess } from "#cli/utils";
import { INVALID_ARGUMENT, PREVIEW_HOSTNAME_TOO_LONG, PUSH_CONFLICT } from "veryfront/errors";
import { brand, createNoopSpinner, createSpinner, formatDuration } from "#cli/ui";
import { withSpan } from "veryfront/observability/otlp-setup";
import { createIgnoreChecker, type IgnoreChecker, loadIgnorePatterns } from "../../sync/ignore.ts";
import { listAllFiles, type PullSource } from "../pull/index.ts";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import { isNotFoundError, lstat } from "veryfront/fs";
import {
  areSourceFilesTracked,
  clearPushReceipt,
  computeSourceDigest,
  getProjectTarget,
  type GitSource,
  normalizeControlPlane,
  resolveGitSource,
  writePushReceipt,
} from "../../shared/deployment-provenance.ts";
import { buildStudioUrl } from "../studio/command.ts";
import { isJsonMode, streamJsonLine } from "../../shared/json-output.ts";
import { type PlannedDelete, type PlannedUpload, planPushChanges } from "./plan.ts";
import { preflightSyncState, readSyncTarget, writeSyncTarget } from "../../sync/state.ts";

const PREVIEW_BRANCH_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const BRANCH_SUFFIX_LENGTH = 6;
const PREVIEW_BRANCH_ERROR =
  "Preview branches must use 1-63 lowercase letters, numbers, or hyphens.";

/**
 * Schema factory for push command arguments
 */
export const getPushArgsSchema = defineSchema((v) =>
  v.object({
    projectSlug: v.string().optional(),
    projectDir: v.string().optional(),
    branch: v.string().regex(PREVIEW_BRANCH_PATTERN, PREVIEW_BRANCH_ERROR).default("main"),
    /** Intentionally overwrite remote changes and bypass concurrency guards. */
    force: v.boolean().default(false),
    prune: v.boolean().default(false),
    dryRun: v.boolean().default(false),
    quiet: v.boolean().default(false),
  })
);

export const PushArgsSchema = lazySchema(getPushArgsSchema);

export type PushArgs = InferSchema<ReturnType<typeof getPushArgsSchema>>;

/**
 * Parse push command arguments from CLI args
 */
const parseKnownPushArgs = createArgParser(PushArgsSchema, {
  projectSlug: { ...CommonArgs.projectSlug, positional: 0 },
  projectDir: CommonArgs.projectDir,
  branch: CommonArgs.branch,
  force: CommonArgs.force,
  prune: { keys: ["prune"], type: "boolean" },
  dryRun: CommonArgs.dryRun,
  quiet: CommonArgs.quiet,
});

export function parsePushArgs(
  args: Parameters<typeof parseKnownPushArgs>[0],
): ReturnType<typeof parseKnownPushArgs> {
  if (Object.hasOwn(args, "delete")) {
    return {
      success: false,
      error: Object.assign(
        new Error("Unknown push option: --delete. Use --prune."),
        { issues: [] },
      ),
    };
  }
  return parseKnownPushArgs(args);
}

/**
 * Push command options
 */
export interface PushOptions {
  /** Project slug to push to (overrides config) */
  projectSlug?: string;
  /** Project directory (defaults to cwd) */
  projectDir?: string;
  /** Branch name to update (defaults to main) */
  branch?: string;
  /** Intentionally overwrite remote changes and bypass concurrency guards. */
  force?: boolean;
  /** Prune remote files that are missing locally. */
  prune?: boolean;
  /** Dry run - show what would be uploaded without uploading */
  dryRun?: boolean;
  /** Quiet mode - suppress spinner/progress output */
  quiet?: boolean;
}

/**
 * File upload operation
 */
export interface UploadOp extends PlannedUpload {
  /** Relative path from project root (sent to API) */
  path: string;
  content: string;
}

export interface PushSourceSnapshot {
  files: UploadOp[];
  gitSource: GitSource;
  sourceDigest: string;
}

/**
 * API response for branch creation
 */
export interface BranchResponse {
  id: string;
  name: string;
  projectId: string;
}

interface BranchListItem {
  id: string;
  name: string;
}

interface EnsuredBranch extends BranchListItem {
  created: boolean;
}

interface PushRemoteTarget {
  branchId: string | null;
  remoteFiles: RemoteFile[];
  source: PullSource;
  branchExists: boolean;
}

interface ListBranchesResponse {
  data: BranchListItem[];
  page_info?: {
    next?: string;
  };
}

interface RemoteFile {
  path: string;
  content?: string;
  version_id?: string;
}

export async function scanLocalFiles(
  projectDir: string,
  ignoreChecker: IgnoreChecker,
): Promise<UploadOp[]> {
  const fs = createFileSystem();
  const ops: UploadOp[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readDir(currentDir);

    for await (const entry of entries) {
      const entryPath = join(currentDir, entry.name);
      const relativePath = relative(projectDir, entryPath);

      if (ignoreChecker.isIgnored(relativePath)) continue;

      if (entry.isSymlink) {
        if (ignoreChecker.isSupportedExtension(entry.name)) {
          throw INVALID_ARGUMENT.create({
            detail:
              `Veryfront push does not support symbolic links: "${relativePath}". Replace the link with a file and run veryfront push again.`,
          });
        }
        continue;
      }

      if (entry.isDirectory) {
        await walk(entryPath);
        continue;
      }

      if (!ignoreChecker.isSupportedExtension(entry.name)) continue;

      const content = await fs.readTextFile(entryPath);
      ops.push({ path: relativePath, content });
    }
  }

  await walk(projectDir);
  return ops;
}

function gitSourcesMatch(left: GitSource, right: GitSource): boolean {
  return left.commitSha === right.commitSha && left.clean === right.clean;
}

function sourceSnapshotsMatch(
  left: PushSourceSnapshot,
  right: PushSourceSnapshot,
): boolean {
  return gitSourcesMatch(left.gitSource, right.gitSource) &&
    left.sourceDigest === right.sourceDigest;
}

function sourceChangedError(): Error {
  return new Error("Local source changed during push. Run veryfront push again.");
}

function projectSlugConflictError(
  error: ProjectSlugConflictError,
  source: ProjectReferenceSource,
): Error {
  return new Error(
    `${error.message} ${slugConflictAction(source)}, then run veryfront push again.`,
  );
}

async function sourceFilesForGitTracking(
  projectDir: string,
  files: readonly UploadOp[],
): Promise<readonly UploadOp[]> {
  const ignorePath = join(projectDir, ".vfignore");
  let ignoreInfo;
  try {
    ignoreInfo = await lstat(ignorePath);
  } catch (error) {
    if (isNotFoundError(error)) return files;
    throw error;
  }

  if (ignoreInfo.isSymlink || !ignoreInfo.isFile) {
    throw INVALID_ARGUMENT.create({
      detail: ".vfignore must be a regular file inside the project and cannot be a symbolic link.",
    });
  }

  return [...files, { path: ".vfignore", content: "" }];
}

export async function capturePushSourceSnapshot(
  projectDir: string,
  ignoreChecker: IgnoreChecker,
): Promise<PushSourceSnapshot> {
  const gitSourceBefore = await resolveGitSource(projectDir);
  const files = await scanLocalFiles(projectDir, ignoreChecker);
  const trackedSourceFiles = await sourceFilesForGitTracking(projectDir, files);
  const [sourceDigest, filesTracked] = await Promise.all([
    computeSourceDigest(files),
    areSourceFilesTracked(projectDir, trackedSourceFiles),
  ]);
  const gitSource = await resolveGitSource(projectDir);

  if (!gitSourcesMatch(gitSourceBefore, gitSource)) throw sourceChangedError();
  return {
    files,
    gitSource: { ...gitSource, clean: gitSource.clean && filesTracked },
    sourceDigest,
  };
}

/**
 * Build a timestamped isolation branch name for pushes that are staged for review.
 *
 * The timestamp has one-second resolution, so it alone lets two pushes started in
 * the same second share a branch and the second upload land on top of the first's
 * staged work. The random suffix separates them. Both stay lowercase alphanumeric
 * so the name is inside {@link PREVIEW_BRANCH_PATTERN} and can round-trip through
 * preview DNS.
 */
export function generateBranchName(): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "").toLowerCase();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, BRANCH_SUFFIX_LENGTH);
  return `push-${timestamp}-${suffix}`;
}

/**
 * Push options for programmatic callers (TUI shortcuts) that stage work for review.
 *
 * These callers never prompt, so they must not target main: the branch is what makes
 * "merge in Studio" true rather than an in-place overwrite of the project's main.
 */
export function createStagedPushOptions(projectSlug: string, projectDir: string): PushOptions {
  return {
    projectSlug,
    projectDir,
    branch: generateBranchName(),
    force: true,
    quiet: true,
  };
}

function suggestPreviewBranchName(branchName: string): string {
  return branchName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "") || "preview";
}

function assertPreviewBranchName(branchName: string): void {
  if (PREVIEW_BRANCH_PATTERN.test(branchName)) return;

  throw INVALID_ARGUMENT.create({
    detail: `Preview branch "${branchName}" is not DNS-safe. Use "${
      suggestPreviewBranchName(branchName)
    }" instead.`,
  });
}

export function buildPushUrls(
  projectSlug: string,
  branchName: string,
): { studio: string; preview: string } {
  assertPreviewBranchName(branchName);
  const previewLabel = branchName === "main" ? projectSlug : `${projectSlug}--${branchName}`;
  if (previewLabel.length > 63) {
    throw PREVIEW_HOSTNAME_TOO_LONG.create({
      detail: "Preview hostname is too long. Shorten the project slug or branch name.",
    });
  }
  const preview = `https://${previewLabel}.preview.veryfront.com`;

  return {
    studio: buildStudioUrl(projectSlug, { branch: branchName }),
    preview,
  };
}

function outputPushResult(
  projectSlug: string,
  branchName: string,
  uploaded: number,
  deleted: number,
  duration?: number,
): void {
  const urls = buildPushUrls(projectSlug, branchName);

  if (isJsonMode()) {
    streamJsonLine({
      type: "result",
      success: true,
      data: {
        projectSlug,
        branch: branchName,
        dryRun: false,
        uploaded,
        deleted,
        studioUrl: urls.studio,
        previewUrl: urls.preview,
      },
    });
    return;
  }

  const changes = [
    ...(uploaded > 0 ? [`${uploaded} uploaded`] : []),
    ...(deleted > 0 ? [`${deleted} deleted`] : []),
  ];
  const target = branchName === "main" ? "main" : `branch "${branchName}"`;
  const durationSuffix = duration !== undefined ? ` in ${formatDuration(duration)}` : "";
  logSuccess(
    changes.length > 0
      ? `Pushed to ${target}${durationSuffix}: ${changes.join(", ")}.`
      : `${target === "main" ? "Main" : `Branch "${branchName}"`} is up to date${durationSuffix}.`,
  );
  console.log();
  console.log(`  Studio:  ${brand(urls.studio)}`);
  console.log(`  Preview: ${brand(urls.preview)}`);
  console.log();
}

function outputPushDryRunResult(
  projectSlug: string,
  branchName: string,
  projectExists: boolean,
  wouldUpload: number,
  wouldDelete: number,
): void {
  const urls = buildPushUrls(projectSlug, branchName);
  streamJsonLine({
    type: "result",
    success: true,
    data: {
      projectSlug,
      branch: branchName,
      dryRun: true,
      projectExists,
      wouldUpload,
      wouldDelete,
      studioUrl: projectExists ? urls.studio : null,
      previewUrl: projectExists ? urls.preview : null,
    },
  });
}

export function createBranch(
  client: ApiClient,
  projectSlug: string,
  branchName: string,
): Promise<BranchResponse> {
  return client.post<BranchResponse>(`/projects/${encodeURIComponent(projectSlug)}/branches`, {
    name: branchName,
  });
}

async function getBranchByName(
  client: ApiClient,
  projectSlug: string,
  branchName: string,
): Promise<BranchListItem | null> {
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = {
      search: branchName,
      limit: "100",
      ...(cursor ? { cursor } : {}),
    };

    const response = await client.get<ListBranchesResponse>(
      `/projects/${encodeURIComponent(projectSlug)}/branches`,
      params,
    );

    const branch = response.data.find((candidate) => candidate.name === branchName);
    if (branch) return branch;

    cursor = response.page_info?.next;
  } while (cursor);

  return null;
}

export async function ensureBranch(
  client: ApiClient,
  projectSlug: string,
  branchName: string,
): Promise<EnsuredBranch> {
  try {
    return { ...await createBranch(client, projectSlug, branchName), created: true };
  } catch (error) {
    if (getErrorStatus(error) !== 409) throw error;

    const existingBranch = await getBranchByName(client, projectSlug, branchName);
    if (existingBranch) return { ...existingBranch, created: false };

    throw error;
  }
}

export async function resolvePushRemoteFiles(
  client: ApiClient,
  projectSlug: string,
  branchName: string,
  mainFiles: RemoteFile[],
): Promise<PushRemoteTarget> {
  const mainSource = { type: "main" } satisfies PullSource;
  if (branchName === "main") {
    return { branchId: null, remoteFiles: mainFiles, source: mainSource, branchExists: true };
  }

  const existingBranch = await getBranchByName(client, projectSlug, branchName);
  if (!existingBranch) {
    return { branchId: null, remoteFiles: mainFiles, source: mainSource, branchExists: false };
  }

  const branchSource = { type: "branch", name: branchName } satisfies PullSource;
  const remoteFiles = await listAllFiles(client, projectSlug, branchSource);
  return { branchId: existingBranch.id, remoteFiles, source: branchSource, branchExists: true };
}

function buildFileUrl(projectSlug: string, path: string, branchId: string | null): string {
  const encodedPath = encodeURIComponent(path);
  const base = `/projects/${encodeURIComponent(projectSlug)}/files/${encodedPath}`;
  return branchId ? `${base}?branch_id=${branchId}` : base;
}

export async function uploadFiles(
  client: ApiClient,
  projectSlug: string,
  branchId: string | null,
  ops: UploadOp[],
  dryRun: boolean,
): Promise<{ uploaded: number; failed: number; conflicts: string[] }> {
  let uploaded = 0;
  let failed = 0;
  const conflicts: string[] = [];

  for (const op of ops) {
    if (dryRun) {
      if (!isJsonMode()) cliLogger.info(`  Would upload: ${op.path}`);
      uploaded++;
      continue;
    }

    try {
      await client.put(
        buildFileUrl(projectSlug, op.path, branchId),
        {
          content: op.content,
          ...(op.expectedVersionId ? { expected_version_id: op.expectedVersionId } : {}),
          ...(op.expectedAbsent ? { expected_absent: true } : {}),
        },
        op.expectedVersionId || op.expectedAbsent ? { retryPolicy: "none" } : undefined,
      );
      uploaded++;
    } catch (error) {
      if (getErrorStatus(error) === 409) {
        conflicts.push(op.path);
        break;
      }
      cliLogger.error(`Failed to upload ${op.path}:`, error);
      failed++;
    }
  }

  return { uploaded, failed, conflicts };
}

export async function deleteFiles(
  client: ApiClient,
  projectSlug: string,
  branchId: string | null,
  ops: PlannedDelete[],
  dryRun: boolean,
): Promise<{ deleted: number; failed: number; conflicts: string[] }> {
  let deleted = 0;
  let failed = 0;
  const conflicts: string[] = [];

  for (const op of ops) {
    if (dryRun) {
      if (!isJsonMode()) cliLogger.info(`  Would delete: ${op.path}`);
      deleted++;
      continue;
    }

    try {
      const url = new URL(
        buildFileUrl(projectSlug, op.path, branchId),
        "https://veryfront.invalid",
      );
      if (op.expectedVersionId) {
        url.searchParams.set("expected_version_id", op.expectedVersionId);
      }
      await client.delete(`${url.pathname}${url.search}`);
      deleted++;
    } catch (error) {
      if (getErrorStatus(error) === 409) {
        conflicts.push(op.path);
        break;
      }
      cliLogger.error(`Failed to delete ${op.path}:`, error);
      failed++;
    }
  }

  return { deleted, failed, conflicts };
}

function formatParts(parts: string[]): string {
  return parts.join(", ");
}

function buildOpParts(
  ops: UploadOp[],
  toDelete: string[],
  uploadLabel: (count: number) => string,
  deleteLabel: (count: number) => string,
): string[] {
  const parts: string[] = [];
  if (ops.length > 0) parts.push(uploadLabel(ops.length));
  if (toDelete.length > 0) parts.push(deleteLabel(toDelete.length));
  return parts;
}

function buildSummaryParts(ops: UploadOp[], toDelete: string[]): string[] {
  return buildOpParts(
    ops,
    toDelete,
    (count) => `${count} to upload`,
    (count) => `${count} to delete`,
  );
}

function buildConfirmParts(ops: UploadOp[], toDelete: string[]): string[] {
  return buildOpParts(ops, toDelete, (count) => `upload ${count}`, (count) => `delete ${count}`);
}

function pushConflictError(paths: readonly string[]): Error {
  const files = paths.map((path) => `"${path}"`).join(", ");
  return PUSH_CONFLICT.create({
    detail: `Push rejected because remote files changed since your last pull or push: ${files}. ` +
      "Commit or stash local changes, run veryfront pull, reconcile the changes with Git, then push again. " +
      "Use veryfront push --force only to intentionally overwrite remote changes.",
    context: { paths: [...paths] },
  });
}

export async function recordPushReceipt(
  client: ApiClient,
  config: ResolvedConfig,
  projectDir: string,
  branch: string,
  snapshot: PushSourceSnapshot,
  ignoreChecker: IgnoreChecker,
  pushedSourceDigest = snapshot.sourceDigest,
): Promise<void> {
  const project = await getProjectTarget(client, projectApiReference(config));
  let currentSnapshot: PushSourceSnapshot;
  try {
    currentSnapshot = await capturePushSourceSnapshot(projectDir, ignoreChecker);
    if (!sourceSnapshotsMatch(snapshot, currentSnapshot)) throw sourceChangedError();
  } catch (error) {
    await clearPushReceipt(projectDir);
    throw error;
  }

  await writePushReceipt(projectDir, {
    controlPlane: normalizeControlPlane(config.apiUrl),
    projectId: project.id,
    projectSlug: project.slug,
    branch,
    commitSha: snapshot.gitSource.commitSha,
    sourceDigest: pushedSourceDigest,
    clean: snapshot.gitSource.clean,
  });
}

export function pushCommand(options: PushOptions = {}): Promise<void> {
  return withSpan(
    "cli.command.push",
    async (): Promise<void> => {
      const {
        projectSlug: slugOverride,
        projectDir = cwd(),
        branch = "main",
        force = false,
        dryRun = false,
        quiet = false,
      } = options;
      const pruneRemoteMissing = options.prune ?? false;
      assertPreviewBranchName(branch);
      const jsonOutput = isJsonMode();
      const startTime = Date.now();

      let spinner = quiet || jsonOutput
        ? createNoopSpinner()
        : createSpinner("Resolving configuration...");

      let config: ResolvedConfig;
      let projectReferenceSource: ProjectReferenceSource;
      try {
        // Use interactive auth - prompts for login if not authenticated
        const resolved = await resolveConfigWithAuthDetails(projectDir);
        config = resolved.config;
        projectReferenceSource = resolved.projectReferenceSource;
      } catch (error) {
        spinner.stop();
        throw error;
      }

      if (slugOverride) {
        config = { ...config, projectSlug: slugOverride };
        projectReferenceSource = { kind: "argument", name: "--project" };
      }

      await preflightSyncState(projectDir);

      spinner.update("Loading ignore patterns...");
      const ignorePatterns = await loadIgnorePatterns(projectDir);
      const ignoreChecker = createIgnoreChecker(ignorePatterns);

      spinner.update("Fetching remote files...");
      const client = createApiClient(config);
      const branchName = branch;
      const isMainBranch = branchName === "main";

      let mainFiles: RemoteFile[] = [];
      let projectExists = true;

      const planProjectCreation = (): void => {
        projectExists = false;
        if (!quiet && !jsonOutput) {
          logInfo(`Project "${config.projectSlug}" will be created on push.`);
        }
      };

      const resolutionClient: ProjectResolutionClient = {
        getProject: (reference) => getProjectTarget(client, reference),
        reserveSlug: async (slug, options) => {
          spinner.update("Creating project...");
          const reserved = await reserveProjectSlug(
            slug,
            config.apiToken,
            undefined,
            config.apiUrl,
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
          createMissingReference: true,
          allowAlternativeSlug: canPersistAlternativeSlug(projectReferenceSource),
          dryRun,
        });
      } catch (error) {
        spinner.stop();
        if (error instanceof ProjectSlugConflictError) {
          throw projectSlugConflictError(error, projectReferenceSource);
        }
        if (error instanceof ProjectReferenceNotFoundError && error.byId) {
          throw new Error(
            `Project "${error.reference}" was not found. Check ${projectReferenceSource.name} or remove it to let Veryfront create a project for this directory.`,
          );
        }
        throw error;
      }

      if (outcome.kind === "planned-create") {
        planProjectCreation();
      } else {
        if (outcome.kind === "created") {
          if (outcome.persisted && outcome.project.slug !== outcome.requestedSlug) {
            if (!quiet && !jsonOutput) logInfo(`Project slug: ${outcome.project.slug}`);
          }
          config = outcome.config;
          // A just-created project has no files yet; a listing failure here is
          // not a reason to fail the push.
          try {
            mainFiles = await listAllFiles(client, projectApiReference(config), { type: "main" });
          } catch {
            mainFiles = [];
          }
        } else {
          // An existing project only adopts the resolved identity when the
          // reference is one this directory owns, or was already an id.
          config = outcome.persisted || shouldPersistProjectLink(projectReferenceSource) ||
              config.projectId
            ? outcome.config
            : config;
          mainFiles = await listAllFiles(client, projectApiReference(config), { type: "main" });
        }
      }

      spinner.update("Scanning local files...");
      let sourceSnapshot: PushSourceSnapshot;
      try {
        sourceSnapshot = await capturePushSourceSnapshot(projectDir, ignoreChecker);
      } catch (error) {
        spinner.stop();
        throw error;
      }
      const ops = sourceSnapshot.files;
      const localPaths = new Set(ops.map((op) => op.path));

      let target: PushRemoteTarget = projectExists
        ? await resolvePushRemoteFiles(
          client,
          projectApiReference(config),
          branchName,
          mainFiles,
        )
        : {
          branchId: null,
          remoteFiles: mainFiles,
          source: { type: "main" } satisfies PullSource,
          branchExists: isMainBranch,
        };
      let remoteFilesAreBaseline = !isMainBranch && !target.branchExists;

      if (!dryRun && !isMainBranch && !target.branchId) {
        spinner.update(`Creating branch "${branchName}"...`);
        try {
          const preparedBranch = await ensureBranch(
            client,
            projectApiReference(config),
            branchName,
          );
          const branchSource = { type: "branch", name: branchName } satisfies PullSource;
          target = {
            branchId: preparedBranch.id,
            remoteFiles: await listAllFiles(
              client,
              projectApiReference(config),
              branchSource,
            ),
            source: branchSource,
            branchExists: true,
          };
          remoteFilesAreBaseline = preparedBranch.created;
        } catch (error) {
          spinner.stop();
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to prepare branch "${branchName}": ${message}`);
        }
      }

      const remoteFilesMissingLocally = target.remoteFiles
        .map((file) => file.path)
        .filter((path) =>
          ignoreChecker.isSupportedExtension(path) &&
          !ignoreChecker.isIgnored(path) &&
          !localPaths.has(path)
        );
      const toDelete = pruneRemoteMissing ? remoteFilesMissingLocally : [];
      const deletePaths = new Set(toDelete);
      const preservedRemoteFiles = target.remoteFiles
        .filter((file) => !localPaths.has(file.path) && !deletePaths.has(file.path))
        .map((file) => {
          if (typeof file.content !== "string") {
            throw new Error(
              `Veryfront returned invalid content for preserved remote file "${file.path}".`,
            );
          }
          return { path: file.path, content: file.content };
        });
      const pushedSourceDigest = preservedRemoteFiles.length === 0
        ? sourceSnapshot.sourceDigest
        : await computeSourceDigest([...ops, ...preservedRemoteFiles]);

      const project = outcome.kind === "planned-create" ? null : outcome.project;
      const baseline = project
        ? await readSyncTarget(projectDir, {
          controlPlane: config.apiUrl,
          projectId: project.id,
          branch: branchName,
        })
        : null;
      const managedRemoteFiles = target.remoteFiles.filter((file) =>
        ignoreChecker.isSupportedExtension(file.path) && !ignoreChecker.isIgnored(file.path)
      );
      const plan = await planPushChanges({
        localFiles: ops,
        remoteFiles: managedRemoteFiles,
        baselineFiles: baseline?.files ?? {},
        deletePaths: toDelete,
        force,
        remoteFilesAreBaseline,
      });
      if (plan.conflicts.length > 0) {
        spinner.stop();
        throw pushConflictError(plan.conflicts);
      }
      const uploadOps = plan.uploads;
      const deleteOps = plan.deletes;

      if (uploadOps.length === 0 && deleteOps.length === 0) {
        try {
          if (!dryRun) {
            await clearPushReceipt(projectDir);
            spinner.update("Verifying push target...");
            await recordPushReceipt(
              client,
              config,
              projectDir,
              branchName,
              sourceSnapshot,
              ignoreChecker,
              pushedSourceDigest,
            );
            if (project) {
              await writeSyncTarget(projectDir, {
                controlPlane: config.apiUrl,
                projectId: project.id,
                projectSlug: project.slug,
                branch: branchName,
                files: plan.nextFiles,
              });
            }
          }
        } finally {
          spinner.stop();
        }
        if (!quiet) {
          if (dryRun && jsonOutput) {
            outputPushDryRunResult(
              config.projectSlug,
              branchName,
              projectExists,
              0,
              0,
            );
          } else if (dryRun) {
            logInfo("Dry run complete. No files would change.");
          } else {
            outputPushResult(config.projectSlug, branchName, 0, 0, Date.now() - startTime);
          }
        }
        return;
      }

      spinner.stop();

      if (!quiet && !jsonOutput && (dryRun || isVerbose())) {
        const parts = buildSummaryParts(uploadOps, deleteOps.map((op) => op.path));
        cliLogger.info(
          `\nFound ${formatParts(parts)} for ${isMainBranch ? "main" : `branch "${branchName}"`}.`,
        );
      }

      if (dryRun) {
        if (uploadOps.length > 0) {
          await uploadFiles(client, projectApiReference(config), target.branchId, uploadOps, true);
        }
        if (deleteOps.length > 0) {
          await deleteFiles(client, projectApiReference(config), target.branchId, deleteOps, true);
        }

        if (jsonOutput && !quiet) {
          outputPushDryRunResult(
            config.projectSlug,
            branchName,
            projectExists,
            uploadOps.length,
            deleteOps.length,
          );
        } else if (!quiet) {
          const parts = buildConfirmParts(uploadOps, deleteOps.map((op) => op.path));
          logInfo(`Dry run complete. Would ${parts.join(" and ")} files.`);
        }
        return;
      }

      await clearPushReceipt(projectDir);

      const branchId = target.branchId;
      const uploadMsg = isMainBranch
        ? "Pushing to main..."
        : branchId
        ? `Pushing to branch "${branchName}"...`
        : `Creating branch "${branchName}"...`;
      spinner = quiet || jsonOutput ? createNoopSpinner() : createSpinner(uploadMsg);

      let uploadResult = { uploaded: 0, failed: 0, conflicts: [] as string[] };
      let deleteResult = { deleted: 0, failed: 0, conflicts: [] as string[] };

      if (uploadOps.length > 0) {
        spinner.update("Uploading files...");
        uploadResult = await uploadFiles(
          client,
          projectApiReference(config),
          branchId,
          uploadOps,
          false,
        );
      }

      if (uploadResult.conflicts.length > 0) {
        spinner.stop();
        throw pushConflictError(uploadResult.conflicts);
      }

      if (uploadResult.failed > 0) {
        spinner.stop();
        throw new Error(
          `Push failed for ${uploadResult.failed} file${
            uploadResult.failed === 1 ? "" : "s"
          }. Remote files were not deleted.`,
        );
      }

      if (deleteOps.length > 0) {
        spinner.update("Deleting removed files...");
        deleteResult = await deleteFiles(
          client,
          projectApiReference(config),
          branchId,
          deleteOps,
          false,
        );
      }

      if (deleteResult.conflicts.length > 0) {
        spinner.stop();
        throw pushConflictError(deleteResult.conflicts);
      }

      if (deleteResult.failed > 0) {
        spinner.stop();
        throw new Error(
          `Push failed for ${deleteResult.failed} file${
            deleteResult.failed === 1 ? "" : "s"
          } during deletion`,
        );
      }

      spinner.update("Verifying push target...");
      try {
        await recordPushReceipt(
          client,
          config,
          projectDir,
          branchName,
          sourceSnapshot,
          ignoreChecker,
          pushedSourceDigest,
        );
        if (project) {
          await writeSyncTarget(projectDir, {
            controlPlane: config.apiUrl,
            projectId: project.id,
            projectSlug: project.slug,
            branch: branchName,
            files: plan.nextFiles,
          });
        }
      } finally {
        spinner.stop();
      }

      if (quiet) return;

      outputPushResult(
        config.projectSlug,
        branchName,
        uploadResult.uploaded,
        deleteResult.deleted,
        Date.now() - startTime,
      );
    },
    { "cli.dryRun": options.dryRun ?? false },
  );
}
