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
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "veryfront/platform/path";
import { cliLogger } from "#cli/utils";
import { resolveCliApiUrl } from "#cli/shared/constants";
import { createFileSystem, cwd, type FileSystem } from "veryfront/platform";
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
import { getSlugSchema } from "veryfront/schemas";
import { DEFAULT_LIMITS } from "veryfront/security";

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
  /** Force overwrite without confirmation */
  force?: boolean;
  /** Dry run - show what would be written without writing */
  dryRun?: boolean;
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

interface WriteOp {
  path: string;
  relativePath: string;
}

interface PullProjectResult {
  written: number;
  skipped: number;
  cancelled: boolean;
}

interface FailedProject {
  project: string;
  message: string;
  status?: number;
  slug?: string;
  error?: unknown;
}

/**
 * Validate and sanitize file path to prevent path traversal attacks.
 * Ensures the resolved path is within the project directory.
 *
 * @param filePath - The file path from API to validate
 * @param projectDir - The project directory base path
 * @returns Sanitized absolute path
 * @throws Error if path attempts to escape project directory
 */
function validateFilePath(filePath: string, projectDir: string): string {
  const normalizedPath = normalize(filePath);

  if (
    filePath.includes("\0") ||
    normalizedPath === "." ||
    isAbsolute(normalizedPath) ||
    normalizedPath.split(/[\\/]/).includes("..")
  ) {
    throw new Error(
      `Invalid file path: "${filePath}" - paths must be relative and cannot escape project directory`,
    );
  }

  const fullPath = resolve(projectDir, normalizedPath);
  const resolvedProjectDir = resolve(projectDir);

  const relativePath = relative(resolvedProjectDir, fullPath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Invalid file path: "${filePath}" - resolved path escapes project directory`);
  }

  return fullPath;
}

function isMissingPathError(error: unknown): boolean {
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate?.name === "NotFound" || candidate?.code === "ENOENT";
}

async function assertNoSymlinkComponents(
  fs: FileSystem,
  projectDir: string,
  targetPath: string,
): Promise<void> {
  if (!fs.lstat) {
    throw new Error("Filesystem does not support secure symbolic-link checks");
  }

  const relativePath = relative(resolve(projectDir), resolve(targetPath));
  let currentPath = resolve(projectDir);

  for (const segment of relativePath.split(/[\\/]/).filter(Boolean)) {
    currentPath = join(currentPath, segment);
    try {
      if ((await fs.lstat(currentPath)).isSymlink) {
        throw new Error(`Refusing to write through symbolic link: ${currentPath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
  }
}

/**
 * Build the files list URL based on pull source
 */
export function buildFilesListUrl(projectSlug: string, source: PullSource): string {
  const encodedProjectSlug = encodeURIComponent(projectSlug);
  switch (source.type) {
    case "environment":
      return `/projects/${encodedProjectSlug}/environments/${
        encodeURIComponent(source.name)
      }/files`;
    case "release":
      return `/projects/${encodedProjectSlug}/releases/${encodeURIComponent(source.version)}/files`;
    case "branch":
      return `/projects/${encodedProjectSlug}/files?branch=${encodeURIComponent(source.name)}`;
    case "main":
      return `/projects/${encodedProjectSlug}/files`;
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
  const encodedProjectSlug = encodeURIComponent(projectSlug);
  const encodedPath = encodeURIComponent(path);

  switch (source.type) {
    case "environment":
      return `/projects/${encodedProjectSlug}/environments/${
        encodeURIComponent(source.name)
      }/files/${encodedPath}`;
    case "release":
      return `/projects/${encodedProjectSlug}/releases/${
        encodeURIComponent(source.version)
      }/files/${encodedPath}`;
    case "branch":
      return `/projects/${encodedProjectSlug}/files/${encodedPath}?branch=${
        encodeURIComponent(source.name)
      }`;
    case "main":
      return `/projects/${encodedProjectSlug}/files/${encodedPath}`;
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
  if (new TextEncoder().encode(content).byteLength > DEFAULT_LIMITS.maxFileSize) {
    throw new Error(`Remote file exceeds the ${DEFAULT_LIMITS.maxFileSize}-byte size limit`);
  }
  if (content && !content.endsWith("\n")) return content + "\n";
  return content;
}

/** Concurrency limit for parallel file fetches */
const CONCURRENCY = 20;

async function processFile(
  op: WriteOp,
  client: ReturnType<typeof createApiClient>,
  projectSlug: string,
  source: PullSource,
  fs: ReturnType<typeof createFileSystem>,
  projectDir: string,
): Promise<{ success: boolean; path: string; error?: Error }> {
  try {
    await assertNoSymlinkComponents(fs, projectDir, op.path);
    const content = await getFileContent(client, projectSlug, op.relativePath, source);
    await fs.mkdir(dirname(op.path), { recursive: true });
    await assertNoSymlinkComponents(fs, projectDir, op.path);
    await fs.writeTextFile(op.path, content);
    return { success: true, path: op.relativePath };
  } catch (error) {
    return { success: false, path: op.relativePath, error: error as Error };
  }
}

async function writeFiles(
  ops: WriteOp[],
  client: ReturnType<typeof createApiClient>,
  projectSlug: string,
  source: PullSource,
  dryRun: boolean,
  projectDir: string,
): Promise<{ written: number; skipped: number }> {
  if (dryRun) {
    for (const op of ops) cliLogger.info(`  Would write: ${op.relativePath}`);
    return { written: ops.length, skipped: 0 };
  }

  const fs = createFileSystem();
  let written = 0;
  let skipped = 0;

  for (let i = 0; i < ops.length; i += CONCURRENCY) {
    const batch = ops.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((op) => processFile(op, client, projectSlug, source, fs, projectDir)),
    );

    for (const result of results) {
      if (result.success) {
        written++;
        continue;
      }
      cliLogger.error(`Failed to write ${result.path}:`, result.error);
      skipped++;
    }
  }

  return { written, skipped };
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

async function confirmPullWrite(projectDir: string): Promise<boolean> {
  if (isInteractive() && !isTTY()) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Pull requires confirmation before writing files, but no interactive prompt is available. ` +
        `Re-run with --force to write into ${projectDir} without prompting.`,
    });
  }

  return await confirmPrompt(
    `This will overwrite local files in ${projectDir}. Continue?`,
    false,
  );
}

async function pullSingleProject(
  projectSlug: string,
  projectDir: string,
  source: PullSource,
  force: boolean,
  dryRun: boolean,
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

  if (files.length === 0) {
    if (!quiet) logInfo(`No files to pull from ${projectSlug}.`);
    return { written: 0, skipped: 0, cancelled: false };
  }

  const writeOps: WriteOp[] = [];
  let preflightSkipped = 0;
  for (const file of files) {
    if (Number.isFinite(file.size) && file.size > DEFAULT_LIMITS.maxFileSize) {
      preflightSkipped++;
      if (!quiet) cliLogger.warn(`Skipping oversized file: ${file.path}`);
      continue;
    }

    try {
      writeOps.push({ path: validateFilePath(file.path, projectDir), relativePath: file.path });
    } catch (error) {
      preflightSkipped++;
      if (!quiet) cliLogger.warn(`Skipping invalid file path: ${file.path}`, error);
    }
  }

  if (!quiet) {
    cliLogger.info(
      `\nFound ${files.length} files to ${dryRun ? "pull" : "write"} from ${projectSlug}.`,
    );
  }

  if (writeOps.length === 0) {
    if (!quiet && preflightSkipped > 0) {
      logWarning(`Skipped ${preflightSkipped} files due to validation errors.`);
    }
    return { written: 0, skipped: preflightSkipped, cancelled: false };
  }

  if (!force && !dryRun) {
    const confirmed = await confirmPullWrite(projectDir);
    if (!confirmed) {
      cliLogger.info("Pull cancelled.");
      return { written: 0, skipped: 0, cancelled: true };
    }
  }

  spinner = quiet ? createNoopSpinner() : createSpinner(`Writing files to ${projectDir}...`);

  const result = await writeFiles(writeOps, client, projectSlug, source, dryRun, projectDir);
  result.skipped += preflightSkipped;

  spinner.stop();

  if (!quiet) {
    if (dryRun) {
      logInfo(`Dry run complete for ${projectSlug}. Would write ${result.written} files.`);
    } else {
      logSuccess(`Pulled ${result.written} files from ${projectSlug} (${sourceLabel}).`);
    }
    if (result.skipped > 0) logWarning(`Skipped ${result.skipped} files due to errors.`);
  }

  return { ...result, cancelled: false };
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

      spinner.stop();

      if (!projects?.length) {
        await pullSingleProject(
          config.projectSlug,
          projectDir,
          source,
          force,
          dryRun,
          config,
          quiet,
        );
        return;
      }

      let totalWritten = 0;
      let totalSkippedFiles = 0;
      const failedProjects: FailedProject[] = [];
      const cancelledProjects: string[] = [];

      for (const project of projects) {
        let targetDir: string;
        try {
          getSlugSchema().parse(project);
          targetDir = validateFilePath(project, projectDir);
        } catch (error) {
          const message = `Invalid project slug "${project}": ${describeError(error)}`;
          cliLogger.error(message);
          failedProjects.push({ project, message, error });
          continue;
        }

        if (!quiet) cliLogger.info(`\n--- Pulling ${project} into ${targetDir} ---`);

        try {
          const result = await pullSingleProject(
            project,
            targetDir,
            source,
            force,
            dryRun,
            config,
            quiet,
          );
          totalWritten += result.written;
          totalSkippedFiles += result.skipped;
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
            `Dry run complete. Would write ${totalWritten} files total across ${projects.length} projects.`,
          );
        } else if (totalWritten > 0) {
          logSuccess(`Pulled ${totalWritten} files total across ${projects.length} projects.`);
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
        if (totalSkippedFiles > 0) {
          logWarning(`Skipped ${totalSkippedFiles} files due to write errors.`);
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
    { "cli.dryRun": options.dryRun ?? false, "cli.source_type": source.type },
  );
}
