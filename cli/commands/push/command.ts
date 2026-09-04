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
import { isVerbose, logInfo, logSuccess, logWarning } from "#cli/utils";
import {
  DEPLOYMENT_ERROR,
  INVALID_ARGUMENT,
  PREVIEW_HOSTNAME_TOO_LONG,
  PUSH_CONFLICT,
  sanitizeTerminalDiagnosticText,
  VeryfrontError,
} from "veryfront/errors";
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
  type ProjectTarget,
  resolveGitSource,
  writePushReceipt,
} from "../../shared/deployment-provenance.ts";
import { buildStudioUrl } from "../studio/command.ts";
import { isJsonMode, streamJsonLine } from "../../shared/json-output.ts";
import { type PlannedDelete, type PlannedUpload, planPushChanges } from "./plan.ts";
import {
  computeContentDigest,
  preflightSyncState,
  readSyncTarget,
  type SyncFileSnapshot,
  writeSyncTarget,
} from "../../sync/state.ts";

const defineOwnProperty = Object.defineProperty;
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
  protectedDeleted: readonly string[],
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
        protectedDeleted: [...protectedDeleted],
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

function warnProtectedRemotePaths(paths: readonly string[], dryRun: boolean): void {
  if (paths.length === 0 || isJsonMode()) return;
  const protectedPathList = paths.map(sanitizeTerminalDiagnosticText).join(", ");
  logWarning(
    `Prune ${dryRun ? "would remove" : "removes"} ${paths.length} protected remote ${
      paths.length === 1 ? "path" : "paths"
    } that .vfignore cannot re-include: ${protectedPathList}.`,
  );
  if (!dryRun) logInfo("Rotate any credential these paths contained.");
}

function outputPushDryRunResult(
  projectSlug: string,
  branchName: string,
  projectExists: boolean,
  wouldUpload: number,
  wouldDelete: number,
  protectedWouldDelete: readonly string[],
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
      protectedWouldDelete: [...protectedWouldDelete],
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
): Promise<{ uploaded: number; failed: number; conflicts: string[]; applied: string[] }> {
  let uploaded = 0;
  let failed = 0;
  const conflicts: string[] = [];
  const applied: string[] = [];

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
      applied.push(op.path);
    } catch (error) {
      if (getErrorStatus(error) === 409) {
        conflicts.push(op.path);
        break;
      }
      cliLogger.error(`Failed to upload ${op.path}:`, error);
      failed++;
    }
  }

  return { uploaded, failed, conflicts, applied };
}

export async function deleteFiles(
  client: ApiClient,
  projectSlug: string,
  branchId: string | null,
  ops: PlannedDelete[],
  dryRun: boolean,
): Promise<{ deleted: number; failed: number; conflicts: string[]; applied: string[] }> {
  let deleted = 0;
  let failed = 0;
  const conflicts: string[] = [];
  const applied: string[] = [];

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
      applied.push(op.path);
    } catch (error) {
      if (getErrorStatus(error) === 409) {
        conflicts.push(op.path);
        break;
      }
      cliLogger.error(`Failed to delete ${op.path}:`, error);
      failed++;
    }
  }

  return { deleted, failed, conflicts, applied };
}

async function deleteForcedPruneRemoteOnlyFiles(
  client: ApiClient,
  projectSlug: string,
  branchId: string | null,
  remoteFiles: readonly RemoteFile[],
  ignoreChecker: IgnoreChecker,
  plannedFiles: Readonly<Record<string, SyncFileSnapshot>>,
): Promise<{ deleted: number; failed: number; conflicts: string[]; applied: string[] }> {
  const plannedPaths = new Set(Object.keys(plannedFiles));
  const remoteOnlyDeletes = remoteFiles
    .filter((file) =>
      (ignoreChecker.isProtected(file.path) ||
        (ignoreChecker.isSupportedExtension(file.path) &&
          !ignoreChecker.isIgnored(file.path))) &&
      !plannedPaths.has(file.path)
    )
    .map((file) => ({ path: file.path }));
  if (remoteOnlyDeletes.length === 0) {
    return { deleted: 0, failed: 0, conflicts: [], applied: [] };
  }
  return await deleteFiles(client, projectSlug, branchId, remoteOnlyDeletes, false);
}

async function uploadForcedPlannedFiles(
  client: ApiClient,
  projectSlug: string,
  branchId: string | null,
  remoteFiles: readonly RemoteFile[],
  ignoreChecker: IgnoreChecker,
  uploads: readonly UploadOp[],
): Promise<{ uploaded: number; failed: number; conflicts: string[]; applied: string[] }> {
  const remoteSnapshot = await buildManagedRemoteSnapshot(remoteFiles, ignoreChecker, false);
  const restoreUploads: UploadOp[] = [];
  for (const upload of uploads) {
    if (
      remoteSnapshot.get(upload.path)?.digest !== await computeContentDigest(upload.content)
    ) {
      restoreUploads.push(upload);
    }
  }
  if (restoreUploads.length === 0) {
    return { uploaded: 0, failed: 0, conflicts: [], applied: [] };
  }
  return await uploadFiles(client, projectSlug, branchId, restoreUploads, false);
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

function pushConflictError(
  paths: readonly string[],
  protectedDeleted: readonly string[] = [],
): Error {
  const files = paths.map((path) => `"${path}"`).join(", ");
  return PUSH_CONFLICT.create({
    detail: `Push rejected because remote files changed since your last pull or push: ${files}. ` +
      "Commit or stash local changes, run veryfront pull, reconcile the changes with Git, then push again. " +
      "Use veryfront push --force only to intentionally overwrite remote changes.",
    context: {
      paths: [...paths],
      ...(protectedDeleted.length > 0 ? { protectedDeleted: [...protectedDeleted] } : {}),
    },
  });
}

function pushMutationError(detail: string, protectedDeleted: readonly string[]): Error {
  return DEPLOYMENT_ERROR.create({
    detail,
    context: protectedDeleted.length > 0 ? { protectedDeleted: [...protectedDeleted] } : undefined,
  });
}

function pushVerificationReadError(protectedDeleted: readonly string[]): Error {
  return DEPLOYMENT_ERROR.create({
    detail:
      "Push verification could not read the remote target after files were deleted. Retry the push and rotate any credential named in protectedDeleted.",
    context: { protectedDeleted: [...protectedDeleted] },
  });
}

function attachProtectedDeleteContext(
  error: unknown,
  protectedDeleted: readonly string[],
): Error {
  if (protectedDeleted.length === 0) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const normalized = [...protectedDeleted];
  if (error instanceof VeryfrontError) {
    try {
      defineOwnProperty(error, "context", {
        value: { protectedDeleted: normalized },
        configurable: true,
        enumerable: true,
        writable: true,
      });
      return error;
    } catch { /* fall through to a typed push error */ }
  }
  return pushMutationError(
    "Push finalization failed after remote files were deleted. " +
      "Retry the push and rotate any credential named in protectedDeleted.",
    normalized,
  );
}

function requireRemoteContent(file: RemoteFile): string {
  if (typeof file.content === "string") return file.content;
  throw new Error(
    `Veryfront returned invalid content for remote file "${file.path}". No files were pushed.`,
  );
}

function findRemoteFilesMissingLocally(
  remoteFiles: readonly RemoteFile[],
  localPaths: ReadonlySet<string>,
  ignoreChecker: IgnoreChecker,
): string[] {
  return remoteFiles
    .map((file) => file.path)
    .filter((path) =>
      !localPaths.has(path) &&
      // A protected path bypasses the extension and ignore filters: it is never
      // scanned locally, so prune is the only way to remove a copy that an older
      // CLI uploaded or that was authored in the web editor.
      (ignoreChecker.isProtected(path) ||
        (ignoreChecker.isSupportedExtension(path) && !ignoreChecker.isIgnored(path)))
    );
}

function requirePreservedRemoteContent(
  remoteFiles: readonly RemoteFile[],
  localPaths: ReadonlySet<string>,
  deletePaths: ReadonlySet<string>,
): void {
  for (const file of remoteFiles) {
    if (!localPaths.has(file.path) && !deletePaths.has(file.path)) {
      requireRemoteContent(file);
    }
  }
}

async function buildManagedRemoteSnapshot(
  files: readonly RemoteFile[],
  ignoreChecker: IgnoreChecker,
  includeVersion = true,
  includeProtected = false,
): Promise<Map<string, { digest: string; versionId?: string }>> {
  const snapshot = new Map<string, { digest: string; versionId?: string }>();
  for (const file of files) {
    const managed = ignoreChecker.isSupportedExtension(file.path) &&
      !ignoreChecker.isIgnored(file.path);
    if (!managed && !(includeProtected && ignoreChecker.isProtected(file.path))) {
      continue;
    }
    snapshot.set(file.path, {
      digest: await computeContentDigest(requireRemoteContent(file)),
      ...(includeVersion && file.version_id ? { versionId: file.version_id } : {}),
    });
  }
  return snapshot;
}

/** Explicit form of the comparator-less sort: UTF-16 code-unit order. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function findRemoteSnapshotChanges(
  expected: Map<string, { digest: string; versionId?: string }>,
  actual: Map<string, { digest: string; versionId?: string }>,
): string[] {
  const paths = new Set([...expected.keys(), ...actual.keys()]);
  const changed: string[] = [];
  for (const path of paths) {
    const expectedFile = expected.get(path);
    const actualFile = actual.get(path);
    if (
      !expectedFile ||
      !actualFile ||
      expectedFile.digest !== actualFile.digest ||
      expectedFile.versionId !== actualFile.versionId
    ) {
      changed.push(path);
    }
  }
  return changed.sort(compareCodeUnits);
}

function buildSyncFileDigestSnapshot(
  files: Readonly<Record<string, SyncFileSnapshot>>,
): Map<string, { digest: string; versionId?: string }> {
  return new Map(
    Object.entries(files)
      .map(([path, file]) => [path, { digest: file.digest }]),
  );
}

async function filterAppliedChangesStillMatchingRemote(
  latestRemoteSnapshot: ReadonlyMap<string, { digest: string; versionId?: string }>,
  appliedUploads: readonly UploadOp[],
  appliedDeletes: readonly PlannedDelete[],
): Promise<{ uploads: UploadOp[]; deletes: PlannedDelete[] }> {
  const uploads: UploadOp[] = [];
  for (const upload of appliedUploads) {
    if (
      latestRemoteSnapshot.get(upload.path)?.digest === await computeContentDigest(upload.content)
    ) {
      uploads.push(upload);
    }
  }
  const deletes = appliedDeletes.filter((deletion) => !latestRemoteSnapshot.has(deletion.path));
  return { uploads, deletes };
}

async function buildSyncFilesAfterAppliedChanges(
  remoteFiles: readonly RemoteFile[],
  appliedUploads: readonly UploadOp[],
  appliedDeletes: readonly PlannedDelete[],
): Promise<Record<string, SyncFileSnapshot>> {
  const files: Record<string, SyncFileSnapshot> = {};
  for (const file of remoteFiles) {
    files[file.path] = {
      digest: await computeContentDigest(requireRemoteContent(file)),
      ...(file.version_id ? { versionId: file.version_id } : {}),
    };
  }
  for (const upload of appliedUploads) {
    files[upload.path] = { digest: await computeContentDigest(upload.content) };
  }
  for (const deletion of appliedDeletes) {
    delete files[deletion.path];
  }
  return files;
}

async function computePushedSourceDigest(
  localFiles: readonly UploadOp[],
  remoteFiles: readonly RemoteFile[],
): Promise<string> {
  const localPaths = new Set(localFiles.map((file) => file.path));
  const preservedRemoteFiles = remoteFiles
    .filter((file) => !localPaths.has(file.path))
    .map((file) => ({ path: file.path, content: requireRemoteContent(file) }));
  return await computeSourceDigest([...localFiles, ...preservedRemoteFiles]);
}

async function writeAppliedSyncTarget(
  projectDir: string,
  config: ResolvedConfig,
  project: ProjectTarget | null,
  branch: string,
  remoteFiles: readonly RemoteFile[],
  appliedUploads: readonly UploadOp[],
  appliedDeletes: readonly PlannedDelete[],
): Promise<void> {
  if (!project || (appliedUploads.length === 0 && appliedDeletes.length === 0)) return;
  await writeSyncTarget(projectDir, {
    controlPlane: config.apiUrl,
    projectId: project.id,
    projectSlug: project.slug,
    branch,
    files: await buildSyncFilesAfterAppliedChanges(remoteFiles, appliedUploads, appliedDeletes),
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
        // Branch creation is a remote mutation. Validate every inherited file
        // that later planning or receipt generation can require before the POST.
        for (const file of target.remoteFiles) requireRemoteContent(file);

        spinner.update(`Creating branch "${branchName}"...`);
        try {
          const preparedBranch = await ensureBranch(
            client,
            projectApiReference(config),
            branchName,
          );
          const branchSource = { type: "branch", name: branchName } satisfies PullSource;
          const branchRemoteFiles = await listAllFiles(
            client,
            projectApiReference(config),
            branchSource,
          );
          if (preparedBranch.created && !force) {
            const conflicts = findRemoteSnapshotChanges(
              await buildManagedRemoteSnapshot(mainFiles, ignoreChecker, false),
              await buildManagedRemoteSnapshot(branchRemoteFiles, ignoreChecker, false),
            );
            if (conflicts.length > 0) {
              throw pushConflictError(conflicts);
            }
          }
          target = {
            branchId: preparedBranch.id,
            remoteFiles: branchRemoteFiles,
            source: branchSource,
            branchExists: true,
          };
          remoteFilesAreBaseline = preparedBranch.created;
        } catch (error) {
          spinner.stop();
          if (error instanceof VeryfrontError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to prepare branch "${branchName}": ${message}`);
        }
      }

      const remoteFilesMissingLocally = findRemoteFilesMissingLocally(
        target.remoteFiles,
        localPaths,
        ignoreChecker,
      );
      const toDelete = pruneRemoteMissing ? remoteFilesMissingLocally : [];
      // Preflight: fail before any remote mutation if a preserved remote file
      // is missing content, so the digest computations after upload/delete
      // cannot be the first to discover it.
      const deletePaths = new Set(toDelete);
      requirePreservedRemoteContent(target.remoteFiles, localPaths, deletePaths);
      let pushedSourceDigest: string;

      const project = outcome.kind === "planned-create" ? null : outcome.project;
      const baseline = project
        ? await readSyncTarget(projectDir, {
          controlPlane: config.apiUrl,
          projectId: project.id,
          branch: branchName,
        })
        : null;
      const managedRemoteFiles = target.remoteFiles.filter((file) =>
        (pruneRemoteMissing && ignoreChecker.isProtected(file.path)) ||
        (ignoreChecker.isSupportedExtension(file.path) && !ignoreChecker.isIgnored(file.path))
      );
      const protectedDeletePaths = toDelete.filter((path) => ignoreChecker.isProtected(path));
      const appliedProtectedDeletePaths = new Set<string>();
      const recordAppliedProtectedDeletes = (paths: readonly string[]) => {
        const newlyApplied = paths.filter((path) =>
          ignoreChecker.isProtected(path) && !appliedProtectedDeletePaths.has(path)
        );
        for (const path of newlyApplied) appliedProtectedDeletePaths.add(path);
        warnProtectedRemotePaths(newlyApplied, false);
      };
      const protectedDeleteContext = () =>
        [...appliedProtectedDeletePaths].map(sanitizeTerminalDiagnosticText);
      // Protected paths are planner input only. The sync baseline must never
      // record them, because `plan.nextFiles` excludes them and no later pull or
      // push would ever reconcile such an entry away.
      const syncBaselineRemoteFiles = managedRemoteFiles.filter((file) =>
        !ignoreChecker.isProtected(file.path)
      );
      const plan = await planPushChanges({
        localFiles: ops,
        remoteFiles: managedRemoteFiles,
        baselineFiles: baseline?.files ?? {},
        deletePaths: toDelete,
        protectedDeletePaths,
        force,
        remoteFilesAreBaseline,
      });
      if (plan.conflicts.length > 0) {
        spinner.stop();
        throw pushConflictError(plan.conflicts);
      }
      const uploadOps = plan.uploads;
      const deleteOps = plan.deletes;
      const branchId = target.branchId;
      let pushedSyncFiles = plan.nextFiles;

      if (!dryRun && !force) {
        spinner = quiet || jsonOutput
          ? createNoopSpinner()
          : createSpinner("Checking remote files...");
        try {
          const latestRemoteFiles = await listAllFiles(
            client,
            projectApiReference(config),
            target.source,
          );
          const conflicts = findRemoteSnapshotChanges(
            await buildManagedRemoteSnapshot(managedRemoteFiles, ignoreChecker),
            await buildManagedRemoteSnapshot(latestRemoteFiles, ignoreChecker),
          );
          if (conflicts.length > 0) {
            throw pushConflictError(conflicts, protectedDeleteContext());
          }
        } finally {
          spinner.stop();
        }
      }

      if (uploadOps.length === 0 && deleteOps.length === 0) {
        let forcedPruneDeleteCount = 0;
        try {
          if (!dryRun) {
            if (!force) {
              spinner.update("Checking remote files...");
              const latestRemoteFiles = await listAllFiles(
                client,
                projectApiReference(config),
                target.source,
              );
              const conflicts = findRemoteSnapshotChanges(
                await buildManagedRemoteSnapshot(managedRemoteFiles, ignoreChecker),
                await buildManagedRemoteSnapshot(
                  latestRemoteFiles,
                  ignoreChecker,
                  true,
                  pruneRemoteMissing,
                ),
              );
              if (conflicts.length > 0) {
                throw pushConflictError(conflicts);
              }
              pushedSourceDigest = await computePushedSourceDigest(ops, latestRemoteFiles);
            } else if (pruneRemoteMissing) {
              spinner.update("Verifying push target...");
              let latestRemoteFiles = await listAllFiles(
                client,
                projectApiReference(config),
                target.source,
              );
              const lateDeleteResult = await deleteForcedPruneRemoteOnlyFiles(
                client,
                projectApiReference(config),
                branchId,
                latestRemoteFiles,
                ignoreChecker,
                plan.nextFiles,
              );
              forcedPruneDeleteCount = lateDeleteResult.deleted;
              recordAppliedProtectedDeletes(lateDeleteResult.applied);
              if (lateDeleteResult.conflicts.length > 0) {
                throw pushConflictError(lateDeleteResult.conflicts, protectedDeleteContext());
              }
              if (lateDeleteResult.failed > 0) {
                throw pushMutationError(
                  `Push failed for ${lateDeleteResult.failed} file${
                    lateDeleteResult.failed === 1 ? "" : "s"
                  } during forced prune reconciliation`,
                  protectedDeleteContext(),
                );
              }
              if (lateDeleteResult.deleted > 0) {
                try {
                  latestRemoteFiles = await listAllFiles(
                    client,
                    projectApiReference(config),
                    target.source,
                  );
                } catch (error) {
                  const protectedDeleted = protectedDeleteContext();
                  if (protectedDeleted.length > 0) {
                    throw pushVerificationReadError(protectedDeleted);
                  }
                  throw error;
                }
              }
              const conflicts = findRemoteSnapshotChanges(
                buildSyncFileDigestSnapshot(plan.nextFiles),
                await buildManagedRemoteSnapshot(latestRemoteFiles, ignoreChecker, false, true),
              );
              if (conflicts.length > 0) {
                throw pushConflictError(conflicts, protectedDeleteContext());
              }
              pushedSourceDigest = await computePushedSourceDigest(ops, latestRemoteFiles);
            } else {
              const latestRemoteFiles = await listAllFiles(
                client,
                projectApiReference(config),
                target.source,
              );
              pushedSourceDigest = await computePushedSourceDigest(ops, latestRemoteFiles);
              pushedSyncFiles = await buildSyncFilesAfterAppliedChanges(
                latestRemoteFiles.filter((file) =>
                  ignoreChecker.isSupportedExtension(file.path) &&
                  !ignoreChecker.isIgnored(file.path)
                ),
                [],
                [],
              );
            }
            await clearPushReceipt(projectDir);
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
            } catch (error) {
              throw attachProtectedDeleteContext(error, protectedDeleteContext());
            }
            if (project) {
              try {
                await writeSyncTarget(projectDir, {
                  controlPlane: config.apiUrl,
                  projectId: project.id,
                  projectSlug: project.slug,
                  branch: branchName,
                  files: pushedSyncFiles,
                });
              } catch (error) {
                throw attachProtectedDeleteContext(error, protectedDeleteContext());
              }
            }
          }
        } finally {
          spinner.stop();
        }
        if (!quiet || jsonOutput) {
          if (dryRun && jsonOutput) {
            outputPushDryRunResult(
              config.projectSlug,
              branchName,
              projectExists,
              0,
              0,
              protectedDeletePaths,
            );
          } else if (dryRun) {
            logInfo("Dry run complete. No files would change.");
          } else {
            outputPushResult(
              config.projectSlug,
              branchName,
              0,
              forcedPruneDeleteCount,
              [...appliedProtectedDeletePaths],
              Date.now() - startTime,
            );
          }
        }
        return;
      }

      spinner.stop();

      // Actual deletes are reported when each remote mutation completes so a
      // late protected path and a partially failed push still get rotation
      // guidance. A dry run has no applied operations, so report its plan here.
      if (dryRun) warnProtectedRemotePaths(protectedDeletePaths, true);

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

        if (jsonOutput) {
          outputPushDryRunResult(
            config.projectSlug,
            branchName,
            projectExists,
            uploadOps.length,
            deleteOps.length,
            protectedDeletePaths,
          );
        } else if (!quiet) {
          const parts = buildConfirmParts(uploadOps, deleteOps.map((op) => op.path));
          logInfo(`Dry run complete. Would ${parts.join(" and ")} files.`);
        }
        return;
      }

      await clearPushReceipt(projectDir);

      const uploadMsg = isMainBranch
        ? "Pushing to main..."
        : branchId
        ? `Pushing to branch "${branchName}"...`
        : `Creating branch "${branchName}"...`;
      spinner = quiet || jsonOutput ? createNoopSpinner() : createSpinner(uploadMsg);

      let uploadResult = {
        uploaded: 0,
        failed: 0,
        conflicts: [] as string[],
        applied: [] as string[],
      };
      let deleteResult = {
        deleted: 0,
        failed: 0,
        conflicts: [] as string[],
        applied: [] as string[],
      };
      const writeConfirmedAppliedSyncTarget = async () => {
        const appliedUploads = new Set(uploadResult.applied);
        const appliedDeletes = [...new Set(deleteResult.applied)]
          .map((path) => ({ path }));
        try {
          await writeAppliedSyncTarget(
            projectDir,
            config,
            project,
            branchName,
            syncBaselineRemoteFiles,
            uploadOps.filter((op) => appliedUploads.has(op.path)),
            appliedDeletes,
          );
        } catch (error) {
          throw attachProtectedDeleteContext(error, protectedDeleteContext());
        }
      };
      const listAllFilesForVerification = async () => {
        try {
          return await listAllFiles(
            client,
            projectApiReference(config),
            target.source,
          );
        } catch (error) {
          await writeConfirmedAppliedSyncTarget();
          const protectedDeleted = protectedDeleteContext();
          if (protectedDeleted.length > 0) {
            throw pushVerificationReadError(protectedDeleted);
          }
          throw error;
        }
      };
      const writeVerifiedAppliedSyncTarget = async (
        knownRemoteFiles?: readonly RemoteFile[],
      ) => {
        const latestRemoteFiles = knownRemoteFiles ?? await listAllFilesForVerification();
        const latestRemoteSnapshot = await buildManagedRemoteSnapshot(
          latestRemoteFiles,
          ignoreChecker,
          false,
        );
        const appliedUploads = new Set(uploadResult.applied);
        const appliedDeletes = [...new Set(deleteResult.applied)]
          .map((path) => ({ path }));
        const stillApplied = await filterAppliedChangesStillMatchingRemote(
          latestRemoteSnapshot,
          uploadOps.filter((op) => appliedUploads.has(op.path)),
          appliedDeletes,
        );
        try {
          await writeAppliedSyncTarget(
            projectDir,
            config,
            project,
            branchName,
            syncBaselineRemoteFiles,
            stillApplied.uploads,
            stillApplied.deletes,
          );
        } catch (error) {
          throw attachProtectedDeleteContext(error, protectedDeleteContext());
        }
      };

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
        const appliedUploads = new Set(uploadResult.applied);
        await writeAppliedSyncTarget(
          projectDir,
          config,
          project,
          branchName,
          syncBaselineRemoteFiles,
          uploadOps.filter((op) => appliedUploads.has(op.path)),
          [],
        );
        throw pushConflictError(uploadResult.conflicts);
      }

      if (uploadResult.failed > 0) {
        spinner.stop();
        const appliedUploads = new Set(uploadResult.applied);
        await writeAppliedSyncTarget(
          projectDir,
          config,
          project,
          branchName,
          syncBaselineRemoteFiles,
          uploadOps.filter((op) => appliedUploads.has(op.path)),
          [],
        );
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
        recordAppliedProtectedDeletes(deleteResult.applied);
      }

      if (deleteResult.conflicts.length > 0) {
        spinner.stop();
        const appliedUploads = new Set(uploadResult.applied);
        const appliedDeletes = new Set(deleteResult.applied);
        await writeAppliedSyncTarget(
          projectDir,
          config,
          project,
          branchName,
          syncBaselineRemoteFiles,
          uploadOps.filter((op) => appliedUploads.has(op.path)),
          deleteOps.filter((op) => appliedDeletes.has(op.path)),
        );
        throw pushConflictError(deleteResult.conflicts, protectedDeleteContext());
      }

      if (deleteResult.failed > 0) {
        spinner.stop();
        await writeVerifiedAppliedSyncTarget();
        throw pushMutationError(
          `Push failed for ${deleteResult.failed} file${
            deleteResult.failed === 1 ? "" : "s"
          } during deletion`,
          protectedDeleteContext(),
        );
      }

      spinner.update("Verifying push target...");
      try {
        if (!force) {
          const latestRemoteFiles = await listAllFilesForVerification();
          const latestRemoteSnapshot = await buildManagedRemoteSnapshot(
            latestRemoteFiles,
            ignoreChecker,
            false,
            pruneRemoteMissing,
          );
          const conflicts = findRemoteSnapshotChanges(
            buildSyncFileDigestSnapshot(plan.nextFiles),
            latestRemoteSnapshot,
          );
          if (conflicts.length > 0) {
            const appliedUploads = new Set(uploadResult.applied);
            const appliedDeletes = new Set(deleteResult.applied);
            const stillApplied = await filterAppliedChangesStillMatchingRemote(
              latestRemoteSnapshot,
              uploadOps.filter((op) => appliedUploads.has(op.path)),
              deleteOps.filter((op) => appliedDeletes.has(op.path)),
            );
            await writeAppliedSyncTarget(
              projectDir,
              config,
              project,
              branchName,
              syncBaselineRemoteFiles,
              stillApplied.uploads,
              stillApplied.deletes,
            );
            throw pushConflictError(conflicts, protectedDeleteContext());
          }
          pushedSourceDigest = await computePushedSourceDigest(ops, latestRemoteFiles);
        } else if (pruneRemoteMissing) {
          const latestRemoteFiles = await listAllFilesForVerification();
          let repaired = false;
          const lateUploadResult = await uploadForcedPlannedFiles(
            client,
            projectApiReference(config),
            branchId,
            latestRemoteFiles,
            ignoreChecker,
            uploadOps,
          );
          if (
            lateUploadResult.uploaded > 0 ||
            lateUploadResult.failed > 0 ||
            lateUploadResult.conflicts.length > 0
          ) {
            repaired = true;
            uploadResult = {
              uploaded: uploadResult.uploaded + lateUploadResult.uploaded,
              failed: uploadResult.failed + lateUploadResult.failed,
              conflicts: [...uploadResult.conflicts, ...lateUploadResult.conflicts],
              applied: [...uploadResult.applied, ...lateUploadResult.applied],
            };
            if (lateUploadResult.conflicts.length > 0) {
              await writeVerifiedAppliedSyncTarget();
              throw pushConflictError(lateUploadResult.conflicts, protectedDeleteContext());
            }
            if (lateUploadResult.failed > 0) {
              await writeVerifiedAppliedSyncTarget();
              throw pushMutationError(
                `Push failed for ${lateUploadResult.failed} file${
                  lateUploadResult.failed === 1 ? "" : "s"
                } during forced prune reconciliation`,
                protectedDeleteContext(),
              );
            }
          }
          const lateDeleteResult = await deleteForcedPruneRemoteOnlyFiles(
            client,
            projectApiReference(config),
            branchId,
            latestRemoteFiles,
            ignoreChecker,
            plan.nextFiles,
          );
          recordAppliedProtectedDeletes(lateDeleteResult.applied);
          if (
            lateDeleteResult.deleted > 0 ||
            lateDeleteResult.failed > 0 ||
            lateDeleteResult.conflicts.length > 0
          ) {
            repaired = true;
            deleteResult = {
              deleted: deleteResult.deleted + lateDeleteResult.deleted,
              failed: deleteResult.failed + lateDeleteResult.failed,
              conflicts: [...deleteResult.conflicts, ...lateDeleteResult.conflicts],
              applied: [...deleteResult.applied, ...lateDeleteResult.applied],
            };
            if (lateDeleteResult.conflicts.length > 0) {
              await writeVerifiedAppliedSyncTarget();
              throw pushConflictError(lateDeleteResult.conflicts, protectedDeleteContext());
            }
            if (lateDeleteResult.failed > 0) {
              await writeVerifiedAppliedSyncTarget();
              throw pushMutationError(
                `Push failed for ${lateDeleteResult.failed} file${
                  lateDeleteResult.failed === 1 ? "" : "s"
                } during forced prune reconciliation`,
                protectedDeleteContext(),
              );
            }
          }
          if (repaired) {
            const repairedRemoteFiles = await listAllFilesForVerification();
            const repairedConflicts = findRemoteSnapshotChanges(
              buildSyncFileDigestSnapshot(plan.nextFiles),
              await buildManagedRemoteSnapshot(repairedRemoteFiles, ignoreChecker, false, true),
            );
            if (repairedConflicts.length > 0) {
              await writeVerifiedAppliedSyncTarget(repairedRemoteFiles);
              throw pushConflictError(repairedConflicts, protectedDeleteContext());
            }
            pushedSourceDigest = await computePushedSourceDigest(ops, repairedRemoteFiles);
          } else {
            pushedSourceDigest = await computePushedSourceDigest(ops, latestRemoteFiles);
          }
        } else {
          let latestRemoteFiles = await listAllFilesForVerification();
          const repairUploadResult = await uploadForcedPlannedFiles(
            client,
            projectApiReference(config),
            branchId,
            latestRemoteFiles,
            ignoreChecker,
            uploadOps,
          );
          uploadResult = {
            uploaded: uploadResult.uploaded + repairUploadResult.uploaded,
            failed: uploadResult.failed + repairUploadResult.failed,
            conflicts: [...uploadResult.conflicts, ...repairUploadResult.conflicts],
            applied: [...uploadResult.applied, ...repairUploadResult.applied],
          };
          if (repairUploadResult.conflicts.length > 0) {
            await writeVerifiedAppliedSyncTarget();
            throw pushConflictError(repairUploadResult.conflicts, protectedDeleteContext());
          }
          if (repairUploadResult.failed > 0) {
            await writeVerifiedAppliedSyncTarget();
            throw pushMutationError(
              `Push failed for ${repairUploadResult.failed} file${
                repairUploadResult.failed === 1 ? "" : "s"
              } during forced push verification`,
              protectedDeleteContext(),
            );
          }
          if (repairUploadResult.uploaded > 0) {
            latestRemoteFiles = await listAllFilesForVerification();
          }
          const latestRemoteSnapshot = await buildManagedRemoteSnapshot(
            latestRemoteFiles,
            ignoreChecker,
            false,
          );
          const uploadPaths = new Set(uploadOps.map((upload) => upload.path));
          const expectedUploadSnapshot = new Map(
            [...buildSyncFileDigestSnapshot(plan.nextFiles)]
              .filter(([path]) => uploadPaths.has(path)),
          );
          const actualUploadSnapshot = new Map(
            [...latestRemoteSnapshot]
              .filter(([path]) => uploadPaths.has(path)),
          );
          const conflicts = findRemoteSnapshotChanges(
            expectedUploadSnapshot,
            actualUploadSnapshot,
          );
          if (conflicts.length > 0) {
            await writeVerifiedAppliedSyncTarget(latestRemoteFiles);
            throw pushConflictError(conflicts, protectedDeleteContext());
          }
          pushedSourceDigest = await computePushedSourceDigest(ops, latestRemoteFiles);
          pushedSyncFiles = await buildSyncFilesAfterAppliedChanges(
            latestRemoteFiles.filter((file) =>
              ignoreChecker.isSupportedExtension(file.path) &&
              !ignoreChecker.isIgnored(file.path)
            ),
            [],
            [],
          );
        }
        const writePlannedSyncTarget = async () => {
          if (!project) return;
          await writeSyncTarget(projectDir, {
            controlPlane: config.apiUrl,
            projectId: project.id,
            projectSlug: project.slug,
            branch: branchName,
            files: pushedSyncFiles,
          });
        };
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
        } catch (error) {
          try {
            await writePlannedSyncTarget();
          } catch (writeError) {
            throw attachProtectedDeleteContext(writeError, protectedDeleteContext());
          }
          throw attachProtectedDeleteContext(error, protectedDeleteContext());
        }
        try {
          await writePlannedSyncTarget();
        } catch (error) {
          throw attachProtectedDeleteContext(error, protectedDeleteContext());
        }
      } finally {
        spinner.stop();
      }

      if (quiet && !jsonOutput) return;

      outputPushResult(
        config.projectSlug,
        branchName,
        uploadResult.uploaded,
        deleteResult.deleted,
        [...appliedProtectedDeletePaths],
        Date.now() - startTime,
      );
    },
    { "cli.dryRun": options.dryRun ?? false },
  );
}
