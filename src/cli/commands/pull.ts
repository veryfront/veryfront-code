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
import {
  createApiClient,
  readConfigFile,
  resolveConfig,
  type ResolvedConfig,
} from "../shared/config.ts";
import { confirmPrompt, createSpinner, logInfo, logSuccess, logWarning } from "../utils/index.ts";

/**
 * Pull command options
 */
export interface PullOptions {
  /** Project slug to pull from */
  projectSlug?: string;
  /** List of project slugs to pull (each into its own directory) */
  projects?: string[];
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

  // Ensure text files end with a trailing newline (POSIX standard)
  const content = response.content;
  if (content && !content.endsWith("\n")) {
    return content + "\n";
  }
  return content;
}

/** Concurrency limit for parallel file fetches */
const CONCURRENCY = 20;

/**
 * Process a single file: fetch content and write to disk
 */
async function processFile(
  op: WriteOp,
  client: ReturnType<typeof createApiClient>,
  projectSlug: string,
  branch: string | undefined,
  fs: ReturnType<typeof createFileSystem>,
): Promise<{ success: boolean; path: string; error?: Error }> {
  try {
    const content = await getFileContent(client, projectSlug, op.relativePath, branch);
    const dir = dirname(op.path);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeTextFile(op.path, content);
    return { success: true, path: op.relativePath };
  } catch (error) {
    return { success: false, path: op.relativePath, error: error as Error };
  }
}

/**
 * Write files to disk with parallel fetching
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

  if (dryRun) {
    for (const op of ops) {
      cliLogger.info(`  Would write: ${op.relativePath}`);
      written++;
    }
    return { written, skipped };
  }

  // Process files in parallel with concurrency limit
  const results: Array<{ success: boolean; path: string; error?: Error }> = [];
  for (let i = 0; i < ops.length; i += CONCURRENCY) {
    const batch = ops.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((op) => processFile(op, client, projectSlug, branch, fs)),
    );
    results.push(...batchResults);
  }

  // Count results and log errors
  for (const result of results) {
    if (result.success) {
      written++;
    } else {
      cliLogger.error(`Failed to write ${result.path}:`, result.error);
      skipped++;
    }
  }

  return { written, skipped };
}

/**
 * Pull files for a single project
 */
async function pullSingleProject(
  projectSlug: string,
  projectDir: string,
  branch: string | undefined,
  force: boolean,
  dryRun: boolean,
  config: ResolvedConfig,
): Promise<{ written: number; skipped: number }> {
  const spinner = createSpinner(`Fetching files from ${projectSlug}...`);
  spinner.start();

  const client = createApiClient({ ...config, projectSlug });

  let files: ProjectFile[];
  try {
    files = await listAllFiles(client, projectSlug, branch);
  } catch (error) {
    spinner.stop();
    throw error;
  }

  spinner.stop();

  if (files.length === 0) {
    logInfo(`No files to pull from ${projectSlug}.`);
    return { written: 0, skipped: 0 };
  }

  // Convert to write operations using path from API directly
  const writeOps: WriteOp[] = files.map((file) => ({
    path: join(projectDir, file.path),
    relativePath: file.path,
  }));

  cliLogger.info(
    `\nFound ${files.length} files to ${dryRun ? "pull" : "write"} from ${projectSlug}.`,
  );

  // Confirm if not forced
  if (!force && !dryRun) {
    const confirmed = await confirmPrompt(
      `This will overwrite local files in ${projectDir}. Continue?`,
      false,
    );
    if (!confirmed) {
      cliLogger.info("Pull cancelled.");
      return { written: 0, skipped: 0 };
    }
  }

  // Write files
  spinner.start();
  spinner.update(`Writing files to ${projectDir}...`);

  const result = await writeFiles(writeOps, client, projectSlug, branch, dryRun);

  spinner.stop();

  if (dryRun) {
    logInfo(`Dry run complete for ${projectSlug}. Would write ${result.written} files.`);
  } else {
    logSuccess(
      `Pulled ${result.written} files from ${projectSlug}${branch ? ` (branch: ${branch})` : ""}.`,
    );
    if (result.skipped > 0) {
      logWarning(`Skipped ${result.skipped} files due to errors.`);
    }
  }

  return result;
}

/**
 * Pull files from Veryfront API
 */
export async function pullCommand(options: PullOptions = {}): Promise<void> {
  const {
    projectSlug: slugOverride,
    projects: projectsOverride,
    projectDir = cwd(),
    branch,
    force = false,
    dryRun = false,
  } = options;

  const spinner = createSpinner("Resolving configuration...");
  spinner.start();

  // Read config file to get projects list if not provided via CLI
  const configFile = await readConfigFile(projectDir);
  const projects = projectsOverride ?? configFile?.projects;

  let config: ResolvedConfig;
  try {
    config = await resolveConfig(projectDir);
    // Override project slug if provided via CLI argument
    if (slugOverride) {
      config = { ...config, projectSlug: slugOverride };
    }
  } catch (error) {
    spinner.stop();
    // If projects list is provided (CLI or config), we don't need the local config's projectSlug
    if (projects && projects.length > 0) {
      // Create a minimal config with just the API token from env or config file
      const apiToken = typeof Deno !== "undefined"
        ? Deno.env.get("VERYFRONT_API_TOKEN")
        : process?.env?.VERYFRONT_API_TOKEN;
      const token = apiToken ?? configFile?.apiToken;
      if (!token) {
        throw new Error(
          "VERYFRONT_API_TOKEN environment variable or apiToken in .veryfrontrc is required when using --projects",
        );
      }
      config = {
        apiUrl: configFile?.apiUrl ?? "https://api.veryfront.com",
        apiToken: token,
        projectSlug: "", // Will be overridden per-project
      };
    } else {
      throw error;
    }
  }

  spinner.stop();

  // Handle multiple projects
  if (projects && projects.length > 0) {
    const fs = createFileSystem();
    let totalWritten = 0;
    let totalSkipped = 0;

    for (const project of projects) {
      const targetDir = join(projectDir, project);

      // Create project directory
      if (!dryRun) {
        await fs.mkdir(targetDir, { recursive: true });
      }

      cliLogger.info(`\n--- Pulling ${project} into ${targetDir} ---`);

      try {
        const result = await pullSingleProject(
          project,
          targetDir,
          branch,
          force,
          dryRun,
          config,
        );
        totalWritten += result.written;
        totalSkipped += result.skipped;
      } catch (error) {
        cliLogger.error(`Failed to pull ${project}:`, error);
        totalSkipped++;
      }
    }

    cliLogger.info("");
    if (dryRun) {
      logInfo(
        `Dry run complete. Would write ${totalWritten} files total across ${projects.length} projects.`,
      );
    } else {
      logSuccess(`Pulled ${totalWritten} files total across ${projects.length} projects.`);
      if (totalSkipped > 0) {
        logWarning(`Skipped ${totalSkipped} files due to errors.`);
      }
    }
    return;
  }

  // Single project flow
  await pullSingleProject(
    config.projectSlug,
    projectDir,
    branch,
    force,
    dryRun,
    config,
  );
}
