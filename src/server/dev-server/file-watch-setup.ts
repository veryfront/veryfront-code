import { serverLogger as logger } from "#veryfront/utils";
import { isAbsolute, join, relative, sep } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { type FileChangeBatchMetadata, OptimizedFileWatcher } from "./file-watcher.ts";
import type { RouteDiscovery } from "./route-discovery.ts";
import { ReloadNotifier } from "../reload-notifier.ts";
import {
  clearModulePathCache,
  invalidateModulePaths,
} from "#veryfront/transforms/mdx/esm-module-loader/index.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { getSafeErrorName } from "../utils/error-name.ts";
import { getErrorCollector } from "#veryfront/observability";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const hmrLog = logger.component("hmr");
const fileWatchSetupLog = logger.component("file-watch-setup");

const METRICS_LOG_INTERVAL = 10;
const MAX_PRIMITIVE_DIRECTORIES = 256;
const MAX_PRIMITIVE_DIRECTORY_LENGTH = 512;
const MAX_HASHED_FILE_BYTES = 4 * 1024 * 1024;
const MAX_CONTENT_HASH_ENTRIES = 10_000;
const textEncoder = new TextEncoder();

/** Default agent/chat primitive directories (used when no custom paths configured) */
const DEFAULT_PRIMITIVE_DIRS = ["tools", "agents", "workflows", "prompts", "resources"];

function normalizePrimitiveDirectory(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_PRIMITIVE_DIRECTORY_LENGTH
  ) {
    throw new TypeError("Primitive directory must be a bounded project-relative path");
  }
  let normalized = value.replaceAll("\\", "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  normalized = normalized.replace(/\/+$/, "");
  if (
    normalized.length === 0 || normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new TypeError("Primitive directory must be a bounded project-relative path");
  }
  const segments = normalized.split("/");
  if (
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".." ||
      hasUnsafeControlCharacters(segment)
    )
  ) {
    throw new TypeError("Primitive directory must be a bounded project-relative path");
  }
  return segments.join("/");
}

/**
 * Patterns for paths that should NOT trigger HMR updates.
 * These are generated/cached files that change during normal operation
 * but don't represent actual source code changes.
 */
const IGNORED_PATH_SEGMENTS = new Set([
  ".cache",
  "node_modules",
  ".git",
  ".veryfront",
  ".playwright-mcp",
]);

/**
 * Generated-artifact file extensions that are never source and must never
 * trigger an HMR update, even when written outside an ignored directory
 * (e.g. a tool that drops a `.log` into the project root). This is the
 * defensive guarantee against future tools writing to as-yet-unknown paths.
 *
 * Deliberately narrow: only extensions that are unambiguously machine output.
 * veryfront hot-reloads more than JS (`.css`, `.mdx`/`.md`, and arbitrary
 * primitive-directory resources), so an allowlist of "source" extensions
 * would wrongly suppress legitimate updates.
 */
const IGNORED_ARTIFACT_EXTENSIONS = new Set([".log", ".tmp"]);

/**
 * Project-root directory names that contain runtime data (not source code)
 * and should be excluded from HMR. Matched by first path segment relative
 * to projectDir to avoid false positives (e.g. "src/data/" is fine).
 */
const IGNORED_RUNTIME_DIRS = new Set(["data"]);

/**
 * Generated build-output directory names. Matched as an exact path *segment*
 * relative to projectDir (at any depth), so a real `dist/` inside the project
 * is skipped while:
 *   - an ancestor directory named `dist` (the project being checked out under
 *     one, e.g. `/workspace/dist/my-app/`) does NOT suppress every source
 *     change. The match is project-relative, and
 *   - a source dir whose name merely ends in "dist" (e.g. `mydist/`,
 *     `wishlist-dist/`) is NOT matched because segments are compared exactly.
 */
const IGNORED_OUTPUT_DIRS = new Set(["dist"]);

/** Whether a path ends in a generated-artifact extension (case-insensitive). */
function hasIgnoredArtifactExtension(path: string): boolean {
  const lower = path.toLowerCase();
  for (const ext of IGNORED_ARTIFACT_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Check if a path should be ignored for HMR purposes, either because it lives
 * in a generated/output directory or because it is a generated-artifact file.
 *
 * Exported for unit testing.
 */
export function shouldIgnorePath(path: string): boolean {
  return path.replaceAll("\\", "/").split("/").some((segment) =>
    IGNORED_PATH_SEGMENTS.has(segment)
  ) ||
    hasIgnoredArtifactExtension(path);
}

/**
 * Whether a path lives inside a generated build-output directory, evaluated
 * relative to `projectDir` so directories *above* the project (which the user
 * cannot control, e.g. a checkout under `/some/dist/...`) are never matched.
 *
 * Exported for unit testing.
 */
export function isIgnoredOutputDir(projectDir: string, fullPath: string): boolean {
  const rel = relative(projectDir, fullPath);
  // A path outside the project root yields a `..`-prefixed relative path; such
  // paths are not project output and are left to the absolute-pattern checks.
  if (rel.startsWith("..")) return false;
  return rel.split(sep).some((segment) => IGNORED_OUTPUT_DIRS.has(segment));
}

/** Return whether an event path is contained by the watched project root. */
export function isPathInsideProject(projectDir: string, fullPath: string): boolean {
  const rel = relative(projectDir, fullPath);
  return rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export class FileWatchSetup {
  private fileWatcher?: { close(): void };
  private watcherController?: AbortController;
  private optimizedWatcher?: OptimizedFileWatcher;
  private watchTask?: Promise<void>;
  private cleanupPromise?: Promise<void>;
  private closed = false;
  private batchCount = 0;
  private primitiveDirs: Set<string>;
  /** Content hashes to skip re-renders when file content is unchanged */
  private contentHashes = new Map<string, string>();

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private routeDiscovery: RouteDiscovery,
    private debounceMs: number,
    private rediscoverPrimitives?: () => Promise<void>,
    primitiveDirNames?: string[],
  ) {
    const configuredPrimitiveDirs = primitiveDirNames ?? DEFAULT_PRIMITIVE_DIRS;
    if (configuredPrimitiveDirs.length > MAX_PRIMITIVE_DIRECTORIES) {
      throw new TypeError("Too many primitive directories configured");
    }
    this.primitiveDirs = new Set(configuredPrimitiveDirs.map(normalizePrimitiveDirectory));
  }

  async setup(): Promise<void> {
    if (this.closed) throw new TypeError("File watcher has been closed");
    if (this.fileWatcher || this.watchTask) throw new TypeError("File watcher is already active");

    const watchPaths = await this.getWatchPaths();
    if (watchPaths.length === 0) {
      hmrLog.warn("No directories found to watch");
      return;
    }

    logger.debug(
      `[HMR] Initializing optimized file watcher with ${this.debounceMs}ms debounce`,
    );

    this.optimizedWatcher = new OptimizedFileWatcher(
      this.debounceMs,
      (changes, metadata) => this.handleBatchedFileChanges(changes, metadata),
    );

    const watcherController = new AbortController();
    try {
      const watcher = this.adapter.fs.watch(watchPaths, {
        recursive: true,
        signal: watcherController.signal,
      });

      this.watcherController = watcherController;
      this.fileWatcher = watcher;
      this.watchTask = this.processFileWatcher(watcher, watcherController.signal);
    } catch (error) {
      watcherController.abort();
      await this.optimizedWatcher.cleanup();
      this.optimizedWatcher = undefined;
      throw error;
    }
  }

  private async getWatchPaths(): Promise<string[]> {
    const potentialPaths = [
      this.projectDir,
      join(this.projectDir, "pages"),
      join(this.projectDir, "components"),
      join(this.projectDir, "styles"),
      join(this.projectDir, "public"),
      join(this.projectDir, "app"),
      // Agent/chat primitive directories (from config or defaults)
      ...Array.from(this.primitiveDirs).map((dir) => join(this.projectDir, dir)),
    ];

    const watchPaths: string[] = [];
    for (const path of potentialPaths) {
      try {
        const stat = await this.adapter.fs.stat(path);
        if (stat.isDirectory) watchPaths.push(path);
      } catch (error) {
        if (isNotFoundError(error)) continue;
        throw error;
      }
    }

    return [...new Set(watchPaths)];
  }

  private async processFileWatcher(
    watcher: AsyncIterable<{ kind: string; paths: string[] }>,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      for await (const { paths } of watcher) {
        if (signal.aborted) break;

        try {
          // Filter out paths that shouldn't trigger HMR (cache, node_modules, runtime data, etc.)
          const relevantPaths = paths.filter((p) =>
            isPathInsideProject(this.projectDir, p) &&
            !shouldIgnorePath(relative(this.projectDir, p)) &&
            !this.isRuntimeDataPath(p) &&
            !isIgnoredOutputDir(this.projectDir, p)
          );
          if (relevantPaths.length === 0) continue;

          const optimizedWatcher = this.optimizedWatcher;
          if (!optimizedWatcher) {
            if (signal.aborted || this.closed) break;
            this.reportBackgroundFailure("File watcher lost its change processor", new Error());
            return;
          }
          optimizedWatcher.handleChange(relevantPaths);
        } catch (error) {
          this.reportBackgroundFailure("Failed to handle file change", error);
        }
      }
      if (!signal.aborted && !this.closed) {
        this.reportBackgroundFailure("File watcher stopped unexpectedly", new Error());
      }
    } catch (error) {
      if (!signal.aborted) {
        this.reportBackgroundFailure("File watcher task failed unexpectedly", error);
      }
    }
  }

  private async refreshAndReload(paths: string[], logMessage: string): Promise<void> {
    if (this.closed) return;
    if (paths.some((path) => !isPathInsideProject(this.projectDir, path))) {
      throw new TypeError("File change path escaped the project root");
    }
    await this.routeDiscovery.discoverRoutes();
    if (this.closed) return;

    // Invalidate on-disk ESM cache for changed files immediately,
    // before the browser reloads, so the next SSR render picks up fresh content.
    const relativePaths = paths.map((p) => relative(this.projectDir, p).split(sep).join("/"));
    invalidateModulePaths(relativePaths);

    if (logMessage) logger.debug(logMessage, { changedFileCount: paths.length });

    // Single source of truth for HMR signaling:
    // ReloadNotifier immediately invalidates runtime caches and then sends
    // one debounced browser update for both local dev and preview clients.
    await ReloadNotifier.triggerReload(relativePaths, { projectDir: this.projectDir });
  }

  /**
   * Check if a path is inside a configured primitive directory (tools/, agents/, etc.)
   * Uses path segment matching to avoid false positives from substrings.
   */
  private isPrimitivePath(fullPath: string): boolean {
    if (!isPathInsideProject(this.projectDir, fullPath)) return false;
    const rel = relative(this.projectDir, fullPath).split(sep).join("/");
    return Array.from(this.primitiveDirs).some((directory) =>
      rel === directory || rel.startsWith(`${directory}/`)
    );
  }

  /**
   * Check if a path is inside a runtime data directory (data/, etc.)
   * that contains generated content (embedding indices) rather than source code.
   */
  private isRuntimeDataPath(fullPath: string): boolean {
    const rel = relative(this.projectDir, fullPath);
    const firstSegment = rel.split(sep)[0] ?? "";
    return IGNORED_RUNTIME_DIRS.has(firstSegment);
  }

  private async hashContent(content: string): Promise<{ hash: string; byteLength: number }> {
    const bytes = textEncoder.encode(content);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    return { hash, byteLength: bytes.byteLength };
  }

  private rememberContentHash(path: string, hash: string): void {
    this.contentHashes.delete(path);
    while (this.contentHashes.size >= MAX_CONTENT_HASH_ENTRIES) {
      const oldest = this.contentHashes.keys().next().value;
      if (oldest === undefined) break;
      this.contentHashes.delete(oldest);
    }
    this.contentHashes.set(path, hash);
  }

  /** Filter out files whose content hasn't actually changed */
  private async filterChangedFiles(paths: string[]): Promise<string[]> {
    const changed: string[] = [];
    for (const path of paths) {
      let stat;
      try {
        stat = await this.adapter.fs.stat(path);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        this.contentHashes.delete(path);
        changed.push(path);
        continue;
      }

      if (!stat.isFile || stat.size > MAX_HASHED_FILE_BYTES) {
        this.contentHashes.delete(path);
        changed.push(path);
        continue;
      }
      if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
        throw new TypeError("File watcher received invalid file metadata");
      }

      let content: string;
      try {
        content = await this.adapter.fs.readFile(path);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        this.contentHashes.delete(path);
        changed.push(path);
        continue;
      }

      const { hash, byteLength } = await this.hashContent(content);
      if (byteLength > MAX_HASHED_FILE_BYTES) {
        this.contentHashes.delete(path);
        changed.push(path);
        continue;
      }
      if (this.contentHashes.get(path) === hash) {
        this.rememberContentHash(path, hash);
        continue;
      }
      this.rememberContentHash(path, hash);
      changed.push(path);
    }
    return changed;
  }

  private async handleBatchedFileChanges(
    changes: string[],
    metadata: FileChangeBatchMetadata = { fullInvalidation: false },
  ): Promise<void> {
    if (this.closed) return;
    const startTime = performance.now();

    if (metadata.fullInvalidation) {
      if (this.rediscoverPrimitives) await this.rediscoverPrimitives();
      if (this.closed) return;
      await this.routeDiscovery.discoverRoutes();
      if (this.closed) return;
      this.contentHashes.clear();
      clearModulePathCache();
      await ReloadNotifier.triggerReload(undefined, { projectDir: this.projectDir });
      hmrLog.warn("File-change backlog required a full cache invalidation");
      this.batchCount++;
      return;
    }

    // Skip files whose content hasn't actually changed (e.g., save without edits)
    const actualChanges = await this.filterChangedFiles(changes);
    if (this.closed) return;
    if (actualChanges.length === 0) {
      hmrLog.debug("All file changes had identical content, skipping HMR");
      return;
    }

    // Check for primitive file changes and trigger re-discovery
    const hasPrimitiveChanges = actualChanges.some((p) => this.isPrimitivePath(p));
    if (hasPrimitiveChanges && this.rediscoverPrimitives) {
      await this.rediscoverPrimitives();
      if (this.closed) return;
    }

    await this.refreshAndReload(actualChanges, "");

    const duration = (performance.now() - startTime).toFixed(0);
    hmrLog.debug(`Batch processed ${changes.length} file changes in ${duration}ms`, {
      changedFileCount: changes.length,
    });

    this.batchCount++;
    if (this.optimizedWatcher && this.batchCount % METRICS_LOG_INTERVAL === 0) {
      hmrLog.debug("Performance metrics", this.optimizedWatcher.getMetrics());
    }
  }

  getMetrics() {
    return this.optimizedWatcher?.getMetrics() ?? null;
  }

  private reportBackgroundFailure(message: string, error: unknown): void {
    const errorName = getSafeErrorName(error);
    hmrLog.error(message, { errorName });
    getErrorCollector().addHMRError(message, undefined, { errorName });
  }

  cleanup(): Promise<void> {
    this.cleanupPromise ??= this.cleanupInternal();
    return this.cleanupPromise;
  }

  private async cleanupInternal(): Promise<void> {
    this.closed = true;
    const watcherController = this.watcherController;
    const optimizedWatcher = this.optimizedWatcher;
    const fileWatcher = this.fileWatcher;
    const watchTask = this.watchTask;
    this.watcherController = undefined;
    this.optimizedWatcher = undefined;
    this.fileWatcher = undefined;
    this.watchTask = undefined;

    watcherController?.abort();
    const optimizedWatcherCleanup = optimizedWatcher?.cleanup();

    let closeError: unknown;
    try {
      fileWatcher?.close();
    } catch (error) {
      closeError = error;
    }
    await Promise.all([watchTask, optimizedWatcherCleanup]);
    this.contentHashes.clear();
    if (closeError !== undefined) {
      fileWatchSetupLog.debug("File watcher close failed", {
        errorName: getSafeErrorName(closeError),
      });
      throw closeError;
    }
  }
}
