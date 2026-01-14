/**
 * Push command - Upload local project files to a new Veryfront branch
 *
 * Scans local files and uploads them to the API using relative paths.
 * Creates a new branch for the changes which can be merged in Studio.
 *
 * @module cli/commands/push
 */

import { join, relative } from "@veryfront/platform/compat/path/index.ts";
import { cliLogger } from "@veryfront/utils";
import { cwd } from "@veryfront/platform/compat/process.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import {
  type ApiClient,
  createApiClient,
  resolveConfig,
  type ResolvedConfig,
} from "../shared/config.ts";
import {
  confirmPrompt,
  createSpinner,
  logError,
  logInfo,
  logSuccess,
  logWarning,
} from "../utils/index.ts";

/**
 * Push command options
 */
export interface PushOptions {
  /** Project directory (defaults to cwd) */
  projectDir?: string;
  /** Branch name to create (auto-generated if not provided) */
  branch?: string;
  /** Force push without confirmation */
  force?: boolean;
  /** Dry run - show what would be uploaded without uploading */
  dryRun?: boolean;
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

/**
 * Scan local project for files to upload
 */
async function scanLocalFiles(projectDir: string): Promise<UploadOp[]> {
  const fs = createFileSystem();
  const ops: UploadOp[] = [];
  const excludeDirs = new Set(["node_modules", ".git", ".veryfront", ".deno"]);

  async function walk(currentDir: string) {
    const entries = await fs.readDir(currentDir);

    for await (const entry of entries) {
      const entryPath = join(currentDir, entry.name);
      const relativePath = relative(projectDir, entryPath);

      if (entry.isDirectory) {
        // Skip excluded directories and hidden directories
        if (!excludeDirs.has(entry.name) && !entry.name.startsWith(".")) {
          await walk(entryPath);
        }
      } else {
        // Skip hidden files and common config files
        if (entry.name.startsWith(".")) continue;
        if (entry.name === "deno.json" || entry.name === "deno.lock") continue;
        if (entry.name === "package.json" || entry.name === "package-lock.json") continue;

        const content = await fs.readTextFile(entryPath);

        ops.push({
          path: relativePath,
          content,
        });
      }
    }
  }

  await walk(projectDir);
  return ops;
}

/**
 * Generate a branch name for CLI push
 */
export function generateBranchName(): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
  return `cli/push-${timestamp}`;
}

/**
 * Create a new branch for the push
 */
export async function createBranch(
  client: ApiClient,
  projectSlug: string,
  branchName: string,
): Promise<BranchResponse> {
  return await client.post<BranchResponse>(`/projects/${projectSlug}/branches`, {
    name: branchName,
  });
}

/**
 * Upload files to the API using the files endpoint
 * When branchId is null, files are pushed directly to main
 */
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
      const encodedPath = encodeURIComponent(op.path);
      // Use branch_id query param only when pushing to a branch (not main)
      const url = branchId
        ? `/projects/${projectSlug}/files/${encodedPath}?branch_id=${branchId}`
        : `/projects/${projectSlug}/files/${encodedPath}`;
      await client.put(url, {
        content: op.content,
      });
      uploaded++;
    } catch (error) {
      cliLogger.error(`Failed to upload ${op.path}:`, error);
      failed++;
    }
  }

  return { uploaded, failed };
}

/**
 * Push local files to Veryfront
 * - By default, creates a new auto-generated branch
 * - With --branch=<name>, creates a branch with that name
 * - With --branch=main, pushes directly to main (no branch creation)
 */
export async function pushCommand(options: PushOptions = {}): Promise<void> {
  const {
    projectDir = cwd(),
    branch,
    force = false,
    dryRun = false,
  } = options;

  const spinner = createSpinner("Resolving configuration...");
  spinner.start();

  let config: ResolvedConfig;
  try {
    config = await resolveConfig(projectDir);
  } catch (error) {
    spinner.stop();
    throw error;
  }

  spinner.update("Scanning local files...");

  const ops = await scanLocalFiles(projectDir);

  if (ops.length === 0) {
    spinner.stop();
    logInfo("No files to push.");
    return;
  }

  spinner.stop();

  const branchName = branch || generateBranchName();
  const isMainBranch = branchName === "main";

  cliLogger.info(
    `\nFound ${ops.length} files to push to ${isMainBranch ? "main" : `branch "${branchName}"`}.`,
  );

  // Confirm if not forced and not dry run
  if (!force && !dryRun) {
    const confirmMessage = isMainBranch
      ? `Push ${ops.length} files directly to main?`
      : `Create branch "${branchName}" and upload ${ops.length} files?`;
    const confirmed = await confirmPrompt(confirmMessage, true);
    if (!confirmed) {
      cliLogger.info("Push cancelled.");
      return;
    }
  }

  if (dryRun) {
    await uploadFiles(createApiClient(config), config.projectSlug, null, ops, true);
    logInfo(
      `Dry run complete. Would upload ${ops.length} files to ${
        isMainBranch ? "main" : `branch "${branchName}"`
      }.`,
    );
    return;
  }

  const client = createApiClient(config);

  // Step 1: Create branch (skip for main)
  let branchId: string | null = null;
  spinner.start();

  if (!isMainBranch) {
    spinner.update(`Creating branch "${branchName}"...`);

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
  } else {
    spinner.update("Pushing to main...");
  }

  // Step 2: Upload files
  spinner.update("Uploading files...");

  const result = await uploadFiles(
    client,
    config.projectSlug,
    branchId,
    ops,
    false,
  );

  spinner.stop();

  if (result.uploaded > 0) {
    if (isMainBranch) {
      logSuccess(`Pushed ${result.uploaded} files to main.`);
    } else {
      logSuccess(`Pushed ${result.uploaded} files to branch "${branchName}".`);
      // Show merge instructions only for branches
      cliLogger.info("");
      logInfo(`To merge your changes, open Studio and merge the branch:`);
      cliLogger.info(
        `  https://studio.veryfront.com/${config.projectSlug}/branches`,
      );
    }
  }
  if (result.failed > 0) {
    logWarning(`Failed to upload ${result.failed} files.`);
  }
}
