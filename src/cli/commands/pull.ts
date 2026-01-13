/**
 * Pull command - Download project files from Veryfront API
 *
 * Downloads all files from the remote Veryfront project using the files API
 * and writes them to the local filesystem with their original paths.
 *
 * @module cli/commands/pull
 */

import { dirname, join } from "@veryfront/platform/compat/path/index.ts";
import { cliLogger } from "@veryfront/utils";
import { cwd } from "@veryfront/platform/compat/process.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import {
  createApiClient,
  readConfigFile,
  resolveConfig,
  type ResolvedConfig,
} from "../shared/config.ts";
import { confirmPrompt, createSpinner, logInfo, logSuccess, logWarning } from "../utils/index.ts";
import { getApiTokenEnv } from "@veryfront/core/config/env.ts";

/**
 * Pull source type - determines which API endpoint to use
 */
export type PullSource =
  | { type: "main" }
  | { type: "branch"; name: string }
  | { type: "environment"; name: string }
  | { type: "release"; version: string };

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
  /** Environment name to pull from (e.g., "production", "staging") */
  env?: string;
  /** Release version to pull from (e.g., "v1.2.0") */
  release?: string;
  /** Force overwrite without confirmation */
  force?: boolean;
  /** Dry run - show what would be written without writing */
  dryRun?: boolean;
}

/**
 * Resolve pull source from options
 * Priority: env > release > branch > main
 */
export function resolvePullSource(options: PullOptions): PullSource {
  if (options.env) {
    return { type: "environment", name: options.env };
  }
  if (options.release) {
    return { type: "release", version: options.release };
  }
  if (options.branch && options.branch !== "main") {
    return { type: "branch", name: options.branch };
  }
  return { type: "main" };
}

/**
 * File from the API
 */
interface ProjectFile {
  id?: string;
  path: string;
  size: number;
  type: string;
  mime_type?: string;
  created_at: string;
  updated_at: string;
}

/**
 * List files response from API
 */
interface ListFilesResponse {
  data: ProjectFile[];
  page_info?: {
    next?: string;
    prev?: string;
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
 * Build the files list URL based on pull source
 */
export function buildFilesListUrl(projectSlug: string, source: PullSource): string {
  switch (source.type) {
    case "environment":
      return `/projects/${projectSlug}/environments/${encodeURIComponent(source.name)}/files`;
    case "release":
      return `/projects/${projectSlug}/releases/${encodeURIComponent(source.version)}/files`;
    case "branch":
      return `/projects/${projectSlug}/branches/${encodeURIComponent(source.name)}/files`;
    case "main":
    default:
      return `/projects/${projectSlug}/files`;
  }
}

/**
 * Fetch all files from API with pagination
 * Supports main, branch, environment, and release sources
 */
export async function listAllFiles(
  client: ReturnType<typeof createApiClient>,
  projectSlug: string,
  source: PullSource,
): Promise<ProjectFile[]> {
  const allFiles: ProjectFile[] = [];
  let cursor: string | undefined;

  const url = buildFilesListUrl(projectSlug, source);

  do {
    const params: Record<string, string> = {
      limit: "100",
      sort_by: "updated_at",
      sort_order: "desc",
    };
    if (cursor) params.cursor = cursor;

    const response = await client.get<ListFilesResponse>(url, params);

    allFiles.push(...response.data);
    cursor = response.page_info?.next;
  } while (cursor);

  return allFiles;
}

/**
 * Build the file content URL based on pull source
 */
export function buildFileContentUrl(projectSlug: string, path: string, source: PullSource): string {
  const encodedPath = encodeURIComponent(path);
  switch (source.type) {
    case "environment":
      return `/projects/${projectSlug}/environments/${encodeURIComponent(source.name)}/files/${encodedPath}`;
    case "release":
      return `/projects/${projectSlug}/releases/${encodeURIComponent(source.version)}/files/${encodedPath}`;
    case "branch":
      return `/projects/${projectSlug}/branches/${encodeURIComponent(source.name)}/files/${encodedPath}`;
    case "main":
    default:
      return `/projects/${projectSlug}/files/${encodedPath}`;
  }
}

/**
 * Get file content from API
 * Supports main, branch, environment, and release sources
 */
export async function getFileContent(
  client: ReturnType<typeof createApiClient>,
  projectSlug: string,
  path: string,
  source: PullSource,
): Promise<string> {
  const url = buildFileContentUrl(projectSlug, path, source);
  const response = await client.get<{ path: string; content: string; size: number }>(url);

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
  source: PullSource,
  fs: ReturnType<typeof createFileSystem>,
): Promise<{ success: boolean; path: string; error?: Error }> {
  try {
    const content = await getFileContent(client, projectSlug, op.relativePath, source);
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
  source: PullSource,
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
      batch.map((op) => processFile(op, client, projectSlug, source, fs)),
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
 * Format pull source for display
 */
function formatPullSource(source: PullSource): string {
  switch (source.type) {
    case "environment":
      return `environment: ${source.name}`;
    case "release":
      return `release: ${source.version}`;
    case "branch":
      return `branch: ${source.name}`;
    case "main":
    default:
      return "main";
  }
}

/**
 * Pull files for a single project
 */
async function pullSingleProject(
  projectSlug: string,
  projectDir: string,
  source: PullSource,
  force: boolean,
  dryRun: boolean,
  config: ResolvedConfig,
): Promise<{ written: number; skipped: number }> {
  const sourceLabel = formatPullSource(source);
  const spinner = createSpinner(`Fetching files from ${projectSlug} (${sourceLabel})...`);
  spinner.start();

  const client = createApiClient({ ...config, projectSlug });

  let files: ProjectFile[];
  try {
    files = await listAllFiles(client, projectSlug, source);
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

  const result = await writeFiles(writeOps, client, projectSlug, source, dryRun);

  spinner.stop();

  if (dryRun) {
    logInfo(`Dry run complete for ${projectSlug}. Would write ${result.written} files.`);
  } else {
    logSuccess(`Pulled ${result.written} files from ${projectSlug} (${sourceLabel}).`);
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
    force = false,
    dryRun = false,
  } = options;

  // Resolve pull source from options (env > release > branch > main)
  const source = resolvePullSource(options);

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
      const apiToken = getApiTokenEnv();
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
          source,
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
    source,
    force,
    dryRun,
    config,
  );
}
