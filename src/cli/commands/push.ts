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
interface UploadOp {
  /** Relative path from project root (sent to API) */
  path: string;
  content: string;
}

/**
 * API response for branch creation
 */
interface BranchResponse {
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
function generateBranchName(): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
  return `cli/push-${timestamp}`;
}

/**
 * Create a new branch for the push
 */
async function createBranch(
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
 */
async function uploadFiles(
  client: ApiClient,
  projectSlug: string,
  branchId: string,
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
      await client.put(`/projects/${projectSlug}/files/${encodedPath}?branchId=${branchId}`, {
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
 * Push local files to a new Veryfront branch
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

  cliLogger.info(`\nFound ${ops.length} files to push to branch "${branchName}".`);

  // Confirm if not forced and not dry run
  if (!force && !dryRun) {
    const confirmed = await confirmPrompt(
      `Create branch "${branchName}" and upload ${ops.length} files?`,
      true,
    );
    if (!confirmed) {
      cliLogger.info("Push cancelled.");
      return;
    }
  }

  if (dryRun) {
    await uploadFiles(createApiClient(config), config.projectSlug, "", ops, true);
    logInfo(
      `Dry run complete. Would upload ${ops.length} files to branch "${branchName}".`,
    );
    return;
  }

  const client = createApiClient(config);

  // Step 1: Create branch
  spinner.start();
  spinner.update(`Creating branch "${branchName}"...`);

  let createdBranch: BranchResponse;
  try {
    createdBranch = await createBranch(client, config.projectSlug, branchName);
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

  // Step 2: Upload files to the branch
  spinner.update("Uploading files...");

  const result = await uploadFiles(
    client,
    config.projectSlug,
    createdBranch.id,
    ops,
    false,
  );

  spinner.stop();

  if (result.uploaded > 0) {
    logSuccess(`Pushed ${result.uploaded} files to branch "${branchName}".`);
  }
  if (result.failed > 0) {
    logWarning(`Failed to upload ${result.failed} files.`);
  }

  // Show merge instructions
  cliLogger.info("");
  logInfo(`To merge your changes, open Studio and merge the branch:`);
  cliLogger.info(
    `  https://studio.veryfront.com/${config.projectSlug}/branches`,
  );
}
