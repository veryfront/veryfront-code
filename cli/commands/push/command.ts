/**
 * Push command - Upload local project files to a new Veryfront branch
 *
 * Scans local files and uploads them to the API using relative paths.
 * Creates a new branch for the changes which can be merged in Studio.
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
  resolveConfigWithAuth,
  type ResolvedConfig,
  writeProjectSlug,
} from "#cli/shared/config";
import { reserveProjectSlug } from "#cli/shared/reserve-slug";
import { confirmPrompt, logInfo, logSuccess } from "#cli/utils";
import { createNoopSpinner, createSpinner } from "#cli/ui";
import { withSpan } from "veryfront/observability/otlp-setup";
import { createIgnoreChecker, type IgnoreChecker, loadIgnorePatterns } from "../../sync/ignore.ts";
import { listAllFiles, type PullSource } from "../pull/index.ts";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import {
  clearPushReceipt,
  computeSourceDigest,
  getProjectTarget,
  normalizeControlPlane,
  resolveGitSource,
  writePushReceipt,
} from "../../shared/deployment-provenance.ts";

/**
 * Schema factory for push command arguments
 */
export const getPushArgsSchema = defineSchema((v) =>
  v.object({
    projectSlug: v.string().optional(),
    projectDir: v.string().optional(),
    branch: v.string().optional(),
    force: v.boolean().default(false),
    dryRun: v.boolean().default(false),
    quiet: v.boolean().default(false),
  })
);

export const PushArgsSchema = lazySchema(getPushArgsSchema);

export type PushArgs = InferSchema<ReturnType<typeof getPushArgsSchema>>;

/**
 * Parse push command arguments from CLI args
 */
export const parsePushArgs = createArgParser(PushArgsSchema, {
  projectSlug: { ...CommonArgs.projectSlug, positional: 0 },
  projectDir: CommonArgs.projectDir,
  branch: CommonArgs.branch,
  force: CommonArgs.force,
  dryRun: CommonArgs.dryRun,
  quiet: CommonArgs.quiet,
});

/**
 * Push command options
 */
export interface PushOptions {
  /** Project slug to push to (overrides config) */
  projectSlug?: string;
  /** Project directory (defaults to cwd) */
  projectDir?: string;
  /** Branch name to create (auto-generated if not provided) */
  branch?: string;
  /** Force push without confirmation */
  force?: boolean;
  /** Dry run - show what would be uploaded without uploading */
  dryRun?: boolean;
  /** Quiet mode - suppress spinner/progress output */
  quiet?: boolean;
}

/**
 * File upload operation
 */
export interface UploadOp {
  /** Relative path from project root (sent to API) */
  path: string;
  content: string;
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

interface ListBranchesResponse {
  data: BranchListItem[];
  page_info?: {
    next?: string;
  };
}

interface RemoteFile {
  path: string;
}

async function scanLocalFiles(
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

export function generateBranchName(): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
  return `push-${timestamp}`;
}

export function createBranch(
  client: ApiClient,
  projectSlug: string,
  branchName: string,
): Promise<BranchResponse> {
  return client.post<BranchResponse>(`/projects/${projectSlug}/branches`, { name: branchName });
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
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
      `/projects/${projectSlug}/branches`,
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
): Promise<BranchListItem> {
  try {
    return await createBranch(client, projectSlug, branchName);
  } catch (error) {
    if (getErrorStatus(error) !== 409) throw error;

    const existingBranch = await getBranchByName(client, projectSlug, branchName);
    if (existingBranch) return existingBranch;

    throw error;
  }
}

export async function resolvePushRemoteFiles(
  client: ApiClient,
  projectSlug: string,
  branchName: string,
  mainFiles: RemoteFile[],
): Promise<{ branchId: string | null; remoteFiles: RemoteFile[]; source: PullSource }> {
  const mainSource = { type: "main" } satisfies PullSource;
  if (branchName === "main") return { branchId: null, remoteFiles: mainFiles, source: mainSource };

  const existingBranch = await getBranchByName(client, projectSlug, branchName);
  if (!existingBranch) return { branchId: null, remoteFiles: mainFiles, source: mainSource };

  const branchSource = { type: "branch", name: branchName } satisfies PullSource;
  const remoteFiles = await listAllFiles(client, projectSlug, branchSource);
  return { branchId: existingBranch.id, remoteFiles, source: branchSource };
}

function buildFileUrl(projectSlug: string, path: string, branchId: string | null): string {
  const encodedPath = encodeURIComponent(path);
  const base = `/projects/${projectSlug}/files/${encodedPath}`;
  return branchId ? `${base}?branch_id=${branchId}` : base;
}

export async function uploadFiles(
  client: ApiClient,
  projectSlug: string,
  branchId: string | null,
  ops: UploadOp[],
  dryRun: boolean,
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;

  for (const op of ops) {
    if (dryRun) {
      cliLogger.info(`  Would upload: ${op.path}`);
      uploaded++;
      continue;
    }

    try {
      await client.put(buildFileUrl(projectSlug, op.path, branchId), { content: op.content });
      uploaded++;
    } catch (error) {
      cliLogger.error(`Failed to upload ${op.path}:`, error);
      failed++;
    }
  }

  return { uploaded, failed };
}

export async function deleteFiles(
  client: ApiClient,
  projectSlug: string,
  branchId: string | null,
  paths: string[],
  dryRun: boolean,
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;

  for (const path of paths) {
    if (dryRun) {
      cliLogger.info(`  Would delete: ${path}`);
      deleted++;
      continue;
    }

    try {
      await client.delete(buildFileUrl(projectSlug, path, branchId));
      deleted++;
    } catch (error) {
      cliLogger.error(`Failed to delete ${path}:`, error);
      failed++;
    }
  }

  return { deleted, failed };
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

async function recordPushReceipt(
  client: ApiClient,
  config: ResolvedConfig,
  projectDir: string,
  branch: string,
  files: UploadOp[],
): Promise<void> {
  const [project, gitSource, sourceDigest] = await Promise.all([
    getProjectTarget(client, config.projectSlug),
    resolveGitSource(projectDir),
    computeSourceDigest(files),
  ]);
  await writePushReceipt(projectDir, {
    controlPlane: normalizeControlPlane(config.apiUrl),
    projectId: project.id,
    projectSlug: project.slug,
    branch,
    commitSha: gitSource.commitSha,
    sourceDigest,
    clean: gitSource.clean,
  });
}

export function pushCommand(options: PushOptions = {}): Promise<void> {
  return withSpan(
    "cli.command.push",
    async (): Promise<void> => {
      const {
        projectSlug: slugOverride,
        projectDir = cwd(),
        branch,
        force = false,
        dryRun = false,
        quiet = false,
      } = options;

      let spinner = quiet ? createNoopSpinner() : createSpinner("Resolving configuration...");

      let config: ResolvedConfig;
      try {
        // Use interactive auth - prompts for login if not authenticated
        config = await resolveConfigWithAuth(projectDir);
      } catch (error) {
        spinner.stop();
        throw error;
      }

      if (slugOverride) config = { ...config, projectSlug: slugOverride };

      spinner.update("Loading ignore patterns...");
      const ignorePatterns = await loadIgnorePatterns(projectDir);
      const ignoreChecker = createIgnoreChecker(ignorePatterns);

      spinner.update("Scanning local files...");
      const ops = await scanLocalFiles(projectDir, ignoreChecker);
      const localPaths = new Set(ops.map((op) => op.path));

      spinner.update("Fetching remote files...");
      const client = createApiClient(config);
      const branchName = branch || generateBranchName();
      const isMainBranch = branchName === "main";

      // First-push: If project doesn't exist on server yet, create it
      let mainFiles: RemoteFile[] = [];
      try {
        mainFiles = await listAllFiles(client, config.projectSlug, { type: "main" });
      } catch (error) {
        // Project doesn't exist yet - create it on first push
        if (getErrorStatus(error) === 404) {
          spinner.update("Creating project...");
          const reserveResult = await reserveProjectSlug(
            config.projectSlug,
            config.apiToken,
            undefined,
            config.apiUrl,
          );
          if (reserveResult.slug !== config.projectSlug) {
            await writeProjectSlug(projectDir, reserveResult.slug);
            logInfo(`Project slug: ${reserveResult.slug}`);
          }
          config = { ...config, projectSlug: reserveResult.slug };
          // Now try to get files again (should be empty for new project)
          try {
            mainFiles = await listAllFiles(client, config.projectSlug, { type: "main" });
          } catch {
            // Project just created, no files yet
            mainFiles = [];
          }
        } else {
          throw error;
        }
      }

      const target = await resolvePushRemoteFiles(
        client,
        config.projectSlug,
        branchName,
        mainFiles,
      );
      const toDelete = target.remoteFiles.map((f) => f.path).filter((p) => !localPaths.has(p));

      if (ops.length === 0 && toDelete.length === 0) {
        try {
          if (!dryRun) {
            await clearPushReceipt(projectDir);
            spinner.update("Verifying push target...");
            await recordPushReceipt(client, config, projectDir, branchName, ops);
          }
        } finally {
          spinner.stop();
        }
        if (!quiet) logInfo("No changes to push.");
        return;
      }

      spinner.stop();

      if (!quiet) {
        const parts = buildSummaryParts(ops, toDelete);
        cliLogger.info(
          `\nFound ${formatParts(parts)} for ${isMainBranch ? "main" : `branch "${branchName}"`}.`,
        );
      }

      if (!force && !dryRun) {
        const parts = buildConfirmParts(ops, toDelete);
        const confirmMessage = isMainBranch
          ? `Push to main (${parts.join(", ")} files)?`
          : target.branchId
          ? `Push to branch "${branchName}" and ${parts.join(", ")} files?`
          : `Create branch "${branchName}" and ${parts.join(", ")} files?`;

        const confirmed = await confirmPrompt(confirmMessage, true);
        if (!confirmed) {
          cliLogger.info("Push cancelled.");
          return;
        }
      }

      if (dryRun) {
        if (ops.length > 0) {
          await uploadFiles(client, config.projectSlug, target.branchId, ops, true);
        }
        if (toDelete.length > 0) {
          await deleteFiles(client, config.projectSlug, target.branchId, toDelete, true);
        }

        if (!quiet) {
          const parts = buildConfirmParts(ops, toDelete);
          logInfo(`Dry run complete. Would ${parts.join(" and ")} files.`);
        }
        return;
      }

      await clearPushReceipt(projectDir);

      let branchId = target.branchId;
      const uploadMsg = isMainBranch
        ? "Pushing to main..."
        : branchId
        ? `Pushing to branch "${branchName}"...`
        : `Creating branch "${branchName}"...`;
      spinner = quiet ? createNoopSpinner() : createSpinner(uploadMsg);

      if (!isMainBranch && !branchId) {
        try {
          const preparedBranch = await ensureBranch(client, config.projectSlug, branchName);
          branchId = preparedBranch.id;
        } catch (error) {
          spinner.stop();
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to prepare branch "${branchName}": ${message}`);
        }
      }

      let uploadResult = { uploaded: 0, failed: 0 };
      let deleteResult = { deleted: 0, failed: 0 };

      if (ops.length > 0) {
        spinner.update("Uploading files...");
        uploadResult = await uploadFiles(client, config.projectSlug, branchId, ops, false);
      }

      if (toDelete.length > 0) {
        spinner.update("Deleting removed files...");
        deleteResult = await deleteFiles(client, config.projectSlug, branchId, toDelete, false);
      }

      const failedTotal = uploadResult.failed + deleteResult.failed;
      if (failedTotal > 0) {
        spinner.stop();
        throw new Error(`Push failed for ${failedTotal} file${failedTotal === 1 ? "" : "s"}`);
      }

      spinner.update("Verifying push target...");
      try {
        await recordPushReceipt(client, config, projectDir, branchName, ops);
      } finally {
        spinner.stop();
      }

      if (quiet) return;

      const successParts: string[] = [];
      if (uploadResult.uploaded > 0) successParts.push(`${uploadResult.uploaded} uploaded`);
      if (deleteResult.deleted > 0) successParts.push(`${deleteResult.deleted} deleted`);

      if (successParts.length > 0) {
        if (isMainBranch) {
          logSuccess(`Pushed to main: ${successParts.join(", ")}.`);
        } else {
          logSuccess(`Pushed to branch "${branchName}": ${successParts.join(", ")}.`);
          cliLogger.info("");
          logInfo(`Preview: https://${config.projectSlug}--${branchName}.preview.veryfront.com`);
          logInfo(`Merge:   https://veryfront.com/projects/${config.projectSlug}/branches`);
        }
      }
    },
    { "cli.dryRun": options.dryRun ?? false },
  );
}
