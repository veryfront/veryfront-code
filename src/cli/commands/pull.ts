/**
 * Pull command - Download project files from Veryfront API
 *
 * Downloads all files from the remote Veryfront project using the files API
 * and writes them to the local filesystem with their original paths.
 *
 * @module cli/commands/pull
 */

import { dirname, join } from "std/path/mod.ts";
import { cliLogger } from "@veryfront/utils";
import { cwd } from "../../platform/compat/process.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";
import { createApiClient, resolveConfig, type ResolvedConfig } from "../shared/config.ts";
import { confirmPrompt, createSpinner, logInfo, logSuccess, logWarning } from "../utils/index.ts";

/**
 * Pull command options
 */
export interface PullOptions {
  /** Project directory (defaults to cwd) */
  projectDir?: string;
  /** Branch name to pull from (optional) */
  branch?: string;
  /** Force overwrite without confirmation */
  force?: boolean;
  /** Dry run - show what would be written without writing */
  dryRun?: boolean;
}

/**
 * File from the API
 */
interface ProjectFile {
  id?: string;
  path: string;
  size: number;
  type: string;
  mimeType?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * List files response from API
 */
interface ListFilesResponse {
  data: ProjectFile[];
  pagination?: {
    cursor?: string;
    hasMore: boolean;
  };
}

/**
 * File write operation
 */
interface WriteOp {
  path: string;
  relativePath: string;
}

/**
 * Fetch all files from API with pagination
 */
async function listAllFiles(
  client: ReturnType<typeof createApiClient>,
  projectSlug: string,
  branch?: string,
): Promise<ProjectFile[]> {
  const allFiles: ProjectFile[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = {
      limit: "10000",
      sortBy: "updatedAt",
      sortOrder: "desc",
    };
    if (cursor) params.cursor = cursor;
    if (branch) params.branch = branch;

    const response = await client.get<ListFilesResponse>(
      `/projects/${projectSlug}/files`,
      params,
    );

    allFiles.push(...response.data);
    cursor = response.pagination?.hasMore ? response.pagination.cursor : undefined;
  } while (cursor);

  return allFiles;
}

/**
 * Get file content from API
 */
async function getFileContent(
  client: ReturnType<typeof createApiClient>,
  projectSlug: string,
  path: string,
  branch?: string,
): Promise<string> {
  const encodedPath = encodeURIComponent(path);
  const params: Record<string, string> = {};
  if (branch) params.branch = branch;

  const response = await client.get<{ path: string; content: string; size: number }>(
    `/projects/${projectSlug}/files/${encodedPath}`,
    params,
  );

  return response.content;
}

/**
 * Write files to disk
 */
async function writeFiles(
  ops: WriteOp[],
  client: ReturnType<typeof createApiClient>,
  projectSlug: string,
  branch: string | undefined,
  dryRun: boolean,
): Promise<{ written: number; skipped: number }> {
  const fs = createFileSystem();
  let written = 0;
  let skipped = 0;

  for (const op of ops) {
    if (dryRun) {
      cliLogger.info(`  Would write: ${op.relativePath}`);
      written++;
      continue;
    }

    try {
      // Fetch content
      const content = await getFileContent(client, projectSlug, op.relativePath, branch);

      // Ensure parent directory exists
      const dir = dirname(op.path);
      await fs.mkdir(dir, { recursive: true });

      // Write the file
      await fs.writeTextFile(op.path, content);
      written++;
    } catch (error) {
      cliLogger.error(`Failed to write ${op.relativePath}:`, error);
      skipped++;
    }
  }

  return { written, skipped };
}

/**
 * Pull files from Veryfront API
 */
export async function pullCommand(options: PullOptions = {}): Promise<void> {
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

  spinner.update(`Fetching files from ${config.projectSlug}...`);

  const client = createApiClient(config);

  let files: ProjectFile[];
  try {
    files = await listAllFiles(client, config.projectSlug, branch);
  } catch (error) {
    spinner.stop();
    throw error;
  }

  spinner.stop();

  if (files.length === 0) {
    logInfo("No files to pull.");
    return;
  }

  // Convert to write operations using path from API directly
  const writeOps: WriteOp[] = files.map((file) => ({
    path: join(projectDir, file.path),
    relativePath: file.path,
  }));

  cliLogger.info(`\nFound ${files.length} files to ${dryRun ? "pull" : "write"}.`);

  // Confirm if not forced
  if (!force && !dryRun) {
    const confirmed = await confirmPrompt(
      "This will overwrite local files. Continue?",
      false,
    );
    if (!confirmed) {
      cliLogger.info("Pull cancelled.");
      return;
    }
  }

  // Write files
  spinner.start();
  spinner.update("Writing files...");

  const result = await writeFiles(writeOps, client, config.projectSlug, branch, dryRun);

  spinner.stop();

  if (dryRun) {
    logInfo(`Dry run complete. Would write ${result.written} files.`);
  } else {
    logSuccess(
      `Pulled ${result.written} files from ${config.projectSlug}${
        branch ? ` (branch: ${branch})` : ""
      }.`,
    );
    if (result.skipped > 0) {
      logWarning(`Skipped ${result.skipped} files due to errors.`);
    }
  }
}
