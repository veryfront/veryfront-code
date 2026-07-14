/**
 * Pull command - Download project files from Veryfront API
 *
 * Downloads all files from the remote Veryfront project using the files API
 * and writes them to the local filesystem with their original paths.
 *
 * @module cli/commands/pull
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { dirname, isAbsolute, join, relative, resolve } from "veryfront/platform/path";
import { isNotFoundError, lstat } from "veryfront/fs";
import { cliLogger } from "#cli/utils";
import { resolveCliApiUrl } from "#cli/shared/constants";
import { createFileSystem, cwd, env, runCommand } from "veryfront/platform";
import {
  createApiClient,
  readConfigFile,
  resolveConfigWithAuth,
  type ResolvedConfig,
} from "#cli/shared/config";
import { confirmPrompt, isTTY, logInfo, logSuccess, logWarning } from "#cli/utils";
import { createNoopSpinner, createSpinner } from "#cli/ui";
import { isInteractive } from "../../shared/interactive.ts";
import { getApiTokenEnv, getEnvironmentConfig } from "veryfront/config";
import {
  ERROR_REGISTRY,
  type ErrorSlug,
  getErrorBySlug,
  INVALID_ARGUMENT,
  RESOURCE_NOT_FOUND,
  VeryfrontError,
} from "veryfront/errors";
import { withSpan } from "veryfront/observability/otlp-setup";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import { createIgnoreChecker, loadIgnorePatterns } from "../../sync/ignore.ts";

/**
 * Schema factory for pull command arguments
 */
export const getPullArgsSchema = defineSchema((v) =>
  v.object({
    projectSlug: v.string().optional(),
    projects: v.array(v.string()).optional(),
    projectDir: v.string().optional(),
    branch: v.string().optional(),
    env: v.string().optional(),
    release: v.string().optional(),
    force: v.boolean().default(false),
    dryRun: v.boolean().default(false),
    prune: v.boolean().default(false),
    quiet: v.boolean().default(false),
  })
);

export const PullArgsSchema = lazySchema(getPullArgsSchema);

export type PullArgs = InferSchema<ReturnType<typeof getPullArgsSchema>>;

/**
 * Parse pull command arguments from CLI args
 */
export const parsePullArgs = createArgParser(PullArgsSchema, {
  projectSlug: { ...CommonArgs.projectSlug, positional: 0 },
  projects: { keys: ["projects"], type: "array" },
  projectDir: CommonArgs.projectDir,
  branch: CommonArgs.branch,
  env: CommonArgs.env,
  release: CommonArgs.release,
  force: CommonArgs.force,
  dryRun: CommonArgs.dryRun,
  prune: { keys: ["prune"], type: "boolean" },
  quiet: CommonArgs.quiet,
});

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
  /** Skip confirmation without changing overwrite semantics */
  force?: boolean;
  /** Dry run - show what would be written without writing */
  dryRun?: boolean;
  /** Delete managed local files that are absent from the selected source */
  prune?: boolean;
  /** Quiet mode - suppress spinner/progress output */
  quiet?: boolean;
}

/**
 * Resolve pull source from options
 * Priority: env > release > branch > main
 */
export function resolvePullSource(options: PullOptions): PullSource {
  if (options.env) return { type: "environment", name: options.env };
  if (options.release) return { type: "release", version: options.release };
  if (options.branch && options.branch !== "main") return { type: "branch", name: options.branch };
  return { type: "main" };
}

interface ProjectFile {
  path: string;
  content: string;
  size: number;
  type: string;
  created_at: string;
  updated_at: string;
}

interface ListFilesResponse {
  data: ProjectFile[];
  page_info?: {
    next?: string;
    prev?: string;
  };
}

interface ValidatedFilePath {
  path: string;
  relativePath: string;
}

interface WriteOp extends ValidatedFilePath {
  content: string;
}

interface DeleteOp {
  path: string;
  relativePath: string;
}

interface PullProjectResult {
  written: number;
  deleted: number;
  cancelled: boolean;
}

interface FailedProject {
  project: string;
  message: string;
  status?: number;
  slug?: string;
  error?: unknown;
}

/** Validate a remote file path as a canonical relative POSIX path. */
export function validateRemoteFilePath(filePath: string): string {
  if (
    filePath.length === 0 ||
    filePath.includes("\\") ||
    filePath.includes("\0") ||
    isAbsolute(filePath)
  ) {
    throw new Error(`Invalid file path: "${filePath}" - expected a relative POSIX path`);
  }

  const segments = filePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Invalid file path: "${filePath}" - path must be canonical`);
  }
  if (segments.some((segment) => [".git", ".veryfront"].includes(segment.toLowerCase()))) {
    throw new Error(`Invalid file path: "${filePath}" - reserved local metadata path`);
  }

  return filePath;
}

/** Resolve a validated remote path and reject local symlink traversal. */
async function validateFilePath(
  filePath: string,
  projectDir: string,
): Promise<ValidatedFilePath> {
  const canonicalPath = validateRemoteFilePath(filePath);
  const resolvedProjectDir = resolve(projectDir);
  const fullPath = resolve(resolvedProjectDir, canonicalPath);
  const destinationRelativePath = relative(resolvedProjectDir, fullPath).replace(/\\/g, "/");

  if (
    destinationRelativePath === ".." ||
    destinationRelativePath.startsWith("../") ||
    isAbsolute(destinationRelativePath)
  ) {
    throw new Error(`Invalid file path: "${filePath}" - resolved path escapes project directory`);
  }

  const segments = canonicalPath.split("/");
  let currentPath = resolvedProjectDir;
  for (const [index, segment] of segments.entries()) {
    currentPath = join(currentPath, segment);
    let info;
    try {
      info = await lstat(currentPath);
    } catch (error) {
      if (isNotFoundError(error)) break;
      throw error;
    }
    if (info.isSymlink) {
      throw new Error(
        `Invalid file path: "${filePath}" - symbolic links are not allowed in pull destinations`,
      );
    }
    const isFinal = index === segments.length - 1;
    if (!isFinal && !info.isDirectory) {
      throw new Error(
        `Invalid file path: "${filePath}" - a parent path is not a directory`,
      );
    }
    if (isFinal && info.isDirectory) {
      throw new Error(`Invalid file path: "${filePath}" - destination is a directory`);
    }
  }

  return { path: fullPath, relativePath: canonicalPath };
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
      return `/projects/${projectSlug}/files?branch=${encodeURIComponent(source.name)}`;
    case "main":
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
      return `/projects/${projectSlug}/environments/${
        encodeURIComponent(source.name)
      }/files/${encodedPath}`;
    case "release":
      return `/projects/${projectSlug}/releases/${
        encodeURIComponent(source.version)
      }/files/${encodedPath}`;
    case "branch":
      return `/projects/${projectSlug}/files/${encodedPath}?branch=${
        encodeURIComponent(source.name)
      }`;
    case "main":
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

  return response.content;
}

/** Concurrency limit for parallel file writes. */
const CONCURRENCY = 20;

async function writeFile(
  op: WriteOp,
  fs: ReturnType<typeof createFileSystem>,
): Promise<{ success: boolean; path: string; error?: Error }> {
  try {
    await fs.mkdir(dirname(op.path), { recursive: true });
    await fs.writeTextFile(op.path, op.content);
    return { success: true, path: op.relativePath };
  } catch (error) {
    return { success: false, path: op.relativePath, error: error as Error };
  }
}

async function writeFiles(
  ops: WriteOp[],
  dryRun: boolean,
): Promise<{ written: number; failed: number }> {
  if (dryRun) {
    for (const op of ops) cliLogger.info(`  Would write: ${op.relativePath}`);
    return { written: ops.length, failed: 0 };
  }

  const fs = createFileSystem();
  let failed = 0;
  let written = 0;

  for (let i = 0; i < ops.length; i += CONCURRENCY) {
    const batch = ops.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((op) => writeFile(op, fs)),
    );

    for (const result of results) {
      if (result.success) {
        written++;
        continue;
      }
      cliLogger.error(`Failed to write ${result.path}:`, result.error);
      failed++;
    }
  }

  return { written, failed };
}

async function listManagedLocalFiles(
  projectDir: string,
  ignoreChecker: ReturnType<typeof createIgnoreChecker>,
): Promise<DeleteOp[]> {
  const fs = createFileSystem();
  if (!(await fs.exists(projectDir))) return [];

  const files: DeleteOp[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readDir(currentDir);

    for await (const entry of entries) {
      const path = join(currentDir, entry.name);
      const relativePath = relative(projectDir, path).replace(/\\/g, "/");

      if (ignoreChecker.isIgnored(relativePath)) continue;
      if (entry.isSymlink) {
        if (ignoreChecker.isSupportedExtension(entry.name)) {
          throw new Error(
            `Veryfront pull with --prune does not support symbolic links: "${relativePath}". Remove the link and run veryfront pull again.`,
          );
        }
        continue;
      }
      if (entry.isDirectory) {
        await walk(path);
        continue;
      }
      if (!ignoreChecker.isSupportedExtension(entry.name)) continue;
      files.push({ path, relativePath });
    }
  }

  await walk(projectDir);
  return files;
}

async function deleteLocalFiles(
  ops: DeleteOp[],
  dryRun: boolean,
): Promise<{ deleted: number; failed: number }> {
  if (dryRun) {
    for (const op of ops) cliLogger.info(`  Would delete: ${op.relativePath}`);
    return { deleted: ops.length, failed: 0 };
  }

  const fs = createFileSystem();
  let deleted = 0;
  let failed = 0;
  for (const op of ops) {
    try {
      await fs.remove(op.path);
      deleted++;
    } catch (error) {
      cliLogger.error(`Failed to delete ${op.relativePath}:`, error);
      failed++;
    }
  }
  return { deleted, failed };
}

function cleanGitEnvironment(): Record<string, string> {
  const gitEnv = env();
  for (const key of Object.keys(gitEnv)) {
    if (key.startsWith("GIT_")) delete gitEnv[key];
  }
  return gitEnv;
}

async function nearestExistingDirectory(path: string): Promise<string | null> {
  let current = resolve(path);
  while (true) {
    try {
      const info = await lstat(current);
      if (info.isDirectory) return current;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function findGitRoot(projectDir: string): Promise<string | null> {
  const cwd = await nearestExistingDirectory(projectDir);
  if (!cwd) return null;

  try {
    const repository = await runCommand("git", {
      args: ["rev-parse", "--show-toplevel"],
      cwd,
      clearEnv: true,
      env: cleanGitEnvironment(),
      capture: true,
      timeoutMs: 5_000,
    });
    const root = repository.stdout?.trim();
    return repository.success && root ? resolve(root) : null;
  } catch {
    return null;
  }
}

function isUntrackedPushReceipt(statusLine: string): boolean {
  if (!statusLine.startsWith("?? ")) return false;
  const path = statusLine.slice(3).replace(/\\/g, "/");
  return path === ".veryfront/push-receipt.json" ||
    path.endsWith("/.veryfront/push-receipt.json");
}

async function assertCleanGitWorktrees(projectDirs: readonly string[]): Promise<void> {
  const gitRoots = new Set<string>();
  for (const projectDir of projectDirs) {
    const gitRoot = await findGitRoot(projectDir);
    if (!gitRoot) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Pull with --prune requires ${projectDir} to be inside a Git worktree. Clone or initialize the repository, or use --dry-run to preview without deleting files.`,
      });
    }
    gitRoots.add(gitRoot);
  }

  for (const gitRoot of gitRoots) {
    const status = await runCommand("git", {
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd: gitRoot,
      clearEnv: true,
      env: cleanGitEnvironment(),
      capture: true,
      timeoutMs: 5_000,
    });
    if (!status.success) {
      throw INVALID_ARGUMENT.create({
        detail: "Veryfront could not verify that the Git worktree is clean before pruning files.",
      });
    }

    const dirty = (status.stdout ?? "").split("\n").some((line) =>
      line !== "" && !isUntrackedPushReceipt(line)
    );
    if (dirty) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Pull with --prune requires a clean Git worktree at ${gitRoot}. Commit or stash local changes, then run the command again.`,
      });
    }
  }
}

function formatPullSource(source: PullSource): string {
  switch (source.type) {
    case "environment":
      return `environment: ${source.name}`;
    case "release":
      return `release: ${source.version}`;
    case "branch":
      return `branch: ${source.name}`;
    case "main":
      return "main";
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}

function errorSlug(error: unknown): string | undefined {
  const slug = (error as { slug?: unknown })?.slug;
  return typeof slug === "string" ? slug : undefined;
}

function pullProjectListError(projectSlug: string, sourceLabel: string, error: unknown): Error {
  const message = [
    `Failed to list files for project "${projectSlug}" from ${sourceLabel}: ${
      describeError(error)
    }.`,
    "Check that the project slug is exact, the selected branch/env/release exists, and your token has access.",
  ].join(" ");
  const status = errorStatus(error);
  if (status === 404) {
    return RESOURCE_NOT_FOUND.create({ detail: message, cause: error, status });
  }

  const wrapped = new Error(message, { cause: error });
  if (typeof status === "number") {
    (wrapped as Error & { status?: number }).status = status;
  }
  return wrapped;
}

async function confirmPullWrite(
  projectDir: string,
  writeCount: number,
  deleteCount: number,
): Promise<boolean> {
  if (isInteractive() && !isTTY()) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Pull requires confirmation before writing files, but no interactive prompt is available. ` +
        `Re-run with --yes to write into ${projectDir} without prompting.`,
    });
  }

  const actions: string[] = [];
  if (writeCount > 0) actions.push(`overwrite ${writeCount} local files`);
  if (deleteCount > 0) actions.push(`delete ${deleteCount} managed local files`);
  const action = actions.join(" and ");
  return await confirmPrompt(`This will ${action} in ${projectDir}. Continue?`, false);
}

async function pullSingleProject(
  projectSlug: string,
  projectDir: string,
  source: PullSource,
  force: boolean,
  dryRun: boolean,
  prune: boolean,
  config: ResolvedConfig,
  quiet = false,
): Promise<PullProjectResult> {
  const sourceLabel = formatPullSource(source);
  let spinner = quiet
    ? createNoopSpinner()
    : createSpinner(`Fetching files from ${projectSlug} (${sourceLabel})...`);

  const client = createApiClient({ ...config, projectSlug });

  let files: ProjectFile[];
  try {
    files = await listAllFiles(client, projectSlug, source);
  } catch (error) {
    throw pullProjectListError(projectSlug, sourceLabel, error);
  } finally {
    spinner.stop();
  }

  const pruneIgnoreChecker = prune
    ? createIgnoreChecker(await loadIgnorePatterns(projectDir))
    : null;
  const writeOps: WriteOp[] = [];
  const remotePaths = new Set<string>();
  for (const file of files) {
    let op: ValidatedFilePath;
    try {
      op = await validateFilePath(file.path, projectDir);
      if (remotePaths.has(op.relativePath)) {
        throw new Error(`Duplicate remote file path: "${op.relativePath}"`);
      }
      remotePaths.add(op.relativePath);
    } catch (error) {
      throw INVALID_ARGUMENT.create({
        detail: `Veryfront returned an invalid file path "${file.path}": ${
          describeError(error)
        }. No local files were changed.`,
        cause: error,
      });
    }

    if (
      pruneIgnoreChecker &&
      (pruneIgnoreChecker.isIgnored(op.relativePath) ||
        !pruneIgnoreChecker.isSupportedExtension(op.relativePath))
    ) {
      continue;
    }
    if (typeof file.content !== "string") {
      throw INVALID_ARGUMENT.create({
        detail:
          `Veryfront returned invalid content for file "${file.path}". No local files were changed.`,
      });
    }
    writeOps.push({ ...op, content: file.content });
  }

  let deleteOps: DeleteOp[] = [];
  if (pruneIgnoreChecker) {
    const managedRemotePaths = new Set(writeOps.map((op) => op.relativePath));
    const localFiles = await listManagedLocalFiles(projectDir, pruneIgnoreChecker);
    deleteOps = localFiles.filter((file) => !managedRemotePaths.has(file.relativePath));
  }

  if (writeOps.length === 0 && deleteOps.length === 0) {
    if (!quiet) logInfo(`No files to pull from ${projectSlug}.`);
    return { written: 0, deleted: 0, cancelled: false };
  }

  if (!quiet) {
    const deleteSummary = deleteOps.length > 0 ? ` and ${deleteOps.length} to delete` : "";
    cliLogger.info(
      `\nFound ${writeOps.length} files to ${
        dryRun ? "pull" : "write"
      }${deleteSummary} from ${projectSlug}.`,
    );
  }

  if (!force && !dryRun) {
    const confirmed = await confirmPullWrite(projectDir, writeOps.length, deleteOps.length);
    if (!confirmed) {
      cliLogger.info("Pull cancelled.");
      return { written: 0, deleted: 0, cancelled: true };
    }
  }

  spinner = quiet ? createNoopSpinner() : createSpinner(`Writing files to ${projectDir}...`);

  const writeResult = await writeFiles(writeOps, dryRun);

  if (writeResult.failed > 0) {
    spinner.stop();
    throw new Error(
      `Failed to pull ${writeResult.failed} file${
        writeResult.failed === 1 ? "" : "s"
      }. No local files were pruned. Review git status and restore a clean worktree before retrying if any files were written.`,
    );
  }

  const deleteResult = await deleteLocalFiles(deleteOps, dryRun);

  spinner.stop();

  if (deleteResult.failed > 0) {
    throw new Error(
      `Failed to prune ${deleteResult.failed} local file${
        deleteResult.failed === 1 ? "" : "s"
      }. Some files may have changed. Review git status and restore a clean worktree before retrying.`,
    );
  }

  if (!quiet) {
    if (dryRun) {
      logInfo(
        `Dry run complete for ${projectSlug}. Would write ${writeResult.written} and delete ${deleteResult.deleted} files.`,
      );
    } else {
      const deletion = deleteResult.deleted > 0 ? ` and deleted ${deleteResult.deleted}` : "";
      logSuccess(
        `Pulled ${writeResult.written} files${deletion} from ${projectSlug} (${sourceLabel}).`,
      );
    }
  }

  return { written: writeResult.written, deleted: deleteResult.deleted, cancelled: false };
}

function formatProjectCount(count: number): string {
  return `${count} project${count === 1 ? "" : "s"}`;
}

function failedProjectsDetail(failedProjects: FailedProject[]): string {
  const names = failedProjects.map(({ project }) => project).join(", ");
  const details = failedProjects.map(({ project, message }) => `${project}: ${message}`).join(" ");
  return `Failed to pull ${formatProjectCount(failedProjects.length)}: ${names}. ${details}`;
}

function isErrorSlug(slug: string | undefined): slug is ErrorSlug {
  return typeof slug === "string" && slug in ERROR_REGISTRY;
}

function structuredFailureAggregate(failedProjects: FailedProject[], detail: string): Error | null {
  if (failedProjects.length === 1) {
    const error = failedProjects[0]?.error;
    if (error instanceof VeryfrontError) return error;
  }

  const slug = failedProjects[0]?.slug;
  if (!isErrorSlug(slug)) return null;
  if (!failedProjects.every((failure) => failure.slug === slug)) return null;

  return getErrorBySlug(slug).create({ detail });
}

/**
 * Pull files from Veryfront API
 */
export function pullCommand(options: PullOptions = {}): Promise<void> {
  const source = resolvePullSource(options);

  return withSpan(
    "cli.command.pull",
    async () => {
      const {
        projectSlug: slugOverride,
        projects: projectsOverride,
        projectDir = cwd(),
        force = false,
        dryRun = false,
        prune = false,
        quiet = false,
      } = options;

      const spinner = quiet ? createNoopSpinner() : createSpinner("Resolving configuration...");

      const configFile = await readConfigFile(projectDir);
      const projects = projectsOverride ?? configFile?.projects;

      let config: ResolvedConfig;
      try {
        // Use interactive auth - prompts for login if not authenticated
        config = await resolveConfigWithAuth(projectDir);
        if (slugOverride) config = { ...config, projectSlug: slugOverride };
      } catch (error) {
        spinner.stop();

        if (!projects?.length) throw error;

        const env = getEnvironmentConfig();
        const token = getApiTokenEnv(env) ?? configFile?.apiToken;
        if (!token) {
          throw new Error(
            "VERYFRONT_API_TOKEN environment variable or apiToken in veryfront.json is required when using --projects",
          );
        }

        config = {
          apiUrl: resolveCliApiUrl(env, configFile?.apiUrl),
          apiToken: token,
          projectSlug: "",
        };
      }

      if (prune && !dryRun) {
        spinner.update("Checking Git worktree...");
        const targetDirs = projects?.length
          ? projects.map((project) => join(projectDir, project))
          : [projectDir];
        try {
          await assertCleanGitWorktrees(targetDirs);
        } catch (error) {
          spinner.stop();
          throw error;
        }
      }

      spinner.stop();

      if (!projects?.length) {
        await pullSingleProject(
          config.projectSlug,
          projectDir,
          source,
          force,
          dryRun,
          prune,
          config,
          quiet,
        );
        return;
      }

      let totalWritten = 0;
      let totalDeleted = 0;
      const failedProjects: FailedProject[] = [];
      const cancelledProjects: string[] = [];

      for (const project of projects) {
        const targetDir = join(projectDir, project);

        if (!quiet) cliLogger.info(`\n--- Pulling ${project} into ${targetDir} ---`);

        try {
          const result = await pullSingleProject(
            project,
            targetDir,
            source,
            force,
            dryRun,
            prune,
            config,
            quiet,
          );
          totalWritten += result.written;
          totalDeleted += result.deleted;
          if (result.cancelled) cancelledProjects.push(project);
        } catch (error) {
          cliLogger.error(`Failed to pull ${project}: ${describeError(error)}`);
          failedProjects.push({
            project,
            message: describeError(error),
            status: errorStatus(error),
            slug: errorSlug(error),
            error,
          });
        }
      }

      if (!quiet) {
        cliLogger.info("");
        if (dryRun) {
          logInfo(
            `Dry run complete. Would write ${totalWritten} and delete ${totalDeleted} files total across ${projects.length} projects.`,
          );
        } else if (totalWritten > 0) {
          const deletion = totalDeleted > 0 ? ` and deleted ${totalDeleted}` : "";
          logSuccess(
            `Pulled ${totalWritten} files${deletion} total across ${projects.length} projects.`,
          );
        } else if (totalDeleted > 0) {
          logSuccess(`Deleted ${totalDeleted} files across ${projects.length} projects.`);
        } else {
          logInfo(`No files were pulled across ${projects.length} projects.`);
        }

        if (cancelledProjects.length > 0) {
          logWarning(
            `Cancelled ${formatProjectCount(cancelledProjects.length)}: ${
              cancelledProjects.join(", ")
            }.`,
          );
        }
        if (failedProjects.length > 0) {
          logWarning(
            `Failed to pull ${formatProjectCount(failedProjects.length)}: ${
              failedProjects.map(({ project }) => project).join(", ")
            }.`,
          );
        }
      }

      if (failedProjects.length > 0) {
        const detail = failedProjectsDetail(failedProjects);
        if (
          failedProjects.every((failure) =>
            failure.slug === "resource-not-found" || failure.status === 404
          )
        ) {
          throw RESOURCE_NOT_FOUND.create({ detail });
        }
        const structuredError = structuredFailureAggregate(failedProjects, detail);
        if (structuredError) throw structuredError;
        throw new Error(detail);
      }
    },
    {
      "cli.dryRun": options.dryRun ?? false,
      "cli.prune": options.prune ?? false,
      "cli.source_type": source.type,
    },
  );
}
