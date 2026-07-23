/**
 * Workspace Sync for Claude Code
 *
 * Provides bidirectional file synchronization between Veryfront API and local filesystem.
 * This enables bash and text_editor tools to work against remote project files.
 *
 * Flow:
 * 1. Before execution: Download project files to local temp directory
 * 2. During execution: Bash/editor operate on local files
 * 3. After execution: Upload changed files back to Veryfront API
 */

import { logger as baseLogger } from "#veryfront/utils";
import { api } from "../api.ts";
import type { CapturedTenantContext } from "../types.ts";
import { dirname, join, relative, resolve } from "@std/path";
import {
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
  isVeryfrontError,
  SECURITY_VIOLATION,
  UNKNOWN_ERROR,
} from "#veryfront/errors";
import { isWithinDirectory } from "#veryfront/utils/path-utils.ts";
import { runWithWorkflowTenant } from "../executor/step-executor.ts";

const logger = baseLogger.component("workspace-sync");

/** Maximum file size for workspace sync (10 MB) */
const MAX_WORKSPACE_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_WORKSPACE_FILES = 10_000;
const DEFAULT_MAX_WORKSPACE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_WORKSPACE_DEPTH = 64;
const DEFAULT_MAX_WORKSPACE_PAGES = 200;

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Base directory for workspaces (default: /tmp/veryfront-workspaces) */
  baseDir?: string;

  /** Run ID for unique workspace isolation */
  runId: string;

  /** Tenant context for API access */
  tenant: CapturedTenantContext;

  /** File patterns to include (glob-like, default: all) */
  include?: string[];

  /** File patterns to exclude (glob-like) */
  exclude?: string[];

  /** Maximum file size to sync (bytes, default: 10MB) */
  maxFileSize?: number;

  /** Maximum number of files in one workspace (default: 10,000) */
  maxFiles?: number;

  /** Maximum aggregate workspace size in bytes (default: 512MB) */
  maxTotalBytes?: number;

  /** Maximum directory nesting depth (default: 64) */
  maxDepth?: number;

  /** Maximum API pages fetched while listing files (default: 200) */
  maxPages?: number;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * File change tracking
 */
export interface FileChange {
  path: string;
  type: "created" | "modified" | "deleted";
  originalChecksum?: string;
  newChecksum?: string;
}

/**
 * Workspace sync result
 */
export interface WorkspaceSyncResult {
  /** Local workspace directory */
  workspaceDir: string;

  /** Number of files downloaded */
  filesDownloaded: number;

  /** Total bytes downloaded */
  bytesDownloaded: number;

  /** Files that were skipped for benign reasons (too large, excluded by pattern) */
  skippedFiles: string[];

  /**
   * Files that failed to download (read threw). Kept separate from skippedFiles
   * so a fetch/permission failure isn't silently indistinguishable from an
   * intentional skip.
   */
  downloadErrors: Array<{ path: string; error: string }>;

  /** Duration in ms */
  duration: number;
}

/**
 * Upload result
 */
export interface UploadResult {
  /** Files that were actually uploaded via the onUpload handler */
  uploaded: FileChange[];

  /**
   * Files that were NOT uploaded because no onUpload handler was provided.
   * Distinct from `uploaded` so callers don't mistake a dry run for a real one.
   */
  skipped: FileChange[];

  /** Files that failed to upload */
  failed: Array<{ path: string; error: string }>;

  /** Duration in ms */
  duration: number;
}

export interface WorkspaceFileApi {
  listAll(options: { maxFiles: number; maxPages: number }): Promise<Array<{ path: string }>>;
  read(path: string): Promise<string>;
}

/** Dependencies captured by a WorkspaceSync instance. */
export interface WorkspaceSyncDependencies {
  files?: WorkspaceFileApi;
}

interface WorkspaceWalkState {
  files: number;
  bytes: number;
}

/**
 * Simple checksum for change detection
 */
async function checksum(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check if a path matches any of the given patterns.
 *
 * This is a deliberately minimal matcher, NOT a full glob implementation. Only
 * these four forms are recognized:
 *
 *   - a leading double-star + slash (e.g. "double-star/foo.ts") matches any
 *     path ending in that suffix
 *   - a trailing slash + double-star (e.g. "src/double-star") matches any path
 *     under that prefix
 *   - `*.ext` matches any path ending in `.ext`
 *   - `exact/path` exact match (with or without a leading slash)
 *
 * Anything else (brace expansion `{a,b}`, single-segment `*`, `?`, character
 * classes, mid-path `**`) is NOT supported and will simply fail to match. Keep
 * include/exclude patterns within the forms above, or replace this with a real
 * glob matcher (e.g. @std/path globToRegExp) if broader support is needed.
 */
function matchesPattern(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.startsWith("**/")) {
      // Match anywhere in path
      const suffix = pattern.slice(3);
      if (path.endsWith(suffix) || path.includes(`/${suffix}`)) {
        return true;
      }
    } else if (pattern.endsWith("/**")) {
      // Match directory prefix
      const prefix = pattern.slice(0, -3);
      if (path.startsWith(prefix) || path.startsWith(`/${prefix}`)) {
        return true;
      }
    } else if (pattern.startsWith("*.")) {
      // Match extension
      if (path.endsWith(pattern.slice(1))) {
        return true;
      }
    } else {
      // Exact match
      if (path === pattern || path === `/${pattern}`) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Workspace manager for Claude Code execution
 */
export class WorkspaceSync {
  private config: Required<Omit<WorkspaceConfig, "include" | "exclude">> & {
    include?: string[];
    exclude?: string[];
  };
  private fileChecksums = new Map<string, string>();
  private initialized = false;
  private readonly files: WorkspaceFileApi;

  constructor(config: WorkspaceConfig, dependencies: WorkspaceSyncDependencies = {}) {
    // SECURITY: Validate runId to prevent path traversal
    if (config.runId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(config.runId)) {
      throw INVALID_ARGUMENT.create({
        detail: "Invalid runId: use 1 to 128 alphanumeric, underscore, or hyphen characters",
      });
    }

    for (
      const [name, value] of [
        ["maxFileSize", config.maxFileSize ?? MAX_WORKSPACE_FILE_SIZE],
        ["maxFiles", config.maxFiles ?? DEFAULT_MAX_WORKSPACE_FILES],
        ["maxTotalBytes", config.maxTotalBytes ?? DEFAULT_MAX_WORKSPACE_BYTES],
        ["maxDepth", config.maxDepth ?? DEFAULT_MAX_WORKSPACE_DEPTH],
        ["maxPages", config.maxPages ?? DEFAULT_MAX_WORKSPACE_PAGES],
      ] as const
    ) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw INVALID_ARGUMENT.create({ detail: `${name} must be a positive safe integer` });
      }
    }

    this.config = {
      baseDir: "/tmp/veryfront-workspaces",
      maxFileSize: MAX_WORKSPACE_FILE_SIZE,
      maxFiles: DEFAULT_MAX_WORKSPACE_FILES,
      maxTotalBytes: DEFAULT_MAX_WORKSPACE_BYTES,
      maxDepth: DEFAULT_MAX_WORKSPACE_DEPTH,
      maxPages: DEFAULT_MAX_WORKSPACE_PAGES,
      debug: false,
      ...config,
      tenant: Object.freeze({ ...config.tenant }),
      include: config.include ? [...config.include] : undefined,
      exclude: config.exclude ? [...config.exclude] : undefined,
    };
    const files = dependencies.files ?? api.files;
    this.files = {
      listAll: (options) => files.listAll(options),
      read: (path) => files.read(path),
    };
  }

  /**
   * Get the workspace directory path
   */
  get workspaceDir(): string {
    return join(this.config.baseDir, this.config.runId);
  }

  /**
   * Initialize workspace by downloading project files
   */
  async initialize(): Promise<WorkspaceSyncResult> {
    return await runWithWorkflowTenant(
      this.config.tenant,
      () => this.initializeForTenant(),
    );
  }

  private async initializeForTenant(): Promise<WorkspaceSyncResult> {
    const startTime = Date.now();
    const skippedFiles: string[] = [];
    const downloadErrors: Array<{ path: string; error: string }> = [];
    let filesDownloaded = 0;
    let bytesDownloaded = 0;
    let ownsWorkspace = false;

    if (this.config.debug) {
      logger.info("Initializing workspace");
    }

    this.initialized = false;
    this.fileChecksums.clear();

    try {
      await Deno.mkdir(this.config.baseDir, { recursive: true });
      try {
        await Deno.mkdir(this.workspaceDir);
        ownsWorkspace = true;
      } catch (cause) {
        if (cause instanceof Deno.errors.AlreadyExists) {
          throw INITIALIZATION_ERROR.create({
            detail: "Workspace directory already exists for this run",
          });
        }
        throw cause;
      }

      // The API client enforces both bounds during pagination. Re-check the
      // returned count so injected and future adapters honor the same contract.
      let projectFiles: Array<{ path: string }>;
      try {
        projectFiles = await this.files.listAll({
          maxFiles: this.config.maxFiles,
          maxPages: this.config.maxPages,
        });
      } catch (cause) {
        throw INITIALIZATION_ERROR.create({
          detail: "Failed to list project files for workspace initialization",
          cause: cause instanceof Error ? cause : undefined,
        });
      }
      if (projectFiles.length > this.config.maxFiles) {
        throw INITIALIZATION_ERROR.create({
          detail: `Workspace exceeds the maximum file count of ${this.config.maxFiles}`,
        });
      }

      if (this.config.debug) logger.info("Found files in project", { count: projectFiles.length });

      const seenPaths = new Set<string>();
      for (const file of projectFiles) {
        if (!file || typeof file.path !== "string" || file.path.length === 0) {
          throw INITIALIZATION_ERROR.create({ detail: "Project file listing is invalid" });
        }
        const path = file.path.startsWith("/") ? file.path : `/${file.path}`;
        if (seenPaths.has(path)) {
          throw INITIALIZATION_ERROR.create({ detail: "Project file listing contains duplicates" });
        }
        seenPaths.add(path);

        if (this.config.include && !matchesPattern(path, this.config.include)) {
          skippedFiles.push(path);
          continue;
        }

        if (this.config.exclude && matchesPattern(path, this.config.exclude)) {
          skippedFiles.push(path);
          continue;
        }

        let content: string;
        try {
          content = await this.files.read(path);
        } catch (cause) {
          downloadErrors.push({ path, error: "File download failed" });
          throw INITIALIZATION_ERROR.create({
            detail: "Failed to initialize a complete workspace",
            cause: cause instanceof Error ? cause : undefined,
          });
        }
        if (typeof content !== "string") {
          throw INITIALIZATION_ERROR.create({ detail: "Project file content is invalid" });
        }

        const byteLength = new TextEncoder().encode(content).length;
        if (byteLength > this.config.maxFileSize) {
          throw INVALID_ARGUMENT.create({
            detail: `Workspace file exceeds the configured maximum file size`,
          });
        }
        if (bytesDownloaded + byteLength > this.config.maxTotalBytes) {
          throw INVALID_ARGUMENT.create({
            detail: `Workspace exceeds the configured maximum aggregate size`,
          });
        }

        const hash = await checksum(content);
        const localPath = await this.resolveSafePath(path);
        const dir = dirname(localPath);
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(localPath, content);
        this.fileChecksums.set(path, hash);

        filesDownloaded++;
        bytesDownloaded += byteLength;
      }

      this.initialized = true;

      const result: WorkspaceSyncResult = {
        workspaceDir: this.workspaceDir,
        filesDownloaded,
        bytesDownloaded,
        skippedFiles,
        downloadErrors,
        duration: Date.now() - startTime,
      };

      if (this.config.debug) {
        logger.info("Workspace initialized", {
          duration: result.duration,
          filesDownloaded,
          bytesDownloaded,
          skipped: skippedFiles.length,
        });
      }

      return result;
    } catch (cause) {
      this.initialized = false;
      this.fileChecksums.clear();
      if (ownsWorkspace) {
        try {
          await Deno.remove(this.workspaceDir, { recursive: true });
        } catch (cleanupError) {
          if (!(cleanupError instanceof Deno.errors.NotFound)) {
            logger.warn("Failed to remove an incomplete workspace", {
              errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
            });
          }
        }
      }
      if (isVeryfrontError(cause)) throw cause;
      throw INITIALIZATION_ERROR.create({
        detail: "Failed to initialize workspace",
        cause: cause instanceof Error ? cause : undefined,
      });
    }
  }

  /**
   * Detect changes in the workspace
   */
  async detectChanges(): Promise<FileChange[]> {
    const changes: FileChange[] = [];
    const walkState: WorkspaceWalkState = { files: 0, bytes: 0 };

    if (!this.initialized) {
      throw INITIALIZATION_ERROR.create({
        detail: "Workspace not initialized. Call initialize() first.",
      });
    }

    // Walk the workspace directory
    for await (const entry of Deno.readDir(this.workspaceDir)) {
      await this.walkAndDetect(
        `${this.workspaceDir}/${entry.name}`,
        `/${entry.name}`,
        changes,
        walkState,
        1,
      );
    }

    // Check for deleted files
    for (const [path, originalHash] of this.fileChecksums) {
      try {
        const localPath = await this.resolveSafePath(path);
        await Deno.stat(localPath);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          changes.push({
            path,
            type: "deleted",
            originalChecksum: originalHash,
          });
          continue;
        }
        throw error;
      }
    }

    if (this.config.debug) {
      logger.info("Detected changes", { count: changes.length });
    }

    return changes;
  }

  /**
   * Recursively walk directory and detect changes.
   *
   * SECURITY: Uses lstat (not stat) and skips any symlink it finds, so a
   * symlink planted inside the workspace cannot cause us to descend into —
   * or read the contents of — files outside the workspace (VULN-FS-4).
   */
  private async walkAndDetect(
    localPath: string,
    relativePath: string,
    changes: FileChange[],
    walkState: WorkspaceWalkState,
    depth: number,
  ): Promise<void> {
    const stat = await Deno.lstat(localPath);

    // Ignore symlinks outright — we never treat them as real files here.
    if (stat.isSymlink) {
      if (this.config.debug) {
        logger.info("Skipping symlink during change detection");
      }
      return;
    }

    if (stat.isDirectory) {
      if (depth >= this.config.maxDepth) {
        throw INVALID_ARGUMENT.create({ detail: "Workspace exceeds the maximum directory depth" });
      }
      for await (const entry of Deno.readDir(localPath)) {
        await this.walkAndDetect(
          `${localPath}/${entry.name}`,
          `${relativePath}/${entry.name}`,
          changes,
          walkState,
          depth + 1,
        );
      }
      return;
    }

    if (!stat.isFile) {
      throw INVALID_ARGUMENT.create({ detail: "Workspace contains an unsupported entry" });
    }
    walkState.files++;
    if (walkState.files > this.config.maxFiles) {
      throw INVALID_ARGUMENT.create({ detail: "Workspace exceeds the maximum file count" });
    }
    if (stat.size > this.config.maxFileSize) {
      throw INVALID_ARGUMENT.create({ detail: "Workspace file exceeds the maximum file size" });
    }
    walkState.bytes += stat.size;
    if (walkState.bytes > this.config.maxTotalBytes) {
      throw INVALID_ARGUMENT.create({ detail: "Workspace exceeds the maximum aggregate size" });
    }

    const content = await Deno.readTextFile(localPath);
    const newHash = await checksum(content);
    const originalHash = this.fileChecksums.get(relativePath);

    if (!originalHash) {
      // New file
      changes.push({
        path: relativePath,
        type: "created",
        newChecksum: newHash,
      });
    } else if (newHash !== originalHash) {
      // Modified file
      changes.push({
        path: relativePath,
        type: "modified",
        originalChecksum: originalHash,
        newChecksum: newHash,
      });
    }
  }

  /**
   * Upload changes back to Veryfront API
   *
   * NOTE: This requires write API support. Currently returns pending changes
   * for manual review or future API implementation.
   */
  async uploadChanges(
    changes: FileChange[],
    options: {
      /** Callback to get file content for upload */
      onUpload?: (
        path: string,
        content: string,
        type: FileChange["type"],
      ) => Promise<void>;
    } = {},
  ): Promise<UploadResult> {
    if (!this.initialized) {
      throw INITIALIZATION_ERROR.create({
        detail: "Workspace not initialized. Call initialize() first.",
      });
    }
    const startTime = Date.now();
    const uploaded: FileChange[] = [];
    const skipped: FileChange[] = [];
    const failed: Array<{ path: string; error: string }> = [];
    const prepared: Array<{ change: FileChange; content: string }> = [];
    const seenPaths = new Set<string>();
    let uploadedBytes = 0;

    if (changes.length > this.config.maxFiles) {
      throw INVALID_ARGUMENT.create({ detail: "Upload exceeds the maximum file count" });
    }

    for (const change of changes) {
      if (
        !change || typeof change.path !== "string" || change.path.length === 0 ||
        !["created", "modified", "deleted"].includes(change.type)
      ) {
        throw INVALID_ARGUMENT.create({ detail: "Upload change entry is invalid" });
      }
      if (seenPaths.has(change.path)) {
        throw INVALID_ARGUMENT.create({ detail: "Upload contains duplicate file paths" });
      }
      seenPaths.add(change.path);

      if (change.type === "deleted") {
        // NOTE(#veryfront-api-write): Implement delete via API when available
        failed.push({
          path: change.path,
          error: "Delete not yet supported via API",
        });
        continue;
      }

      try {
        const content = await this.readFile(change.path);
        uploadedBytes += new TextEncoder().encode(content).length;
        if (uploadedBytes > this.config.maxTotalBytes) {
          throw INVALID_ARGUMENT.create({ detail: "Upload exceeds the maximum aggregate size" });
        }
        prepared.push({ change, content });
      } catch (error) {
        if (isVeryfrontError(error) && error.slug === "invalid-argument") throw error;
        failed.push({
          path: change.path,
          error: "Failed to upload workspace file",
        });
      }
    }

    for (const { change, content } of prepared) {
      if (options.onUpload) {
        try {
          await options.onUpload(change.path, content, change.type);
          uploaded.push(change);
        } catch {
          failed.push({ path: change.path, error: "Failed to upload workspace file" });
        }
        continue;
      }

      if (this.config.debug) {
        logger.info("Would upload file (no onUpload handler)", { type: change.type });
      }
      skipped.push(change);
    }

    return {
      uploaded,
      skipped,
      failed,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Safely resolve a path within the workspace, preventing path traversal
   * and symlink-based escapes (VULN-FS-4).
   *
   * - Rejects NUL bytes outright.
   * - Rejects any intermediate path segment that is a symlink.
   * - Re-checks containment by realpath-ing the parent directory after the
   *   segment walk, so a symlink that resolves through a non-symlink directory
   *   chain still cannot escape the workspace.
   *
   * Note: this deliberately rejects ALL symlinks inside the workspace — even
   * those whose targets remain within it — because the race window between
   * resolution and use is not worth the complexity for our use-case.
   */
  private async resolveSafePath(path: string): Promise<string> {
    // Reject NUL bytes — they confuse filesystem APIs and are never legitimate.
    if (path.includes("\0")) {
      throw SECURITY_VIOLATION.create({ detail: `NUL byte in path` });
    }

    // Workspace-relative paths only. A single leading "/" is the canonical
    // API form for "the project root" (e.g. "/src/foo.ts") and is accepted;
    // anything that syntactically looks like a system-absolute path beyond
    // that one-slash convention is rejected.
    //
    // - Windows drive letters (C:\...) — rejected.
    // - UNC paths (//host/share) — rejected.
    // - Unix absolute paths with a leading slash are treated as
    //   workspace-relative, but any component that tries to escape the
    //   workspace is still caught by the traversal / realpath checks below.
    if (/^[A-Za-z]:[\\/]/.test(path)) {
      throw SECURITY_VIOLATION.create({ detail: "Absolute path not allowed" });
    }
    if (path.startsWith("//")) {
      throw SECURITY_VIOLATION.create({ detail: "Absolute path not allowed" });
    }

    // Normalize the input path (treat leading "/" as workspace-relative).
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;

    // Empty path resolves to the workspace dir itself — writing to it would
    // clobber the workspace as a regular file. Reject explicitly.
    if (normalizedPath === "") {
      throw SECURITY_VIOLATION.create({ detail: `Empty path not allowed` });
    }

    // Resolve the full path lexically first (catches literal "..").
    const fullPath = resolve(join(this.workspaceDir, normalizedPath));
    const relativePath = relative(this.workspaceDir, fullPath);
    if (!relativePath || relativePath.startsWith("..") || relativePath === "..") {
      throw SECURITY_VIOLATION.create({ detail: "Path traversal detected" });
    }

    // Walk each segment and reject any existing symlink along the way.
    // A segment that does not yet exist is fine — it will be created later.
    const relSegments = relativePath === "" ? [] : relativePath.split(/[\\/]/).filter(Boolean);
    let cursor = this.workspaceDir;
    for (const seg of relSegments) {
      cursor = join(cursor, seg);
      try {
        const info = await Deno.lstat(cursor);
        if (info.isSymlink) {
          throw SECURITY_VIOLATION.create({
            detail: "Refusing to traverse symlink",
          });
        }
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          // Segment doesn't exist yet — the rest of the chain will be
          // created under a verified-non-symlink parent, so stop walking.
          break;
        }
        throw e;
      }
    }

    // Final containment check against the realpath of the parent directory,
    // to defeat any symlink-in-parent we might have missed (e.g. one that
    // appeared mid-walk). If the parent doesn't exist yet, that's fine —
    // the segment walk above already proved every existing ancestor is real.
    try {
      const parentReal = await Deno.realPath(dirname(fullPath));
      const workspaceReal = await Deno.realPath(this.workspaceDir);
      if (!isWithinDirectory(workspaceReal, parentReal)) {
        throw SECURITY_VIOLATION.create({
          detail: "Resolved parent outside workspace",
        });
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }

    return fullPath;
  }

  /**
   * Read a file from the workspace
   */
  async readFile(path: string): Promise<string> {
    const localPath = await this.resolveSafePath(path);
    const info = await Deno.lstat(localPath);
    if (!info.isFile || info.size > this.config.maxFileSize) {
      throw INVALID_ARGUMENT.create({ detail: "Workspace file exceeds the maximum file size" });
    }
    return await Deno.readTextFile(localPath);
  }

  /**
   * Write a file to the workspace
   */
  async writeFile(path: string, content: string): Promise<void> {
    if (typeof content !== "string") {
      throw INVALID_ARGUMENT.create({ detail: "Workspace file content must be a string" });
    }
    if (new TextEncoder().encode(content).length > this.config.maxFileSize) {
      throw INVALID_ARGUMENT.create({ detail: "Workspace file exceeds the maximum file size" });
    }
    const localPath = await this.resolveSafePath(path);

    // Ensure directory exists
    const dir = dirname(localPath);
    await Deno.mkdir(dir, { recursive: true });

    await Deno.writeTextFile(localPath, content);
  }

  /**
   * Delete a file from the workspace
   */
  async deleteFile(path: string): Promise<void> {
    const localPath = await this.resolveSafePath(path);
    await Deno.remove(localPath);
  }

  /**
   * Check if a file exists in the workspace
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      const localPath = await this.resolveSafePath(path);
      await Deno.stat(localPath);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      if ((error as { slug?: unknown })?.slug === "security-violation") return false;
      throw error;
    }
  }

  /**
   * Clean up the workspace directory
   */
  async cleanup(): Promise<void> {
    if (this.config.debug) {
      logger.info("Cleaning up workspace");
    }

    try {
      await Deno.remove(this.workspaceDir, { recursive: true });
    } catch (cause) {
      if (!(cause instanceof Deno.errors.NotFound)) {
        logger.warn("Workspace cleanup failed", {
          errorName: cause instanceof Error ? cause.name : typeof cause,
        });
        throw UNKNOWN_ERROR.create({
          detail: "Failed to clean up workspace",
          cause: cause instanceof Error ? cause : undefined,
        });
      }
    } finally {
      this.initialized = false;
      this.fileChecksums.clear();
    }
  }
}

/**
 * Create a workspace sync for a Claude Code run
 */
export function createWorkspaceSync(config: WorkspaceConfig): WorkspaceSync {
  return new WorkspaceSync(config);
}

/**
 * Execute a function with a synchronized workspace
 *
 * @example
 * ```typescript
 * const result = await withWorkspace(
 *   { runId: "abc123", tenant },
 *   async (workspace) => {
 *     // Workspace is initialized with project files
 *     await runBashCommand("npm install", workspace.workspaceDir);
 *     await runBashCommand("npm test", workspace.workspaceDir);
 *
 *     // Return result
 *     return { success: true };
 *   },
 * );
 *
 * // Changes are automatically detected and returned
 * console.log(result.changes);
 * ```
 */
export async function withWorkspace<T>(
  config: WorkspaceConfig,
  fn: (workspace: WorkspaceSync) => Promise<T>,
): Promise<{
  result: T;
  changes: FileChange[];
  syncResult: WorkspaceSyncResult;
}> {
  const workspace = createWorkspaceSync(config);
  let value: {
    result: T;
    changes: FileChange[];
    syncResult: WorkspaceSyncResult;
  };

  try {
    // Initialize workspace
    const syncResult = await workspace.initialize();

    // Execute function
    const result = await fn(workspace);

    // Detect changes
    const changes = await workspace.detectChanges();

    value = { result, changes, syncResult };
  } catch (error) {
    try {
      await workspace.cleanup();
    } catch (cleanupError) {
      logger.warn("Workspace cleanup also failed after an operation error", {
        errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
      });
    }
    throw error;
  }

  await workspace.cleanup();
  return value;
}
