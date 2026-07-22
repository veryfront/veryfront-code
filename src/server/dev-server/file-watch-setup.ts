import { serverLogger as logger } from "#veryfront/utils";
import { handleErrorWithFallback } from "#veryfront/errors";
import { join, relative, sep } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { OptimizedFileWatcher } from "./file-watcher.ts";
import type { RouteDiscovery } from "./route-discovery.ts";
import { ReloadNotifier } from "../reload-notifier.ts";
import { invalidateModulePaths } from "#veryfront/transforms/mdx/esm-module-loader/index.ts";

const hmrLog = logger.component("hmr");
const fileWatchSetupLog = logger.component("file-watch-setup");

const METRICS_LOG_INTERVAL = 10;

/** Default agent/chat primitive directories (used when no custom paths configured) */
const DEFAULT_PRIMITIVE_DIRS = ["tools", "agents", "workflows", "prompts", "resources"];

/**
 * Patterns for paths that should NOT trigger HMR updates.
 * These are generated/cached files that change during normal operation
 * but don't represent actual source code changes.
 */
const IGNORED_PATH_PATTERNS = [
  ".cache/",
  ".cache\\",
  "node_modules/",
  "node_modules\\",
  ".git/",
  ".git\\",
  ".veryfront/",
  ".veryfront\\",
  ".omx/",
  ".omx\\",
  // Tool output directories that live inside the project root. Tools such as
  // the Playwright MCP server write per-step artifacts here continuously,
  // which would otherwise drive an open-ended HMR refresh loop.
  ".playwright-mcp/",
  ".playwright-mcp\\",
];

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

/**
 * Check if a path should be ignored for HMR purposes — either because it lives
 * in a generated/output directory or because it is a generated-artifact file.
 *
 * Exported for unit testing.
 */
export function shouldIgnorePath(path: string): boolean {
  return IGNORED_PATH_PATTERNS.some((pattern) => path.includes(pattern)) ||
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

export class FileWatchSetup {
  private fileWatcher?: { close(): void };
  private watcherController?: AbortController;
  private optimizedWatcher?: OptimizedFileWatcher;
  private batchCount = 0;
  private primitiveDirs: Set<string>;
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
  ) {
    this.primitiveDirs = new Set(primitiveDirNames ?? DEFAULT_PRIMITIVE_DIRS);
  }

  async setup(): Promise<void> {
    try {
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
        (changes) => this.handleBatchedFileChanges(changes),
      );

      this.watcherController = new AbortController();
      const watcher = this.adapter.fs.watch(watchPaths, {
        recursive: true,
        signal: this.watcherController.signal,
      });

      this.fileWatcher = watcher;
      this.processFileWatcher(watcher, this.watcherController.signal);
    } catch (error) {
      hmrLog.warn("Failed to setup file watcher", error);
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
        if (!(await this.adapter.fs.exists(path))) continue;

        const stat = await this.adapter.fs.stat(path);
        if (stat.isDirectory) watchPaths.push(path);
      } catch (error) {
        hmrLog.debug(`Directory not found, skipping: ${path}`, error);
      }
    }

    return watchPaths;
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
            !shouldIgnorePath(p) && !this.isRuntimeDataPath(p) &&
            !isIgnoredOutputDir(this.projectDir, p)
          );
          if (relevantPaths.length === 0) continue;

          if (this.optimizedWatcher) {
            this.optimizedWatcher.handleChange(relevantPaths);
            continue;
          }

          await this.handleImmediateFileChange(relevantPaths);
        } catch (error) {
          hmrLog.error("Failed to handle file change", error);
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        hmrLog.error("File watcher task failed unexpectedly", error);
      }
    }
  }

  private async refreshAndReload(paths: string[], logMessage: string): Promise<void> {
    await handleErrorWithFallback(() => this.routeDiscovery.discoverRoutes(), undefined, logger);
    this.invalidateHandler();

    // Invalidate on-disk ESM cache for changed files immediately,
    // before the browser reloads, so the next SSR render picks up fresh content.
    const relativePaths = paths.map((p) => relative(this.projectDir, p).split(sep).join("/"));
    invalidateModulePaths(relativePaths);

    const display = paths.map((p) => p.replace(this.projectDir, ".")).join(", ");
    logger.debug(logMessage, { files: display });

    // Single source of truth for HMR signaling:
    // ReloadNotifier immediately invalidates runtime caches and then sends
    // one debounced browser update for both local dev and preview clients.
    ReloadNotifier.triggerReload(relativePaths);
  }

  /**
   * Check if a path is inside a configured primitive directory (tools/, agents/, etc.)
   * Uses path segment matching to avoid false positives from substrings.
   */
  private isPrimitivePath(fullPath: string): boolean {
    const rel = relative(this.projectDir, fullPath);
    const firstSegment = rel.split(sep)[0] ?? "";
    return this.primitiveDirs.has(firstSegment);
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

  private async handleBatchedFileChanges(changes: string[]): Promise<void> {
    const startTime = performance.now();

    // Skip files whose content hasn't actually changed (e.g., save without edits)
    const actualChanges = await this.filterChangedFiles(changes);
    if (actualChanges.length === 0) {
      hmrLog.debug("All file changes had identical content, skipping HMR");
      return;
    }

    // Check for primitive file changes and trigger re-discovery
    const hasPrimitiveChanges = actualChanges.some((p) => this.isPrimitivePath(p));
    if (hasPrimitiveChanges && this.rediscoverPrimitives) {
      await this.rediscoverPrimitives();
    }

    await this.refreshAndReload(actualChanges, "");

    const duration = (performance.now() - startTime).toFixed(0);
    hmrLog.debug(`Batch processed ${changes.length} file changes in ${duration}ms`, {
      files: changes.map((p) => p.replace(this.projectDir, ".")).join(", "),
    });

    this.batchCount++;
    if (this.optimizedWatcher && this.batchCount % METRICS_LOG_INTERVAL === 0) {
      hmrLog.debug("Performance metrics", this.optimizedWatcher.getMetrics());
    }
  }

  private async handleImmediateFileChange(paths: string[]): Promise<void> {
    const actualChanges = await this.filterChangedFiles(paths);
    if (actualChanges.length === 0) return;
    await this.refreshAndReload(actualChanges, "[HMR] file change");
  }

  getMetrics() {
    return this.optimizedWatcher?.getMetrics() ?? null;
  }

  cleanup(): void {
    this.watcherController?.abort();
    this.optimizedWatcher?.cleanup();

    if (!this.fileWatcher) return;

    try {
      this.fileWatcher.close();
    } catch (error) {
      fileWatchSetupLog.debug("Error closing file watcher (non-critical)", error);
    }
  }
}
