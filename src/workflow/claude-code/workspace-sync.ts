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
import { join, relative, resolve } from "@std/path";

const logger = baseLogger.component("workspace-sync");

/** Maximum file size for workspace sync (10 MB) */
const MAX_WORKSPACE_FILE_SIZE = 10 * 1024 * 1024;

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

  /** Files that were skipped (too large, excluded) */
  skippedFiles: string[];

  /** Duration in ms */
  duration: number;
}

/**
 * Upload result
 */
export interface UploadResult {
  /** Files that were uploaded */
  uploaded: FileChange[];

  /** Files that failed to upload */
  failed: Array<{ path: string; error: string }>;

  /** Duration in ms */
  duration: number;
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
 * Check if path matches any pattern
 */
function matchesPattern(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Simple glob matching
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

  constructor(config: WorkspaceConfig) {
    // SECURITY: Validate runId to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(config.runId)) {
      throw new Error(
        `Invalid runId: must contain only alphanumeric, underscore, or hyphen characters`,
      );
    }

    this.config = {
      baseDir: "/tmp/veryfront-workspaces",
      maxFileSize: MAX_WORKSPACE_FILE_SIZE,
      debug: false,
      ...config,
    };
  }

  /**
   * Get the workspace directory path
   */
  get workspaceDir(): string {
    return `${this.config.baseDir}/${this.config.runId}`;
  }

  /**
   * Initialize workspace by downloading project files
   */
  async initialize(): Promise<WorkspaceSyncResult> {
    const startTime = Date.now();
    const skippedFiles: string[] = [];
    let filesDownloaded = 0;
    let bytesDownloaded = 0;

    if (this.config.debug) {
      logger.info("Initializing workspace", { workspaceDir: this.workspaceDir });
    }

    // Create workspace directory
    await Deno.mkdir(this.workspaceDir, { recursive: true });

    // List all files from project
    const files = await api.files.listAll();

    if (this.config.debug) {
      logger.info("Found files in project", { count: files.length });
    }

    // Download each file
    for (const file of files) {
      const path = file.path.startsWith("/") ? file.path : `/${file.path}`;

      // Check include patterns
      if (this.config.include && !matchesPattern(path, this.config.include)) {
        skippedFiles.push(path);
        continue;
      }

      // Check exclude patterns
      if (this.config.exclude && matchesPattern(path, this.config.exclude)) {
        skippedFiles.push(path);
        continue;
      }

      // Check file size (if available in metadata)
      // Note: We might not have size info until we fetch the file

      try {
        const content = await api.files.read(path);

        // Check size after fetching
        if (content.length > this.config.maxFileSize) {
          skippedFiles.push(path);
          if (this.config.debug) {
            logger.info("Skipping large file", { path, size: content.length });
          }
          continue;
        }

        // Calculate checksum for change detection
        const hash = await checksum(content);
        this.fileChecksums.set(path, hash);

        // Write to local filesystem (use safe path resolution)
        const localPath = this.resolveSafePath(path);
        const dir = localPath.substring(0, localPath.lastIndexOf("/"));
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(localPath, content);

        filesDownloaded++;
        bytesDownloaded += content.length;

        if (this.config.debug) {
          logger.info("Downloaded file", { path });
        }
      } catch (error) {
        if (this.config.debug) {
          logger.error("Failed to download file", { path }, error);
        }
        skippedFiles.push(path);
      }
    }

    this.initialized = true;

    const result: WorkspaceSyncResult = {
      workspaceDir: this.workspaceDir,
      filesDownloaded,
      bytesDownloaded,
      skippedFiles,
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
  }

  /**
   * Detect changes in the workspace
   */
  async detectChanges(): Promise<FileChange[]> {
    const changes: FileChange[] = [];

    if (!this.initialized) {
      throw new Error("Workspace not initialized. Call initialize() first.");
    }

    // Walk the workspace directory
    for await (const entry of Deno.readDir(this.workspaceDir)) {
      await this.walkAndDetect(
        `${this.workspaceDir}/${entry.name}`,
        `/${entry.name}`,
        changes,
      );
    }

    // Check for deleted files
    for (const [path, originalHash] of this.fileChecksums) {
      try {
        const localPath = this.resolveSafePath(path);
        await Deno.stat(localPath);
      } catch (_) {
        // File was deleted
        changes.push({
          path,
          type: "deleted",
          originalChecksum: originalHash,
        });
      }
    }

    if (this.config.debug) {
      logger.info("Detected changes", { count: changes.length });
    }

    return changes;
  }

  /**
   * Recursively walk directory and detect changes
   */
  private async walkAndDetect(
    localPath: string,
    relativePath: string,
    changes: FileChange[],
  ): Promise<void> {
    const stat = await Deno.stat(localPath);

    if (stat.isDirectory) {
      for await (const entry of Deno.readDir(localPath)) {
        await this.walkAndDetect(
          `${localPath}/${entry.name}`,
          `${relativePath}/${entry.name}`,
          changes,
        );
      }
      return;
    }

    // It's a file - check for changes
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
    const startTime = Date.now();
    const uploaded: FileChange[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    for (const change of changes) {
      if (change.type === "deleted") {
        // NOTE(#veryfront-api-write): Implement delete via API when available
        failed.push({
          path: change.path,
          error: "Delete not yet supported via API",
        });
        continue;
      }

      try {
        const localPath = this.resolveSafePath(change.path);
        const content = await Deno.readTextFile(localPath);

        if (options.onUpload) {
          await options.onUpload(change.path, content, change.type);
          uploaded.push(change);
        } else {
          // No upload handler - just log the change
          if (this.config.debug) {
            logger.info("Would upload file", { path: change.path, type: change.type });
          }
          // Mark as uploaded for tracking, even though we didn't actually upload
          uploaded.push(change);
        }
      } catch (error) {
        failed.push({
          path: change.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      uploaded,
      failed,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Safely resolve a path within the workspace, preventing path traversal attacks
   */
  private resolveSafePath(path: string): string {
    // Normalize the input path
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;

    // Resolve the full path
    const fullPath = resolve(join(this.workspaceDir, normalizedPath));

    // Verify the resolved path is within the workspace
    const relativePath = relative(this.workspaceDir, fullPath);
    if (relativePath.startsWith("..") || !relativePath || relativePath === "..") {
      throw new Error(`Path traversal detected: ${path}`);
    }

    return fullPath;
  }

  /**
   * Read a file from the workspace
   */
  async readFile(path: string): Promise<string> {
    const localPath = this.resolveSafePath(path);
    return await Deno.readTextFile(localPath);
  }

  /**
   * Write a file to the workspace
   */
  async writeFile(path: string, content: string): Promise<void> {
    const localPath = this.resolveSafePath(path);

    // Ensure directory exists
    const dir = localPath.substring(0, localPath.lastIndexOf("/"));
    await Deno.mkdir(dir, { recursive: true });

    await Deno.writeTextFile(localPath, content);
  }

  /**
   * Delete a file from the workspace
   */
  async deleteFile(path: string): Promise<void> {
    const localPath = this.resolveSafePath(path);
    await Deno.remove(localPath);
  }

  /**
   * Check if a file exists in the workspace
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      const localPath = this.resolveSafePath(path);
      await Deno.stat(localPath);
      return true;
    } catch (_) {
      /* expected: file may not exist */
      return false;
    }
  }

  /**
   * Clean up the workspace directory
   */
  async cleanup(): Promise<void> {
    if (this.config.debug) {
      logger.info("Cleaning up workspace", { workspaceDir: this.workspaceDir });
    }

    try {
      await Deno.remove(this.workspaceDir, { recursive: true });
    } catch (error) {
      if (this.config.debug) {
        logger.error("Cleanup failed", error);
      }
    }

    this.initialized = false;
    this.fileChecksums.clear();
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

  try {
    // Initialize workspace
    const syncResult = await workspace.initialize();

    // Execute function
    const result = await fn(workspace);

    // Detect changes
    const changes = await workspace.detectChanges();

    return { result, changes, syncResult };
  } finally {
    // Always cleanup
    await workspace.cleanup();
  }
}
