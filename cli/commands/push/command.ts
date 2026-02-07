/**
 * Push command - Upload local project files to a new Veryfront branch
 *
 * Scans local files and uploads them to the API using relative paths.
 * Creates a new branch for the changes which can be merged in Studio.
 *
 * @module cli/commands/push
 */

import { z } from "zod";
import { join, relative } from "veryfront/platform/path";
import { cliLogger } from "#cli/utils";
import { cwd } from "veryfront/platform";
import { createFileSystem } from "veryfront/platform";
import {
  type ApiClient,
  createApiClient,
  resolveConfigWithAuth,
  type ResolvedConfig,
} from "#cli/shared/config";
import { reserveProjectSlug } from "../new/reserve-slug.ts";
import { confirmPrompt, logError, logInfo, logSuccess, logWarning } from "#cli/utils";
import { createNoopSpinner, createSpinner } from "#cli/ui";
import { withSpan } from "veryfront/observability/otlp-setup";
import { createIgnoreChecker, type IgnoreChecker, loadIgnorePatterns } from "../../sync/ignore.ts";
import { listAllFiles } from "../pull/index.ts";
import { CommonArgs, createArgParser } from "#cli/shared/args";

/**
 * Zod schema for push command arguments
 */
export const PushArgsSchema = z.object({
  projectSlug: z.string().optional(),
  projectDir: z.string().optional(),
  branch: z.string().optional(),
  force: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

export type PushArgs = z.infer<typeof PushArgsSchema>;

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
  return `cli/push-${timestamp}`;
}

export function createBranch(
  client: ApiClient,
  projectSlug: string,
  branchName: string,
): Promise<BranchResponse> {
  return client.post<BranchResponse>(`/projects/${projectSlug}/branches`, { name: branchName });
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

      // First-push: If project doesn't exist on server yet, create it
      let remoteFiles: { path: string }[] = [];
      try {
        remoteFiles = await listAllFiles(client, config.projectSlug, { type: "main" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Project doesn't exist yet - create it on first push
        if (message.includes("404") || message.includes("not found")) {
          spinner.update("Creating project...");
          await reserveProjectSlug(config.projectSlug, config.apiToken);
          // Now try to get files again (should be empty for new project)
          try {
            remoteFiles = await listAllFiles(client, config.projectSlug, { type: "main" });
          } catch {
            // Project just created, no files yet
            remoteFiles = [];
          }
        } else {
          throw error;
        }
      }
      const toDelete = remoteFiles.map((f) => f.path).filter((p) => !localPaths.has(p));

      if (ops.length === 0 && toDelete.length === 0) {
        spinner.stop();
        if (!quiet) logInfo("No changes to push.");
        return;
      }

      spinner.stop();

      const branchName = branch || generateBranchName();
      const isMainBranch = branchName === "main";

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
          : `Create branch "${branchName}" and ${parts.join(", ")} files?`;

        const confirmed = await confirmPrompt(confirmMessage, true);
        if (!confirmed) {
          cliLogger.info("Push cancelled.");
          return;
        }
      }

      if (dryRun) {
        if (ops.length > 0) await uploadFiles(client, config.projectSlug, null, ops, true);
        if (toDelete.length > 0) {
          await deleteFiles(client, config.projectSlug, null, toDelete, true);
        }

        if (!quiet) {
          const parts = buildConfirmParts(ops, toDelete);
          logInfo(`Dry run complete. Would ${parts.join(" and ")} files.`);
        }
        return;
      }

      let branchId: string | null = null;
      const uploadMsg = isMainBranch ? "Pushing to main..." : `Creating branch "${branchName}"...`;
      spinner = quiet ? createNoopSpinner() : createSpinner(uploadMsg);

      if (!isMainBranch) {
        try {
          const createdBranch = await createBranch(client, config.projectSlug, branchName);
          branchId = createdBranch.id;
        } catch (error) {
          spinner.stop();
          const message = error instanceof Error ? error.message : String(error);

          if (message.includes("already exists")) {
            logError(
              `Branch "${branchName}" already exists. Use --branch to specify a different name.`,
            );
          } else {
            logError(`Failed to create branch: ${message}`);
          }
          return;
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

      spinner.stop();

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
          logInfo("To merge your changes, open Studio and merge the branch:");
          cliLogger.info(`  https://veryfront.com/projects/${config.projectSlug}/branches`);
        }
      }

      const failedTotal = uploadResult.failed + deleteResult.failed;
      if (failedTotal > 0) logWarning(`Failed: ${failedTotal} files.`);
    },
    { "cli.dryRun": options.dryRun ?? false },
  );
}
