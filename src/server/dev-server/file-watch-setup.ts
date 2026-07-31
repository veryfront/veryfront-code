import { serverLogger as logger } from "#veryfront/utils";
import { join, relative, sep } from "#veryfront/compat/path/index.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { FileWatcher, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { OptimizedFileWatcher } from "./file-watcher.ts";
import type { RouteDiscovery } from "./route-discovery.ts";
import { ReloadNotifier } from "../reload-notifier.ts";
import { invalidateModulePaths } from "#veryfront/transforms/mdx/esm-module-loader/index.ts";
import type { ReloadProjectInfo } from "../reload-notifier.ts";

const hmrLog = logger.component("hmr");

const METRICS_LOG_INTERVAL = 10;

/** Default agent/chat primitive directories (used when no custom paths configured) */
const DEFAULT_PRIMITIVE_DIRS = ["tools", "agents", "workflows", "prompts", "resources"];

/**
 * Exact directory-name path segments that should NOT trigger HMR updates.
 * These contain generated or cached files that change during normal operation
 * but don't represent actual source code changes.
 */
const IGNORED_DIRECTORY_NAMES = new Set([
  ".cache",
  "node_modules",
  ".git",
  ".veryfront",
  ".omx",
  // Tool output directories that live inside the project root. Tools such as
  // the Playwright MCP server write per-step artifacts here continuously,
  // which would otherwise drive an open-ended HMR refresh loop.
  ".playwright-mcp",
]);

/**
 * Generated-artifact file extensions that are never source and must never
 * trigger an HMR update — even when written outside an ignored directory
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
 * Generated file names written at project root during dev-server request
 * handling. These files are not source and must not trigger HMR.
 */
const TRANSIENT_MIDDLEWARE_MODULE_RE = /^\.vf-middleware-.+\.mjs$/;

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
 *     change — the match is project-relative, and
 *   - a source dir whose name merely ends in "dist" (e.g. `mydist/`,
 *     `wishlist-dist/`) is NOT matched — segments are compared exactly.
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

function hasIgnoredArtifactFileName(path: string): boolean {
  const fileName = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  return TRANSIENT_MIDDLEWARE_MODULE_RE.test(fileName);
}

/**
 * Check if a path should be ignored for HMR purposes — either because it lives
 * in a generated/output directory or because it is a generated-artifact file.
 *
 * Exported for unit testing.
 */
export function shouldIgnorePath(path: string): boolean {
  return path.split(/[\\/]/).some((segment) => IGNORED_DIRECTORY_NAMES.has(segment)) ||
    hasIgnoredArtifactExtension(path) ||
    hasIgnoredArtifactFileName(path);
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

function normalizeRelativeDirectory(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}

/** Whether a changed file belongs to one of the configured discovery roots. */
export function isConfiguredPrimitivePath(
  projectDir: string,
  primitiveDirs: readonly string[],
  fullPath: string,
): boolean {
  const projectRelativePath = normalizeRelativeDirectory(relative(projectDir, fullPath));
  return primitiveDirs.some((directory) => {
    const normalizedDirectory = normalizeRelativeDirectory(directory);
    return normalizedDirectory.length > 0 &&
      (projectRelativePath === normalizedDirectory ||
        projectRelativePath.startsWith(`${normalizedDirectory}/`));
  });
}

export class FileWatchSetup {
  private fileWatcher?: FileWatcher;
  private watcherController?: AbortController;
  private watcherTask?: Promise<void>;
  private watcherDone?: Promise<void>;
  private watcherFailureReported = false;
  private watcherFailure?: unknown;
  private optimizedWatcher?: OptimizedFileWatcher;
  private watcherGeneration = 0;
  private setupPromise?: Promise<void>;
  private cleanupPromise?: Promise<void>;
  private batchCount = 0;
  private primitiveDirs: string[];
  /** Content hashes to skip re-renders when file content is unchanged */
  private contentHashes = new Map<string, number>();

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private routeDiscovery: RouteDiscovery,
    private debounceMs: number,
    private invalidateHandler: () => void = () => {},
    private rediscoverPrimitives?: () => Promise<void>,
    primitiveDirNames?: string[],
    private reloadProject?: ReloadProjectInfo,
    private onWatcherFailure?: (error: unknown) => void,
  ) {
    this.primitiveDirs = Array.from(new Set(primitiveDirNames ?? DEFAULT_PRIMITIVE_DIRS));
  }

  setup(): Promise<void> {
    if (
      this.setupPromise || this.cleanupPromise || this.fileWatcher ||
      this.watcherController || this.optimizedWatcher
    ) {
      return Promise.reject(new Error("File watcher setup is already active"));
    }

    const operation = this.initializeWatcher();
    this.setupPromise = operation;
    return operation.finally(() => {
      if (this.setupPromise === operation) this.setupPromise = undefined;
    });
  }

  private async initializeWatcher(): Promise<void> {
    const generation = ++this.watcherGeneration;
    const watchPaths = await this.getWatchPaths();
    if (watchPaths.length === 0) {
      throw new Error("No directories are available for file watching");
    }

    logger.debug(
      `[HMR] Initializing optimized file watcher with ${this.debounceMs}ms debounce`,
    );

    this.optimizedWatcher = new OptimizedFileWatcher(
      this.debounceMs,
      (changes) => this.handleBatchedFileChanges(changes, generation),
    );

    this.watcherController = new AbortController();
    let watcher: FileWatcher | undefined;
    try {
      watcher = this.adapter.fs.watch(watchPaths, {
        recursive: true,
        signal: this.watcherController.signal,
      });

      this.fileWatcher = watcher;
      if (watcher.ready) await watcher.ready;

      const hasCompletionSignal = watcher.done !== undefined;
      this.watcherTask = this.processFileWatcher(
        watcher,
        this.watcherController.signal,
        hasCompletionSignal,
        generation,
      );
      void this.watcherTask.catch((error) => this.reportWatcherFailure(error));

      if (watcher.done) {
        this.watcherDone = watcher.done;
        void watcher.done.then(
          () => {
            if (!this.watcherController?.signal.aborted) {
              this.reportWatcherFailure(new Error("File watcher stopped unexpectedly"));
            }
          },
          (error) => this.reportWatcherFailure(error),
        );
      }
    } catch (error) {
      if (this.watcherGeneration === generation) this.watcherGeneration++;
      this.watcherController.abort();
      await this.optimizedWatcher.cleanup();
      try {
        watcher?.close();
      } catch {
        // Preserve the acquisition failure. Cleanup is best effort before the
        // watcher generation has been published to the server lifecycle.
      }
      await watcher?.done?.catch(() => undefined);
      this.fileWatcher = undefined;
      this.watcherController = undefined;
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
      ...this.primitiveDirs.map((dir) => join(this.projectDir, dir)),
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

    return watchPaths;
  }

  private async processFileWatcher(
    watcher: AsyncIterable<{ kind: string; paths: string[] }>,
    signal: AbortSignal,
    hasCompletionSignal: boolean,
    generation: number,
  ): Promise<void> {
    for await (const { paths } of watcher) {
      if (signal.aborted) break;

      try {
        // Filter out paths that shouldn't trigger HMR (cache, node_modules, runtime data, etc.)
        const relevantPaths = paths.filter((p) =>
          !shouldIgnorePath(p) && !this.isRuntimeDataPath(p) &&
          !isIgnoredOutputDir(this.projectDir, p)
        );
        if (relevantPaths.length === 0) continue;

        if (this.optimizedWatcher) {
          this.optimizedWatcher.handleChange(relevantPaths);
          continue;
        }

        await this.handleImmediateFileChange(relevantPaths, generation);
      } catch (error) {
        hmrLog.error("Failed to handle file change", error);
      }
    }

    if (!signal.aborted && !hasCompletionSignal) {
      throw new Error("File watcher stopped unexpectedly");
    }
  }

  private reportWatcherFailure(error: unknown): void {
    if (this.watcherController?.signal.aborted || this.watcherFailureReported) return;
    this.watcherFailureReported = true;
    this.watcherFailure = error;

    if (!this.onWatcherFailure) {
      hmrLog.error("File watcher failed", error);
      return;
    }

    try {
      this.onWatcherFailure(error);
    } catch (callbackError) {
      hmrLog.error("File watcher failure callback failed", callbackError);
    }
  }

  private isWatcherGenerationActive(generation: number): boolean {
    return this.watcherGeneration === generation &&
      this.watcherController?.signal.aborted === false;
  }

  private async refreshAndReload(
    paths: string[],
    logMessage: string,
    generation: number,
  ): Promise<boolean> {
    if (!this.isWatcherGenerationActive(generation)) return false;
    await this.routeDiscovery.discoverRoutes();
    if (!this.isWatcherGenerationActive(generation)) return false;
    this.invalidateHandler();

    // Invalidate on-disk ESM cache for changed files immediately,
    // before the browser reloads, so the next SSR render picks up fresh content.
    const relativePaths = paths.map((p) => relative(this.projectDir, p).split(sep).join("/"));
    await invalidateModulePaths(relativePaths);
    if (!this.isWatcherGenerationActive(generation)) return false;

    const display = paths.map((p) => p.replace(this.projectDir, ".")).join(", ");
    logger.debug(logMessage, { files: display });

    // Single source of truth for HMR signaling:
    // ReloadNotifier immediately invalidates runtime caches and then sends
    // one debounced browser update for both local dev and preview clients.
    ReloadNotifier.triggerReload(relativePaths, this.reloadProject);
    return true;
  }

  /**
   * Check if a path is inside a configured primitive directory (tools/, agents/, etc.)
   * Uses path segment matching to avoid false positives from substrings.
   */
  private isPrimitivePath(fullPath: string): boolean {
    return isConfiguredPrimitivePath(this.projectDir, this.primitiveDirs, fullPath);
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

  /** FNV-1a hash for fast content comparison */
  private hashContent(content: string): number {
    let h = 2166136261;
    for (let i = 0; i < content.length; i++) {
      h ^= content.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h;
  }

  /** Filter out files whose content hasn't actually changed */
  private async filterChangedFiles(paths: string[]): Promise<string[]> {
    const changed: string[] = [];
    for (const path of paths) {
      try {
        const content = await this.adapter.fs.readFile(path);
        const hash = this.hashContent(content);
        if (this.contentHashes.get(path) === hash) continue;
        this.contentHashes.set(path, hash);
        changed.push(path);
      } catch (_) {
        /* expected: file may be deleted or unreadable — treat as changed */
        this.contentHashes.delete(path);
        changed.push(path);
      }
    }
    return changed;
  }

  private async handleBatchedFileChanges(changes: string[], generation: number): Promise<void> {
    const startTime = performance.now();

    // Skip files whose content hasn't actually changed (e.g., save without edits)
    const actualChanges = await this.filterChangedFiles(changes);
    if (!this.isWatcherGenerationActive(generation)) return;
    if (actualChanges.length === 0) {
      hmrLog.debug("All file changes had identical content, skipping HMR");
      return;
    }

    // Check for primitive file changes and trigger re-discovery
    const hasPrimitiveChanges = actualChanges.some((p) => this.isPrimitivePath(p));
    if (hasPrimitiveChanges && this.rediscoverPrimitives) {
      await this.rediscoverPrimitives();
      if (!this.isWatcherGenerationActive(generation)) return;
    }

    if (!await this.refreshAndReload(actualChanges, "", generation)) return;

    const duration = (performance.now() - startTime).toFixed(0);
    hmrLog.debug(`Batch processed ${changes.length} file changes in ${duration}ms`, {
      files: changes.map((p) => p.replace(this.projectDir, ".")).join(", "),
    });

    this.batchCount++;
    if (this.optimizedWatcher && this.batchCount % METRICS_LOG_INTERVAL === 0) {
      hmrLog.debug("Performance metrics", this.optimizedWatcher.getMetrics());
    }
  }

  private async handleImmediateFileChange(paths: string[], generation: number): Promise<void> {
    const actualChanges = await this.filterChangedFiles(paths);
    if (!this.isWatcherGenerationActive(generation)) return;
    if (actualChanges.length === 0) return;
    await this.refreshAndReload(actualChanges, "[HMR] file change", generation);
  }

  getMetrics() {
    return this.optimizedWatcher?.getMetrics() ?? null;
  }

  cleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;

    const operation = this.performCleanup();
    this.cleanupPromise = operation;
    return operation.finally(() => {
      if (this.cleanupPromise === operation) this.cleanupPromise = undefined;
    });
  }

  private async performCleanup(): Promise<void> {
    // If cleanup races watcher acquisition, let acquisition either publish a
    // complete generation or fully roll itself back, then retire that result.
    // This prevents cleanup from returning while setup can still orphan a
    // native watcher after its last ownership check.
    await this.setupPromise?.catch(() => undefined);
    this.watcherGeneration++;
    this.watcherController?.abort();
    await this.optimizedWatcher?.cleanup();

    const watcher = this.fileWatcher;
    if (!watcher) {
      this.optimizedWatcher = undefined;
      this.watcherController = undefined;
      return;
    }

    try {
      watcher.close();
    } catch (error) {
      throw new Error("Failed to close file watcher", { cause: error });
    }

    const completionResults = await Promise.allSettled([
      ...(this.watcherTask ? [this.watcherTask] : []),
      ...(this.watcherDone ? [this.watcherDone] : []),
    ]);

    const cleanupFailures = completionResults
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason)
      .filter((error) => !this.watcherFailureReported || error !== this.watcherFailure);

    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, "File watcher cleanup did not complete cleanly");
    }

    this.fileWatcher = undefined;
    this.watcherController = undefined;
    this.watcherTask = undefined;
    this.watcherDone = undefined;
    this.optimizedWatcher = undefined;
    this.watcherFailureReported = false;
    this.watcherFailure = undefined;
  }
}
