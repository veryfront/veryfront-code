/**
 * Push command - Upload local project files to a new Veryfront branch
 *
 * Scans local files and uploads them to the API using relative paths.
 * Creates a new branch for the changes which can be merged in Studio.
 *
 * @module cli/commands/push
 */

import { join, relative } from "#veryfront/platform/compat/path/index.ts";
import { cliLogger } from "#veryfront/utils";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  type ApiClient,
  createApiClient,
  resolveConfig,
  type ResolvedConfig,
} from "../shared/config.ts";
import {
  confirmPrompt,
  createNoopSpinner,
  createSpinner,
  logError,
  logInfo,
  logSuccess,
  logWarning,
} from "../utils/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { createIgnoreChecker, type IgnoreChecker, loadIgnorePatterns } from "../sync/ignore.ts";

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

/**
 * Scan local project for files to upload using .vfignore patterns
 */
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

      // Check if path should be ignored
      if (ignoreChecker.isIgnored(relativePath)) {
        continue;
      }

      if (entry.isDirectory) {
        await walk(entryPath);
        continue;
      }

      // Only include supported file extensions
      if (!ignoreChecker.isSupportedExtension(entry.name)) {
        continue;
      }

      const content = await fs.readTextFile(entryPath);
      ops.push({ path: relativePath, content });
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
export function createBranch(
  client: ApiClient,
  projectSlug: string,
  branchName: string,
): Promise<BranchResponse> {
  return client.post<BranchResponse>(`/projects/${projectSlug}/branches`, {
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
      const url = branchId
        ? `/projects/${projectSlug}/files/${encodedPath}?branch_id=${branchId}`
        : `/projects/${projectSlug}/files/${encodedPath}`;

      await client.put(url, { content: op.content });
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
export function pushCommand(options: PushOptions = {}): Promise<void> {
  return withSpan(
    "cli.command.push",
    async () => {
      const {
        projectSlug: slugOverride,
        projectDir = cwd(),
        branch,
        force = false,
        dryRun = false,
        quiet = false,
      } = options;

      const spinner = quiet ? createNoopSpinner() : createSpinner("Resolving configuration...");
      spinner.start();

      let config: ResolvedConfig;
      try {
        config = await resolveConfig(projectDir);
        if (slugOverride) config = { ...config, projectSlug: slugOverride };
      } catch (error) {
        spinner.stop();
        throw error;
      }

      spinner.update("Loading ignore patterns...");
      const ignorePatterns = await loadIgnorePatterns(projectDir);
      const ignoreChecker = createIgnoreChecker(ignorePatterns);

      spinner.update("Scanning local files...");
      const ops = await scanLocalFiles(projectDir, ignoreChecker);

      if (ops.length === 0) {
        spinner.stop();
        if (!quiet) logInfo("No files to push.");
        return;
      }

      spinner.stop();

      const branchName = branch || generateBranchName();
      const isMainBranch = branchName === "main";

      if (!quiet) {
        cliLogger.info(
          `\nFound ${ops.length} files to push to ${
            isMainBranch ? "main" : `branch "${branchName}"`
          }.`,
        );
      }

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

      const client = createApiClient(config);

      if (dryRun) {
        await uploadFiles(client, config.projectSlug, null, ops, true);
        if (!quiet) {
          logInfo(
            `Dry run complete. Would upload ${ops.length} files to ${
              isMainBranch ? "main" : `branch "${branchName}"`
            }.`,
          );
        }
        return;
      }

      let branchId: string | null = null;
      spinner.start();

      if (isMainBranch) {
        spinner.update("Pushing to main...");
      } else {
        spinner.update(`Creating branch "${branchName}"...`);
        try {
          const createdBranch = await createBranch(
            client,
            config.projectSlug,
            branchName,
          );
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

      spinner.update("Uploading files...");
      const result = await uploadFiles(
        client,
        config.projectSlug,
        branchId,
        ops,
        false,
      );

      spinner.stop();

      if (quiet) return;

      if (result.uploaded > 0) {
        if (isMainBranch) {
          logSuccess(`Pushed ${result.uploaded} files to main.`);
        } else {
          logSuccess(`Pushed ${result.uploaded} files to branch "${branchName}".`);
          cliLogger.info("");
          logInfo(`To merge your changes, open Studio and merge the branch:`);
          cliLogger.info(
            `  https://veryfront.com/projects/${config.projectSlug}/branches`,
          );
        }
      }

      if (result.failed > 0) {
        logWarning(`Failed to upload ${result.failed} files.`);
      }
    },
    { "cli.dryRun": options.dryRun ?? false },
  );
}
